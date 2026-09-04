import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

const AUTH_BOOTSTRAP_TIMEOUT_MS = 2500;
// How long we will wait for a session RESTORE that we know is in flight (a
// token is in storage but getSession hasn't answered). Deliberately much
// longer than the bootstrap timeout: this path only runs for someone who is
// almost certainly signed in, and the alternative — declaring them logged out
// while their token refreshes — is the worse failure by a wide margin.
const AUTH_RESTORE_GRACE_MS = 15000;
// See ProtectedRoute.tsx — dev-only + opt-in via `?debug_auth=1`.
const DEBUG_AUTH =
  import.meta.env.DEV &&
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).has("debug_auth");

type AuthSnapshot = { user: User | null; isReady: boolean };

let authSnapshot: AuthSnapshot = { user: null, isReady: false };
let authBootstrapStarted = false;
const authListeners = new Set<(snapshot: AuthSnapshot) => void>();

const emitAuthSnapshot = (snapshot: AuthSnapshot) => {
  // Sentry breadcrumb on the first isReady=true transition — gives any
  // post-auth-ready error a clear "we got through the auth bootstrap"
  // marker in the dashboard. One-shot via the prior snapshot check.
  const justBecameReady = !authSnapshot.isReady && snapshot.isReady;
  authSnapshot = snapshot;
  if (DEBUG_AUTH) {
    console.log("[auth] snapshot", {
      isReady: snapshot.isReady,
      hasUser: !!snapshot.user,
      userId: snapshot.user?.id ?? null,
    });
  }
  if (justBecameReady) {
    void import("@/lib/sentry").then(({ markColdLaunchPhase }) =>
      markColdLaunchPhase("auth-ready-resolved"),
    );
  }
  authListeners.forEach((listener) => listener(snapshot));
};

/**
 * Is there a Supabase session sitting in storage right now?
 *
 * This is the difference between "we don't know yet" and "logged out", and
 * getting it wrong logs real users out — see the timeout note in
 * `getSessionWithTimeout`. A persisted `sb-<ref>-auth-token` means Supabase
 * has a session it is trying to restore (very likely refreshing an expired
 * access token over the network), so a slow answer must NOT be read as
 * "nobody is signed in".
 *
 * Wrapped in try/catch because localStorage THROWS, not returns null, in a
 * private window or when the browser is set to block site data.
 */
const hasPersistedSession = (): boolean => {
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key?.startsWith("sb-") && key.endsWith("-auth-token") && window.localStorage.getItem(key)) {
        return true;
      }
    }
  } catch {
    // Storage unreadable — fall through to "no persisted session", which is
    // the safe answer: it only costs a signed-out user a login redirect they
    // were getting anyway.
  }
  return false;
};

/**
 * Returns the session, plus whether we gave up waiting rather than learning
 * there is no session. Those two outcomes used to be the same value (`null`)
 * and that conflation is what logged people out:
 *
 *   getSession() has to REFRESH an expired access token over the network
 *   before it can answer, and every returning user past their token's ~1h
 *   expiry takes that path on cold load. On slow cellular or a cold start
 *   that refresh routinely exceeds AUTH_BOOTSTRAP_TIMEOUT_MS, the race
 *   resolved null, `markReady(null)` fired, and ProtectedRoute redirected to
 *   /login with reason "no-user-after-ready" — while the real session landed
 *   via onAuthStateChange(TOKEN_REFRESHED) a moment later, too late to matter.
 *
 * Reproduced 2026-09-04 with ?debug_auth=1: getSession {hasSession:false} ->
 * snapshot {isReady:true,hasUser:false} -> ProtectedRoute redirect ->
 * onAuthStateChange {event:TOKEN_REFRESHED, hasSession:true}.
 */
const getSessionWithTimeout = async (): Promise<{ session: Session | null; timedOut: boolean }> => {
  const TIMED_OUT = Symbol("auth-bootstrap-timeout");
  try {
    const result = await Promise.race([
      supabase.auth.getSession(),
      new Promise<typeof TIMED_OUT>((resolve) =>
        window.setTimeout(() => resolve(TIMED_OUT), AUTH_BOOTSTRAP_TIMEOUT_MS),
      ),
    ]);

    if (result === TIMED_OUT) return { session: null, timedOut: true };
    if (!result) return { session: null, timedOut: false };
    return { session: result.data.session ?? null, timedOut: false };
  } catch {
    return { session: null, timedOut: false };
  }
};

export const useAuthReady = () => {
  const [snapshot, setSnapshot] = useState<AuthSnapshot>(authSnapshot);

  useEffect(() => {
    authListeners.add(setSnapshot);
    if (authSnapshot.isReady) setSnapshot(authSnapshot);

    if (!authBootstrapStarted) {
      authBootstrapStarted = true;
      let initialized = false;

      const markReady = (session: Session | null) => {
        initialized = true;
        emitAuthSnapshot({ user: session?.user ?? null, isReady: true });
      };

      supabase.auth.onAuthStateChange((event, session) => {
        if (DEBUG_AUTH) {
          console.log("[auth] onAuthStateChange", {
            event,
            hasSession: !!session,
            userId: session?.user?.id ?? null,
          });
        }
        if (session || event === "SIGNED_OUT" || event !== "INITIAL_SESSION") {
          initialized = true;
          emitAuthSnapshot({ user: session?.user ?? null, isReady: true });
        }
      });

      // A restore is "in flight" when we timed out waiting for getSession AND
      // a token is sitting in storage. In that window we must not declare the
      // user signed out — we simply do not know yet, and onAuthStateChange
      // will tell us (SIGNED_IN / INITIAL_SESSION / TOKEN_REFRESHED).
      let restoreInFlight = false;

      void getSessionWithTimeout().then(({ session, timedOut }) => {
        if (DEBUG_AUTH) {
          console.log("[auth] getSession", {
            hasSession: !!session,
            userId: session?.user?.id ?? null,
            initialized,
            timedOut,
          });
        }
        // Timed out with a token still on disk: stay un-ready and let the
        // auth listener resolve it. Marking ready here is what redirected a
        // signed-in user to /login on any refresh slower than 2.5s.
        if (timedOut && !session && !initialized && hasPersistedSession()) {
          restoreInFlight = true;
          if (DEBUG_AUTH) console.log("[auth] restore in flight — deferring ready");
          return;
        }
        if (session || !initialized || !authSnapshot.user) markReady(session);
      });

      // Last-resort net. Two horizons on purpose: a visitor with NO stored
      // token gets the original snappy answer, while a token-holder whose
      // refresh is still crawling gets a much longer grace period before we
      // give up and let ProtectedRoute bounce them. Being slow to render for
      // someone who IS signed in is a far cheaper failure than logging them
      // out; the fast path is unchanged for everyone else.
      window.setTimeout(() => {
        if (!initialized && !restoreInFlight) {
          emitAuthSnapshot({ user: authSnapshot.user, isReady: true });
        }
      }, AUTH_BOOTSTRAP_TIMEOUT_MS + 250);

      window.setTimeout(() => {
        if (!initialized) emitAuthSnapshot({ user: authSnapshot.user, isReady: true });
      }, AUTH_RESTORE_GRACE_MS);
    }

    return () => {
      authListeners.delete(setSnapshot);
    };
  }, []);

  return snapshot;
};
