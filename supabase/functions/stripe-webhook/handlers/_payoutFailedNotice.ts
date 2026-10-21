// Tell the Helpr when a transfer to them failed (transfer.failed). Until
// 2026-10-22 only Slack heard about it: the Helpr saw a payout that never came
// and nothing saying why (lead 2026-10-22, "file and fix").
//
// In-app notice + email (send-notification-email, which honours the member's
// own email switches). The SMS alert follows on its own: the notice's title
// is one public.sms_kind_for() texts as 'money_problem' (20261021193738), and
// SMS is behind its own switch and opt-in.
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
 * One notice per member per job per day: a payout the cron retries and that
 * fails again does not notify again the same day.
 */
export async function tellHelprPayoutFailed(
  supabase: Db,
  input: { userId: string; jobId: string | null; amountCents: number; requeued: boolean; transferId: string },
): Promise<{ told: boolean; emailed: boolean; reason?: string }> {
  const { userId, jobId, amountCents, requeued, transferId } = input;
  try {
    let recent = supabase
      .from("notifications")
      .select("id")
      .eq("user_id", userId)
      .eq("title", PAYOUT_TRANSFER_FAILED_TITLE)
      .gte("created_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString())
      .limit(1);
    recent = jobId ? recent.eq("job_id", jobId) : recent.is("job_id", null);
    const { data: already, error: readErr } = await recent;
    if (readErr) throw new Error(`could not read earlier notices: ${readErr.message}`);
    if ((already?.length ?? 0) > 0) return { told: false, emailed: false, reason: "already_told_today" };

    const title = PAYOUT_TRANSFER_FAILED_TITLE;
    const message = payoutTransferFailedMessage(amountCents, requeued);
    const link = "/profile?tab=earnings";
    const ok = await insertNotifications(supabase, { user_id: userId, title, message, type: "financial_alerts", link, job_id: jobId });
    if (!ok) throw new Error("the in-app notice was not written");

    let emailed = false;
    // deno-lint-ignore no-explicit-any
    const env = (globalThis as any).Deno?.env;
    const url = env?.get?.("SUPABASE_URL");
    const key = env?.get?.("SECRET_KEY") ?? env?.get?.("SUPABASE_SERVICE_ROLE_KEY");
    if (url && key) {
      try {
        const res = await fetchFunction(`${url}/functions/v1/send-notification-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body: JSON.stringify({ user_id: userId, title, message, type: "financial_alerts", link, job_id: jobId }),
        }, {
          deadlineAt: Date.now() + 25_000,
          fetchImpl: (u, i) => fetch(u, { ...i, signal: AbortSignal.timeout(15_000) }),
        });
        emailed = res.ok;
        if (!res.ok) console.error(`[transfer.failed] payout email for ${userId} answered ${res.status}`);
      } catch (e) {
        // The in-app notice is written; the email is best effort and logged.
        console.error(`[transfer.failed] payout email for ${userId} failed: ${caughtMessage(e)}`);
      }
    } else {
      console.error("[transfer.failed] no SUPABASE_URL / service key to reach send-notification-email");
    }
    return { told: true, emailed };
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
 * member, so the destination Connect account does. void-cancelled-payments
 * retries the row, so the notice says "we'll try again".
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
    await tellHelprPayoutFailed(supabase, { userId: metaHelpr, jobId, amountCents: transfer.amount, requeued: true, transferId: transfer.id });
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
  await tellHelprPayoutFailed(supabase, { userId: String(payee.user_id), jobId, amountCents: transfer.amount, requeued: true, transferId: transfer.id });
}
