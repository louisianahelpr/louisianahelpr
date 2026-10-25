import { BadgeDollarSign, Loader2 } from "lucide-react";
import { JobStepPrimaryButton } from "@/components/job-card/JobActionRow";
import { usePayoutAfterHireOn } from "@/lib/payoutAfterHireSwitch";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { usePayoutSetupPaused } from "@/hooks/usePayoutSetupPaused";
import { useStartPayoutSetup } from "@/hooks/useStartPayoutSetup";
import { PayoutSetupPausedNotice } from "@/components/payouts/PayoutSetupPausedNotice";
import { FINISH_PAYOUT_SETUP_LABEL, JOB_PAYOUT_SETUP_HEADLINE, jobPayoutHeldLine, payoutAccountReady } from "@/lib/payoutAfterHire";

/**
 * "Finish payout setup to get paid. Your $X for this job is held until your
 * payout account is ready." (owner decision 2026-10-25, switch
 * payout_after_hire). On the hired Helpr's own job card while their payout
 * account is not ready, with the one button that runs Stripe's ID check and
 * bank setup. Renders nothing when the switch is off for them, while their
 * profile is loading, or once payouts are ready.
 *
 * While setup is not offered (usePayoutSetupPaused) the button gives way to
 * the paused notice: the pay is held either way.
 */
export function PayoutSetupJobNotice({ amountLabel }: { amountLabel: string | null }) {
  const on = usePayoutAfterHireOn();
  const { profile } = useCurrentUser();
  const setupPaused = usePayoutSetupPaused();
  const { start, loading } = useStartPayoutSetup("job_card");
  if (!on || !profile || payoutAccountReady(profile)) return null;
  return (
    <div role="status" data-payout-setup-job="" className="space-y-2">
      <div
        className="rounded-2xl px-4 py-3"
        // Inline, not `bg-card` (PaymentProblemNotice's reason: the T2 card rule).
        style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
      >
        <p className="font-sans font-bold text-ds-15 leading-snug text-foreground">{JOB_PAYOUT_SETUP_HEADLINE}</p>
        <p className="mt-0.5 text-ds-13 text-muted-foreground leading-snug">{jobPayoutHeldLine(amountLabel)}</p>
        {!setupPaused && (
          <div className="mt-3">
            <JobStepPrimaryButton
              icon={loading ? Loader2 : BadgeDollarSign}
              iconClassName={loading ? "animate-spin" : undefined}
              label={FINISH_PAYOUT_SETUP_LABEL}
              onClick={() => void start()}
              disabled={loading}
            />
          </div>
        )}
      </div>
      {setupPaused && <PayoutSetupPausedNotice compact />}
    </div>
  );
}
