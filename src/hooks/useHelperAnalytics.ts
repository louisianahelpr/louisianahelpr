// useHelperAnalytics — the single fetch behind /analytics.
//
// ONE RPC, and deliberately so. `get_helper_analytics` is SECURITY DEFINER and
// takes no user id: the subject is always `auth.uid()`. Two consequences worth
// stating, because both are load-bearing:
//
//  1. THE GATE IS NOT HERE. A Free or Basic caller gets `entitled:false` from
//     the database. The client renders the upgrade surface because the server
//     said so, not because a local `tier === "pro"` said so — a client-side
//     gate on a paid perk is a suggestion, and an audit already found exactly
//     that hole on `earlyAccess`.
//  2. RLS IS NOT LOAD-BEARING EITHER. After 20260831232513 a helper cannot
//     read `public.jobs` rows they are not party to, so the market half of
//     this page is unreachable from the client at any tier. The definer
//     function is the only path, which is why there is no "fall back to
//     querying the tables" branch below — there is nothing to fall back to.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { queryKeys } from "@/lib/queryKeys";
import type { HelperAnalyticsPayload } from "@/lib/helperAnalytics";

export const ANALYTICS_RANGES = [90, 365, 730] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];
export const DEFAULT_ANALYTICS_RANGE: AnalyticsRange = 365;

export const RANGE_LABELS: Record<AnalyticsRange, string> = {
  90: "90 days",
  365: "12 months",
  730: "2 years",
};

/**
 * Sentinel for "the migration has merged but db-deploy has not finished".
 *
 * CLAUDE.md requires a graceful PGRST202 fallback on every brand-new RPC,
 * because migrations deploy on merge and there is a window of a few minutes
 * where the code is live and the function is not. This is NOT swallowed into
 * an empty payload — an empty payload would render "no history yet" to a
 * helper with ten years of it, which is precisely the class of lie this page
 * exists to stop. It renders its own "coming online" state instead.
 */
export const ANALYTICS_PENDING_DEPLOY = "pending-deploy" as const;

export type HelperAnalyticsResult =
  | HelperAnalyticsPayload
  | typeof ANALYTICS_PENDING_DEPLOY;

export function isPendingDeploy(
  data: HelperAnalyticsResult | undefined,
): data is typeof ANALYTICS_PENDING_DEPLOY {
  return data === ANALYTICS_PENDING_DEPLOY;
}

export function useHelperAnalytics(
  userId: string | undefined,
  days: AnalyticsRange = DEFAULT_ANALYTICS_RANGE,
) {
  return useQuery<HelperAnalyticsResult>({
    queryKey: queryKeys.helperAnalytics.byUser(userId, days),
    enabled: !!userId,
    // Analytics is a "sit and read" screen, not a live feed. Five minutes stops
    // a tab-switch from re-running a multi-table aggregate for no new answer.
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    queryFn: async () => {
      // `as never` because the RPC is not in the generated Functions map until
      // types are regenerated post-deploy — the same cast JobPetCareSheet and
      // PetReportCard use for their new RPCs.
      const res = await supabase.rpc("get_helper_analytics" as never, {
        p_days: days,
      } as never);
      if (res.error && (res.error as { code?: string }).code === "PGRST202") {
        return ANALYTICS_PENDING_DEPLOY;
      }
      // Everything else throws, error intact — never swallow a Supabase error.
      return unwrap(res) as unknown as HelperAnalyticsPayload;
    },
  });
}
