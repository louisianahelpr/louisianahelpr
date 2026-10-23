// Tell the Helpr when a transfer to them failed (transfer.failed). Until
// 2026-10-22 only Slack heard about it: the Helpr saw a payout that never came
// and nothing saying why (lead 2026-10-22, "file and fix").
//
// In-app notice + email (send-notification-email, which honours the member's
// own email switches). No text is sent from here. When the SMS alerts slice
// lands (migration 20261021193738, behind its own switch and opt-in), its
// sms_kind_for() maps this exact title to 'money_problem'.
//
// Never throws: the ledger flip and the re-queue already happened when this
// runs, and a retried webhook would page a zero-row re-queue. A notice that
// could not be written pages ops instead (the member was NOT told).
import { insertNotifications } from "../../_shared/insertNotifications.ts";
import { postSlackOpsAlert } from "../../_shared/slack-alerts.ts";
import { fetchFunction } from "../../_shared/functionFetch.ts";
import { caughtMessage } from "../../_shared/caughtMessage.ts";

export const PAYOUT_TRANSFER_FAILED_TITLE = "We couldn't send your payout";

export function payoutTransferFailedMessage(amountCents: number, requeued: boolean): string {
  const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Math.max(0, amountCents) / 100);
  return requeued
    ? `Your ${usd} payout didn't go through. We'll try again automatically. If it keeps failing, check your payout account in You → Money.`
    : `Your ${usd} payout didn't go through. We're looking into it and will contact you.`;
}

// deno-lint-ignore no-explicit-any
type Db = any;

/**
 * One notice per member per job per day FOR THE SAME WORDS: a payout the cron
 * retries and that fails again the same way does not notify again that day,
 * but a second failure that changes what we promise (re-queued -> not) does
 * (lh-silent-failure review, should-fix 1). A dedupe read that fails sends
 * anyway: a duplicate notice costs less than none (should-fix 2).
 */
