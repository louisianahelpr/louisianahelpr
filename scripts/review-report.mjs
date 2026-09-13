#!/usr/bin/env node
/**
 * `npm run review:report` — every screenshot a run produced, beside whether a
 * review entry (e2e/reviewLog.ts -> test-results/review-log.jsonl) exists.
 *
 * Scans test-results/ (Playwright failure captures and toHaveScreenshot
 * -actual/-expected/-diff images) and the visual sweep's output dir
 * (SWEEP_OUTPUT_DIR, default /tmp/ui-review). Exits 1 when a FAILURE capture
 * or a CHANGED (pixel-diff) screenshot has no review entry — those are the
 * ones nobody may claim to have checked without looking.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const RESULTS = resolve("test-results");
const LOG = join(RESULTS, "review-log.jsonl");
const dirs = [RESULTS, resolve(process.env.SWEEP_OUTPUT_DIR || "/tmp/ui-review")];

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".png")) out.push(p);
  }
  return out;
}

const reviews = existsSync(LOG)
  ? readFileSync(LOG, "utf8").split("\n").filter(Boolean).flatMap((l) => {
      try { return [JSON.parse(l)]; } catch { return []; }
    })
  : [];
const byPath = new Map(reviews.map((r) => [resolve(r.screenshot), r]));

function kind(p) {
  const n = basename(p);
  if (/-diff\.png$/.test(n)) return "changed";
  if (/-(actual|expected)\.png$/.test(n)) return "diff-side";
  if (/^test-failed-\d+\.png$/.test(n)) return "failure";
  return "capture";
}

const shots = [...new Set(dirs.flatMap((d) => walk(d)))].sort();
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

console.log(rows.join("\n") || "(no screenshots found)");
console.log(`\n${shots.length} screenshot(s), ${reviewed} reviewed, ${reviews.length} entr(ies) in ${LOG}`);
if (mustButUnreviewed) {
  console.error(`✖ ${mustButUnreviewed} failure/changed screenshot(s) have no review entry. Look at each, then recordReview().`);
  process.exit(1);
}
