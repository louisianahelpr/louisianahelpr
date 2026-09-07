import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useAuthReady } from "@/hooks/useAuthReady";
import { queryKeys } from "@/lib/queryKeys";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

/**
 * The three possible answers to "is this person an admin?".
 *
 * `unknown` is NOT a synonym for `not_admin`, and conflating them is the bug
 * this type exists to prevent — see the note on `adminCheckFailed` in
 * `fetchCurrentUser`. A privilege check must still fail CLOSED on `unknown`
 * (deny access), but the UI must be able to tell the reader *why* it is
 * denying, and offer a retry, instead of silently redirecting an admin to
 * /dashboard because their connection was slow.
 */
export type AdminStatus = "admin" | "not_admin" | "unknown";

const PROFILE_QUERY_TIMEOUT_MS = 10000;
const DEBUG_AUTH = import.meta.env.DEV;

const withTimeout = async <T,>(promise: Promise<T>, ms = PROFILE_QUERY_TIMEOUT_MS): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => window.setTimeout(() => reject(new Error("Profile request timed out")), ms)),
  ]);
};

interface CurrentUser {
  user: ReturnType<typeof useAuthReady>["user"];
  profile: Profile | null;
  /**
   * CONFIRMED admin only. False for a confirmed non-admin AND for an
   * undetermined check — privilege checks fail closed. Anything that renders
   * a *consequence* of the denial (a redirect, an "access denied" screen)
   * must read {@link adminStatus} instead, so it can tell "we know you are
   * not an admin" apart from "we could not find out".
   */
  isAdmin: boolean;
  /** Tri-state role result: confirmed admin / confirmed not / could not determine. */
  adminStatus: AdminStatus;
  isLoading: boolean;
  /**
   * True when the profile query has finished (after all retries) and ended in
   * error. Distinct from `isLoading`: we are no longer waiting, the fetch
   * just failed. Callers (notably `ProtectedRoute`) use this to avoid
   * fail-open rendering when the profile can never arrive in this session
   * without a manual retry — see PR #303 follow-up.
   */
  isError: boolean;
  /** Force a re-fetch of the current user's profile (bypasses cache). */
  refresh: () => Promise<void>;
}

const fetchCurrentUser = async (
  userId: string,
): Promise<{ profile: Profile | null; isAdmin: boolean; adminCheckFailed: boolean }> => {
  // The profile lookup and the admin-role lookup are independent, so they
  // run concurrently — this query gates the app shell on load, and waiting
  // on one round trip instead of two halves that blocking time.
  //
  // The admin-role query always runs (it is not gated behind `pathname ===
  // "/admin"`): the Profile settings list uses `isAdmin` to decide whether to
  // render the "Admin panel" row (it was the Dashboard app bar's Shield button
  // until that bar was removed), and gating it meant the entry point was
  // permanently invisible on every other page, so admins had no way to
  // *reach* /admin in the first place.
  // The profile lookup is essential — if it fails, the caller SHOULD see an
  // error (ProtectedRoute renders the retry card). It throws on error.
  const profilePromise = withTimeout(
    Promise.resolve(supabase.from("profiles").select("*").eq("user_id", userId).maybeSingle()).then(({ data, error }) => {
      if (error) throw error;
      return data ?? null;
    }),
  );

  // The admin-role lookup must NEVER block the profile. It was previously in
  // the same `Promise.all`, so a `user_roles` RLS/permission/timeout failure
  // rejected the whole fetch and blanked the ENTIRE account screen with the
  // "We couldn't load this" card — even though the profile row was fine. So it
  // still catches its own failure and never rejects.
  //
  // What it must NOT do is report the failure as `false`. `.catch(() => false)`
  // made a slow network INDISTINGUISHABLE from "not an admin": AdminRoute read
  // `isAdmin === false` and bounced a real admin to /dashboard with nothing on
  // screen to say a lookup had failed — reproduced repeatedly against prod on
  // 2026-08-31 with the role row present and the response body confirmed
  // `[{"role":"admin"}]`, on a connection slow enough to cross the 10s timeout.
  // Two lanes lost the admin surfaces to it, and the owner would lose them the
  // same way on hotel wifi.
  //
  // A privilege check SHOULD fail closed — but "closed" means deny access, not
  // "assert they are a civilian". Those are different claims and only one of
  // them is a lie. So the failure is reported as its own third state and the
  // caller decides how to render it (AdminRoute: a retryable "couldn't verify"
  // card, not a redirect). Nothing downstream is granted anything on `unknown`.
  //
  // A genuine non-admin does NOT reach this branch: the "Users can read their
  // own roles" policy (USING auth.uid() = user_id) lets them read their own
  // rows, so no admin row resolves as `{ data: null, error: null }` — a real
  // answer, not an error. An error here really does mean "could not determine".
  // ONE attempt is not enough (AR-011, lh-authz-rls 2026-09-04): this whole
  // promise catches and RESOLVES on failure, so a slow/flaky connection never
  // reaches React Query's own `retry: 2` — that only applies to a REJECTED
  // query, and this one never rejects. Verified live: a single injected
  // HTTP 500 on this exact read locked a real admin out of /admin with no
  // automatic retry, needing a manual "Try again" tap. Retrying INSIDE the
  // existing 10s timeout budget (not adding a new one) means a fast error is
  // retried for free while a genuinely slow connection still gets the same
  // 10s it always had — not 30s of extra waiting for a legitimately down
  // network.
  const ADMIN_ROLE_ATTEMPTS = 3;
  const ADMIN_ROLE_RETRY_DELAY_MS = 250;
  const readAdminRoleOnce = () =>
    Promise.resolve(
      supabase.from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle(),
    ).then(({ data, error }): { ok: true; isAdmin: boolean } => {
      if (error) throw error;
      return { ok: true, isAdmin: !!data };
    });
  const adminPromise = withTimeout(
    (async (): Promise<{ ok: true; isAdmin: boolean }> => {
      let lastErr: unknown;
      for (let attempt = 0; attempt < ADMIN_ROLE_ATTEMPTS; attempt++) {
        if (attempt > 0) {
          await new Promise((resolve) => window.setTimeout(resolve, ADMIN_ROLE_RETRY_DELAY_MS * attempt));
        }
        try {
          return await readAdminRoleOnce();
        } catch (err) {
          lastErr = err;
        }
      }
      throw lastErr;
    })(),
  ).catch((err): { ok: false; isAdmin: false } => {
    // Loud on purpose: this used to vanish without a trace, which is most of
    // why it took a two-lane outage to find.
    console.error("[auth] admin role lookup failed — role state is UNKNOWN, not 'not admin':", err);
    return { ok: false, isAdmin: false };
  });

  // Promise.all, not sequential awaits: both are already in flight, but only
  // Promise.all attaches a rejection handler to the profile promise at the
  // same tick it was created. Awaiting them in sequence would let a fast
  // profile rejection land while nothing is listening — an unhandled rejection.
  const [profile, adminResult] = await Promise.all([profilePromise, adminPromise]);

  return { profile, isAdmin: adminResult.isAdmin, adminCheckFailed: !adminResult.ok };
};

