import { supabase } from "@/integrations/supabase/client";
import { track, AhaEvent } from "@/lib/analytics";
import { report } from "@/lib/errorLogger";

/**
 * First-payment aha for a checkout return (Q2114). It used to fire whenever
 * the paid-job count was `<= 1`, so a poster with NO paid job (and every
 * visit of a poster with one) counted as a first payment, and a failed count
 * read (count null) did too. Now: the poster's paid jobs must be exactly ONE
 * and it must be THIS job; an unreadable read fires nothing (we do not know
 * it is the first). Never throws: analytics must not break the page.
 */
export async function trackFirstPaymentCollected(jobId: string, props: Record<string, unknown>): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: paid, error: paidError } = await supabase
      .from("jobs")
      .select("id")
      .eq("customer_id", user.id)
      .not("stripe_payment_intent_id", "is", null)
      .limit(2);
    if (paidError) {
      report(paidError, { tags: { source: "PaymentSuccess.firstPaymentCount" } });
      return;
    }
    if (paid?.length === 1 && paid[0].id === jobId) {
      track(AhaEvent.FirstPaymentCollected, { job_id: jobId, ...props });
    }
  } catch (e) {
    report(e, { tags: { source: "PaymentSuccess.firstPaymentCount" } });
  }
}
