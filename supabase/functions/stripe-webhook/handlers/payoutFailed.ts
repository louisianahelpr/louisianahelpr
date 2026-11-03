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

/**
 * Q2276 (a): a payout.paid for a LATER payout can be delivered before this
 * (retried) payout.failed. handlePayoutPaid then found no open row to close,
 * and the row inserted here stayed open, a stale Home card, until yet another
 * payout was paid. So ask Stripe: has a payout on this account been paid after
 * this failure? If so the row is written already resolved, at that payout's
 * arrival date. arrival_date is a date (midnight UTC), so a payout paid the
 * same day as the failure is not counted: the miss is a card left open until
 * the next payout.paid, never a real failure hidden. A failed read is only
 * logged: the row is written open, as before.
 */
async function paidAfter(stripe: Stripe, accountId: string, failedAtSec: number): Promise<string | null> {
  try {
    const paid = await stripe.payouts.list(
      { status: "paid", arrival_date: { gt: failedAtSec }, limit: 1 },
      { stripeAccount: accountId },
    );
    const arrival = Number(paid?.data?.[0]?.arrival_date);
    return Number.isFinite(arrival) && arrival > failedAtSec ? new Date(arrival * 1000).toISOString() : null;
  } catch (e) {
    console.error(`[payout.failed] could not ask Stripe for a later paid payout on ${accountId}; the failure is recorded open: ${(e as Error)?.message ?? e}`);
    return null;
  }
}

export async function handlePayoutFailed(event: Stripe.Event, { stripe, supabase, logStep }: WebhookContext) {
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

  const failedAtSec = event.created ?? Math.floor(Date.now() / 1000);
  const resolvedAt = await paidAfter(stripe, accountId, failedAtSec);
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
        failed_at: new Date(failedAtSec * 1000).toISOString(),
        // Q2276 (a): a later payout already paid means the bank works again.
        resolved_at: resolvedAt,
      },
      { onConflict: "stripe_payout_id", ignoreDuplicates: true },
    )
    .select("id");
  if (insErr) throw new Error(`payout.failed: could not record ${payout.id}: ${insErr.message}`);
  let failureId = (inserted ?? [])[0]?.id as string | undefined;
  if (!failureId) {
    // Q2276 (b): already recorded. A row whose notice never went out (the
    // first delivery's notice failed) is told now; one already told is not.
    const { data: existing, error: readErr } = await supabase
      .from("payout_failures")
      .select("id, notified_at, resolved_at")
      .eq("stripe_payout_id", payout.id)
      .maybeSingle();
    if (readErr) throw new Error(`payout.failed: could not read the recorded ${payout.id}: ${readErr.message}`);
    if (!existing || existing.notified_at) {
      logStep("payout.failed already recorded; no second notice", { payoutId: payout.id });
      return;
    }
    // Q2276 (a), lead 11-03: a row recorded resolved is never told.
    if (existing.resolved_at) {
      logStep("payout.failed already recorded resolved; no notice", { payoutId: payout.id });
      return;
    }
    failureId = existing.id as string;
  }

  // Q2276 (a), lead 11-03: written RESOLVED (a later payout already reached
  // the bank), so it is already fixed: no "didn't go through" notice and no
  // page. Written open (including when Stripe could not be asked): told.
  if (resolvedAt) {
    logStep("payout.failed recorded resolved: a later payout already arrived; member not told", { payoutId: payout.id, resolvedAt });
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
    // Q2276 (b): the row stays with notified_at NULL, so Stripe's redelivery
    // (this throw rolls back the router's dedupe row) sends the notice. No
    // delete: a failed undo used to leave a row that read "already told".
    throw new Error(`payout.failed: notice for ${payout.id} not sent; the redelivery sends it`);
  }
  // Only a row still unstamped: a concurrent redelivery that also told the
  // member is not stamped twice. A failed stamp is not thrown (the member WAS
  // told; a redelivery would tell them again), only logged loudly.
  const { error: stampErr } = await supabase
    .from("payout_failures")
    .update({ notified_at: new Date().toISOString() })
    .eq("id", failureId)
    .is("notified_at", null)
    .select("id");
  if (stampErr) console.error(`[payout.failed] notice for ${payout.id} sent but notified_at not stamped: ${stampErr.message}`);

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
