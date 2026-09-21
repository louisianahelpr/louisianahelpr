/**
 * The closing line of scripts/e2e/prod-lifecycle-sweeper.mjs.
 *
 * WHY THIS IS ITS OWN MODULE
 * --------------------------
 * The sweeper used to end on a flat `"OK — all stranded rows unwound."` for
 * every run that produced no hard failure, including runs that deliberately
 * left rows behind. A hired-AND-funded leftover is skipped on purpose
 * (cancel_escrow answers 409 useCancelJob, and poster_cancel_job would record
 * a cancel_with_helper strike on poster-e2e — three of those restrict the
 * account every nightly signs in as), and the plan is that it "settles
 * forward" on its own.
 *
 * On 2026-09-20 prod held FIVE such rows in escrow — the oldest created
 * 2026-09-15, five days earlier — and every nightly log had said OK. The
 * forward-settle assumption had not held for a single one of them, and the
 * closing line was why nobody could tell. So the line now names what was left
 * and how old the oldest of them is, and a row past DEFERRED_STALE_MS is
 * reported as a warning rather than folded into an OK.
 *
 * Pure, and exported, so src/test/sweepSummary.test.ts can drive it with rows
 * of a known age instead of asserting against the sweeper's own output.
 */

/** A deferred row older than this has demonstrably NOT settled forward. */
export const DEFERRED_STALE_MS = 48 * 60 * 60 * 1000;

/**
 * @param {{ listed: number, deferred: Array<{ id: string, created_at: string }>, now?: number }} input
 * @returns {{ ok: boolean, stale: Array<{ id: string, ageMs: number }>, line: string }}
 *   `ok` is false when at least one deferred row is past DEFERRED_STALE_MS —
 *   the caller turns that into a ::warning, never a non-zero exit: the row is
 *   a real residue, but failing the sweep would red a nightly for something
 *   the sweeper is not allowed to fix.
 */
export function summariseSweep({ listed, deferred = [], now = Date.now() }) {
  const aged = deferred.map((job) => ({ id: job.id, ageMs: now - Date.parse(job.created_at) }));
  const stale = aged.filter((r) => Number.isFinite(r.ageMs) && r.ageMs >= DEFERRED_STALE_MS);

  if (!listed) return { ok: true, stale: [], line: "OK — nothing stranded." };
  if (!deferred.length) return { ok: true, stale: [], line: "OK — all stranded rows unwound." };

  const oldest = aged.reduce((a, b) => (b.ageMs > a.ageMs ? b : a));
  const days = (oldest.ageMs / 86_400_000).toFixed(1);
  const head =
    `${deferred.length} row(s) left to settle forward (hired and funded); ` +
    `oldest ${oldest.id} is ${days} day(s) old`;

  return {
    ok: stale.length === 0,
    stale,
    line: stale.length
      ? `NOT ALL UNWOUND — ${head}. ${stale.length} of them are past ` +
        `${DEFERRED_STALE_MS / 3_600_000}h, so "settles forward" is not happening: ` +
        `${stale.map((r) => r.id).join(", ")}`
      : `OK — every other stranded row unwound; ${head}.`,
  };
}

/**
 * What a `cancel_escrow` answer MEANS, as a pure function.
 *
 * Extracted 2026-09-21 because the branching lived inline in the sweeper's
 * network loop, where it could not be tested — and one missing arm of it made
 * the nightly money loop red for two days.
 *
 * The three answers are genuinely different things, and only one is a fault:
 *
 *   "settle-forward"  409 + useCancelJob — a hired, funded leftover. Cancelling
 *                     it here would record a cancel_with_helper strike against
 *                     poster-e2e, and three of those restrict the account for
 *                     7 days and break every nightly journey. It settles
 *                     forward via auto-release instead.
 *   "disputed"        409 + "under dispute" — the escrow of a disputed job must
 *                     NOT be unwound behind the admin who will decide where it
 *                     goes. This refusal is the product working. Treating it as
 *                     a stranded row is what turned ONE unresolved test fixture
 *                     (e7e09075, disputed 2026-09-19) into a nightly red.
 *   "failure"         anything else non-OK — a real defect in the cancel path.
 *
 * Both 409s are REPORTED, never fatal. The distinction that matters is between
 * "the product refused, correctly" and "the product could not do the thing".
 */
export function classifyCancelEscrow(status, body = "") {
  if (status >= 200 && status < 300) return "ok";
  if (status === 409 && /"useCancelJob"\s*:\s*true/.test(body)) return "settle-forward";
  if (status === 409 && /under dispute/i.test(body)) return "disputed";
  /*
   * 429 IS BACKPRESSURE, NOT A BROKEN CANCEL PATH.
   *
   * Same category error as the dispute 409 this function was extracted for: an
   * answer that means "ask again later" was being reported as "a funded job
   * that cancel_escrow refuses is a real defect in the cancel path". It is not
   * a verdict about the job at all.
   *
   * Measured 2026-09-21: with 17 stranded rows and three dispatches inside
   * forty minutes, 11 of 17 calls came back
   * `{"error":"Too many requests. Please try again later."}`. The rate limit
   * doing its job read as eleven defects in the money path.
   *
   * The caller retries with backoff before believing it, and reports it as
   * throttling rather than as residue if it persists — a sweep that could not
   * ASK is a different fact from a sweep that asked and was refused, and
   * conflating them sends whoever reads the log looking for a bug that is not
   * there.
   */
  if (status === 429) return "throttled";
  return "failure";
}
