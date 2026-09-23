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
 *     `generated` / `generatedAt` / `measuredAt` / `measured` / `at` timestamp is
 *     evidence someone measured. Older than MAX_EVIDENCE_HOURS = stale —
 *     UNLESS something better proves it current (check-generated-current.mjs
 *     GENERATED / TWO_WAY / HISTORICAL, or WORKFLOW_BOUND below).
 *  2. EVIDENCE vs CODE. Evidence that declares what it measures (a top-level
 *     `covers` array of paths) is stale once any of those paths changes after
 *     it was measured, however young it is. Without `covers` only the age
 *     limit applies — "any src/ change" would make every file red on every
 *     commit, which is noise, not freshness.
 *  3. LEDGERS. docs/OPEN.md (the one open-work list; OPEN_ITEMS.md was
 *     retired by Q16) must be touched within MAX_LEDGER_COMMITS commits
 *     touching src/ or supabase/ (the launch-audit pre-flight rule, now
 *     enforced nightly instead of remembered).
 *  4. SCOREBOARD. docs/SCOREBOARD.md's live section (CI runs, prod SQL,
 *     issues — carried forward verbatim between refreshes) is younger than
 *     MAX_EVIDENCE_HOURS (Q59).
 *  5. REPORTS (Q165). Every docs/audit/**.md that is not a dated record
 *     (RECORD_DIRS of scripts/check-stated-counts.mjs: morning/, lanes/,
 *     inbox/, device-sweeps/ ...), not generated and not a LIVE_DOCS entry
 *     must have been touched within MAX_REPORT_DAYS. On 2026-09-23, 29 such
 *     reports were 9 days to 3 months old and no longer described the app.
 *     Refresh = re-check its findings, carry the true ones into docs/OPEN.md,
 *     `git mv` it to docs/archive/ with the one-line historical banner.
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
// `at` added 2026-09-23: loading-states/measurements.json stamps `at`, so the
// one browser measurement most likely to rot was invisible to this scan.
const TS_KEYS = ["generatedAt", "generated", "measuredAt", "measured", "at"];

// How to refresh each known evidence file. An evidence file with no entry
// here is still checked; the report just says "no refresh command recorded".
export const REFRESH = {
  "docs/audit/loading-states/baseline.json": "npm run loading-states:measure (browser + test accounts), then npm run check:loading-states",
  "e2e/happy-path/overlay-sweep.baseline.json": "UPDATE_BASELINE=1 npx playwright test e2e/happy-path/overlay-sweep.spec.ts",
  "docs/audit/loading-states/measurements.json": "npm run loading-states:measure (browser + test accounts); refreshed daily by loading-states-refresh.yml (download its artifact to land it)",
};

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

export const MAX_REPORT_DAYS = 14;
/**
 * docs/audit/ files that are NOT reports: operating docs something reads
 * today. Exact and two-way — each must exist and be linked to its consumer
 * (the consumer names the doc, or the doc names a consumer that exists;
 * src/test/stalenessWatch.test.ts), so an entry cannot outlive its use.
 */
export const LIVE_DOCS = {
  "docs/audit/launch-2026-09/PROTOCOL.md": { consumer: "scripts/check-agent-refs.mjs", why: "the contract every lh-* lane agent reads" },
  "docs/audit/launch-2026-09/WAVES.md": { consumer: "scripts/audit-coverage.mjs", why: "the fleet's wave schedule, parsed for the coverage report" },
  "docs/audit/STATE_REVIEW_PROMPT.md": { consumer: "scripts/state-review.mjs", why: "the default --prompt of the state review" },
  "docs/audit/launch-2026-09/deferred/README.md": { consumer: "docs/audit/launch-2026-09/deferred/Overlay.tsx.deferred", why: "the note on the code parked beside it" },
  "docs/audit/visual-notes-2026-09-14.md": { consumer: "scripts/check-visual-notes.mjs", why: "the owner's VN checklist, its default input; its evidence folder sits beside it" },
  "docs/audit/OPEN_ITEMS.md": { consumer: "src/test/onlyOneOpenList.test.ts", why: "the retired pointer to docs/OPEN.md (Q16)" },
};
const ARCHIVE_HOW = "re-check its open findings against the source, carry the true ones into docs/OPEN.md, then `git mv` it to docs/archive/ with the banner 'historical, superseded by docs/OPEN.md' (Q165)";

