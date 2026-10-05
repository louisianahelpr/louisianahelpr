#!/usr/bin/env node
/**
 * GENERATED FILES ARE CURRENT — regenerate every committed inventory and fail
 * if the committed copy differs.
 *
 * Owner, 2026-09-23: "nothing at all should ever be stale ... make sure every
 * single number is updated according to what it does paths workflows buttons
 * everything". That night: COVERAGE.md was three weeks old (5 of 39 lanes
 * "reported"; the truth was 38 of 46), ROLLUP.md and COVERAGE.md disagreed on
 * the open-finding count (397 vs 284) because they folded the bus differently,
 * SURFACE.md's prose quoted overlay counts from an earlier run (139/109 against
 * its own table's 151/117) and a notification count its parser inflated (21;
 * prod holds 18), and the GUARD-BURNDOWN score was hand-typed under a banner
 * saying "do not hand-edit". None of that was a wrong measurement — every one
 * was a generator nobody re-ran.
 *
 * So this runs every generator that can run in CI (no browser, no prod
 * secrets), compares its output with what is committed, and names the file and
 * the command that refreshes it. Generators that need a browser or prod are
 * registered too (EVIDENCE), with the workflow that refreshes them; their age
 * is enforced by scripts/check-staleness.mjs.
 *
 * COMPLETENESS IS DERIVED, not claimed. Three scans must be fully covered by
 * this file's registries, and a registry entry the scan no longer finds is
 * itself a failure (both directions):
 *   1. every script under scripts/ that writes a file,
 *   2. every committed file that declares itself generated (a "do not
 *      hand-edit" / GENERATED header, or a `<!-- generated:` block),
 *   3. every committed JSON that carries a measurement timestamp
 *      (scripts/check-staleness.mjs listEvidence()).
 *
 * Usage:
 *   node scripts/check-generated-current.mjs            # regenerate + diff + coverage scans (MAIN only)
 *   node scripts/check-generated-current.mjs --only <id>[,<id>]
 *   node scripts/check-generated-current.mjs --coverage # the three registry scans only (branches: land.sh, PR CI, gate)
 *   node scripts/check-generated-current.mjs --list     # print the inventory table
 *   node scripts/check-generated-current.mjs --outputs  # every CI generator's output path, one per line
 *   node scripts/check-generated-current.mjs --fix      # regenerate all in place (npm run inventories:refresh; the main bot)
 *
 * Exit codes: 0 current; 1 a generator crashed or a registry scan found a gap;
 * 3 DRIFT, when every problem is a committed output that differs from its
 * regenerated copy.
 *
 * ONE WRITER: THE BOT ON MAIN (owner, 2026-10-05; first step 2026-10-04 "generate
 * shared docs after merge, not in every PR"). Every output below is a whole-tree
 * product: when each branch regenerated them, every landing touched the same
 * lines (the queue score, the burn-down total, the vacuity guard count) and
 * conflicted with every other landing, or merged cleanly to the WRONG number
 * (2026-10-01, #2051: committed 1285, regenerated 1286). So:
 *   - a branch never commits a generated output. scripts/check-branch-generated.mjs
 *     (protectedPaths() below) refuses one in land.sh and in the required Test
 *     check; the bot's own bot/refresh/* branches are exempt;
 *   - main is the only place the outputs are regenerated and diffed:
 *     staleness-watch.yml runs this check on every push to main, and on DRIFT
 *     (exit 3) lands `npm run inventories:refresh` through the
 *     bot/refresh/inventories PR (.github/actions/refresh-pr, auto-merge);
 *   - vitest never reads a committed output to judge a branch (a branch's copy
 *     is stale by design); it runs the generator instead
 *     (src/test/branchesNeverEditGenerated.test.ts scans for it).
 *
 * Run (full) per push to main and nightly by staleness-watch.yml; branches run
 * only --coverage (land.sh, test.yml on a PR, `npm run gate`).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { listEvidence } from "./check-staleness.mjs";
import { ARCHIVE_DIR, ARCHIVE_RE, archivePathFor } from "./lib/openQueue.mjs";

export const REPO = resolve(import.meta.dirname, "..");

/**
 * CI-runnable generators, in dependency order (COVERAGE reads SURFACE).
 * `volatile`: lines/keys that legitimately change on every run and are
 * normalised away before comparing — kept to the timestamp only.
 */
