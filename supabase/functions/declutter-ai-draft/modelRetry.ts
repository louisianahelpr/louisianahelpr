/**
 * One bounded retry for the photo model's "busy" answers.
 *
 * On 2026-10-15 06:12Z the model answered 503 "high demand" and the seller
 * saw "The photo tool isn't available right now" twice in a row
 * (function_logs, declutter-ai-draft). Those answers are the model saying
 * "try again in a moment", so this tries ONCE more after a short pause.
 *
 * Only 503 (overloaded / unavailable) and 529 (overloaded) are retried.
 * Everything else, including 429 (our quota: retrying spends more of it) and
 * every 4xx (the request itself is wrong), goes straight back to the caller,
 * which turns it into the same `ai_unavailable` answer as before. Two
 * attempts at most, so a dead model costs one extra call, never a loop.
 *
 * Pure (no Deno globals) so src/test/declutterAiModelRetry.test.ts can run it.
 */
export const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([503, 529]);
export const MAX_ATTEMPTS = 2;
/** Pause before the one retry. Short: the seller is watching a spinner. */
export const RETRY_DELAY_MS = 1500;

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Calls `attempt` (one model request, with its own timeout) and, if the
 * answer is a retryable status, waits `delayMs` and calls it exactly once
 * more. Returns the last Response either way. A thrown error (timeout,
 * network) is not retried: it propagates as before.
 */
export async function fetchModelWithRetry(
  attempt: () => Promise<Response>,
  opts: { sleep?: (ms: number) => Promise<void>; delayMs?: number; onRetry?: (status: number) => void } = {},
): Promise<Response> {
  const sleep = opts.sleep ?? defaultSleep;
  let response = await attempt();
  for (let n = 1; n < MAX_ATTEMPTS && RETRYABLE_STATUSES.has(response.status); n++) {
    opts.onRetry?.(response.status);
    // Drain the busy answer's body so the connection is released.
    await response.body?.cancel().catch(() => {
      // Nothing to release: the body was already consumed or closed.
    });
    await sleep(opts.delayMs ?? RETRY_DELAY_MS);
    response = await attempt();
  }
  return response;
}
