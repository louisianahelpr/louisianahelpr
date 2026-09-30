// Calls one of our own edge functions from another, surviving Supabase's
// per-trace budget on function-to-function calls.
//
// Every fetch one function makes to another shares the caller's trace, and the
// platform throttles a trace that makes too many: the fetch THROWS a
// `RateLimitError` carrying `retryAfterMs`. Measured on prod 2026-09-29 16:26Z:
// review-nag-cron sent ~25 sequential send-notification-email calls in 5 s,
// then the next 6 threw "Rate limit exceeded for trace ... Retry after 54486ms",
// so 6 review nags were never emailed and the cron answered 500.
//
// fetchFunction waits the time the platform names and tries again, so a cron
// looping over recipients slows down instead of dropping them. It gives up
// (rethrows the original error) after `maxRetries` waits, or when a wait would
// end past `deadlineAt`. The gateway drops a request that has not answered in
// 150 s, so a cron passes `invocationDeadline(startedAt)` (start + 120 s) and
// still answers with its own defect count; a caller that passes nothing gets
// DEFAULT_BUDGET_MS from this call's start, which keeps a synchronous client
// call (create-notification) far from a 504 the client would retry.

/** Longest a call may spend waiting when the caller names no deadline. */
export const DEFAULT_BUDGET_MS = 60_000;
/** A cron's whole run must answer inside the gateway's 150 s idle timeout. */
const INVOCATION_BUDGET_MS = 120_000;

export function invocationDeadline(startedAt: number): number {
  return startedAt + INVOCATION_BUDGET_MS;
}

type RateLimitLike = { name?: string; retryAfterMs?: number };

function rateLimitRetryAfterMs(err: unknown): number | null {
  if (!err || typeof err !== "object") return null;
  const e = err as RateLimitLike;
  if (e.name !== "RateLimitError" && typeof e.retryAfterMs !== "number") return null;
  return typeof e.retryAfterMs === "number" && e.retryAfterMs >= 0 ? e.retryAfterMs : 60_000;
}

export type FunctionFetchOptions = {
  maxRetries?: number;
  /** Epoch ms; a wait that would end after it is not taken (the error is rethrown). */
  deadlineAt?: number;
  now?: () => number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

export async function fetchFunction(
  url: string,
  init: RequestInit,
  opts: FunctionFetchOptions = {},
): Promise<Response> {
  const maxRetries = opts.maxRetries ?? 2;
  const now = opts.now ?? Date.now;
  const deadlineAt = opts.deadlineAt ?? now() + DEFAULT_BUDGET_MS;
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 0; ; attempt++) {
    try {
      return await doFetch(url, init);
    } catch (err) {
      const wait = rateLimitRetryAfterMs(err);
      if (wait === null || attempt >= maxRetries || now() + wait + 250 > deadlineAt) throw err;
      console.warn("[fetchFunction] trace rate limit; waiting before retry", { url, wait, attempt });
      await sleep(wait + 250);
    }
  }
}
