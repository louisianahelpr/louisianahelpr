/**
 * F328 / F360b: the one-time setup fee a seller's first payout loses at its send, as the payout SQL decides it
 * (declutter_setup_fee_from_payout_cents 20261031232943: 0 for an admin or an identity_check_exempt seller, which is
 * every member while the ID check is off and an enrolled test account; else the unpaid onboarding fee, capped at $100).
 *
 * `unknown` is true while any input that could add the fee is not in yet (the switch, the admin check, the fee read):
 * a money figure then shows nothing rather than a figure too high by the fee (lh-money-escrow reviews 11-11).
 * `enabled` false skips the fee read where no row could take it.
 */
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useOnboardingFeeQuery } from "@/hooks/useOnboardingFee";
import { useIdentityCheckLastAnswerStore } from "@/lib/identityCheckSwitch";

const SETUP_FEE_CAP_CENTS = 10_000;

export function useSellerSetupFee(enabled = true): { cents: number; unknown: boolean } {
  const { profile, adminStatus } = useCurrentUser();
  // The switch's last real answer: null = not known (loading, or no read has ever succeeded); a failed refetch keeps it.
  const idAnswer = useIdentityCheckLastAnswerStore();
  const idSettled = idAnswer !== null;
  const idOn = idAnswer === true;
  // The seller has not paid it (profiles.onboarding_fee_paid, the SQL's own test) and is not a seeded test account.
  const possible = enabled && !!profile && profile.onboarding_fee_paid !== true && profile.is_seed !== true && adminStatus !== "admin";
  const applies = possible && idSettled && idOn && adminStatus === "not_admin";
  const fee = useOnboardingFeeQuery(applies);
  const unknown = possible && (!idSettled || adminStatus === "unknown" || (applies && !fee.isSuccess));
  return { cents: applies && fee.isSuccess ? Math.min(fee.data ?? 0, SETUP_FEE_CAP_CENTS) : 0, unknown };
}
