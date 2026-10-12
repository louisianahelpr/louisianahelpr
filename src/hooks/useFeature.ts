import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { useAuthReady } from "@/hooks/useAuthReady";
import type { FeatureKey } from "@/config/featureSwitches";

/**
 * Is hidden feature `key` on for the signed-in user?
 *
 * The SERVER decides (`public.feature_enabled_for`, which reads the audience
 * and the caller's admin role / test account membership); this only asks.
 * FALSE while loading, on any error and when signed out: a hidden feature that
 * flickers on, or shows because a read failed, has leaked. Hiding a control is
 * never the protection on its own: the RPC or edge function behind the feature
 * refuses too (`public.require_feature`, `requireFeature` in
 * supabase/functions/_shared/featureSwitch.ts).
 *
 * Call it with a string literal only: src/test/featureSwitchRegistry.test.ts
 * reads every call to keep the registry exact.
 */
export function useFeature(key: FeatureKey): boolean {
  const { user, isReady } = useAuthReady();
  const uid = user?.id ?? null;
  const { data, isSuccess } = useQuery({
    queryKey: ["feature-enabled", key, uid],
    enabled: isReady && !!uid,
    staleTime: 5 * 60_000,
    queryFn: async () => unwrap(await supabase.rpc("feature_enabled_for", { p_key: key })) === true,
  });
  // isSuccess, not data: a refetch that fails keeps the last data but flips
  // the status to error, and an error reads as off.
  return isReady && !!uid && isSuccess && data === true;
}