export const GENERATED = [
  {
    // SURFACE.md's toast count is read from this same scanner (Q228).
    id: "toast-inventory",
    script: "scripts/toast-inventory.mjs",
    cmd: ["node", "scripts/toast-inventory.mjs"],
    outputs: ["docs/audit/toast-inventory.json"],
    what: "every toast call in src/ with its title/description copy (literal / template / dynamic), render status under toastPolicy, raw-error leaks",
  },
  {
    id: "surface",
    script: "scripts/audit-surface.mjs",
    cmd: ["node", "scripts/audit-surface.mjs"],
    outputs: ["docs/audit/launch-2026-09/SURFACE.md"],
    what: "routes, tabs, views, overlays, toasts, flows, forms, admin files, emails, notification types",
  },
  {
    id: "rollup",
    script: "scripts/audit-bus.mjs",
    cmd: ["node", "scripts/audit-bus.mjs", "rollup"],
    outputs: ["docs/audit/launch-2026-09/ROLLUP.md"],
    what: "launch-audit findings by severity; open / blocker / fixed counts",
  },
  {
    id: "coverage",
    script: "scripts/audit-coverage.mjs",
    cmd: ["node", "scripts/audit-coverage.mjs"],
    outputs: ["docs/audit/launch-2026-09/COVERAGE.md"],
    what: "audit lanes reported / not started; findings per lane; surface classes",
  },
  {
    id: "form-inventory",
    script: "scripts/form-inventory.mjs",
    cmd: ["node", "scripts/form-inventory.mjs"],
    outputs: ["docs/audit/form-inventory.md"],
    what: "files rendering form controls, grouped by route",
  },
  {
    id: "sitemap",
    script: "scripts/generate-sitemap.mjs",
    cmd: ["node", "scripts/generate-sitemap.mjs"],
    outputs: ["public/sitemap.xml"],
    what: "public URLs (also sitemap-drift.yml)",
  },
  {
    id: "vacuity-report",
    script: "scripts/vacuity/index.mjs",
    cmd: ["node", "scripts/vacuity/index.mjs", "--report", "--no-mutate"],
    // index.mjs exits 1 when the vacuity gate itself is red; the report is
    // still written, and the gate's own failure is vacuity.yml's to report.
    allowNonZeroExit: true,
    outputs: ["docs/audit/vacuity-report.json"],
    volatile: [/^\s*"generated": "[^"]*",?$/],
    what: "guards, registrations, empty-inventory / self-referential classes",
  },
  {
    id: "burndown",
    script: "scripts/burndown-score.mjs",
    cmd: ["node", "scripts/burndown-score.mjs"],
    outputs: ["docs/GUARD-BURNDOWN.md"],
    what: "guard burn-down score table (proven / exempt / owed per scope)",
  },
  {
    // BEFORE scoreboard: moves done items to the dated archive; the counts,
    // which read OPEN.md + archives (scripts/lib/openQueue.mjs), do not move.
    id: "archive-done",
    script: "scripts/archive-done.mjs",
    cmd: ["node", "scripts/archive-done.mjs", "--write"],
    outputs: ["docs/OPEN.md", archivePathFor(new Date().toISOString().slice(0, 10))],
    // A new month's archive has no file until its first done item moves in
    // (2026-10-01: every land.sh and staleness run crashed on the missing file).
    // Absent on both sides is current; committed but not produced still fails.
    mayBeAbsent: [archivePathFor(new Date().toISOString().slice(0, 10))],
    what: "docs/OPEN.md holds live items only; done items move verbatim to docs/archive/OPEN-done-YYYY-MM.md (Q16)",
  },
  {
    // AFTER archive-done. The Everything-open block (with the queue score line,
    // which docs/OPEN.md no longer carries, owner 2026-10-05) and the table.
    // Offline, this recomputes the LOCAL rows (queue, audit bus, burn-down,
    // baselines) and carries the LIVE section (CI runs, prod SQL, issues,
    // branches) forward verbatim — so the diff here is deterministic, and the
    // live section's shape is checked by the script itself. Its AGE is
    // check-staleness.mjs's job; `node scripts/scoreboard.mjs --write` and
    // .github/workflows/scoreboard.yml re-measure it (Q58/Q59).
    id: "scoreboard",
    script: "scripts/scoreboard.mjs",
    cmd: ["node", "scripts/scoreboard.mjs"],
    outputs: ["docs/SCOREBOARD.md"],
    what: "the scoreboard (pass / fail / total per signal) and its Everything-open block with the queue score line, owner 2026-09-23 / 2026-10-05",
  },
];

