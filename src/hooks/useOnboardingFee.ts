import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

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
  const { data } = useQuery({
    queryKey: ["platform-settings", "onboarding-fee-cents"],
    // An admin-edited price does not need to be fresh to the second, but it
    // must not be pinned for the life of the session either.
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<number | null> => {
      const { data, error } = await supabase.rpc("get_public_platform_settings");
      // Deliberately NOT thrown: this drives a single word inside a sentence
      // that reads fine without it, and a failed price lookup must not take
      // the whole verification prompt off the screen.
      if (error) return null;
      const cents = (Array.isArray(data) ? data[0] : null)?.onboarding_fee_cents;
      // A zero or negative fee means the platform is not charging one, which
      // is not a number to put in a sentence about paying.
      return typeof cents === "number" && cents > 0 ? cents : null;
    },
  });
  return data ?? null;
}

/** "$2" for a whole number of dollars, "$2.50" otherwise. `null` passes through. */
export function formatFeeLabel(cents: number | null): string | null {
  if (cents == null) return null;
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}
