#!/usr/bin/env node
/**
 * `npm run review:report` — every screenshot a run produced, beside whether a
 * review entry (e2e/reviewLog.ts -> test-results/review-log.jsonl) exists.
 *
 * ─── WHY THIS FILE WAS REWRITTEN (2026-09-19) ──────────────────────────────
 *
 * CLAUDE.md's standing rule is "'I looked' is RECORDED, not claimed". This
 * script IS that recording's enforcement, and it could not enforce it:
 *
 *   1. It scanned exactly two directories — `test-results/` and
 *      `SWEEP_OUTPUT_DIR` (default `/tmp/ui-review`). A run that captured
 *      anywhere else — and several do: `a11y-webkit-prod.yml` points
 *      SWEEP_OUTPUT_DIR at `$GITHUB_WORKSPACE/a11y-prod-out/<engine>`,
 *      `check-changed.mjs` at `test-results/check-changed` — was invisible to
 *      a plain `npm run review:report`, which then printed
 *      "(no screenshots found)" and **exited 0**.
 *   2. Finding NOTHING was a pass. A reporter that exits 0 having looked at
 *      nothing certifies nothing; it is the same vacuous-check defect class
 *      this repo spent the day removing, sitting inside the tool that exists
 *      to catch it.
 *   3. `/tmp` is age-wiped on this Mac, so the default root's evidence
 *      silently disappears — and a vanished capture read as "no screenshots",
 *      i.e. as a pass, rather than as lost evidence.
 *
 * ─── HOW IT ACCOUNTS FOR CAPTURES OUTSIDE ITS DEFAULT ROOT ─────────────────
 *
 * Both answers, because each covers the other's blind spot:
 *
 *   THE LOG'S OWN PATHS. `recordReview()` stores an ABSOLUTE path per entry,
 *   so the log already knows where a run wrote — including roots this script
 *   was never told about. Every directory named by an entry becomes a root.
 *   This is what makes an out-of-root run countable at all, and it needs no
 *   coordination with whoever ran it.
 *
 *   EXPLICIT ROOTS. `REVIEW_DIRS` (comma- or colon-separated) and any
 *   directory passed as an argument are scanned too, so a run that captured
 *   elsewhere and recorded NOTHING — precisely the case the log cannot see —
 *   can still be pointed at and audited:
 *       npm run review:report -- a11y-prod-out/webkit
 *
 * Neither alone is sufficient: the log cannot reveal a directory nobody
 * recorded from, and an explicit list cannot be trusted to be complete. So
 * the script prints EVERY root it scanned, and refuses to pass when the union
 * of them is empty.
 *
 * ─── WHAT MAKES IT EXIT 1 ──────────────────────────────────────────────────
 *
 *   NOTHING TO REPORT ON   no PNG under any root and no log entry. There is
 *                          no run here to certify.
 *   NOTHING LOOKED AT      screenshots exist and the log is empty. "0
 *                          reviewed" is the finding, not a clean bill.
 *   EVIDENCE GONE          every recorded review points at a file that no
 *                          longer exists (the `/tmp` wipe). The claim cannot
 *                          be re-checked by anyone, so it does not stand.
 *   UNREVIEWED FAILURE     a FAILURE capture or a CHANGED (pixel-diff)
 *                          screenshot with no review entry. The original rule,
 *                          unchanged.
 *
 * Some MISSING entries alongside surviving ones are reported and do not fail:
 * evidence ageing out of `/tmp` is expected, and the surviving entries still
 * carry the run. Capture somewhere under $HOME if you need it to last.
 */
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

/**
 * One spelling per file. On macOS `/tmp` and `/var` are symlinks to
 * `/private/...`, so a capture recorded as `/var/.../x.png` and the same file
 * walked as `/private/var/.../x.png` are two different strings for one PNG —
 * which showed up as a screenshot listed TWICE, once "reviewed" and once
 * "UNREVIEWED". A review that does not match its own screenshot is the same
 * unfalsifiable-recording defect this script exists to end, so both sides are
 * canonicalised before they are ever compared.
 */
const canon = (p) => {
  const abs = resolve(p);
  try { return realpathSync.native(abs); } catch { return abs; }
};

