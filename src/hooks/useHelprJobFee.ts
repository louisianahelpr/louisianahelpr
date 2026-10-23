/**
 * The jobs fee for a job this member has not posted yet: 8% + $0.70 on the PayPal path (owner
 * ruling 2026-10-23, while `paypal_payments` is on for them), else 5% + $0.70. The database stamps
 * the same fee at post (enforce_jobs_fee_model_lock), and every payout prices a job by its stamp.
 *
 * `settled` is false until the switch has answered: a screen that quotes a figure waits for it
 * rather than flash today's fee to a PayPal tester.
 */
import { useFeatureStatus } from "@/hooks/useFeature";
import { helprJobFeeFor, type HelprJobFee } from "@/lib/helprFlatFee";

export function useHelprJobFee(): HelprJobFee & { settled: boolean } {
  const paypal = useFeatureStatus("paypal_payments");
  return { ...helprJobFeeFor(paypal.on), settled: paypal.settled };
}
