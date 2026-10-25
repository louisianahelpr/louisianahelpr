import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuthReady } from "@/hooks/useAuthReady";
import { queryKeys } from "@/lib/queryKeys";
import { isMissingRpcNamed } from "@/lib/missingRpc";
import { unwrap } from "@/lib/supabaseResult";

/**
 * May the signed-in member open a payout account yet? (Owner decision
 * 2026-10-25: payout setup moves from sign-up to the HIRE. Stripe rejected 45
 * of our 46 connected accounts, most opened at sign-up by people nobody hired.)
 *
 * The SERVER decides (public.payout_setup_hire_allowed_for_me, migration
 * 20261025162003: chosen for a job that holds money, an accept waiting on
 * setup, a payout already recorded, or a Declutter / Shops / Rentals seller);
 * stripe-connect refuses setup on its own (403 payout_setup_needs_hire). FALSE
 * while loading, on any error, when signed out and while the function is not
 * deployed yet (PGRST202): the app never offers a setup the server would
 * refuse. Under the activity query prefix, so the realtime refresh that shows a
 * new hire re-asks.
 */
export function usePayoutSetupHireAllowed(): boolean {
  const { user } = useAuthReady();
  const userId = user?.id ?? null;
  const { data } = useQuery({
    queryKey: queryKeys.activity.payoutSetupHire(userId),
    enabled: !!userId,
    staleTime: 60_000,
    // User-scoped and decides what a member may start: never restored from the persisted cache.
    meta: { persist: false },
    queryFn: async (): Promise<boolean> => {
      const res = await supabase.rpc("payout_setup_hire_allowed_for_me");
      // Not deployed yet (the web build can reach prod before db-deploy): not hired.
      if (res.error && isMissingRpcNamed(res.error, "payout_setup_hire_allowed_for_me")) return false;
      return unwrap(res) === true;
    },
  });
  return data === true;
}