/** docs/audit/ markdown that counts as a report (see check 5). */
export function listReports(files, recordDirs, exempt) {
  return files.filter((f) => f.startsWith("docs/audit/") && f.endsWith(".md")
    && !recordDirs.some((d) => f.startsWith(d)) && !exempt.has(f) && !(f in LIVE_DOCS));
}

export function checkReports(reports, now, lastTouched) {
  const stale = [];
  for (const f of reports) {
    const at = lastTouched(f);
    const days = at ? (now - at) / 864e5 : Infinity;
    if (days > MAX_REPORT_DAYS) {
      stale.push(`${f}: report last touched ${at ? at.toISOString().slice(0, 10) : "never"} (${Math.round(days)}d ago, limit ${MAX_REPORT_DAYS}d). Refresh: ${ARCHIVE_HOW}`);
    }
  }
  return stale;
}

function lastTouchedFromGit(file) {
  const iso = git("log", "-1", "--format=%cI", "--", file);
  return iso ? new Date(iso) : null;
}

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

/**
 * AGE IS ONLY A SIGNAL WHERE NOTHING BETTER EXISTS. A file regenerated and
 * diffed on every push (check-generated-current.mjs GENERATED) or guarded both
 * ways on every push (TWO_WAY) is proven current by that check; its timestamp
 * says when someone last rewrote it, not whether it is right. Aging those out
 * forced pointless re-stamps (vacuity.baseline.json and the control ledger
 * went "stale" at 72h while their own guards were green). `exempt` is that set.
 */
