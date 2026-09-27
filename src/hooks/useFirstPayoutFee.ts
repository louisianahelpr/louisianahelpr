import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useOnboardingFeeCents } from "@/hooks/useOnboardingFee";

/**
 * The one-time setup fee the VIEWER's next payout will lose, in cents; 0 when
 * none is due.
 *
 * `release-payout` and `process-scheduled-payouts` take
 * `platform_settings.onboarding_fee_cents` out of the first payout of any
 * account whose `profiles.onboarding_fee_paid` is not true (`!onboarding_fee_paid`,
 * so null counts as unpaid). This mirrors that predicate, so a take-home figure
 * shown before the work can subtract it instead of reading higher than what
 * lands (ME-008).
 *
 * The amount is the platform's live setting, never a constant. While the
 * profile or the setting is still loading (or the setting read fails) this
 * returns 0, the same "no number yet" answer `useOnboardingFeeCents` gives.
 */
export function useFirstPayoutFeeCents(): number {
  const feeCents = useOnboardingFeeCents();
  const { profile } = useCurrentUser();
  if (!profile || profile.onboarding_fee_paid === true || feeCents == null) return 0;
  return feeCents;
}
