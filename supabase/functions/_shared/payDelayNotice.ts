/**
 * A payout that misses its day tells the Helpr (10-30 jobs audit, item 8). A failed
 * transfer told admins and Slack, and a payout held because the account cannot be
 * paid told ops, so the Helpr saw the promised day pass in silence.
 *
 * Notice only: it moves no money and decides nothing about the payout.
 *
 * The cron runs hourly and retries, so a blip fixed within the grace below is never
 * mentioned. After that it is at most once a day per job, like "Payout account
 * required" (the notifications dedupe trigger only looks back 10 minutes). A failed
 * read of today's notices sends it: one extra notice beats none.
 */
import { insertNotifications } from "./insertNotifications.ts";

const PAY_DELAYED_TITLE = "Your pay is delayed";
const PAY_DELAY_GRACE_HOURS = 12;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Whose side the delay is on. `account`: Stripe says their account can't be paid. */
export type PayDelayWhy = "account" | "sending";

/** The live-gate kinds that are about the Helpr's own account (not our platform, or a read that failed). */
export function payDelayWhyForGate(kind: string): PayDelayWhy {
  return kind === "not_payable" || kind === "rejected" || kind === "unusable" ? "account" : "sending";
}

/**
 * Says the why and what to do. "Profile → Payments" holds in both payout-setup
 * states: that screen shows the setup steps, or the paused notice.
 */
export function payDelayMessage(jobTitle: string, why: PayDelayWhy): string {
  return why === "account"
    ? `Your pay for "${jobTitle}" is delayed because your payout account can't receive money right now. Your pay is kept for you. Profile → Payments shows what's needed.`
    : `Your pay for "${jobTitle}" is delayed because we couldn't send it. You don't need to do anything. We're trying again and will tell you when it's sent.`;
}

/** Past the promised time by more than the grace. No readable time means it is not known to be late. */
export function payIsOverdue(payoutScheduledAt: string | null | undefined, now = Date.now()): boolean {
  const at = payoutScheduledAt ? Date.parse(payoutScheduledAt) : Number.NaN;
  return Number.isFinite(at) && now - at >= PAY_DELAY_GRACE_HOURS * 60 * 60 * 1000;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a supabase-js client, as in insertNotifications
type Db = { from: (table: string) => any };

export async function tellHelprPayIsDelayed(
  supabaseAdmin: Db,
  opts: {
    helperId: string;
    job: { id: string; title: string | null; payout_scheduled_at?: string | null; is_seed?: boolean | null };
    why: PayDelayWhy;
    source: string;
  },
): Promise<void> {
  const { helperId, job, why, source } = opts;
  if (job.is_seed === true || !payIsOverdue(job.payout_scheduled_at)) return;
  const { count, error } = await supabaseAdmin
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", helperId)
    .eq("job_id", job.id)
    .eq("title", PAY_DELAYED_TITLE)
    .gte("created_at", new Date(Date.now() - DAY_MS).toISOString());
  if (error) console.error(`[${source}] could not read today's pay-delay notices for ${helperId} (job ${job.id}); sending:`, error.message);
  if (!error && count) return;
  await insertNotifications(supabaseAdmin, {
    user_id: helperId,
    job_id: job.id,
    title: PAY_DELAYED_TITLE,
    message: payDelayMessage(job.title ?? "your job", why),
    type: "financial_alerts",
    link: why === "account" ? "/profile?tab=payment" : `/jobs?job=${job.id}`,
  });
}
