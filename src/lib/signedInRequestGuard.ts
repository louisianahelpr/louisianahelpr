/**
 * A signed-in member's request never leaves the device signed OUT.
 *
 * What happened, measured on prod (error_logs + edge logs, 2026-10-09 21:45Z,
 * one desktop session): a member's token refresh failed on the network
 * ("Failed to fetch", status 0); reads then went out with the publishable
 * bearer and got 401, and the next refresh succeeded under a second later.
 * (The phone sign-up bursts the same day are a different path: the stored
 * session itself went away, see "Not covered here" below.) auth-js keeps the
 * session in storage, but while the
 * stored access token is expired and the refresh has failed, `getSession()`
 * answers `session: null` (auth-js 2.117.2 `__loadSession`, the version the
 * lockfile ships), and for the next 60 s (REFRESH_FAILURE_COOLDOWN_MS) its
 * refresh cooldown hands every caller the same cached failure.
 * supabase-js then builds each request with the PUBLISHABLE key as its bearer
 * (`fetchWithAuth` falls back to `supabaseKey` when there is no session token;
 * edge-function calls go out with no Authorization at all). PostgREST runs
 * those as `anon`, so a signed-in screen gets:
 *   - "permission denied for table ..." / "for function ..." wherever anon has
 *     no grant, reported to Sentry and shown as "We couldn't load this";
 *   - worse, a quietly WRONG answer wherever anon may read (an anon read of a
 *     signed-in member's data is an empty list, not an error).
 *
 * So the client's fetch holds such a request back instead: a /rest/v1/,
 * /functions/v1/ or /storage/v1/ request that carries no member token while a
 * session is still stored on this device is rejected as a transport failure
 * (a TypeError whose message starts "Failed to fetch", the family
 * src/lib/networkFailure.ts recognises): the screen shows connection trouble,
 * and a write fails as "connection trouble" instead of being sent as anon.
 * postgrest-js's own read retries (1 s, 2 s, 4 s) mostly fall inside the 60 s
 * cooldown and RPCs (POST) are not retried at all, so RECOVERY is explicit:
 * every hold sets a flag, and client.ts, on the next TOKEN_REFRESHED or
 * SIGNED_IN, takes it (`takeHeldSinceRefresh`) and refetches the active
 * queries that ended in an error. A visitor with no stored session is
 * untouched: their requests go out exactly as before.
 *
 * A session that VANISHED from storage with no SIGNED_OUT in this tab (Q1596,
 * error_logs 2026-10-30 02:02:37Z: a Mac Chrome tab open 68 min, auth events
 * since load only INITIAL_SESSION, then ~16 signed-in reads all sent as anon
 * and refused; another tab or cleared site data removed the stored session) is
 * a real sign-out, but this page still believes it is signed in. Its requests
 * are held too, for at most VANISHED_HOLD_MS, and `onVanished` is told once so
 * the client finishes the sign-out locally (SIGNED_OUT: the app's own
 * signed-out path, ProtectedRoute sends the person to Log In). After this
 * tab's SIGNED_OUT, requests go out as a guest's again. Only a page that saw a
 * member session (`noteAuthState`) holds; a visitor is never touched.
 *
 * Guard: src/lib/signedInRequestGuard.test.ts drives the real supabase-js
 * client through it.
 */

type MaybeAsyncStorage = { getItem: (key: string) => string | null | Promise<string | null> };

export interface SignedInRequestGuardOptions {
  /** The project URL the client was built with. */
  supabaseUrl: string;
  /** The publishable (anon) key: the bearer supabase-js falls back to. */
  publishableKey: string;
  /** The SAME storage object the auth client persists its session in. */
  storage: MaybeAsyncStorage;
  /** The auth client's storage key (`sb-<project ref>-auth-token` by default). */
  storageKey: string;
  /** The fetch underneath (the app passes signOutAwareFetch). */
  fetchImpl: typeof fetch;
  /** Told about every held request (rate-limiting is the caller's choice). */
  onHeld?: (info: { surface: GuardedSurface; method: string }) => void;
  /** Told once when a member session vanished from storage without this tab's SIGNED_OUT. */
  onVanished?: () => void;
}

/** The data surfaces whose requests run as the bearer's database role. */
export const GUARDED_SURFACES = ["rest", "functions", "storage"] as const;
type GuardedSurface = (typeof GUARDED_SURFACES)[number];

/** The message prefix of a held request ("Failed to fetch" = transport family). */
export const HELD_MESSAGE =
  "Failed to fetch: signed-in request held (the sign-in is refreshing; it was not sent signed out)";

/** The message prefix of a request held because the stored session vanished (transport family too). */
export const VANISHED_MESSAGE =
  "Failed to fetch: signed-in request held (the sign-in is gone from this device; it was not sent signed out)";

/** The longest a vanished session holds requests if no SIGNED_OUT follows (then they go out as before). */
export const VANISHED_HOLD_MS = 10_000;

