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
  return useFeatureStatus(key).on;
}

/**
 * useFeature, plus WHETHER THE ANSWER IS IN. `settled` turns true once the
 * server has answered (yes, no, or an error: an error is an answer too, and it
 * reads as off), and straight away when signed out, since there is nothing to
 * ask. It is false while auth or the read is pending.
 *
 * For a page that must paint in ONE settled commit (Q169). Content that shows
 * only while a switch is on otherwise arrives after the rest of the page and
 * pushes it down (Q?profile-declutter-shift: on /profile at 375 the Declutter
 * row landed about 50 ms after Settings and moved it 90px, CLS 0.0599). Feed
 * `settled` to the page's useArrivalGate so the skeleton holds until the
 * answer is in.
 *
 * `lastAnswer` is the server's last SUCCESSFUL answer (null until one
 * arrives, and when signed out). A refetch that fails flips `on` to false but
 * leaves `lastAnswer` as it was: for a page that must not swap a member's
 * full view for a lesser one on a network blip (ShopPage), where the reads
 * behind the full view are gated on the server anyway. Gate nothing on it
 * that `on` should gate.
 *
 * The string-literal rule is the same as useFeature's
 * (featureSwitchRegistry.test.ts reads both).
 */
export function useFeatureStatus(key: FeatureKey): { on: boolean; settled: boolean; lastAnswer: boolean | null } {
  const { user, isReady } = useAuthReady();
  const uid = user?.id ?? null;
  const { data, isSuccess, isError } = useQuery({
    queryKey: ["feature-enabled", key, uid],
    enabled: isReady && !!uid,
    staleTime: 5 * 60_000,
    queryFn: async () => unwrap(await supabase.rpc("feature_enabled_for", { p_key: key })) === true,
  });
  // isSuccess, not data: a refetch that fails keeps the last data but flips
  // the status to error, and an error reads as off.
  const on = isReady && !!uid && isSuccess && data === true;
  const settled = isReady && (!uid || isSuccess || isError);
  // React Query keeps `data` from the last success through a failed refetch.
  const lastAnswer = isReady && !!uid && typeof data === "boolean" ? data : null;
  return { on, settled, lastAnswer };
}
