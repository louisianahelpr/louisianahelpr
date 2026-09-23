/**
 * The ONE fold of the launch-audit bus (docs/audit/launch-2026-09/findings.jsonl).
 *
 * audit-bus.mjs (ROLLUP.md) and audit-coverage.mjs (COVERAGE.md) both count
 * findings. Until 2026-09-23 each had its own parse, and the two committed
 * documents disagreed: ROLLUP said "397 live", COVERAGE said "284 live". The
 * rollup counted FIXED findings as live, and the coverage parse kept only the
 * last finding per id, so it dropped every id collision the bus had preserved.
 * Every consumer counts through here now, so one fact has one number.
 */

/** Statuses that take a finding out of the OPEN count. */
// `obsolete` (added 2026-09-23 reconcile): the surface or premise no longer
// exists (feature removed, owner decision) — closed, but not "the claim was false".
export const CLOSED_STATUSES = new Set(["fixed", "retracted", "duplicate", "wontfix", "obsolete"]);

/**
 * Fold the append-only log into current state: the newest status record for an
 * id wins. This is what every consumer should use instead of reading raw lines.
 */
export function foldFindings(records) {
  const findings = new Map();
  for (const r of records) {
    if (r.kind === "finding") {
      // A SECOND finding under an existing id must never DELETE the first.
      //
      // nextId() in audit-bus.mjs stops new collisions; this stops the ones
      // already on disk from staying invisible. Twelve findings were shadowed
      // before that fix landed — all 8 of lh-verification-credentials'
      // (VC-001..VC-008, overwritten by lh-visual-critic), 3 of
      // lh-copy-content's (CC-001..CC-003, overwritten by lh-concurrency-cache)
      // and main's TC-001 (overwritten by lh-test-ci) — including two HIGH
      // findings about a credential tier any signed-in user can self-grant and
      // a license that never expires. The ledger is append-only, so every one
      // of those rows is still in the file; only this fold dropped them.
      //
      // The incumbent keeps the id, because any status rows filed against that
      // id were filed against IT. The newcomer is kept under `<id>#<agent>` so
      // it stays readable instead of vanishing.
      const incumbent = findings.get(r.id);
      if (incumbent && incumbent.agent !== r.agent) {
        findings.set(`${r.id}#${r.agent}`, {
          ...r,
          id: `${r.id}#${r.agent}`,
          collided_with: r.id,
          status: "filed",
          history: [],
        });
        continue;
      }
      findings.set(r.id, { ...r, status: "filed", history: [] });
    } else if (r.kind === "status") {
      const f = findings.get(r.id);
      if (!f) continue;
      f.status = r.status;
      if (r.dupe_of) f.dupe_of = r.dupe_of;
      f.history.push(r);
    }
  }
  return [...findings.values()];
}

/** Parse findings.jsonl text; a corrupt line throws (never silently skipped). */
export function parseFindingsLog(text) {
  return text
    .split("\n")
    .filter((l) => l.trim())
    .map((l, i) => {
      try { return JSON.parse(l); } catch { throw new Error(`findings.jsonl: corrupt line ${i + 1}`); }
    });
}

/** Exact counts every generated doc prints — one definition, used everywhere. */
export function countFindings(all) {
  const by = (st) => all.filter((f) => f.status === st).length;
  const open = all.filter((f) => !CLOSED_STATUSES.has(f.status));
  return {
    filed: all.length,
    open: open.length,
    openBlockers: open.filter((f) => f.launch_blocker).length,
    fixed: by("fixed"),
    retracted: by("retracted"),
    duplicate: by("duplicate"),
    wontfix: by("wontfix"),
    obsolete: by("obsolete"),
  };
}
