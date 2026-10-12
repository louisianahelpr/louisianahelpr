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
 * answers `session: null` (auth-js 2.116.0 `__loadSession`), and for the next
 * ~60 s its refresh cooldown hands every caller the same cached failure.
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
 * src/lib/networkFailure.ts recognises). postgrest-js then retries an
 * idempotent read itself (1 s, 2 s, 4 s), and every retry asks auth-js for the
 * session again, so the read goes out with the member's token as soon as the
 * refresh lands; a write fails as "connection trouble" instead of being sent
 * as anon. A visitor with no stored session is untouched: their requests go
 * out exactly as before.
 *
 * Not covered here, on purpose: a session that is GONE from storage while a
 * screen still believes it is signed in. That is a real sign-out, and the
 * session-lost net (ProtectedRoute + src/lib/sessionLoss.ts) sends the person
 * to Log In on the first denial.
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
}

/** The data surfaces whose requests run as the bearer's database role. */
export const GUARDED_SURFACES = ["rest", "functions", "storage"] as const;
type GuardedSurface = (typeof GUARDED_SURFACES)[number];

/** The message prefix of a held request ("Failed to fetch" = transport family). */
export const HELD_MESSAGE =
  "Failed to fetch: signed-in request held (the sign-in is refreshing; it was not sent signed out)";

/** The default auth storage key supabase-js derives from the project URL. */
export function defaultAuthStorageKey(supabaseUrl: string): string {
  return `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;
}

const urlOf = (input: RequestInfo | URL): string =>
  typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

function surfaceOf(url: string, base: string): GuardedSurface | null {
  if (!url.startsWith(base)) return null;
  const path = url.slice(base.length);
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

export function guardSignedInRequests(opts: SignedInRequestGuardOptions): typeof fetch {
  const base = opts.supabaseUrl.replace(/\/+$/, "");
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
          const method = (init?.method ?? (typeof Request !== "undefined" && input instanceof Request ? input.method : "GET")).toUpperCase();
          try {
            opts.onHeld?.({ surface, method });
          } catch {
            // Silent by design: reporting is diagnostics; the hold below is
            // what protects the member and must happen regardless.
          }
          throw new TypeError(HELD_MESSAGE);
        }
      }
    }
    return opts.fetchImpl(input, init);
  };
}
