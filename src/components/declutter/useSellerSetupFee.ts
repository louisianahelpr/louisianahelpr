/**
 * F328 / F360b / owner 11-11 ~3:25 PM: the one-time setup fee a seller's FIRST payout actually sent loses, and the one
 * sale it comes out of.
 *
 * The server decides both (declutter_my_setup_fee, 20261111212343): the fee by the send's own rule
 * (declutter_setup_fee_from_payout_cents: 0 for an admin, an identity_check_exempt seller (is_seed AND enrolled in
 * test_accounts) and every member while the ID check is off; else the unpaid onboarding fee, capped at $100), and the
 * sale by the payout run's own order. `server` is true when that answer is in; `orderId` then names the sale (null:
 * none). Before the function is deployed (PGRST202) the client's own reading below is used, with `orderId` undefined
 * (the card then works out the row itself, setupFeeAheadByOrder).
 *
 * `unknown` is true while any input that could add the fee is not in yet: a money figure then shows nothing rather
 * than a figure too high by the fee (lh-money-escrow reviews 11-11). `enabled` false skips the reads.
 */
import { useQuery } from "@tanstack/react-query";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useOnboardingFeeQuery } from "@/hooks/useOnboardingFee";
import { useIdentityCheckLastAnswerStore } from "@/lib/identityCheckSwitch";
import { fetchMySetupFee } from "@/lib/declutter/mySetupFee";

const SETUP_FEE_CAP_CENTS = 10_000;

export interface SellerSetupFee {
  cents: number;
  unknown: boolean;
  /** True when the server answered (declutter_my_setup_fee); false on the pre-deploy fallback. */
  server: boolean;
  /** The sale that takes the fee (server answer only); null: no sale of the seller's takes it. */
  orderId?: string | null;
}

export function useSellerSetupFee(enabled = true): SellerSetupFee {
  const { user, profile, adminStatus } = useCurrentUser();
  const uid = user?.id ?? "";
  const mine = useQuery({
    queryKey: ["declutter", "my-setup-fee", uid],
    queryFn: fetchMySetupFee,
    enabled: enabled && !!uid,
  });
  // PGRST202 only: the function is not deployed yet, so the client's own reading stands in.
  const fallback = mine.isSuccess && mine.data === null;
  // The switch's last real answer: null = not known (loading, or no read has ever succeeded); a failed refetch keeps it.
  const idAnswer = useIdentityCheckLastAnswerStore();
  const idSettled = idAnswer !== null;
  const idOn = idAnswer === true;
  // The seller has not paid it (profiles.onboarding_fee_paid, the SQL's own test) and is not a seeded test account.
  const possible = fallback && !!profile && profile.onboarding_fee_paid !== true && profile.is_seed !== true && adminStatus !== "admin";
  const applies = possible && idSettled && idOn && adminStatus === "not_admin";
  const fee = useOnboardingFeeQuery(applies);
  if (!enabled || !uid) return { cents: 0, unknown: false, server: false };
  if (mine.data) {
    return { cents: Math.min(mine.data.feeCents, SETUP_FEE_CAP_CENTS), unknown: false, server: true, orderId: mine.data.orderId };
  }
  if (!fallback) return { cents: 0, unknown: true, server: false };
  const unknown = possible && (!idSettled || adminStatus === "unknown" || (applies && !fee.isSuccess));
  return { cents: applies && fee.isSuccess ? Math.min(fee.data ?? 0, SETUP_FEE_CAP_CENTS) : 0, unknown, server: false };
}
