// Retry the model call when the provider is briefly overloaded.
//
// MEASURED (prod, 2026-10-09 11:59:24Z): Gemini answered 503 "This model is
// currently experiencing high demand… try again later", the function returned
// 500, and the poster got a red "busy, try again" toast; their own retry 12s
// later succeeded. Measured 2026-09-07: 1 in 4 calls came back that way. A
// short in-function retry turns that into a slower success instead of a toast.
//
// What is retried, and why only that (code review, 2026-10-09):
//   - 500 / 502 / 503 only: the provider answered and refused, so nothing was
//     generated or billed. 504 is NOT retried: a gateway timeout already spent
//     its time, and three of them would outrun the edge function's wall clock.
//   - A thrown fetch error (dropped connection, timeout) is NOT retried: it can
//     drop after the model already produced and billed the answer, and a retry
//     would pay for the same prompt again.
//   - 429 (our quota) and 402 (billing) are never retried.
// Every attempt has its own time limit, the whole call has a deadline (no
// retry starts that could not finish inside it), and the waits are jittered so
// posters who hit the same overload do not all retry on the same beat.
const RETRYABLE_STATUSES = new Set([500, 502, 503]);
/** Base wait before attempt 2 and attempt 3; three attempts in all. */
export const RETRY_DELAYS_MS = [800, 1600];
/** One attempt may take this long before it is aborted. */
const ATTEMPT_TIMEOUT_MS = 25_000;
/** No retry starts after this much of the call has elapsed. */
const RETRY_DEADLINE_MS = 30_000;

export async function fetchWithRetry(
  doFetch: (signal: AbortSignal) => Promise<Response>,
  opts: {
    delays?: number[];
    attemptMs?: number;
    deadlineMs?: number;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
    random?: () => number;
    onRetry?: (attempt: number, status: number) => void;
  } = {},
): Promise<Response> {
  const delays = opts.delays ?? RETRY_DELAYS_MS;
  const attemptMs = opts.attemptMs ?? ATTEMPT_TIMEOUT_MS;
  const deadlineMs = opts.deadlineMs ?? RETRY_DEADLINE_MS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const random = opts.random ?? Math.random;
  const started = now();
  for (let i = 0; ; i++) {
    const res = await doFetch(AbortSignal.timeout(attemptMs));
    if (!RETRYABLE_STATUSES.has(res.status) || i >= delays.length) return res;
    // ±50% jitter around the base wait.
    const wait = Math.round(delays[i] * (0.5 + random()));
    if (now() - started + wait >= deadlineMs) return res;
    // Release the failed attempt's body before the next request.
    await res.body?.cancel().catch(() => {});
    opts.onRetry?.(i + 1, res.status);
    await sleep(wait);
  }
}
