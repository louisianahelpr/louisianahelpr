#!/usr/bin/env node
/**
 * Q184 (owner, 2026-09-27): a CI line-coverage floor for src/lib and src/hooks.
 *
 * vitest.yml runs `npx vitest run --coverage` (json-summary reporter, config in
 * vitest.config.ts) and then this script, which reads
 * coverage/coverage-summary.json, sums covered/total LINES per area (a path
 * prefix), and compares each with scripts/coverage-baseline.json.
 *
 * TWO-WAY, with a band. Coverage moves on every source change, so an exact
 * match would red CI on nearly every commit. Instead:
 *   - below the floor           -> FAIL (coverage FELL; add tests, or explain)
 *   - above floor + BAND points -> FAIL (coverage ROSE past the floor; raise it
 *                                   in the same commit so the gain cannot drift away)
 * An area with no files in the summary fails too (a config that measured
 * nothing would otherwise read as 0 and be "fixed" by lowering the floor).
 *
 *   node scripts/check-coverage-floor.mjs [summary.json] [baseline.json]
 */
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const BAND = 1.0;

/** Sum line coverage per area prefix from a coverage-summary.json object. */
export function measureAreas(summary, areas, root = process.cwd()) {
  const out = {};
  for (const area of areas) out[area] = { covered: 0, total: 0, files: 0 };
  for (const [file, v] of Object.entries(summary)) {
    if (file === "total" || !v?.lines) continue;
    const rel = (file.startsWith("/") ? relative(root, file) : file).split("\\").join("/");
    for (const area of areas) {
      if (!rel.startsWith(area)) continue;
      out[area].covered += v.lines.covered;
      out[area].total += v.lines.total;
      out[area].files += 1;
    }
  }
  for (const a of areas) {
    const m = out[a];
    m.pct = m.total ? Math.round((m.covered / m.total) * 10000) / 100 : 0;
  }
  return out;
}

/** Compare measured areas with the floors. Returns a list of failure strings. */
export function compareFloors(measured, floors, band = BAND) {
  const failures = [];
  for (const [area, floor] of Object.entries(floors)) {
    const m = measured[area];
    if (!m || m.files === 0) {
      failures.push(`${area}: no files measured (coverage config include is wrong?)`);
      continue;
    }
    if (m.pct < floor) failures.push(`${area}: line coverage FELL to ${m.pct}% (floor ${floor}%)`);
    else if (m.pct > floor + band)
      failures.push(`${area}: line coverage ROSE past the floor to ${m.pct}% (floor ${floor}%): raise scripts/coverage-baseline.json to ${m.pct}`);
  }
  return failures;
}

function main() {
  const summaryPath = resolve(process.argv[2] ?? "coverage/coverage-summary.json");
  const baselinePath = resolve(process.argv[3] ?? "scripts/coverage-baseline.json");
  const floors = JSON.parse(readFileSync(baselinePath, "utf8")).areas;
  const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
  const measured = measureAreas(summary, Object.keys(floors));
  if (process.env.TESTS_OUTCOME) console.log(`coverage test run outcome: ${process.env.TESTS_OUTCOME}`);
  for (const [a, m] of Object.entries(measured))
    console.log(`${a}: ${m.pct}% lines (${m.covered}/${m.total}, ${m.files} files), floor ${floors[a]}%`);
  const failures = compareFloors(measured, floors);
  for (const f of failures) console.error(`::error::coverage floor: ${f}`);
  process.exit(failures.length ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
