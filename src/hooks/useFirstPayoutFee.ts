import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useOnboardingFeeCents, useOnboardingFeeQuery } from "@/hooks/useOnboardingFee";

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

/** {@link useFirstPayoutFeeCents} in dollars, the unit every take-home surface computes in. */
export function useFirstPayoutFeeDollars(): number {
  return useFirstPayoutFeeCents() / 100;
}

/**
 * True once {@link useFirstPayoutFeeCents} is the real answer, not the
 * "not loaded yet" 0: the profile is in, and either the fee is already paid
 * or the platform's setting has answered (a failed read has not). A surface that must show a number
 * or nothing (Home's "Coming to you", spec v2 §1.5) waits for this instead of
 * flashing a figure $2 too high.
 */
export function useFirstPayoutFeeKnown(): boolean {
  const { profile } = useCurrentUser();
  const fee = useOnboardingFeeQuery();
  if (!profile) return false;
  // isSuccess, never !isPending: a FAILED read is not an answer (lh-money-escrow, 2026-10-20).
  return profile.onboarding_fee_paid === true || fee.isSuccess;
}
