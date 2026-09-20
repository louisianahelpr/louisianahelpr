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
