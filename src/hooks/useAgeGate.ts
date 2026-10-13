import { useCallback, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { queryClient } from "@/lib/queryClient";
import { queryKeys } from "@/lib/queryKeys";
import { ageGateCopy, isUnder18, type AgeGateKind } from "@/lib/ageGate";

type CachedUser = { profile?: { date_of_birth?: string | null } | null } | undefined;

/**
 * The signed-in member's saved birthday, from the profile the app already
 * holds: useCurrentUser's ["currentUser", <id>] query, which every signed-in
 * route loads before an Apply or a Post. Sign-out clears the whole cache
 * (signOutWithPushCleanup -> queryClient.clear()), so the newest profile under
 * that prefix is the signed-in member's. Read from the app's one QueryClient,
 * the way PhotoPrompt does: no fetch, no provider and no auth bootstrap, so the
 * nav and every card can call it for free.
 */
function signedInBirthday(): string | null {
  let newest: { at: number; dob: string | null } | null = null;
  for (const q of queryClient.getQueryCache().findAll({ queryKey: queryKeys.currentUser.all })) {
    const data = q.state.data as CachedUser;
    if (!data?.profile) continue;
    if (!newest || q.state.dataUpdatedAt > newest.at) {
      newest = { at: q.state.dataUpdatedAt, dob: data.profile.date_of_birth ?? null };
    }
  }
  return newest?.dob ?? null;
}

const subscribe = (onChange: () => void) => queryClient.getQueryCache().subscribe(onChange);

/**
 * The under-18 grey-out (owner, 2026-10-12, Q1586(c)); the rule and the server
 * half are in src/lib/ageGate.ts.
 *
 * `underAge`   true only when the signed-in member's SAVED birthday makes them
 *              under 18 today. Signed out, profile not loaded, or no birthday:
 *              false, so nothing changes for them.
 * `gate(kind, go)`  a click handler that runs `go`, or, when under age, shows
 *              the one plain line instead. For entry points with no room for
 *              the line beside them (the nav's Post button, a menu item).
 * `gatedProps(kind)`  aria-disabled + data-age-gated, which index.css greys
 *              out. A real `disabled` cannot be tapped, so it could never say
 *              why; aria-disabled keeps the tap for the explanation.
 */
export function useAgeGate() {
  const dob = useSyncExternalStore(subscribe, signedInBirthday);
  const underAge = isUnder18(dob);

  const explain = useCallback((kind: AgeGateKind) => {
    toast.error(ageGateCopy(kind), { id: `age-gate-${kind}` });
  }, []);

  const gate = useCallback(
    <A extends unknown[]>(kind: AgeGateKind, go: (...args: A) => void) =>
      (...args: A) => {
        if (underAge) {
          explain(kind);
          return;
        }
        go(...args);
      },
    [underAge, explain],
  );

  const gatedProps = useCallback(
    (kind: AgeGateKind): { "aria-disabled"?: true; "data-age-gated"?: AgeGateKind } =>
      underAge ? { "aria-disabled": true, "data-age-gated": kind } : {},
    [underAge],
  );

  return { underAge, explain, gate, gatedProps };
}