export function checkEvidence(evidence, now, lastCodeChange, exempt = new Set()) {
  const stale = [];
  for (const e of evidence) {
    if (exempt.has(e.file)) continue;
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

/**
 * docs/SCOREBOARD.md's live rows (Q59): stale once older than
 * MAX_EVIDENCE_HOURS, and "never measured" is stale too.
 */
export function checkScoreboardLive(text, now, liveAgeHours) {
  const h = liveAgeHours(text, now);
  const refresh = "node scripts/scoreboard.mjs --write (gh + linked Supabase CLI), or land the artifact of the latest .github/workflows/scoreboard.yml run";
  if (h === null) return [`docs/SCOREBOARD.md: live rows were never measured. Refresh: ${refresh}`];
  if (h > MAX_EVIDENCE_HOURS) return [`docs/SCOREBOARD.md: live rows measured ${Math.round(h)}h ago (limit ${MAX_EVIDENCE_HOURS}h). Refresh: ${refresh}`];
  return [];
}

/**
 * Currency bound to a WORKFLOW rather than a file: a baseline asserted both
 * ways by a scheduled browser run is current while that run keeps passing.
 */
export const WORKFLOW_BOUND = [
  // ui-sweep.yml runs on every push too, in a DIFFERENT mode (empty-state);
  // any green run is a proxy, not the thing. Only the Friday 05:00 UTC cron
  // resolves to the overlay sweep, so only a scheduled Friday success counts.
  { file: "e2e/happy-path/overlay-sweep.baseline.json", workflow: "ui-sweep.yml", event: "schedule", weekdayUtc: 5, maxDays: 8 },
  // Re-measured daily on prod and re-proved two ways against the baseline in
  // the same run; the committed file is a snapshot of the last one landed.
  { file: "docs/audit/loading-states/measurements.json", workflow: "loading-states-refresh.yml", maxDays: 2 },
];

export function checkWorkflowBound(bound, lastSuccess, now) {
  const stale = [];
  for (const b of bound) {
    const at = lastSuccess(b);
    if (at === undefined) continue; // not measurable here (local, no gh); CI requires it
    const days = at ? (now - at) / 864e5 : Infinity;
    if (days > b.maxDays) {
      stale.push(`${b.file}: its two-way check (${b.workflow}) last passed ${at ? at.toISOString() : "never"} (limit ${b.maxDays}d). Fix the workflow's red run; the baseline is unproven until it passes.`);
    }
  }
  return stale;
}

function lastSuccessFromGh({ workflow, event, weekdayUtc }) {
  try {
    const args = ["run", "list", "--workflow", workflow, "--status", "success", "--limit", "40", "--json", "createdAt"];
    if (event) args.push("--event", event);
    const rows = JSON.parse(execFileSync("gh", args, { encoding: "utf8" }))
      .map((r) => new Date(r.createdAt))
      .filter((d) => weekdayUtc === undefined || d.getUTCDay() === weekdayUtc);
    return rows.length ? rows[0] : null;
  } catch (e) {
    if (process.env.CI) throw new Error(`gh run list failed in CI (${e.message}) — set GH_TOKEN; refusing to report fresh`);
    console.warn(`note: \`gh run list --workflow ${workflow}\` failed locally (${String(e.message).split("\n")[0]}); its currency is NOT checked in this run — CI refuses instead`);
    return undefined;
  }
}

async function main() {
  const i = process.argv.indexOf("--now");
  const now = i > 0 ? new Date(process.argv[i + 1]) : new Date();
  const evidence = listEvidence();
  const { GENERATED, TWO_WAY, HISTORICAL } = await import("./check-generated-current.mjs");
  const exempt = new Set([...GENERATED.flatMap((g) => g.outputs), ...Object.keys(TWO_WAY), ...Object.keys(HISTORICAL), ...WORKFLOW_BOUND.map((b) => b.file)]);
  const stale = [...checkEvidence(evidence, now, lastCodeChangeFromGit, exempt), ...checkWorkflowBound(WORKFLOW_BOUND, lastSuccessFromGh, now)];

  // The one open-work list (docs/audit/OPEN_ITEMS.md was retired to a pointer
  // by Q16 on 2026-09-23; checking it would demand pointless re-stamps).
  const LEDGER = "docs/OPEN.md";
  const last = git("log", "-1", "--format=%H", "--", LEDGER);
  if (last) {
    const n = Number(git("rev-list", "--count", `${last}..HEAD`, "--", "src/", "supabase/"));
    stale.push(...checkLedger(LEDGER, n));
  }

  // The scoreboard's LIVE section (CI, prod, issues) is carried forward
  // verbatim between refreshes; its age is the only thing that can rot.
  const { liveAgeHours, SCOREBOARD } = await import("./scoreboard.mjs");
  stale.push(...checkScoreboardLive(readFileSync(SCOREBOARD, "utf8"), now, liveAgeHours));

  // Reports (Q165). A shallow clone dates every file at its boundary commit,
  // which would read as "touched today": refuse rather than report fresh.
  if (git("rev-parse", "--is-shallow-repository") === "true") {
    console.error("::error::shallow clone — report ages are unmeasurable (fetch-depth: 0 / git fetch --unshallow); refusing to report fresh.");
    process.exit(2);
  }
  const { RECORD_DIRS } = await import("./check-stated-counts.mjs");
  const reports = listReports(git("ls-files", "docs/audit").split("\n").filter(Boolean), RECORD_DIRS, exempt);
  stale.push(...checkReports(reports, now, lastTouchedFromGit));

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ evidence: evidence.map((e) => e.file), stale }, null, 2));
  }
  console.log(`staleness: ${evidence.length} evidence file(s) found (${evidence.filter((e) => exempt.has(e.file)).length} proven per push or by workflow instead of by age), ${reports.length} docs/audit report(s), 1 ledger and the scoreboard live section checked.`);
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
