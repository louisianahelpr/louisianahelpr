import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { WebhookContext } from "../context.ts";
import { insertNotifications } from "../../_shared/insertNotifications.ts";
import { postSlackOpsAlert } from "../../_shared/slack-alerts.ts";
import { classifyParties } from "../../_shared/stripeMode.ts";

/**
 * payout.failed (board 143a): the member's BANK returned a payout from their
 * payout account. RECORD AND NOTICE ONLY (lead 10-21): no money moves here and
 * no retry logic changes. Stripe returns the money to the member's payout
 * balance; the member has to fix their bank before it can go out again.
 *
 * Idempotent: the router dedupes by event id (stripe_webhook_events), and the
 * row itself is unique per payout, so a second delivery records nothing and
 * sends no second notice. Fails LOUD: a lookup or write error throws, the
 * router rolls back its dedupe row and answers 500, and Stripe redelivers.
 */
/** A TEST-mode event, or a Helpr the Stripe-mode rule reads as a test or seed account. A failed read pages (not seed). */
// deno-lint-ignore no-explicit-any
async function isTestPayee(supabase: any, event: Stripe.Event, helperId: string | null): Promise<boolean> {
  if (event.livemode === false) return true;
  if (!helperId) return false;
  try {
    return (await classifyParties(supabase, [helperId])).get(helperId) !== "real";
  } catch {
    // Unreadable: treated as a real member, so a person is told.
    return false;
  }
}

const PAYOUT_FAILED_TITLE = "Your payout didn't go through";

function payoutFailedMessage(amountCents: number): string {
  const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amountCents / 100);
  return `Your payout of ${usd} didn't go through. Update your bank or card in You → Money.`;
}

export async function handlePayoutFailed(event: Stripe.Event, { supabase, logStep }: WebhookContext) {
  const payout = event.data.object as Stripe.Payout;
  // A connected account's payout carries `event.account`. Without one this is
  // the PLATFORM's own payout: not a member's money, nothing to tell anyone.
  const accountId = event.account;
  if (!accountId) {
    logStep("Skipped payout.failed: platform payout, not a member's", { payoutId: payout.id });
    await postSlackOpsAlert({
      kind: "payout_failed",
      severity: "critical",
      title: "Platform payout failed",
      message: `The platform's own payout ${payout.id} failed (${payout.failure_code ?? "no code"}).`,
      fields: { "Payout": payout.id },
    });
    return;
  }

  // Jobs audit 54b: the bank handed back an INSTANT payout. Its fee is now owed
  // back like any failed attempt's: this write only says so (no money moves here).
  // instant-payout returns it at the Helpr's next cash-out, and
  // process-scheduled-payouts every hour, before any new fee.
  // Review of 9c498193ff #3: FIRST, before the duplicate check below, and a
  // failed write throws (the router rolls back its dedupe row and Stripe
  // redelivers). After the check, a redelivery that found the failure already
  // recorded returned early and never marked the fee owed: a second fee could
  // follow. Repeat-safe: it moves only a row still reading "kept".
  const { data: returnedInstant, error: instantErr } = await supabase
    .from("instant_payouts")
    .update({ status: "failed", fee_state: "taken", error_message: `bank returned the payout: ${payout.failure_code ?? "no code"}` })
    .eq("stripe_payout_id", payout.id)
    .eq("fee_state", "kept")
    .select("id, helper_id");
  if (instantErr) throw new Error(`payout.failed: could not mark instant payout ${payout.id}: ${instantErr.message}`);
  const instantRow = (returnedInstant ?? [])[0] as { id: string; helper_id: string | null } | undefined;
  if (instantRow) {
    await postSlackOpsAlert({
      kind: "money_at_risk",
      severity: "critical",
      title: "A bank returned an instant payout: its fee is owed back",
      message: `Bank returned instant payout ${payout.id}. The fee goes back within the hour (process-scheduled-payouts), or when the member next opens cash out; reverse it by hand if it stays owed.`,
      fields: { "Account": accountId, "Payout": payout.id },
      // Review of 9c498193ff #4: a test account's payout never pages the owner.
      seed: await isTestPayee(supabase, event, instantRow.helper_id),
    });
  }

  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("user_id")
    .eq("stripe_account_id", accountId)
    .maybeSingle();
  if (profileErr) throw new Error(`payout.failed: member lookup failed for ${accountId}: ${profileErr.message}`);
  if (!profile) {
    // An account no profile links (a deleted member). Nobody to tell in-app;
    // ops must know, because the money is sitting in that payout balance.
    logStep("payout.failed for an account no profile links", { accountId, payoutId: payout.id });
    await postSlackOpsAlert({
      kind: "payout_failed",
      severity: "warning",
      title: "Payout failed on an account no member links",
      message: `Payout ${payout.id} on ${accountId} failed (${payout.failure_code ?? "no code"}); no profile links this account.`,
      fields: { "Account": accountId, "Payout": payout.id },
    });
    return;
  }

  const { data: inserted, error: insErr } = await supabase
    .from("payout_failures")
    .upsert(
      {
        user_id: profile.user_id,
        stripe_account_id: accountId,
        stripe_payout_id: payout.id,
        stripe_event_id: event.id,
        amount_cents: Math.max(0, payout.amount ?? 0),
        currency: payout.currency ?? "usd",
        failure_code: payout.failure_code ?? null,
        failed_at: new Date((event.created ?? Math.floor(Date.now() / 1000)) * 1000).toISOString(),
      },
      { onConflict: "stripe_payout_id", ignoreDuplicates: true },
    )
    .select("id");
  if (insErr) throw new Error(`payout.failed: could not record ${payout.id}: ${insErr.message}`);
  if (!inserted || inserted.length === 0) {
    logStep("payout.failed already recorded; no second notice", { payoutId: payout.id });
    return;
  }

  const sent = await insertNotifications(supabase, {
    user_id: profile.user_id,
    title: PAYOUT_FAILED_TITLE,
    message: payoutFailedMessage(payout.amount ?? 0),
    type: "warning",
    link: "/profile?tab=earnings",
  });
  if (!sent) {
    // Undo the record so Stripe's redelivery writes both again; otherwise the
    // retry would see the row, skip, and the member would never be told.
    const { error: undoErr } = await supabase.from("payout_failures").delete().eq("id", inserted[0].id).select("id");
    throw new Error(`payout.failed: notice for ${payout.id} not sent${undoErr ? ` (and undo failed: ${undoErr.message})` : ""}`);
  }

  logStep("Payout failure recorded and member told", { userId: profile.user_id, payoutId: payout.id, code: payout.failure_code });
  await postSlackOpsAlert({
    kind: "payout_failed",
    severity: "warning",
    title: "A member's bank payout failed",
    message: `Payout ${payout.id} (${payout.amount} ${payout.currency}) failed: ${payout.failure_code ?? "no code"}. The member was told.`,
    fields: { "Account": accountId, "Payout": payout.id },
    // payout_failed always pages (alertPolicy); one page per account per day
    // is enough, the member already has the notice and the Home card.
    oncePerDayKey: `payout_failed:${accountId}`,
  });
}