/**
 * Generators that need a browser or prod. They cannot be regenerated here; each
 * names the workflow that refreshes it and how its currency is enforced.
 */
export const EVIDENCE = [
  {
    id: "loading-states",
    script: "scripts/audit/measure-loading-states.mjs",
    outputs: ["docs/audit/loading-states/measurements.json"],
    refresh: "npm run loading-states:measure (browser + test accounts)",
    refreshedBy: ".github/workflows/loading-states-refresh.yml (daily 17:17 UTC; uploads the fresh set and lands measurements.json through an auto-merging refresh PR, Q57)",
    checkedBy: "check-loading-state-shape.mjs on the FRESH measurement in that run; check-staleness.mjs binds currency to its last successful run (2 days)",
  },
  {
    id: "write-contract",
    script: "scripts/audit/write-contract.mjs",
    outputs: ["scripts/audit/write-contract.snapshot.json"],
    refresh: "node scripts/audit/write-contract.mjs --refresh (prod schema, read-only)",
    refreshedBy: ".github/workflows/write-contract-refresh.yml (weekly; a drift is landed through an auto-merging refresh PR, Q57)",
    checkedBy: "write-contract-refresh.yml --check-drift",
  },
  {
    id: "supabase-types",
    script: "scripts/check-types-fresh.mjs",
    outputs: ["src/integrations/supabase/types.ts"],
    refresh: "npm run db:types (SUPABASE_ACCESS_TOKEN)",
    refreshedBy: "by the committer after a migration; db-deploy.yml and db-drift-detect.yml (nightly) fail when it drifts from prod",
    checkedBy: "scripts/check-types-fresh.mjs",
  },
  {
    id: "overlay-sweep",
    script: "e2e/happy-path/overlay-sweep.spec.ts",
    outputs: ["e2e/happy-path/overlay-sweep.baseline.json"],
    refresh: "UPDATE_BASELINE=1 npx playwright test e2e/happy-path/overlay-sweep.spec.ts",
    refreshedBy: ".github/workflows/ui-sweep.yml (overlay mode, weekly) — asserts both directions",
    checkedBy: "check-staleness.mjs: last successful Friday scheduled ui-sweep.yml run",
  },
  {
    id: "open-feeds",
    script: "scripts/open-sync-trackers.mjs",
    outputs: ["docs/audit/open-feeds.json"],
    refresh: "node scripts/open-sync-trackers.mjs (gh + prod ops_alert_ledger, read-only; also mirrors new sources into docs/OPEN.md)",
    refreshedBy: ".github/workflows/scoreboard.yml (measures the feeds, then lands the snapshot + OPEN.md items through its refresh PR)",
    checkedBy: "src/test/openFeedsMirrored.test.ts (every open source in the snapshot has a not-done OPEN.md item)",
  },
];

/**
 * Committed files whose currency is proven on every push by their OWN
 * two-way guard (an entry that no longer reproduces fails). Their timestamp is
 * not a freshness signal, so the age rule skips them.
 */
export const TWO_WAY = {
  "src/test/vacuity.baseline.json": "scripts/vacuity/index.mjs ratchet (stale entry fails)",
  "src/test/controlInteractionLedger.json": "src/test/controlInteractionSameness.test.ts (no-longer-a-violation fails)",
  "docs/audit/loading-states/baseline.json": "scripts/check-loading-state-shape.mjs (entry that no longer breaches fails)",
  "scripts/stated-counts-baseline.json": "scripts/check-stated-counts.mjs (an entry nothing matches fails; a new undated count fails)",
};

/**
 * Dated RECORDS, not living numbers: a one-off before/after probe kept as
 * evidence for a specific fix. They are allowed to be old because they claim
 * nothing about today — each carries its own timestamp. A living inventory may
 * never be parked here to escape a check.
 */
export const HISTORICAL = {
  "docs/audit/loading-states/skel-probe/measurements.json": "before-state of the 2026-09-22 skeleton fix (Q-loading-states), kept as its red-before evidence",
  "docs/audit/loading-states/skel-probe-after/measurements.json": "after-state of the same fix, kept as its green-after evidence",
};

/**
 * Scripts that write files which are NOT committed inventories — each with the
 * reason. A script that starts writing a committed file must move out of here.
 */