/**
 * There is deliberately NO realtime subscription to the caller's own profile.
 *
 * There used to be one — a refcounted `profile-self-<uid>` channel binding
 * UPDATE on `public.profiles` — and it had never delivered a single event.
 * Migration 20260423164103 DROPPED `profiles` from the `supabase_realtime`
 * publication on purpose, to stop broadcasting sensitive PII, so from that day
 * the binding was dead. Supabase does not error on a binding to an unpublished
 * table; the channel simply reports CHANNEL_ERROR and retries forever, which
 * is why this survived so long — it read as working code and cost nothing
 * visible. (Filed as SF-017.)
 *
 * Re-publishing `profiles` is NOT the fix: that reopens the exact PII
 * broadcast the 2026-04 migration closed.
 *
 * What actually keeps the profile fresh is the query config below —
 * `staleTime: 30s` plus `refetchOnWindowFocus` and `refetchOnReconnect`. An
 * admin flipping `approval_status`, `idv_status`, `subscription_tier` or a ban
 * reaches an open client on the next focus or within 30 seconds. That was
 * always the real mechanism; it just was not the one the comments credited.
 */

export const useCurrentUser = (): CurrentUser => {
  const { user, isReady } = useAuthReady();
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.currentUser.byId(user?.id),
    queryFn: () => fetchCurrentUser(user!.id),
    enabled: isReady && !!user,
    // This is the ONLY mechanism that refreshes the profile — see the block
    // comment above `useCurrentUser` for why there is no realtime channel.
    // Short staleTime so approval-status changes (made by an admin) get picked
    // up quickly; focus/reconnect refetch covers the returning-user case.
    staleTime: 30 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: 2,
  });


  const refresh = async () => {
    if (!user?.id) return;
    await queryClient.invalidateQueries({ queryKey: queryKeys.currentUser.byId(user.id) });
  };

  useEffect(() => {
    if (!DEBUG_AUTH) return;
    console.log("[auth] useCurrentUser", {
      isReady,
      hasUser: !!user,
      userId: user?.id ?? null,
      queryLoading: isLoading,
      hasProfile: !!data?.profile,
      route: window.location.pathname,
    });
  }, [data?.profile, isLoading, isReady, user?.id]);

  // Tri-state, derived once. `unknown` covers both "the role query failed"
  // and "there is no settled result yet" — callers check `isLoading` first,
  // and a caller that forgets still lands on the safe, non-granting answer.
  //
  // `data.adminCheckFailed` can be undefined on a cache entry written by hand
  // (CompleteProfile.tsx setQueryData merges `{ profile, isAdmin }` over the
  // existing object). Undefined is falsy → "not failed", which is right: that
  // path carries the previously-resolved isAdmin forward rather than a failure.
  const adminStatus: AdminStatus = !data
    ? "unknown"
    : data.adminCheckFailed
      ? "unknown"
      : data.isAdmin
        ? "admin"
        : "not_admin";

  return {
    user,
    profile: data?.profile ?? null,
    // Confirmed-admin only: `unknown` grants nothing. The privilege check is
    // exactly as strict as it was before; what changed is that the *reason*
    // for a denial is now legible to the UI via `adminStatus`.
    isAdmin: adminStatus === "admin",
    adminStatus,
    // After all retries fail, `useQuery` reports `isLoading: false` *and*
    // `data: undefined`. We must NOT treat the missing data as "still
    // loading" in that case — doing so leaves callers blocked on a state
    // that will never resolve in this session, and (worse) lets
    // `ProtectedRoute` fall through its `isLoading && !user` guard and
    // render with no profile-based gate. Surface the error to callers
    // explicitly via `isError` and stop reporting `isLoading` once the
    // query has settled.
    isLoading: !isReady || (!!user && !isError && (isLoading || !data)),
    isError: !!user && isError,
    refresh,
  };
};
