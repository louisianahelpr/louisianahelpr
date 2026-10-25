import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { isMissingRpcNamed } from "@/lib/missingRpc";
import { featureSwitchBatchKey, featureSwitchSingleKey } from "@/lib/featureSwitchQuery";
import { useAuthReady } from "@/hooks/useAuthReady";
import { FEATURE_SWITCH_KEYS, type FeatureKey } from "@/config/featureSwitches";

const STALE_MS = 5 * 60_000;

/**
 * Switch answers are user-scoped and decide what a member may see, so they are
 * never written to the persisted cache: a restored answer from another session
 * (or from before an admin flipped the switch) must not show a hidden feature.
 *
 * reportsItself: true — the hook already handles every failure gracefully
 * (on = false, settled = true), so a 42501 "permission denied" from an expired
 * session is not actionable Sentry noise. The global QueryCache error handler
 * skips this query; auth errors resolve on the next auth refresh.
 */
const SWITCH_QUERY_META = { persist: false, reportsItself: true } as const;

/**
 * Every registered switch for the caller in ONE request
 * (public.feature_switches_for_me, migration 20261019043416), as {key: boolean}.
 *
 * nightly-red #2601: useFeature used to call feature_enabled_for once per
 * switch per cold load (loading-states-refresh 39158661660: 480 calls over 118
 * signed-in boots, 3-6 each). Every useFeature/useFeatureStatus now observes
 * this ONE query and selects its own key, so N switches on a page cost one
 * request, one retry chain and one error report. Returns null only when the
 * batched RPC is not deployed yet (isMissingRpcNamed: PGRST202 with no hint, or a
 * hint naming another function; the web
 * build can reach prod before db-deploy has applied the migration); each switch
 * then asks feature_enabled_for on its own, as before. Any other error throws.
 */
async function fetchAllSwitches(): Promise<Record<string, boolean> | null> {
  const res = await supabase.rpc("feature_switches_for_me", { p_keys: [...FEATURE_SWITCH_KEYS] });
  if (res.error && isMissingRpcNamed(res.error, "feature_switches_for_me")) return null;
  const data = unwrap(res);
  const out: Record<string, boolean> = {};
  if (data && typeof data === "object" && !Array.isArray(data)) {
    // Only a literal true is on; anything else in the answer reads as off.
    for (const [k, v] of Object.entries(data)) out[k] = v === true;
  }
  return out;
}

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
  const signedIn = isReady && !!uid;
  // ONE observed query for every switch; `select` picks this key out of it.
  // Gates that read the cache directly use featureSwitchSettled (same keys).
  // undefined = the batched RPC is not deployed yet (see fetchAllSwitches).
  const batch = useQuery({
    queryKey: featureSwitchBatchKey(uid),
    enabled: signedIn,
    staleTime: STALE_MS,
    meta: SWITCH_QUERY_META,
    queryFn: fetchAllSwitches,
    select: (all: Record<string, boolean> | null) => (all === null ? undefined : all[key] === true),
  });
  // Only while the batched RPC is missing: the old per-switch read.
  const missing = batch.isSuccess && batch.data === undefined;
  const single = useQuery({
    queryKey: featureSwitchSingleKey(key, uid),
    enabled: signedIn && missing,
    staleTime: STALE_MS,
    meta: SWITCH_QUERY_META,
    queryFn: async () => unwrap(await supabase.rpc("feature_enabled_for", { p_key: key })) === true,
  });
  const answer = missing ? single : batch;
  // isSuccess, not data: a refetch that fails keeps the last data but flips
  // the status to error, and an error reads as off.
  const on = signedIn && answer.isSuccess && answer.data === true;
  const settled = isReady && (!uid || answer.isSuccess || answer.isError);
  // React Query keeps `data` from the last success through a failed refetch.
  const lastAnswer = signedIn && typeof answer.data === "boolean" ? answer.data : null;
  return { on, settled, lastAnswer };
}
