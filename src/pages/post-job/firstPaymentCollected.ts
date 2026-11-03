import { supabase } from "@/integrations/supabase/client";
import { track, AhaEvent } from "@/lib/analytics";
import { report } from "@/lib/errorLogger";

/**
 * `jobs.payment_status` values (jobs_payment_status_check) that mean a job's money WAS collected at some point, or may
 * have been ('cancelling' is on its way out of either state, so it counts as paid: a false "first" is worse than a
 * missed one). 'held' is a card hold, not a collection; 'unpaid', 'failed', 'cancelled', 'abandoned' never collected.
 */
export const EVER_PAID_STATUSES = ["escrow", "payout_pending", "released", "refunded", "chargeback", "cancelling"] as const;

/**
 * First-payment aha for a checkout return.
 *
 * Q2114: it used to fire whenever the paid-job count was `<= 1` (a poster with NO paid job counted, and so did a
 * failed read). Q2115 (lh-silent-failure@1e0c79b08#4): the fix then counted jobs with a stripe_payment_intent_id,
 * which only the webhook writes, and ran on the first poster-confirmed read, usually before the webhook landed, so a
 * real first payment was not counted (and a gift-covered job, which has no intent, never was).
 *
 * Now the caller fires this only once the page has READ this job as paid (escrow / payout_pending / released), and
 * this counts the poster's OTHER jobs whose payment_status says money was collected: none means this is the first.
 * An unreadable read fires nothing (we do not know it is the first). Never throws: analytics must not break the page.
 */
export async function trackFirstPaymentCollected(jobId: string, props: Record<string, unknown>): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: others, error: othersError } = await supabase
      .from("jobs")
      .select("id")
      .eq("customer_id", user.id)
      .neq("id", jobId)
      .in("payment_status", [...EVER_PAID_STATUSES])
      .limit(1);
    if (othersError) {
      report(othersError, { tags: { source: "PaymentSuccess.firstPaymentCount" } });
      return;
    }
    if (Array.isArray(others) && others.length === 0) {
      track(AhaEvent.FirstPaymentCollected, { job_id: jobId, ...props });
    }
  } catch (e) {
    report(e, { tags: { source: "PaymentSuccess.firstPaymentCount" } });
  }
}