export const WRITES_NOT_COMMITTED = {
  "scripts/prune-stale-branches.mjs": "Q915: UNLANDED-branch table to $GITHUB_STEP_SUMMARY in branch-prune.yml (a CI job summary, never a repo file)",
  "scripts/stranded-work.mjs": "Q1146: --report JSON to ~/.lh-hygiene/stranded.json (outside the repo; written by .claude/hooks/git-hygiene.sh, read by session-start.sh), never a repo file",
  "scripts/lib/openItemMerge.mjs": "land.sh only: resolves a docs/OPEN.md rebase conflict item by item, mid-rebase; the result is the replayed commit's own content (docs/OPEN.md holds items only)",
  "scripts/storage-backup.mjs": "Q147: downloaded storage files + manifest.json into the db-backup runner's out/storage (encrypted into the CI artifact, never a repo file)",
  "scripts/rollback/rollback.mjs": "timing log to ~/.lh-rollback/timing.jsonl (outside the repo); in a LIVE migration rollback only, the new revert migration it stamps, which the operator commits (docs/RUNBOOK-rollback.md)",
  "scripts/audit-capture.mjs": "screenshots to ~/lh-audit-shots",
  "scripts/open-renumber.mjs": "one-shot fix-up run by land.sh after the rebase: renames the branch's copy of a Q number that origin/main already uses, in docs/OPEN.md and the archives, and land.sh commits that. Not an inventory with output to re-derive; a duplicate left behind is caught by duplicateIds in queueItemsNameTheirGuard.test.ts",
  "scripts/load/load-test.mjs": "Q60: per-run JSON (run-<runId>.json) to --out, default ~/.lh-shots/q60 (outside the repo)",
  "scripts/open-done-when.mjs": "--out report (/tmp/done-when.md in open-done-when.yml, the nightly-red issue body), never a repo file",
  "scripts/prod-deploy.mjs": "action/sha/deployment to $GITHUB_OUTPUT in prod-deploy.yml (a CI step output, never a repo file)",
  "scripts/rollback/drill-web.mjs": "current/restored/timings to $GITHUB_OUTPUT in rollback-drill.yml (a CI step output, never a repo file)",
  "scripts/audit/a11y-engine-diff.mjs": "report to --out path",
  "scripts/audit/press-every-control.mjs": "results to test-results/ (CI artifact)",
  "scripts/audit/measure-page-settle.mjs": "Q169 audit table to ~/.lh-shots/cls (evidence outside the repo); the CI budget is e2e/prod-audit/page-settle.spec.ts",
  "scripts/audit/rail-overlap-probe.mjs": "test-results/rail-probe",
  "scripts/perf/measure-load.mjs": "Q178 load timings to ~/.lh-shots/q178 (evidence outside the repo); the CI budget is scripts/perf/critical-path.mjs --check",
  "scripts/perf/cwv-lab.mjs": "Q1157/Q1158 Web Vitals lab tables, filmstrips and screenshots to ~/.lh-shots/perf (evidence outside the repo) and a throwaway TLS certificate in the OS temp dir; the CI budget is e2e/web-vitals/first-screens.spec.ts",
  "scripts/audit/walk-every-control.mjs": "~/.lh-shots/lh-audit",
  "scripts/audit/measurement-from-log.mjs": "a TRANSPORT, not a generator: rebuilds the loading-states EVIDENCE output (docs/audit/loading-states/measurements.json, produced by measure-loading-states.mjs) byte-for-byte from a loading-states-refresh branch run's log, sha256-checked, for a session that cannot reach the artifact host (#1773)",
  "scripts/build-og-shell.mjs": "dist/ (build output)",
  "scripts/canary/shared-accounts-busy.mjs": "GITHUB_OUTPUT only (the Q61 canary's stand-down verdict)",
  "scripts/vacuity/scope.mjs": "Q551: GITHUB_OUTPUT only (vacuity.yml's `scope` job: have_e2e / e2e_count / unit_count), never a repo file",
  "scripts/check-changed.mjs": "docs/audit/prepush-skips.log (untracked local log)",
  "scripts/check-gitleaksignore.mjs": "redacted gitleaks report to an os.tmpdir() dir, deleted before exit",
  "scripts/check-vercel-usage.mjs": "CI report + GITHUB_OUTPUT",
  "scripts/check-analytics-freshness.mjs": "GITHUB_STEP_SUMMARY only (Q72 daily check in quota-monitor.yml)",
  "scripts/check-quota-usage.mjs": "GITHUB_STEP_SUMMARY only (Q63 daily check in quota-monitor.yml)",
  "scripts/check-stripe-balance.mjs": "GITHUB_STEP_SUMMARY only (Q3 daily check in quota-monitor.yml)",
  "scripts/db-saturation-check.mjs": "GITHUB_STEP_SUMMARY only (Q53 hourly check in prod-errors.yml)",
  "scripts/e2e/request-budget.mjs": "request-budget/summary.json (gitignored, per CI run) + GITHUB_STEP_SUMMARY (Q104)",
  "scripts/gate.mjs": "~/.lh-gate/last.json — per-machine record of the last local gate, read by the scoreboard's gate row",
  "scripts/gateLock.mjs": "lock file",
  "scripts/generate-ios-icons.mjs": "binary app icons from the source artwork; ios-icon-sync.yml",
  "scripts/measure-back-control-hover.mjs": "--out measurement dir",
  "scripts/morning-page.mjs": "docs/morning/<date>.md, a DATED daily record that claims only its own date (Q67); morning-page.yml publishes it as the job summary + artifact and lands it through an auto-merging refresh PR (Q57, .github/actions/refresh-pr)",
  "scripts/new-migration.mjs": "scaffolds a new migration (authored, not generated)",
  "scripts/new-repro.mjs": "scaffolds a new repro spec (authored, not generated)",
  "scripts/prerender.mjs": "dist/ (build output)",
  "scripts/probe-state-matrix.mjs": "~/lh-audit-shots",
  "scripts/probes/messages-inbox-states.drive.mjs": "test-results/",
  "scripts/probes/messages-inbox-states.prod.mjs": "test-results/ ledger",
  "scripts/probes/mint-funded-seed-jobs.prod.mjs": "--out fixture ledger",
  "scripts/prod-errors-check.mjs": "CI report + GITHUB_OUTPUT",
  "scripts/prune-git-hygiene.mjs": "~/.lh-hygiene log",
  "scripts/state-review.mjs": "~/.lh-shots/lh-state-review",
  "scripts/storage-orphan-sweep.mjs": "sweep log",
  "scripts/expiry-check.mjs": "expiry-report.md (CI step summary) + GITHUB_OUTPUT",
  "scripts/supabase-usage-check.mjs": "CI report + GITHUB_OUTPUT",
  "scripts/sync-ios-metadata.mjs": "native project files during sync:ios; verified by verify-ios-metadata.sh",
  "scripts/typecheck-edge.mjs": "temporary canary file, deleted after the probe",
  "scripts/uptime-check.mjs": "CI report + GITHUB_OUTPUT",
  "scripts/vacuity/run.mjs": "temporarily mutates a guarded file and restores it",
  "scripts/verify-functions-deployed.mjs": "--lost-file for the deploy retry",
  "scripts/lib/edgeBuildStamp.mjs": "writeStamp rewrites supabase/functions/_shared/buildStamp.ts's BUILD_STAMP line inside the functions-deploy.yml runner only, right before a deploy; the committed file keeps the placeholder (src/test/edgeBuildStamp.test.ts asserts it)",
  "scripts/check-edge-build-stamps.mjs": "--mismatch-file for the functions-deploy.yml redeploy loop",
  "scripts/check-storage-refs.mjs": "--json report, uploaded as a restore-reconcile.yml artifact",
  "scripts/check-stripe-restore-drift.mjs": "--json report, uploaded as a restore-reconcile.yml artifact",
  "scripts/check-generated-current.mjs": "restores generator outputs after each comparison",
  "scripts/any-baseline.mjs": "rewrites scripts/any-baseline.json only on --write, which refuses to raise any entry (two-way guard: src/test/anyRatchet.test.ts)",
  "scripts/check-fixes-update-their-items.mjs": "GITHUB_STEP_SUMMARY only (Q1150: land.sh and the test.yml job print which named open items a landing left untouched)",
  "scripts/check-sensitive-review.mjs": "GITHUB_STEP_SUMMARY; `record` appends a hand-recorded review to docs/reviews/sensitive-reviews.jsonl (authored log, not generated; Q9)",
  "scripts/session-worktree.mjs": "creates ~/.lh-wt/session-<id> and <git-common-dir>/lh-sessions/<id>, logs overrides to ~/.lh-hygiene (Q47/Q18), nothing committed",
  "scripts/component-size-baseline.mjs": "rewrites scripts/component-size-baseline.json only on --write, which refuses to raise or add any entry (two-way guard: src/test/componentSizeRatchet.test.ts)",
  "scripts/check-stated-counts.mjs": "rewrites scripts/stated-counts-baseline.json only on --write-baseline, which refuses to grow it",
};

