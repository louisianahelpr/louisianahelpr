/**
 * Answer a caller that has a hard timeout (Supabase Auth gives a hook 5 s, then
 * fails the request and rolls a sign-up back) with whatever is ready by then,
 * and let the rest finish in the background.
 */

/**
 * Handler time allowed before answering, counted from the start of `serve`.
 * Auth's 5 s also covers a cold worker's boot and module load, which happen
 * before `serve` runs: measured 2026-10-22, the two cold runs had spent ~0.6 s
 * and ~1.4 s (a 674 ms boot) before the handler started. Warm runs take
 * 1.3-1.6 s end to end, so they still return their real result.
 */
export const HOOK_ANSWER_BY_MS = 2_500;

/** The handler time left of HOOK_ANSWER_BY_MS for a request whose handler started at `startedAt`. */
export function answerBudgetMs(startedAt: number, now = Date.now()): number {
  return Math.max(0, HOOK_ANSWER_BY_MS - (now - startedAt));
}

/** `work`'s own result if it settles within `ms`, else null while it keeps running. A throw inside the window rejects. */
export async function answerWithin<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export interface FinishInBackground<T> {
  /** A result that arrived after the caller was answered. */
  onLateResult?: (value: T) => void;
  /** A throw after the caller was answered: must alert, nobody else will see it. */
  onLateError: (error: unknown) => Promise<void> | void;
  /** EdgeRuntime.waitUntil, when the runtime offers it. */
  waitUntil?: (p: Promise<unknown>) => void;
  /** The runtime has no waitUntil: the work may be cut off when the response is sent. */
  onNoWaitUntil: () => Promise<void> | void;
}

/**
 * answerWithin, and when the deadline wins, keep `work` alive (waitUntil) with
 * its late result and late error handled. Returns the result, or null when the
 * caller must be answered now. `work` must never RESOLVE to null itself (that
 * would read as a timeout); the auth hook's deliver() always returns a Response.
 */
export async function answerOrFinishInBackground<T>(
  work: Promise<T>,
  ms: number,
  late: FinishInBackground<T>,
): Promise<T | null> {
  const answered = await answerWithin(work, ms);
  if (answered !== null) return answered;
  const finishing = work.then(
    (value) => late.onLateResult?.(value),
    (error: unknown) => late.onLateError(error),
  );
  if (late.waitUntil) late.waitUntil(finishing);
  // Not awaited: the caller is past its deadline, and a slow alert must not
  // push its answer later still.
  // (onNoWaitUntil logs and alerts itself; a failing alert has nowhere left to go.)
  else void Promise.resolve(late.onNoWaitUntil()).catch(() => undefined);
  return null;
}