export async function tellHelprPayoutFailed(
  supabase: Db,
  input: { userId: string; jobId: string | null; amountCents: number; requeued: boolean; transferId: string },
): Promise<{ told: boolean; emailed: boolean; reason?: string }> {
  const { userId, jobId, amountCents, requeued, transferId } = input;
  try {
    const title = PAYOUT_TRANSFER_FAILED_TITLE;
    const message = payoutTransferFailedMessage(amountCents, requeued);
    const link = "/profile?tab=earnings";
    let recent = supabase
      .from("notifications")
      .select("id")
      .eq("user_id", userId)
      .eq("title", title)
      .eq("message", message)
      .gte("created_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString())
      .limit(1);
    recent = jobId ? recent.eq("job_id", jobId) : recent.is("job_id", null);
    const { data: already, error: readErr } = await recent;
    if (readErr) {
      console.error(`[transfer.failed] could not read earlier payout notices for ${userId} (sending anyway): ${readErr.message}`);
    } else if ((already?.length ?? 0) > 0) {
      return { told: false, emailed: false, reason: "already_told_today" };
    }

    const ok = await insertNotifications(supabase, { user_id: userId, title, message, type: "financial_alerts", link, job_id: jobId });
    if (!ok) throw new Error("the in-app notice was not written");

    // deno-lint-ignore no-explicit-any
    const env = (globalThis as any).Deno?.env;
    const url = env?.get?.("SUPABASE_URL");
    const key = env?.get?.("SECRET_KEY") ?? env?.get?.("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) {
      console.error("[transfer.failed] no SUPABASE_URL / service key to reach send-notification-email");
      return { told: true, emailed: false };
    }
    // The in-app notice is written; the email is best effort and logged.
    const send = (async (): Promise<boolean> => {
      try {
        const res = await fetchFunction(`${url}/functions/v1/send-notification-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body: JSON.stringify({ user_id: userId, title, message, type: "financial_alerts", link, job_id: jobId }),
        }, {
          deadlineAt: Date.now() + 25_000,
          fetchImpl: (u, i) => fetch(u, { ...i, signal: AbortSignal.timeout(15_000) }),
        });
        if (!res.ok) console.error(`[transfer.failed] payout email for ${userId} answered ${res.status}`);
        return res.ok;
      } catch (e) {
        console.error(`[transfer.failed] payout email for ${userId} failed: ${caughtMessage(e)}`);
        return false;
      }
    })();
    // Off the webhook's answer when the runtime allows (should-fix 5): an
    // email that takes 15-40 s must not make Stripe count the delivery failed.
    const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
    if (rt?.waitUntil) {
      rt.waitUntil(send);
      return { told: true, emailed: false, reason: "email_in_background" };
    }
    return { told: true, emailed: await send };
  } catch (e) {
    await postSlackOpsAlert({
      kind: "payout_failed",
      severity: "critical",
      title: "Helpr payout failed AND the Helpr was not told",
      message: `Stripe transfer ${transferId} failed and the member's notice could not be written: ${caughtMessage(e)}. Tell them by hand.`,
      fields: { "Transfer ID": transferId, "User": userId, "Job": jobId ?? "—" },
    });
    return { told: false, emailed: false, reason: caughtMessage(e) };
  }
}

/**
 * A failed or canceled cancellation-fee transfer: its ledger row names no
 * member, so the transfer's metadata.helper_id does (else the destination
 * Connect account). The notice says "we're looking into it", never "we'll try
 * again": the caller pages ops critical, and void-cancelled-payments' retry
 * counts any non-reversed fee transfer in the job's group as already paid, so
 * a retry after a failed transfer is not certain (lh-silent-failure review,
 * should-fix 4).
 */
export async function tellFeePayeeFailed(
  supabase: Db,
  transfer: { id: string; amount: number; destination?: unknown; metadata?: Record<string, string> | null },
  logStep: (msg: string, data?: Record<string, unknown>) => void,
): Promise<void> {
  // The fee transfer carries its Helpr (void-cancelled-payments sets metadata.helper_id).
  const metaHelpr = String((transfer.metadata ?? {}).helper_id ?? "");
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(metaHelpr)) {
    const jobId = String((transfer.metadata ?? {}).job_id ?? "") || null;
    await tellHelprPayoutFailed(supabase, { userId: metaHelpr, jobId, amountCents: transfer.amount, requeued: false, transferId: transfer.id });
    return;
  }
  const { data: payee, error: payeeErr } = await supabase
    .from("profiles")
    .select("user_id")
    .eq("stripe_account_id", String(transfer.destination ?? ""))
    .maybeSingle();
  if (payeeErr || !payee?.user_id) {
    logStep("Cancellation-fee transfer did not settle; payee not found to tell", { id: transfer.id, error: payeeErr?.message });
    await postSlackOpsAlert({
      kind: "payout_failed",
      severity: "critical",
      title: "Helpr cancellation-fee transfer did not settle AND the Helpr could not be found to tell",
      message: `Stripe transfer ${transfer.id}: no profile links destination ${String(transfer.destination ?? "—")}${payeeErr ? ` (${payeeErr.message})` : ""}. Tell them by hand.`,
      fields: { "Transfer ID": transfer.id },
    });
    return;
  }
  const jobId = String((transfer.metadata ?? {}).job_id ?? "") || null;
  await tellHelprPayoutFailed(supabase, { userId: String(payee.user_id), jobId, amountCents: transfer.amount, requeued: false, transferId: transfer.id });
}

/**
 * A crew cancellation-fee SHARE transfer (metadata.share_id) that failed or was
 * canceled. Since Q2356 the webhook marks its crew_cancellation_fee_shares row
 * failed first (`recorded`), and the hourly run's share retry sends it again;
 * when no row matched, nothing retries it and ops must pay it by hand. The
 * share's Helpr is told "we're looking into it" and ops is paged critical
 * (lh-silent-failure review, should-fix 3). Returns whether it was a share.
 */
export async function tellCrewShareFailed(
  supabase: Db,
  transfer: { id: string; amount: number; metadata?: Record<string, string> | null },
  { recorded = false }: { recorded?: boolean } = {},
): Promise<boolean> {
  const md = transfer.metadata ?? {};
  if (md.type !== "cancellation_fee" || !md.share_id) return false;
  const helpr = String(md.helper_id ?? "");
  const jobId = String(md.job_id ?? "") || null;
  const known = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(helpr);
  if (known) {
    await tellHelprPayoutFailed(supabase, { userId: helpr, jobId, amountCents: transfer.amount, requeued: false, transferId: transfer.id });
  }
  await postSlackOpsAlert({
    kind: "payout_failed",
    severity: "critical",
    title: "Crew cancellation-fee share transfer did not settle",
    message: `Stripe transfer ${transfer.id} (crew share ${md.share_id}) did not settle. ${recorded ? "The share is marked failed and remembers this transfer, so the hourly void-cancelled-payments run sends it again (Q2356); if it fails again, pay it by hand." : "No crew_cancellation_fee_shares row matched it, so nothing retries it. Pay it by hand."} ${known ? "The Helpr was told we are looking into it." : "No Helpr is named on the transfer, so nobody was told."}`,
    fields: { "Transfer ID": transfer.id, "Share": String(md.share_id), "Job": jobId ?? "—", "Helpr": known ? helpr : "—" },
  });
  return true;
}
