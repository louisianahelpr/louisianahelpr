import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { loadModule } from "@/lib/loadModule";
import { report } from "@/lib/errorLogger";
import { recordColdLaunchPhase } from "@/lib/coldLaunchPhases";
import { noteAuthUser } from "@/lib/authUserChanged";
import { rememberHadSession } from "@/lib/hadSession";

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

/**
 * A SESSION WITH NO `user.id` IS NOT A SESSION — it is a corrupt one, and the
 * only safe reading of it is "signed out".
 *
 * `supabase.auth.getSession()` does not validate the shape of what comes back
 * out of storage: `__loadSession` checks that a session object exists and that
 * `expires_at` has not passed, then hands the stored `user` straight through
 * (@supabase/auth-js GoTrueClient `__loadSession`). This app supplies a CUSTOM
 * storage adapter on both platforms — the @capacitor/preferences adapter natively,
 * `getWebAuthStorage()`'s localStorage-or-in-memory fallback on the web — so
 * the bytes that become `session.user` have travelled through code that can
 * return a partial value, and nothing between there and here would notice.
 *
 * What that costs when it happens is not an error, which is the point:
 * `!!user` is true, so every id-keyed query downstream runs with
 * `undefined` as its filter. Measured on /home with the id stripped from
 * the persisted session — SEVEN malformed PostgREST requests on one page load,
 * from five different call sites:
 *
 *   /rest/v1/profiles?select=*&user_id=eq.undefined
 *   /rest/v1/user_roles?select=role&user_id=eq.undefined&role=eq.admin
 *   /rest/v1/user_blocks?...or=(blocker_id.eq.undefined,blocked_id.eq.undefined)
 *   /rest/v1/messages?...&receiver_id=eq.undefined&read=eq.false
 *   /rest/v1/notifications?select=*&user_id=eq.undefined  (×3 variants)
 *
 * Against prod those are 400s on a uuid column, so `useCurrentUser` throws and
 * every authed route renders "We couldn't load your account." with a Try again
 * that can never succeed — the profile is not missing, the request was never
 * answerable. Guarding each of those five call sites would be five guards for
 * one cause; the cause is that this snapshot is allowed to carry a user nobody
 * can query for. So it is normalised HERE, once, and the existing `!user`
 * branch in ProtectedRoute does what it already does well: send them to /login
 * with their intended path preserved, which is the correct remedy for a
 * session that cannot be used.
 *
 * Reported, not swallowed — this is abnormal and must be visible in Sentry if
 * it ever fires for a real account.
 */
const usableUser = (user: User | null): User | null => {
  if (!user || user.id) return user;
  report(new Error("useAuthReady: session carried a user with no id — treated as signed out"), {
    severity: "error",
    tags: { area: "auth", op: "sessionUserWithoutId" },
  });
  return null;
};

const emitAuthSnapshot = (rawSnapshot: AuthSnapshot) => {
  const snapshot: AuthSnapshot = { ...rawSnapshot, user: usableUser(rawSnapshot.user) };
  // Sentry breadcrumb on the first isReady=true transition — gives any
  // post-auth-ready error a clear "we got through the auth bootstrap"
  // marker in the dashboard. One-shot via the prior snapshot check.
  const justBecameReady = !authSnapshot.isReady && snapshot.isReady;
  authSnapshot = snapshot;
  noteAuthUser(snapshot.isReady, snapshot.user?.id ?? null);
  // F281a: this browser has held a session; /login tells a lapsed member from a guest by it.
  if (snapshot.user) rememberHadSession();
  if (DEBUG_AUTH) {
    console.log("[auth] snapshot", {
      isReady: snapshot.isReady,
      hasUser: !!snapshot.user,
      userId: snapshot.user?.id ?? null,
    });
  }
  if (justBecameReady) {
    // Buffered, not `import("@/lib/sentry")`: that fetched the whole Sentry
    // SDK mid cold-load for a breadcrumb it then dropped (Q178). sentry.ts
    // replays it on init; see coldLaunchPhases.ts.
    recordColdLaunchPhase("auth-ready-resolved");
  }
  authListeners.forEach((listener) => listener(snapshot));
};