const WRITE_RE = /\b(writeFileSync|appendFileSync|writeFile)\s*\(/;

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(mjs|cjs|js)$/.test(e)) out.push(p);
  }
  return out;
}

/** Scan 1: every script that writes a file. */
export function discoverWriters() {
  return walk(join(REPO, "scripts"))
    .filter((p) => WRITE_RE.test(readFileSync(p, "utf8")))
    .map((p) => relative(REPO, p))
    .sort();
}

const git = (...a) => execFileSync("git", a, { cwd: REPO, encoding: "utf8", maxBuffer: 1 << 26 });

/** Scan 2: every committed file that declares itself generated. */
export function discoverDeclaredGenerated() {
  const files = git("ls-files", "--", "docs", "public", "src/test", "e2e", "scripts").split("\n").filter(Boolean)
    .filter((f) => /\.(md|json|xml|txt|html)$/.test(f));
  const out = [];
  for (const f of files) {
    let text;
    try { text = readFileSync(join(REPO, f), "utf8"); } catch { continue; }
    const head = text.split("\n").slice(0, 12).join("\n");
    if (/do not hand-edit/i.test(head) || /GENERATED (FILE|by)/.test(head) || text.includes("<!-- generated:")) out.push(f);
  }
  return out.sort();
}

export function registeredOutputs() {
  return new Set([...GENERATED, ...EVIDENCE].flatMap((g) => g.outputs));
}

