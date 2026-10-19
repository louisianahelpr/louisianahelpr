import type { QueryClient } from "@tanstack/react-query";

/**
 * The React Query cache layout of the hidden feature switches (useFeature,
 * src/hooks/useFeature.ts), in one place so a screen that needs to know
 * whether a switch's answer is IN reads the same keys the hook writes.
 *
 * ONE batched entry per user holds every switch ({key: boolean}, from
 * public.feature_switches_for_me), or null while that RPC is not deployed yet; in
 * that window each switch has its own entry (public.feature_enabled_for).
 *
 * "(all)" can never be a switch key (public.feature_switches.key is
 * ^[a-z][a-z0-9_]{1,62}$), and both keys sit under the "feature-enabled"
 * prefix, so FeatureSwitchesCard's invalidateQueries([FEATURE_SWITCH_PREFIX])
 * refetches them after a switch changes.
 */
export const FEATURE_SWITCH_PREFIX = "feature-enabled";
const ALL_SWITCHES = "(all)";

export function featureSwitchBatchKey(uid: string | null) {
  return [FEATURE_SWITCH_PREFIX, ALL_SWITCHES, uid] as const;
}

export function featureSwitchSingleKey(key: string, uid: string | null) {
  return [FEATURE_SWITCH_PREFIX, key, uid] as const;
}

/**
 * Has the server answered switch `key` for `uid` (yes, no, or an error, which
 * reads as off)? For a gate that shows a skeleton until then and a 404 after:
 * it pairs with useFeature(key), whose query re-renders the gate when the
 * answer lands. Mirrors useFeatureStatus().settled for a signed-in caller.
 */
export function featureSwitchSettled(qc: QueryClient, key: string, uid: string): boolean {
  const batch = qc.getQueryState<Record<string, boolean> | null>(featureSwitchBatchKey(uid));
  if (batch?.status === "error") return true;
  if (batch?.status !== "success") return false;
  if (batch.data !== null) return true;
  // The batched RPC is not deployed yet: the per-switch read decides.
  const single = qc.getQueryState(featureSwitchSingleKey(key, uid));
  return single?.status === "success" || single?.status === "error";
}