/**
 * Sign-out's floor says "signed out" to the app itself.
 *
 * When auth.signOut() fails or hits its cap, signOutWithPushCleanup clears
 * the stored session by hand (clearPersistedAuthToken + the Keychain). That
 * floor emits no SIGNED_OUT, and when the cap fired while an expired token's
 * refresh was hung (started before the sign-out's abort scope, so nothing can
 * abort it, and signOut() waits on it before sending /logout), auth-js emits
 * none either. This snapshot then kept the old user: the app stayed "signed
 * in" with no session, and on the app NativeRedirect sent "/" back to /home.
 * src/lib/authSignOut.expiredRefresh.test.ts drives that case.
 */
export const forceSignedOutSnapshot = () => {
  if (authSnapshot.isReady && !authSnapshot.user) return;
  emitAuthSnapshot({ user: null, isReady: true });
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

/** auth-js refreshes a stored session this close to expiry before getSession() answers (EXPIRY_MARGIN_MS, 3 x 30 s). */
const REFRESH_MARGIN_MS = 90_000;

/** The app's own auth storage key (defaultAuthStorageKey in src/lib/signedInRequestGuard.ts, copied: no import here). */
const authStorageKey = (): string | null => {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (!url) return null;
  try {
    return `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
  } catch {
    // Silent by design: a malformed project URL means no client either; the bootstrap below answers as it always did.
    return null;
  }
};

/** The native app keeps its session in the Keychain; its localStorage copy is a mirror, never read here. */
const isNativeShell = (): boolean => {
  const cap = (window as unknown as { Capacitor?: { getPlatform?: () => string; isNativePlatform?: () => boolean } }).Capacitor;
  if (!cap) return window.location.protocol === "capacitor:";
  try {
    return cap.isNativePlatform?.() === true || (typeof cap.getPlatform === "function" && cap.getPlatform() !== "web");
  } catch {
    // Silent by design: a half-initialised bridge is treated as native, which only keeps the old (waiting) path.
    return true;
  }
};

/**
 * A RETURNING VISITOR'S FIRST SCREEN NEVER WAITS ON THE TOKEN REFRESH
 * (Q1158 / Q1170, 2026-11-22; prod-audit 45000593002: mobile /home LCP 4256 ms
 * with a fresh token, 19504 ms with an expired one; /messages 1936 -> 18824).
 *
 * A visitor back after an hour has an expired access token, and getSession()
 * answers only once auth-js has refreshed it over the network. When that
 * refresh is slow or fails on the network (auth-js retries with backoff for up
 * to ~25 s and keeps the session), nothing here was ready: ProtectedRoute held
 * its skeleton until AUTH_RESTORE_GRACE_MS (15 s), then bounced a member whose
 * session was still good to Log In. So when the stored session is one auth-js
 * must refresh before it can answer (web, an expired or expiring access token,
 * a refresh token and a user id), the bootstrap is ready AT ONCE with that
 * stored user, and the refresh carries on in the background:
 *   - refreshed: TOKEN_REFRESHED / getSession() hands over the same user;
 *   - refused (revoked, already used): auth-js removes the session and emits
 *     SIGNED_OUT, the snapshot turns signed out, ProtectedRoute sends the
 *     person to Log In, as before;
 *   - failed on the network: the session stays stored, and the member stays
 *     signed in; their data requests wait on the same refresh inside
 *     supabase-js, and any sent before it lands are held, never sent signed
 *     out (src/lib/signedInRequestGuard.ts), and refetched on TOKEN_REFRESHED.
 * Trust is unchanged: getSession() hands out this same stored user, unverified,
 * whenever its token has life left; every read is still decided by the server
 * on the refreshed token. Native keeps the old path (its Keychain is the store).
 *
 * Guard: src/hooks/useAuthReady.expiredRestore.test.tsx; lab budget: the
 * expired-token test in e2e/web-vitals/first-screens.spec.ts.
 */
const storedUserAwaitingRefresh = (): User | null => {
  try {
    if (isNativeShell()) return null;
    const key = authStorageKey();
    const raw = key ? window.localStorage.getItem(key) : null;
    if (!raw) return null;
    const stored = JSON.parse(raw) as { refresh_token?: unknown; expires_at?: unknown; user?: { id?: unknown } | null } | null;
    if (typeof stored?.refresh_token !== "string" || !stored.refresh_token) return null;
    if (typeof stored.expires_at !== "number" || typeof stored.user?.id !== "string" || !stored.user.id) return null;
    if (stored.expires_at * 1000 - Date.now() >= REFRESH_MARGIN_MS) return null;
    return stored.user as User;
  } catch {
    // Silent by design: storage blocked or a corrupt session is the old path (getSession decides), never a guess.
    return null;
  }
};

/** Does storage still hold a session auth-js could refresh? (A refused refresh removes it.) */
const storedSessionStillRefreshable = (): boolean => {
  try {
    const key = authStorageKey();
    const raw = key ? window.localStorage.getItem(key) : null;
    const stored = raw ? (JSON.parse(raw) as { refresh_token?: unknown } | null) : null;
    return typeof stored?.refresh_token === "string" && stored.refresh_token.length > 0;
  } catch {
    // Silent by design: unreadable storage holds no session to keep the member signed in with.
    return false;
  }
};

/**
 * Q2705/Q2706 slice 4 (Builder 3, 11-04): the Supabase client (30 KB gz) loads off the boot path; auth takes it on
 * first use. Null only when a recovery reload prevented the chunk (loadModule); a real load failure rejects.
 */
let clientLoad: Promise<SupabaseClientType | null> | null = null;
type SupabaseClientType = typeof import("@/integrations/supabase/client")["supabase"];
const loadClient = (): Promise<SupabaseClientType | null> => {
  // One load shared by the listener and getSession (they start together); a failed load is retried next time.
  const load = (clientLoad ??= loadModule(() => import("@/integrations/supabase/client")).then((m) => m?.supabase ?? null));
  load.catch(() => { clientLoad = null; });
  return load;
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
      // No client (a recovery reload is under way): answer as a timeout, so a stored token is never read as signed out.
      loadClient().then(async (client) => (client ? await client.auth.getSession() : TIMED_OUT)),
      new Promise<typeof TIMED_OUT>((resolve) =>
        window.setTimeout(() => resolve(TIMED_OUT), AUTH_BOOTSTRAP_TIMEOUT_MS),
      ),
    ]);

    if (result === TIMED_OUT) return { session: null, timedOut: true };
    if (!result) return { session: null, timedOut: false };
    return { session: result.data.session ?? null, timedOut: false };
  } catch (err) {
    // Not silent: `getSession()` throwing is abnormal (a corrupt or
    // unreadable stored session), and it is indistinguishable from a clean
    // signed-out boot to everything downstream — the user simply lands on
    // /login with nothing recorded. Report it, then fall through to the
    // signed-out answer, which is the only safe one available here.
    report(err, { severity: "warning", tags: { area: "auth", op: "bootstrapGetSession" } });
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

      // Q1158/Q1170: a stored session auth-js must refresh first is ready NOW with its stored user; the refresh
      // carries on in the background (storedUserAwaitingRefresh above says what each outcome does).
      const restoredUser = storedUserAwaitingRefresh();
      if (restoredUser) {
        initialized = true;
        emitAuthSnapshot({ user: restoredUser, isReady: true });
      }

      void loadClient().then((client) => client?.auth.onAuthStateChange((event, session) => {
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
      })).catch((err: unknown) => {
        // The client chunk failed to load: getSession below fails the same way and is reported there.
        if (DEBUG_AUTH) console.log("[auth] client load failed", err);
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
        // A restored member whose getSession() answered null keeps their stored user only while storage still holds
        // a refreshable session (the refresh failed on the network); a session gone without SIGNED_OUT is signed out.
        if (restoredUser && !session) {
          if (!timedOut && !storedSessionStillRefreshable()) markReady(null);
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
