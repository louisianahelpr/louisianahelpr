import { PaymentProblemNotice } from "@/components/job-card/PaymentProblemNotice";
import { PayoutSetupJobNotice } from "@/components/payouts/PayoutSetupJobNotice";
import { cardPaymentProblem } from "@/lib/jobPaymentCardState";
import { usePayoutAfterHireOn } from "@/lib/payoutAfterHireSwitch";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { payoutAccountReady } from "@/lib/payoutAfterHire";

/** A hired Helpr's job whose payment is held: the pay waits on their payout account. */
const PAY_HELD = new Set(["escrow", "payout_pending"]);

/**
 * The money notes on the Helpr's own expanded job card, in one band:
 *   - Q360's payment problem (a chargeback or a declined card), the same words
 *     as the poster's card;
 *   - owner 2026-10-25 (switch payout_after_hire): "Finish payout setup to get
 *     paid" on a job they were hired for whose payment is held, while their
 *     payout account is not ready.
 * The band draws nothing when neither applies.
 *
 * JOBS2-44 (Jobs audit 10-30): the card draws the band twice, `only="problem"` above the step and `only="setup"` under
 * it, so on the day "Finish payout setup" never pushes the job's step down the card (the pay waits either way).
 */
export function HelperMoneyNotices({
  job,
  hired,
  amountLabel,
  only,
}: {
  job: { payment_status?: string | null; status?: string | null };
  hired: boolean;
  amountLabel: string | null;
  /** One of the two notes (JOBS2-44: the card puts the setup note under the step). Absent: both. */
  only?: "problem" | "setup";
}) {
  const payoutAfterHire = usePayoutAfterHireOn();
  const { profile } = useCurrentUser();
  const problem = only !== "setup" && !!cardPaymentProblem(job);
  const setupOwed = only !== "problem" && payoutAfterHire && hired && PAY_HELD.has(job.payment_status ?? "") && !!profile && !payoutAccountReady(profile);
  if (!problem && !setupOwed) return null;
  return (
    <div className="px-4 pt-3 pb-3 border-t border-border/30 space-y-3">
      {problem && <PaymentProblemNotice job={job} />}
      {setupOwed && <PayoutSetupJobNotice amountLabel={amountLabel} />}
    </div>
  );
}