const RESULTS = canon("test-results");
// NOT under test-results/: Playwright clears that directory at the start of
// every run, which silently emptied this log (and made this report green on an
// empty file). See e2e/reviewLog.ts.
const LOG = join(canon(".review"), "review-log.jsonl");

const reviews = existsSync(LOG)
  ? readFileSync(LOG, "utf8").split("\n").filter(Boolean).flatMap((l) => {
      try { return [JSON.parse(l)]; } catch { return []; }
    })
  : [];
const byPath = new Map(reviews.map((r) => [canon(r.screenshot), r]));

/** Roots, in the order they are reported. Deduped, existence noted per root. */
const extra = [
  ...process.argv.slice(2),
  ...(process.env.REVIEW_DIRS || "").split(/[,:]/),
].map((s) => s.trim()).filter(Boolean);

const roots = [...new Set([
  RESULTS,
  canon(process.env.SWEEP_OUTPUT_DIR || "/tmp/ui-review"),
  ...extra.map((d) => canon(d)),
  // The log's own paths — every directory a recorded capture actually lives in.
  ...reviews.map((r) => canon(dirname(resolve(r.screenshot)))),
])];

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".png")) out.push(canon(p));
  }
  return out;
}

function kind(p) {
  const n = basename(p);
  if (/-diff\.png$/.test(n)) return "changed";
  if (/-(actual|expected)\.png$/.test(n)) return "diff-side";
  if (/^test-failed-\d+\.png$/.test(n)) return "failure";
  return "capture";
}

const shots = [...new Set(roots.flatMap((d) => walk(d)))].sort();
const missing = reviews.filter((r) => !existsSync(canon(r.screenshot)));

let mustButUnreviewed = 0;
let reviewed = 0;
const rows = shots.map((p) => {
  const k = kind(p);
  const r = byPath.get(p);
  const must = k === "changed" || k === "failure";
  if (r) reviewed++;
  else if (must) mustButUnreviewed++;
  const status = r ? `reviewed:${r.verdict}` : must ? "UNREVIEWED" : "not reviewed";
  return `${status.padEnd(16)} ${k.padEnd(10)} ${p}${r?.note ? `  (${r.note})` : ""}`;
});

console.log("roots scanned:");
for (const d of roots) {
  const n = walk(d).length;
  console.log(`  ${existsSync(d) ? `${String(n).padStart(4)} png` : "  ABSENT"}  ${d}`);
}
console.log("");
console.log(rows.join("\n") || "(no screenshots found)");
if (missing.length) {
  console.log("");
  console.log(`MISSING — recorded as reviewed, file no longer on disk (${missing.length}):`);
  for (const r of missing) console.log(`  ${resolve(r.screenshot)}  (${r.screen})`);
  console.log("  /tmp is age-wiped on this machine; capture under $HOME to keep the evidence.");
}
console.log(`\n${shots.length} screenshot(s), ${reviewed} reviewed, ${reviews.length} entr(ies) in ${LOG}`);

const fail = (msg) => { console.error(`✖ ${msg}`); return 1; };
let code = 0;

if (shots.length === 0 && reviews.length === 0) {
  code = fail(
    "no screenshots under any root and no review entries — there is no run here to report on. " +
    "A reporter that passes having looked at nothing certifies nothing. " +
    "Point it at the run's output: `npm run review:report -- <dir>` or REVIEW_DIRS=<dir>.",
  );
} else if (shots.length > 0 && reviews.length === 0) {
  code = fail(
    `${shots.length} screenshot(s) found and the review log is EMPTY — nothing was recorded as looked at. ` +
    "Look at them, then recordReview() each one (npm run review:record -- <png> <screen> <checked> <ok|defect>).",
  );
} else if (reviews.length > 0 && missing.length === reviews.length) {
  code = fail(
    `all ${reviews.length} recorded review(s) point at files that no longer exist — the evidence is gone, ` +
    "so the claim cannot be re-checked. Re-run the capture somewhere under $HOME.",
  );
}

if (mustButUnreviewed) {
  code = fail(`${mustButUnreviewed} failure/changed screenshot(s) have no review entry. Look at each, then recordReview().`);
}

process.exit(code);
