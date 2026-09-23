#!/usr/bin/env node
/**
 * STALENESS WATCH — nothing the monitoring relies on may be out of date.
 *
 * Owner, 2026-09-23: "nothing at all should ever be stale there is no excuse
 * for that ... set up routines so this can never happen." That night found:
 * loading-state evidence 3 days old after the skeletons changed, the audit
 * ledger 926 commits behind main, the deadcode baseline 63 exports loose, and
 * types.ts 59 differences behind prod.
 *
 * Checks, each derived from the repo rather than a hand list, so a NEW
 * baseline or ledger is covered the day it is added:
 *
 *  1. EVIDENCE AGE. Every committed JSON file carrying a top-level
 *     `generated` / `generatedAt` / `measuredAt` / `measured` timestamp is
 *     evidence someone measured. Older than MAX_EVIDENCE_HOURS = stale.
 *  2. EVIDENCE vs CODE. Evidence that declares what it measures (a top-level
 *     `covers` array of paths) is stale once any of those paths changes after
 *     it was measured, however young it is. Without `covers` only the age
 *     limit applies — "any src/ change" would make every file red on every
 *     commit, which is noise, not freshness.
 *  3. LEDGERS. docs/audit/OPEN_ITEMS.md must be re-stamped within
 *     MAX_LEDGER_COMMITS commits touching src/ or supabase/ (the launch-audit
 *     pre-flight rule, now enforced nightly instead of remembered).
 *
 * Exit 1 on anything stale, listing each with the command that refreshes it.
 * Run nightly by .github/workflows/staleness-watch.yml, which files a
 * nightly-red issue via nightly-issue-sync.
 *
 * Usage: node scripts/check-staleness.mjs [--now <iso>] [--json]
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export const MAX_EVIDENCE_HOURS = 72;
export const MAX_LEDGER_COMMITS = 25;
const TS_KEYS = ["generatedAt", "generated", "measuredAt", "measured"];

// How to refresh each known evidence file. An evidence file with no entry
// here is still checked; the report just says "no refresh command recorded".
export const REFRESH = {
  "docs/audit/loading-states/baseline.json": "npm run loading-states:measure (browser + test accounts), then npm run check:loading-states",
  "e2e/happy-path/overlay-sweep.baseline.json": "UPDATE_BASELINE=1 npx playwright test e2e/happy-path/overlay-sweep.spec.ts",
  "src/test/vacuity.baseline.json": "npm run vacuity:all (then review the diff)",
  "docs/audit/vacuity-report.json": "npm run vacuity:report",
  "src/test/controlInteractionLedger.json": "npm run audit:press (regenerates the control ledger)",
};

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

export function evidenceTimestamp(json) {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  for (const k of TS_KEYS) {
    const v = json[k];
    if (typeof v === "string" && !Number.isNaN(Date.parse(v))) return { key: k, at: new Date(v) };
  }
  return null;
}

export function listEvidence() {
  const files = git("ls-files", "*.json").split("\n").filter(Boolean)
    .filter((f) => !f.startsWith("node_modules/") && !/package(-lock)?\.json$|tsconfig|\.vscode|ios\/|android\//.test(f));
  const out = [];
  for (const f of files) {
    let json;
    try { json = JSON.parse(readFileSync(f, "utf8")); } catch { continue; } // not JSON we can read: not evidence
    const ts = evidenceTimestamp(json);
    if (ts) out.push({ file: f, ...ts, covers: Array.isArray(json.covers) ? json.covers : null });
  }
  return out;
}

export function checkEvidence(evidence, now, lastCodeChange) {
  const stale = [];
  for (const e of evidence) {
    const hours = (now - e.at) / 36e5;
    const refresh = REFRESH[e.file] ?? "no refresh command recorded — add one to REFRESH in scripts/check-staleness.mjs";
    if (hours > MAX_EVIDENCE_HOURS) {
      stale.push(`${e.file}: measured ${e.at.toISOString()} (${Math.round(hours)}h ago, limit ${MAX_EVIDENCE_HOURS}h). Refresh: ${refresh}`);
      continue;
    }
    if (!e.covers) continue;
    const changed = lastCodeChange(e.covers);
    if (changed && changed > e.at) {
      stale.push(`${e.file}: measured ${e.at.toISOString()}, but the code it measures changed at ${changed.toISOString()}. Refresh: ${refresh}`);
    }
  }
  return stale;
}

function lastCodeChangeFromGit(paths) {
  const iso = git("log", "-1", "--format=%cI", "--", ...paths);
  return iso ? new Date(iso) : null;
}

export function checkLedger(path, commitsSinceStamp) {
  if (commitsSinceStamp > MAX_LEDGER_COMMITS) {
    return [`${path}: ${commitsSinceStamp} commits touching src/ or supabase/ since it was last updated (limit ${MAX_LEDGER_COMMITS}). Reconcile it against main and re-stamp.`];
  }
  return [];
}

function main() {
  const i = process.argv.indexOf("--now");
  const now = i > 0 ? new Date(process.argv[i + 1]) : new Date();
  const evidence = listEvidence();
  const stale = [...checkEvidence(evidence, now, lastCodeChangeFromGit)];

  const LEDGER = "docs/audit/OPEN_ITEMS.md";
  const last = git("log", "-1", "--format=%H", "--", LEDGER);
  if (last) {
    const n = Number(git("rev-list", "--count", `${last}..HEAD`, "--", "src/", "supabase/"));
    stale.push(...checkLedger(LEDGER, n));
  }

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ evidence: evidence.map((e) => e.file), stale }, null, 2));
  }
  console.log(`staleness: ${evidence.length} evidence file(s) found, 1 ledger checked.`);
  if (evidence.length === 0) {
    console.error("::error::found NO timestamped evidence — the scan is broken, refusing to report fresh.");
    process.exit(2);
  }
  if (stale.length) {
    for (const s of stale) console.error(`::error::STALE ${s}`);
    process.exit(1);
  }
  console.log("OK: nothing stale.");
}

if (import.meta.url === `file://${process.argv[1]}`) main();
