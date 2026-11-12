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
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { fetchMySetupFee } from "@/lib/declutter/mySetupFee";

const SETUP_FEE_CAP_CENTS = 10_000;

// Q178 (critical path): the pre-deploy fallback's two inputs (the ID-check switch's last answer and the platform's
// onboarding fee) live in modules the chunker puts in signed-in-pages; imported statically they put that whole chunk
// on the Declutter Selling route. They load only when the fallback is in use (the server function not deployed).

/** The switch's last real answer, read through a lazily loaded identityCheckSwitch; null until it loads or answers. */
function useLazyIdentityCheckLastAnswer(active: boolean): boolean | null {
  const [answer, setAnswer] = useState<boolean | null>(null);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    let off: (() => void) | undefined;
    import("@/lib/identityCheckSwitch")
      .then((m) => {
        if (!alive) return;
        setAnswer(m.identityCheckLastAnswer());
        off = m.subscribeIdentityCheckLastAnswer(() => setAnswer(m.identityCheckLastAnswer()));
      })
      // A failed chunk load leaves the answer null: "not known", so no fee figure shows (never a guess).
      .catch((err) => console.warn("[declutter] identity check switch did not load", err));
    return () => {
      alive = false;
      off?.();
    };
  }, [active]);
  return answer;
}

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
  const idAnswer = useLazyIdentityCheckLastAnswer(fallback);
  const idSettled = idAnswer !== null;
  const idOn = idAnswer === true;
  // The seller has not paid it (profiles.onboarding_fee_paid, the SQL's own test) and is not a seeded test account.
  const possible = fallback && !!profile && profile.onboarding_fee_paid !== true && profile.is_seed !== true && adminStatus !== "admin";
  const applies = possible && idSettled && idOn && adminStatus === "not_admin";
  // The same query (key, staleTime, reportsItself) as useOnboardingFeeQuery, its module loaded only when read.
  const fee = useQuery({
    queryKey: ["platform-settings", "onboarding-fee-cents"],
    enabled: applies,
    meta: { reportsItself: true },
    staleTime: 10 * 60_000,
    queryFn: async () => (await import("@/hooks/useOnboardingFee")).fetchOnboardingFeeCents(),
  });
  if (!enabled || !uid) return { cents: 0, unknown: false, server: false };
  if (mine.data) {
    return { cents: Math.min(mine.data.feeCents, SETUP_FEE_CAP_CENTS), unknown: false, server: true, orderId: mine.data.orderId };
  }
  if (!fallback) return { cents: 0, unknown: true, server: false };
  const unknown = possible && (!idSettled || adminStatus === "unknown" || (applies && !fee.isSuccess));
  return { cents: applies && fee.isSuccess ? Math.min(fee.data ?? 0, SETUP_FEE_CAP_CENTS) : 0, unknown, server: false };
}
