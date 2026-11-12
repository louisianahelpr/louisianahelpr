import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";
import { unwrap } from "@/lib/supabaseResult";

/**
 * The one-time account setup fee, in cents, as the platform actually charges it.
 *
 * `platform_settings.onboarding_fee_cents` is an admin-editable number (200
 * today) that `pay-onboarding-fee` reads at checkout time. Any copy quoting a
 * hard-coded "$2" is a price that can silently stop being true — the same
 * failure mode as the live Stripe price drift in CLAUDE.md, where the guard
 * compared code against our own UI instead of the charging authority.
 *
 * Returns `null` while loading or on failure, and every caller must render
 * something honest without it: an unquoted fee is a gap, a wrong fee is a lie.
 * `get_public_platform_settings` is the safe RPC — the raw table is not
 * readable by a member.
 */
export function useOnboardingFeeCents(): number | null {
  return useOnboardingFeeQuery().data ?? null;
}

/** The query key every reader of the setup fee shares (one cache entry, one request). */
export const ONBOARDING_FEE_QUERY_KEY = ["platform-settings", "onboarding-fee-cents"] as const;

/**
 * The read itself, for a caller that loads this module lazily (useSellerSetupFee keeps it off the Declutter Selling
 * route's critical path, Q178) and runs it under {@link ONBOARDING_FEE_QUERY_KEY}.
 */
export async function fetchOnboardingFeeCents(): Promise<number | null> {
  const res = await supabase.rpc("get_public_platform_settings");
  // Reported here (Q753: every payout preview reads this number) AND
  // THROWN through unwrap() (lh-money-escrow review of the Home money tiles, 2026-10-20):
  // a swallowed failure read as an ANSWER, so useFirstPayoutFeeKnown took
  // "no fee" for known and Home showed a take-home $2 high. Every caller
  // still gets null (useOnboardingFeeCents is `data ?? null`), so no
  // screen loses anything. `reportsItself` keeps the shared QueryCache
  // reporter from logging it twice.
  if (res.error) report(res.error, { severity: "warning", tags: { source: "useOnboardingFeeCents" } });
  const data = unwrap(res);
  const cents = (Array.isArray(data) ? data[0] : null)?.onboarding_fee_cents;
  // A zero or negative fee means the platform is not charging one, which
  // is not a number to put in a sentence about paying.
  return typeof cents === "number" && cents > 0 ? cents : null;
}

/**
 * The read behind {@link useOnboardingFeeCents}; `isPending` says the answer is not in yet. `enabled` false skips the
 * read where no fee can apply (F360b: a seller card list with no unsent payout, or a seller who already paid it).
 */
export function useOnboardingFeeQuery(enabled = true) {
  return useQuery({
    queryKey: ONBOARDING_FEE_QUERY_KEY,
    enabled,
    meta: { reportsItself: true },
    // An admin-edited price does not need to be fresh to the second, but it
    // must not be pinned for the life of the session either.
    staleTime: 10 * 60_000,
    queryFn: fetchOnboardingFeeCents,
  });
}

/** "$2" for a whole number of dollars, "$2.50" otherwise. `null` passes through. */
export function formatFeeLabel(cents: number | null): string | null {
  if (cents == null) return null;
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}