/**
 * Files only the main bot may write (owner, 2026-10-05). Every CI generator's
 * outputs, EXCEPT docs/OPEN.md (archive-done edits it on main, but its items
 * are the authored source a branch exists to change), plus EVERY dated
 * done-item archive (archive-done appends to them; open-renumber reads them).
 * EVIDENCE outputs are not here: each has its own refresh and checker, and
 * some (supabase types, the write-contract snapshot) are legitimately
 * committed with the migration that changes them.
 */
export const AUTHORED_SOURCES = new Set(["docs/OPEN.md"]);

export function isProtectedPath(path) {
  const p = String(path).replace(/^\.\//, "");
  if (AUTHORED_SOURCES.has(p)) return false;
  if (p.startsWith(`${ARCHIVE_DIR}/`) && ARCHIVE_RE.test(p.slice(ARCHIVE_DIR.length + 1))) return true;
  return GENERATED.some((g) => g.outputs.includes(p));
}

/** Coverage of the three scans, both directions. Returns problem strings. */
export function coverageProblems({ writers = discoverWriters(), declared = discoverDeclaredGenerated(), evidence = listEvidence().map((e) => e.file) } = {}) {
  const problems = [];
  const genScripts = new Set([...GENERATED, ...EVIDENCE].map((g) => g.script));
  for (const w of writers) {
    if (!genScripts.has(w) && !(w in WRITES_NOT_COMMITTED)) {
      problems.push(`${w} writes files but is in no registry — register it in GENERATED/EVIDENCE (it writes a committed inventory) or WRITES_NOT_COMMITTED (with the reason) in scripts/check-generated-current.mjs`);
    }
  }
  for (const w of Object.keys(WRITES_NOT_COMMITTED)) {
    if (!writers.includes(w)) problems.push(`WRITES_NOT_COMMITTED entry ${w} no longer writes a file (or is gone) — remove it`);
  }
  for (const g of [...GENERATED, ...EVIDENCE]) {
    if (!existsSync(join(REPO, g.script))) problems.push(`${g.id}: generator ${g.script} does not exist — update the registry`);
    for (const o of g.outputs) if (!existsSync(join(REPO, o)) && !g.mayBeAbsent?.includes(o)) problems.push(`${g.id}: output ${o} does not exist — update the registry`);
  }
  const outs = registeredOutputs();
  for (const f of declared) {
    if (!outs.has(f)) problems.push(`${f} declares itself generated but no registry entry produces it — register its generator`);
  }
  for (const f of evidence) {
    if (!outs.has(f) && !(f in TWO_WAY) && !(f in HISTORICAL)) problems.push(`${f} carries a measurement timestamp but is in no registry (GENERATED, EVIDENCE, TWO_WAY or HISTORICAL)`);
  }
  for (const f of [...Object.keys(TWO_WAY), ...Object.keys(HISTORICAL)]) if (!existsSync(join(REPO, f))) problems.push(`registry entry ${f} does not exist — remove it`);
  return problems;
}

export function normalise(text, volatile = []) {
  if (!volatile.length) return text;
  return text.split("\n").map((l) => (volatile.some((re) => re.test(l)) ? "<volatile>" : l)).join("\n");
}

/** First differing line, for a readable failure. */
export function firstDiff(a, b) {
  const A = a.split("\n");
  const B = b.split("\n");
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    if (A[i] !== B[i]) return { line: i + 1, committed: A[i] ?? "<end of file>", regenerated: B[i] ?? "<end of file>" };
  }
  return null;
}

