import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";

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

/** The read behind {@link useOnboardingFeeCents}; `isPending` says the answer is not in yet. */
export function useOnboardingFeeQuery() {
  return useQuery({
    queryKey: ["platform-settings", "onboarding-fee-cents"],
    meta: { reportsItself: true },
    // An admin-edited price does not need to be fresh to the second, but it
    // must not be pinned for the life of the session either.
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<number | null> => {
      const { data, error } = await supabase.rpc("get_public_platform_settings");
      // Reported here (Q753: every payout preview reads this number) AND
      // THROWN (lh-money-escrow review of the Home money tiles, 2026-10-20):
      // a swallowed failure read as an ANSWER, so useFirstPayoutFeeKnown took
      // "no fee" for known and Home showed a take-home $2 high. Every caller
      // still gets null (useOnboardingFeeCents is `data ?? null`), so no
      // screen loses anything. `reportsItself` keeps the shared QueryCache
      // reporter from logging it twice.
      if (error) {
        report(error, { severity: "warning", tags: { source: "useOnboardingFeeCents" } });
        throw error;
      }
      const cents = (Array.isArray(data) ? data[0] : null)?.onboarding_fee_cents;
      // A zero or negative fee means the platform is not charging one, which
      // is not a number to put in a sentence about paying.
      return typeof cents === "number" && cents > 0 ? cents : null;
    },
  });
}

/** "$2" for a whole number of dollars, "$2.50" otherwise. `null` passes through. */
export function formatFeeLabel(cents: number | null): string | null {
  if (cents == null) return null;
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}
