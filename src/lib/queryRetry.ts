/**
 * The ONE read-retry policy (docs/OPEN.md Q1164).
 *
 * The client policy in src/lib/queryClient.ts has always said "client errors
 * (401/403/404/etc.) won't be fixed by retrying", and useCurrentUser relies on
 * "no retry at all on a 4xx". For a Supabase read that was never true.
 * postgrest-js puts the HTTP status on the RESPONSE (`{ data, error, status }`),
 * never on `error`, so both shapes the app throws into React Query arrived
 * without one: `unwrap()`'s Error copy and a bare `throw error` (a plain
 * `{ code, details, hint, message }` object). The old check read
 * `status ?? statusCode ?? Number(code)`: NaN for "PGRST301", 42501 for an RLS
 * denial, so no PostgREST error ever counted as a 4xx and every failed read was
 * sent twice.
 *
 * Measured 2026-10-03 (Q1164). e2e-real-backend run 37132155495 failed its
 * request budget at 410/min with 291 duplicate GETs. A local replay of eight of
 * its page loads found 22 duplicate GETs, 20 of them a 401 PGRST301 "Expected 3
 * parts in JWT; got 1" from prod followed 0.6-1.0 s later by the retry, whose
 * stack (CDP initiator) is React Query's retry timer. The 401s came from mocked specs
 * whose calls the Workbox service worker sent past the mocks (that half is
 * fixed in playwright.config.ts). Any signed-in user whose read is refused gets
 * the same doubled request and waits the retry delay before the error card.
 *
 * So the status is recovered from every shape that can carry it: a numeric
 * `status`/`statusCode` (auth-js, storage-js, and `unwrap()`, which now copies
 * the response status), an edge-function error's `context` Response, and
 * otherwise the PostgREST error `code`, mapped with PostgREST's own status table
 * (the "Errors" page of the PostgREST reference docs). Anything unrecognised
 * keeps today's behaviour: retried once.
 */

/** PostgREST's own PGRST-code status exceptions; the rest of each group uses the group default below. */
const PGRST_STATUS: Record<string, number> = {
  PGRST003: 504,
  PGRST101: 405,
  PGRST103: 416,
  PGRST105: 405,
  PGRST106: 406,
  PGRST107: 415,
  PGRST111: 500,
  PGRST112: 500,
  PGRST116: 406,
  PGRST117: 405,
  PGRST121: 500,
  PGRST125: 404,
  PGRST126: 404,
  PGRST201: 300,
  PGRST202: 404,
  PGRST203: 300,
  PGRST205: 404,
  PGRST300: 500,
  PGRSTX00: 500,
};

/** PostgREST's group defaults, by the digit after "PGRST": connection, request, schema cache, JWT. */
const PGRST_GROUP_STATUS: Record<string, number> = { "0": 503, "1": 400, "2": 400, "3": 401 };

/** SQLSTATEs PostgREST maps exactly (checked before the two-character classes). */
const SQLSTATE_STATUS: Record<string, number> = {
  "23503": 409,
  "23505": 409,
  "25006": 405,
  "53400": 500,
  "57P01": 503,
  P0001: 400,
  "42883": 404,
  "42P01": 404,
  "42P17": 500,
  // 401 for an anonymous request, 403 for a signed-in one: a 4xx either way.
  "42501": 403,
};

/** SQLSTATE classes (first two characters) PostgREST maps; every other code is a 400. */
const SQLSTATE_CLASS_STATUS: Record<string, number> = {
  "08": 503,
  "09": 500,
  "0L": 403,
  "0P": 403,
  "25": 500,
  "28": 403,
  "2D": 500,
  "38": 500,
  "39": 500,
  "3B": 500,
  "40": 500,
  "53": 503,
  "54": 500,
  "55": 500,
  "57": 500,
  "58": 500,
  F0: 500,
  HV: 500,
  P0: 500,
  XX: 500,
};

/** The HTTP status PostgREST answers with for an error `code`, or undefined when it is not one of its codes. */
function postgrestStatusFor(code: string): number | undefined {
  if (PGRST_STATUS[code] !== undefined) return PGRST_STATUS[code];
  const group = /^PGRST(\d)\d\d$/.exec(code);
  if (group) return PGRST_GROUP_STATUS[group[1]];
  if (!/^[0-9A-Z]{5}$/.test(code)) return undefined;
  // RAISE ... USING ERRCODE = 'PT404' sets the status itself.
  const pt = /^PT(\d{3})$/.exec(code);
  if (pt) return Number(pt[1]);
  return SQLSTATE_STATUS[code] ?? SQLSTATE_CLASS_STATUS[code.slice(0, 2)] ?? 400;
}

const asStatus = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d{3}$/.test(v) ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 100 && n <= 599 ? n : undefined;
};

/**
 * The HTTP status a failed call answered with, or undefined when the error does
 * not say (a network failure, a timeout, an error the app made up itself).
 */
function httpStatusOf(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const e = error as { status?: unknown; statusCode?: unknown; context?: unknown; code?: unknown; details?: unknown; hint?: unknown };
  const direct = asStatus(e.status) ?? asStatus(e.statusCode);
  if (direct !== undefined) return direct;
  // FunctionsHttpError: `context` is the edge function's Response.
  const ctx = e.context as { status?: unknown } | null | undefined;
  if (ctx && typeof ctx === "object") {
    const fromResponse = asStatus(ctx.status);
    if (fromResponse !== undefined) return fromResponse;
  }
  if (typeof e.code === "number" || (typeof e.code === "string" && /^\d{3}$/.test(e.code))) return asStatus(e.code);
  // Only a PostgREST error carries details + hint beside its code; an auth-js
  // or Capacitor error with a code string is not mapped through PostgREST's table.
  if (typeof e.code === "string" && e.code && "details" in e && "hint" in e) return postgrestStatusFor(e.code);
  return undefined;
}

/**
 * A 4xx: the request itself was refused, so sending it again gets the same
 * answer. Except 408 (Request Timeout) and 429 (Too Many Requests), which say
 * "not now" rather than "no" and keep the one retry they always had.
 */
function isClientError(error: unknown): boolean {
  const status = httpStatusOf(error);
  return status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429;
}

/**
 * React Query's `retry` for every read: never a 4xx, otherwise up to
 * `maxRetries` more attempts (1 by default: see the retry schedule notes in
 * src/lib/queryClient.ts). A query that needs its own rule composes this one
 * (src/test/queryRetryPolicy.test.ts fails a `retry:` that does not).
 */
export function shouldRetryQuery(failureCount: number, error: unknown, maxRetries = 1): boolean {
  if (isClientError(error)) return false;
  return failureCount < maxRetries;
}
