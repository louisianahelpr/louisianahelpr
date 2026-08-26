/**
 * The response body is the ONLY channel a scheduled function has to the watcher.
 *
 * pg_cron records whether the `net.http_post` ENQUEUE worked, never what came
 * back. `sweep_cron_http_failures()` closes that gap by reading
 * net._http_response. This helper gives it the two things it cannot otherwise
 * learn: WHETHER the run dropped work, and WHICH function is answering.
 *
 * ─── 1. Whether: a run that failed at anything answers non-2xx ────────────
 *
 * A run that swallows its own failures into a counter and still answers 200 is
 * invisible to the watcher that exists to catch it. That is not hypothetical.
 * `payment-confirm-reminder` inserted a `job_id` column that `notifications`
 * does not have, so every insert died on PGRST204 — and the run answered
 * `200 {"processed":14,"sent":0,"errors":14}`. It sent zero reminders for its
 * entire life while every dashboard read green. `engagement-automations` did
 * the same with an undeclared `corsHeaders`.
 *
 * ─── Defects, not outcomes ───────────────────────────────────────────────
 *
 * The counter passed here must count DEFECTS — work the function intended to
 * do that did not happen because something is broken. It must NOT count
 * business outcomes that are simply what they are:
 *
 *   defect  — a DB write rejected, an undefined variable, a query that errored,
 *             a notification insert that failed, a cursor that didn't advance
 *   outcome — a card declined, a helper with no payout account, an email the
 *             provider bounced, zero rows matching today
 *
 * This distinction is the whole reason the convention is safe to page on. A
 * declined card is not a defect; it will "fail" again tomorrow and forever, and
 * a watcher that pages on it is a watcher people mute. The sweep already
 * learned this from pg_net timeouts, which it records at 'warning' and never
 * pages — a timeout is AMBIGUOUS (the function may well have finished
 * server-side). A defect counter is not ambiguous: it is positive evidence that
 * work was dropped. That is what should page.
 *
 * ─── 2. Which: the function names itself ─────────────────────────────────
 *
 * The sweep originally attributed a response to a cron by timestamp proximity,
 * on the stated assumption that no two HTTP crons share a start second. That
 * assumption was false: four pairs share a schedule, including
 * `void-cancelled-payments` with `auto-expire-jobs` on `0 * * * *` — and
 * `auto-release-payment`, which runs every 30 minutes, lands on the same second
 * every hour, making it a three-way tie across two money crons. An alert could
 * name the wrong function and send someone to the wrong file mid-incident.
 *
 * Exact attribution from pg_net alone is impossible: `net.http_request_queue`
 * holds the URL, but its rows are deleted the moment the request resolves, so
 * nothing is joinable by the time the sweep runs (verified: 0 of the last
 * hour's responses had a surviving queue row). So the function states its own
 * name in the body, and the sweep reads it from there — exact, and it required
 * no change to the 17 job definitions.
 *
 * ─── Why 500, and why it is safe on money crons ──────────────────────────
 *
 * HTTP has no "partially succeeded" code that is also non-2xx — 207 is 2xx, so
 * the watcher would skip it, defeating the point. 500 overstates a partial run
 * slightly; the body carries the truth and the sweep stores the body precisely
 * so the difference is legible to whoever reads the alert.
 *
 * Returning 500 does NOT cause a retry. pg_net is fire-and-forget: one attempt
 * per enqueue, no retry logic. Verified against live data before this was
 * applied to the money crons — `process-email-queue` shows 36 responses for 36
 * scheduled runs over three hours INCLUDING one pg_net timeout, the case most
 * likely to retry if retries existed. So flipping a money cron from 200 to 500
 * cannot cause a second charge.
 */

export type CronDefects = {
  /** Count of defects — see the defects-vs-outcomes note above. */
  count: number;
  /** Short human reasons; the first few ride along in the body for the alert. */
  reasons?: string[];
};

/** How many reasons ride along in the body. The sweep truncates content at 500 chars. */
const MAX_REASONS = 5;

/**
 * Build the terminal response for a scheduled function.
 *
 * @param fn      This function's name, exactly as the directory is spelled —
 *                the sweep matches it against `cron.job.jobname`.
 * @param body    Whatever the run wants to report (counts, ids, dry-run flags).
 * @param defects Defect count + reasons. `{ count: 0 }` for a clean run.
 *
 * Answers 200 when the run was clean, 500 when it dropped work, so
 * `sweep_cron_http_failures()` sees it either way.
 */
export function cronResult(
  fn: string,
  body: Record<string, unknown>,
  defects: CronDefects,
  headers: Record<string, string> = {},
): Response {
  const count = Math.max(0, defects.count | 0);
  const reasons = (defects.reasons ?? []).filter(Boolean);

  return new Response(
    JSON.stringify({
      ok: count === 0,
      // First key the sweep looks for. Kept short because pg_net's stored
      // content is truncated to 500 chars and this must survive that cut.
      fn,
      ...body,
      // Named `defects` rather than `errors` on purpose: several of these
      // functions already report an `errors` field that counts business
      // outcomes, and conflating the two is what this convention exists to stop.
      defects: count,
      ...(reasons.length > 0
        ? { defectReasons: reasons.slice(0, MAX_REASONS) }
        : {}),
    }),
    {
      status: count > 0 ? 500 : 200,
      headers: { ...headers, "Content-Type": "application/json" },
    },
  );
}

/**
 * Error responses need to name the function too — a run that throws is exactly
 * when someone needs to know which function threw.
 */
export function cronError(
  fn: string,
  message: string,
  headers: Record<string, string> = {},
  status = 500,
): Response {
  return new Response(
    JSON.stringify({ ok: false, fn, error: message, defects: 1 }),
    { status, headers: { ...headers, "Content-Type": "application/json" } },
  );
}

/**
 * Collects defect reasons at the call sites, so a function can record "this
 * specific write failed" where it happens instead of reconstructing it at the
 * end. Keeps the count and the reasons from drifting apart.
 */
export function defectTracker() {
  const reasons: string[] = [];
  return {
    /** Record a defect. Call it and carry on — it never throws. */
    record(reason: string) {
      reasons.push(reason);
    },
    get count() {
      return reasons.length;
    },
    get reasons() {
      return reasons;
    },
    /** Shape expected by `cronResult`. */
    get defects(): CronDefects {
      return { count: reasons.length, reasons };
    },
  };
}