/** The default auth storage key supabase-js derives from the project URL. */
export function defaultAuthStorageKey(supabaseUrl: string): string {
  return `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;
}

const urlOf = (input: RequestInfo | URL): string =>
  typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

/** Origin + path, no trailing slash: the form supabase-js builds its URLs from (`new URL`). */
function normalisedBase(url: string): string | null {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`.replace(/\/+$/, "");
  } catch {
    // Silent by design: an unparseable URL is not one of the client's own
    // data-surface URLs, so nothing about it is held.
    return null;
  }
}

function surfaceOf(url: string, base: string): GuardedSurface | null {
  const at = normalisedBase(url);
  if (at === null || !at.startsWith(base)) return null;
  const path = at.slice(base.length) + "/";
  for (const surface of GUARDED_SURFACES) {
    if (path.startsWith(`/${surface}/v1/`)) return surface;
  }
  return null;
}

function authorizationOf(input: RequestInfo | URL, init: RequestInit | undefined): string | null {
  const fromInit = init?.headers ? new Headers(init.headers).get("Authorization") : null;
  if (fromInit !== null) return fromInit;
  if (typeof Request !== "undefined" && input instanceof Request) return input.headers.get("Authorization");
  return null;
}

/** Does the stored value hold a session auth-js could still refresh? */
function holdsRefreshableSession(raw: string | null): boolean {
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as { refresh_token?: unknown } | null;
    return typeof parsed?.refresh_token === "string" && parsed.refresh_token.length > 0;
  } catch {
    // Silent by design: an unparseable value is not a session auth-js could
    // use either (it discards it), so this device holds no session.
    return false;
  }
}

/** The same "could auth-js still refresh this?" read the guard uses, for client.ts's re-check. */
export function storedSessionIsRefreshable(raw: string | null): boolean {
  return holdsRefreshableSession(raw);
}

let heldSinceRefresh = false;

// Q1596: has this page load seen a member session (and no SIGNED_OUT since)?
let memberSessionSeen = false;
let vanishedAt: number | null = null;

/**
 * client.ts passes every auth event here. A session marks the page signed in;
 * SIGNED_OUT (this tab's, or one broadcast from another tab) marks it signed
 * out, so later requests are a guest's and go out untouched.
 */
export function noteAuthState(event: string, hasSession: boolean): void {
  if (event === "SIGNED_OUT") {
    memberSessionSeen = false;
    vanishedAt = null;
    return;
  }
  if (hasSession) {
    memberSessionSeen = true;
    vanishedAt = null;
  }
}

/** Is a vanished session still waiting for its SIGNED_OUT? (client.ts asks before signing out locally.) */
export function sessionVanishedPending(): boolean {
  return memberSessionSeen && vanishedAt !== null;
}

/**
 * Was any request held since the last call? Clears the flag. client.ts asks
 * on TOKEN_REFRESHED / SIGNED_IN and refetches the queries the hold failed.
 */
export function takeHeldSinceRefresh(): boolean {
  const held = heldSinceRefresh;
  heldSinceRefresh = false;
  return held;
}

export function guardSignedInRequests(opts: SignedInRequestGuardOptions): typeof fetch {
  // Normalised like supabase-js's own `new URL(...)`: a differently written env
  // value (case, trailing slash) must not make the guard silently inert.
  const base = normalisedBase(opts.supabaseUrl) ?? opts.supabaseUrl.replace(/\/+$/, "");
  const anonBearer = `Bearer ${opts.publishableKey}`;
  return async (input, init) => {
    const surface = surfaceOf(urlOf(input), base);
    if (surface) {
      const authorization = authorizationOf(input, init);
      const carriesNoMemberToken = authorization === null || authorization === anonBearer;
      if (carriesNoMemberToken) {
        let stored: string | null;
        try {
          stored = await opts.storage.getItem(opts.storageKey);
        } catch {
          // Silent by design: an unreadable store is the signed-out answer the
          // auth client itself would reach, so the request goes out unchanged.
          stored = null;
        }
        if (holdsRefreshableSession(stored)) {
          heldSinceRefresh = true;
          const method = (init?.method ?? (typeof Request !== "undefined" && input instanceof Request ? input.method : "GET")).toUpperCase();
          try {
            opts.onHeld?.({ surface, method });
          } catch {
            // Silent by design: reporting is diagnostics; the hold below is
            // what protects the member and must happen regardless.
          }
          throw new TypeError(HELD_MESSAGE);
        }
        if (memberSessionSeen) {
          const now = Date.now();
          if (vanishedAt === null) {
            vanishedAt = now;
            try {
              opts.onVanished?.();
            } catch {
              // Silent by design: finishing the sign-out is the caller's job;
              // the hold below still keeps this request from going out as anon.
            }
          }
          if (now - vanishedAt < VANISHED_HOLD_MS) throw new TypeError(VANISHED_MESSAGE);
          // No SIGNED_OUT came: stop holding, requests go out as they did before.
          memberSessionSeen = false;
          vanishedAt = null;
        }
      }
    }
    return opts.fetchImpl(input, init);
  };
}