/**
 * A non-zero exit is failure unless the generator opted in with
 * allowNonZeroExit AND actually rewrote an output. A crash (e.g. a missing
 * `typescript` in a tree without node_modules) also exits 1 but writes
 * nothing, and was once read as "unchanged" (2026-09-27, vacuity-report).
 * Every opted-in generator stamps a volatile `generated` time, so a real
 * write always changes the bytes.
 */
export function generatorFailed(g, run, before, after) {
  if (run.status === 0) return false;
  if (!g.allowNonZeroExit) return true;
  return after.every((text, k) => text === before[k]);
}

/**
 * Run one generator, compare, and RESTORE the committed bytes whatever
 * happens, so running the check never edits the working tree.
 */
export function checkGenerator(g) {
  const saved = new Map(g.outputs.map((o) => [o, existsSync(join(REPO, o)) ? readFileSync(join(REPO, o), "utf8") : null]));
  let produced;
  let run;
  try {
    run = spawnSync(g.cmd[0], g.cmd.slice(1), { cwd: REPO, encoding: "utf8", maxBuffer: 1 << 26 });
    produced = new Map(g.outputs.map((o) => [o, existsSync(join(REPO, o)) ? readFileSync(join(REPO, o), "utf8") : null]));
  } finally {
    for (const [o, text] of saved) {
      const p = join(REPO, o);
      if (text === null) rmSync(p, { force: true }); else writeFileSync(p, text); // force: an absent file is already the wanted state
    }
  }
  const refresh = g.cmd.join(" ");
  if (generatorFailed(g, run, g.outputs.map((o) => saved.get(o)), g.outputs.map((o) => produced.get(o)))) {
    return [`${g.id}: generator failed (exit ${run.status}) — ${refresh}\n${(run.stderr || run.stdout || "").trim().split("\n").slice(-5).join("\n")}`];
  }
  const problems = [];
  for (const o of g.outputs) {
    const before = saved.get(o);
    const after = produced.get(o);
    if (after === null && before === null && g.mayBeAbsent?.includes(o)) continue;
    if (after === null) { problems.push(`${o}: ${refresh} did not produce it`); continue; }
    if (before === null) { problems.push(`${o}: not committed — run \`${refresh}\` and commit it`); continue; }
    const a = normalise(before, g.volatile);
    const b = normalise(after, g.volatile);
    if (a !== b) {
      const d = firstDiff(a, b);
      problems.push(
        `STALE ${o} — the committed copy differs from what its generator produces now (npm run inventories:refresh regenerates all of them).\n` +
          `    refresh: ${refresh}   (then commit ${o})\n` +
          `    first difference, line ${d.line}:\n      committed:   ${String(d.committed).slice(0, 160)}\n      regenerated: ${String(d.regenerated).slice(0, 160)}`,
      );
    }
  }
  return problems;
}

function printList() {
  console.log("| file | generator | how refreshed | how checked |");
  console.log("|---|---|---|---|");
  for (const g of GENERATED) for (const o of g.outputs) console.log(`| \`${o}\` | \`${g.cmd.join(" ")}\` | by the main bot (staleness-watch.yml, bot/refresh/inventories) | regenerate-and-diff, every push to main + nightly |`);
  for (const g of EVIDENCE) for (const o of g.outputs) console.log(`| \`${o}\` | \`${g.script}\` | ${g.refreshedBy} | ${g.checkedBy} |`);
  for (const [f, how] of Object.entries(TWO_WAY)) console.log(`| \`${f}\` | hand-lowered baseline | when a fix lowers it, same commit | ${how} |`);
}

