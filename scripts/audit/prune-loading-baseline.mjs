#!/usr/bin/env node
/**
 * prune-loading-baseline — delete the `allow` entries of
 * docs/audit/loading-states/baseline.json that a fresh measurement shows FIXED
 * (Q1695).
 *
 * WHY. The loading-states refresh PR could never land (#2627, #3110, #3380,
 * #3797, #3963, #4152, 2026-10-09..11-07): loadingStateShape.test.ts grades the
 * fresh measurement against main's baseline in BOTH directions, so every fixed
 * skeleton turned the bot's own PR red ("entry no longer breaches, delete it")
 * until a person edited baseline.json on the bot branch, and nobody did. Main
 * kept the 2026-10-07 measurement, so the check graded a month-old UI.
 *
 * WHAT IT DOES. Only SHRINKS the list: an `allow` entry this measurement shows
 * not breaching (scripts/lib/loadingStateRules.mjs `staleEntries`, the same
 * rule the check uses, so an entry whose element was not measured this run is
 * kept) is removed. An entry with no `path` is never pruned (its #N key can
 * point at another element on another run). It never adds an entry and never touches `byDesign`, so a
 * NEW breach still turns the refresh PR red and waits for a fix or a person.
 *
 *   node scripts/audit/prune-loading-baseline.mjs [measurements.json] [baseline.json]
 *
 * Dependency-free: the refresh workflow's `land` job runs it with no npm install.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { breaches, staleEntries } from "../lib/loadingStateRules.mjs";

/** The baseline with every stale `allow` entry removed, and the removed ids. */
export function pruneBaseline(measurements, baseline) {
  const results = measurements.results ?? [];
  const allow = baseline.allow ?? [];
  // Only entries that name their element (`path`): keys are by index, so a
  // path-less entry can read as fixed when another element lands at its #N.
  // The check still judges those strictly; a person deletes them.
  const { stale } = staleEntries(results, allow.filter((a) => a.path), breaches(results));
  const gone = new Set(stale);
  const kept = allow.filter((a) => !gone.has(`${a.key}|${a.kind}`));
  return { baseline: { ...baseline, allow: kept }, removed: stale };
}

function main() {
  const repo = resolve(import.meta.dirname, "../..");
  const evidence = resolve(process.argv[2] ?? resolve(repo, "docs/audit/loading-states/measurements.json"));
  const basePath = resolve(process.argv[3] ?? resolve(repo, "docs/audit/loading-states/baseline.json"));
  const { baseline, removed } = pruneBaseline(JSON.parse(readFileSync(evidence, "utf8")), JSON.parse(readFileSync(basePath, "utf8")));
  if (!removed.length) {
    console.log("prune-loading-baseline: no allow entry is fixed on this measurement; baseline unchanged");
    return;
  }
  writeFileSync(basePath, JSON.stringify(baseline, null, 2) + "\n");
  console.log(`prune-loading-baseline: removed ${removed.length} fixed allow entr(ies): ${removed.join(", ")}`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();