/** Exit code for "only committed outputs differ" (see the header). */
export const DRIFT_EXIT = 3;

/** True when there are problems and every one is a STALE output: drift, not a crash or a registry gap. */
export function isPureDrift(problems) {
  return problems.length > 0 && problems.every((p) => p.startsWith("STALE "));
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--list")) return printList();
  if (argv.includes("--coverage")) {
    // What a BRANCH is judged on: the registries cover every writer, every
    // self-declared generated file and every timestamped JSON. Never the
    // outputs' currency: that is main's (staleness-watch.yml).
    const problems = coverageProblems();
    for (const p of problems) console.error(`::error::${p}`);
    if (problems.length) process.exit(1);
    console.log(`generated-current --coverage: registries complete (${GENERATED.length} CI generators, ${EVIDENCE.length} evidence, ${Object.keys(WRITES_NOT_COMMITTED).length} non-inventory writers).`);
    return;
  }
  if (argv.includes("--outputs")) {
    // One path per line: what staleness-watch.yml's Q57 refresh PR may commit.
    for (const o of [...new Set(GENERATED.flatMap((g) => g.outputs))]) console.log(o);
    return;
  }
  const active = GENERATED;
  if (argv.includes("--fix")) {
    // Regenerate everything IN PLACE (no restore), in dependency order, and say
    // what moved. Never stages anything: the committer reviews and commits.
    // Adding a test moves the burn-down score and the vacuity report, so this
    // is the one command to run before pushing a new guard.
    for (const g of active) {
      const before = g.outputs.map((o) => (existsSync(join(REPO, o)) ? readFileSync(join(REPO, o), "utf8") : ""));
      const run = spawnSync(g.cmd[0], g.cmd.slice(1), { cwd: REPO, encoding: "utf8", maxBuffer: 1 << 26 });
      const afterAll = g.outputs.map((o) => (existsSync(join(REPO, o)) ? readFileSync(join(REPO, o), "utf8") : ""));
      if (generatorFailed(g, run, before, afterAll)) {
        console.error(`✗ ${g.id}: ${g.cmd.join(" ")} exited ${run.status} without rewriting its output\n${(run.stderr || run.stdout || "").trim().split("\n").slice(-5).join("\n")}`);
        process.exitCode = 1;
        continue;
      }
      g.outputs.forEach((o, k) => {
        // An output may legitimately not exist: on the 1st of a month the dated
        // OPEN-done archive has no file until something is archived into it.
        const after = afterAll[k];
        const moved = normalise(before[k], g.volatile) !== normalise(after, g.volatile);
        // Only a volatile line (a timestamp) moved: keep the committed bytes,
        // so a refresh with nothing to say leaves no diff (Q57 refresh PRs).
        if (!moved && before[k] && before[k] !== after) writeFileSync(join(REPO, o), before[k]);
        console.log(`${moved ? "↻ regenerated" : "  unchanged  "} ${o}`);
      });
    }
    return;
  }
  const i = argv.indexOf("--only");
  const only = i >= 0 ? new Set(argv[i + 1].split(",")) : null;

  const problems = only ? [] : coverageProblems();
  const selected = active.filter((g) => !only || only.has(g.id));
  for (const g of selected) {
    const p = checkGenerator(g);
    console.log(`${p.length ? "✗" : "✓"} ${g.id.padEnd(15)} ${g.outputs.join(", ")}`);
    problems.push(...p);
  }
  console.log(
    `generated-current: ${selected.length} CI generator(s) re-run, ${EVIDENCE.length} browser/prod evidence generator(s) registered, ` +
      `${Object.keys(TWO_WAY).length} two-way baseline(s), ${Object.keys(WRITES_NOT_COMMITTED).length} non-inventory writer(s) classified.`,
  );
  if (!only && GENERATED.length < 7) problems.push(`only ${GENERATED.length} generators registered — the registry shrank; floor is 7`);
  if (problems.length) {
    for (const p of problems) console.error(`::error::${p}`);
    // 3 = drift only (the caller decides whose it is); 1 = anything else.
    process.exit(isPureDrift(problems) ? DRIFT_EXIT : 1);
  }
  console.log("OK: every generated inventory is current.");
}

if (import.meta.url === `file://${process.argv[1]}`) main();
