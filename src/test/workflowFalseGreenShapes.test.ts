/*
 * CLASS GUARD: a workflow step that goes GREEN when the thing it checks is
 * broken. (docs/OPEN.md Q52, owner 2026-09-23: "nothing is a false positive or
 * going green if it's not truly green".)
 *
 * ── What this class cost, measured 2026-09-23 ───────────────────────────────
 * The same night five checks were found green while checking nothing (a
 * $fn$-only parser, a guard matching a comment, a cron detector counting one
 * failure kind, npm audit failing only on critical, a generated report with
 * machine-specific data). Scanning .github/ for the SHAPES that produce that
 * found, in the workflows themselves:
 *
 *   nightly-red-age.yml   `gh issue list … || echo '[]'` — the GATE that reads
 *                         every nightly-red issue treated a failed read as
 *                         "zero open" and printed "None open."
 *   migration-lint.yml,   `FILES=$(git diff … || true)` then `[ -z "$FILES" ]
 *   db-deploy.yml,        && exit 0` — a failed diff read as "no migration /
 *   functions-deploy.yml  function changed": lint nothing, deploy nothing, green.
 *   deploy.yml            console.log guard: `grep … dist/assets/*.js
 *                         2>/dev/null | … || true` — no bundle at all = clean.
 *   db-smoke.yml          role-string scan: grep exit 2 (could not read) was
 *                         swallowed as "no match".
 *   prod-audit.yml        strike check + leftover sweeper: exit 2 ("could not
 *                         read prod") was a ::warning:: and the job stayed green.
 *   press-every-control   missing key -> `exit 0` (personas UNCOVERED, clean-up
 *                         and the proof-photo CHECK skipped), and the notify job
 *                         ignored the clean-up job's result.
 *   e2e-real-backend.yml  the `authenticated` leg runs every schedule but was
 *                         not in the nightly-red status: a red leg closed the
 *                         issue.
 *
 * ── The shapes ──────────────────────────────────────────────────────────────
 *   SWALLOW      `|| true`, `|| :`, `|| echo …`, `|| exit 0`, `|| printf`
 *   EARLY_EXIT   `exit 0` anywhere but the last line of a run block — every
 *                "nothing to do / secret missing -> green" path
 *   COE          `continue-on-error` with no later step reading
 *                `steps.<id>.outcome`; reading `.conclusion` of such a step is
 *                ALWAYS wrong (it is 'success' even when the step failed)
 *   NOTIFY       a nightly-issue-sync `status:` that ignores one of the job's
 *                `needs` — a red leg that cannot open (or keep open) the issue
 *   PIPE         a CHECK command (node/npm/npx/bash/…) on the left of a pipe in
 *                a block without pipefail: GitHub's default shell is
 *                `bash -e {0}`, so the pipe's status is the RIGHT side's
 *   SET_PLUS_E   `set +e` — errexit off; every one must re-read its codes
 *   SHELL        a custom `shell:` that drops `-e`
 *
 * Every occurrence is either FIXED or listed below with the reason it is
 * truthful. Both directions are enforced: an entry that no longer matches
 * anything fails (so the list cannot rot into a permanent excuse), and a
 * reason must be a sentence, not a placeholder.
 *
 * Comments are ignored (a line whose first non-blank char is `#`), and
 * backslash-continued lines are joined, so `node x \n --flag … || true` is
 * judged as the one command it is.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "yaml";

const ROOT = resolve(__dirname, "../..");
const WF_DIR = join(ROOT, ".github/workflows");
const ACT_DIR = join(ROOT, ".github/actions");

type Step = Record<string, unknown> & { run?: unknown; name?: string; id?: string; uses?: string; shell?: string; with?: Record<string, unknown> };
type Job = Record<string, unknown> & { steps?: Step[]; needs?: string | string[] };

interface Block { file: string; job: string; step: string; stepObj: Step; jobObj: Job; lines: string[]; shell: string | undefined; composite: boolean }
interface Hit { file: string; job: string; step: string; text: string }

function workflowFiles(): string[] {
  const out = readdirSync(WF_DIR).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml")).map((f) => `.github/workflows/${f}`);
  for (const d of readdirSync(ACT_DIR)) {
    for (const n of ["action.yml", "action.yaml"]) if (existsSync(join(ACT_DIR, d, n))) out.push(`.github/actions/${d}/${n}`);
  }
  return out;
}

/** Whole-line comments dropped; backslash continuations joined into one logical line. */
function logicalLines(run: string): string[] {
  const out: string[] = [];
  let buf = "";
  for (const raw of run.split("\n")) {
    const t = raw.trim();
    if (!buf && (t === "" || t.startsWith("#"))) continue;
    if (buf && t.startsWith("#")) continue;
    if (t.endsWith("\\")) { buf += t.slice(0, -1) + " "; continue; }
    out.push((buf + t).replace(/\s+/g, " ").trim());
    buf = "";
  }
  if (buf.trim()) out.push(buf.replace(/\s+/g, " ").trim());
  return out.filter(Boolean);
}

const files = workflowFiles();
const docs = files.map((file) => ({ file, doc: parse(readFileSync(join(ROOT, file), "utf8")) as Record<string, unknown> }));

const blocks: Block[] = [];
const jobsByFile: { file: string; jobId: string; job: Job; composite: boolean }[] = [];
for (const { file, doc } of docs) {
  const composite = !doc.jobs;
  const jobs: Record<string, Job> = composite
    ? { composite: { steps: ((doc.runs as Record<string, unknown>)?.steps ?? []) as Step[] } }
    : (doc.jobs as Record<string, Job>);
  const defShell = ((doc.defaults as Record<string, Record<string, unknown>>)?.run?.shell) as string | undefined;
  for (const [jobId, job] of Object.entries(jobs)) {
    jobsByFile.push({ file, jobId, job, composite });
    const jobShell = ((job.defaults as Record<string, Record<string, unknown>>)?.run?.shell) as string | undefined;
    (job.steps ?? []).forEach((s, i) => {
      if (typeof s.run !== "string") return;
      blocks.push({
        file, job: jobId, step: String(s.name ?? s.id ?? `#${i}`), stepObj: s, jobObj: job,
        lines: logicalLines(s.run), shell: s.shell ?? jobShell ?? defShell, composite,
      });
    });
  }
}

// ── the allowlists (two-way) ───────────────────────────────────────────────

interface Allow { file: string; match: string; reason: string }

const LEDGER = "the ops-alert ledger write is a SECOND channel inside a step that only runs once the job has already failed (or the alert already fired); the red run itself is the primary signal, and a ledger outage must not suppress the Slack post after it";
const SLACK_FAIL = "a Slack delivery failure inside a notify-on-FAILURE step: the job is already red, so the swallow only keeps the warning text from replacing the real failure as the headline";
const DIAG = "diagnostic output only (version strings / listings printed for a human reading a failed run); nothing decides pass/fail from it";

/** `|| true` and friends that are truthful. `match` is a substring of `job / step :: line`. */
const SWALLOW_OK: Allow[] = [
  { file: ".github/workflows/broken-links.yml", match: `|| echo "000")`, reason: "curl failing to connect becomes status 000, which the case statement below treats as BROKEN (FAIL=1) — the swallow converts a transport error into a failure, not a pass" },
  { file: ".github/workflows/bundle-size.yml", match: "INITIAL_CHUNKS=$(grep -oE", reason: "grep exits 1 on no match; the EMPTY-GREP GUARD immediately below fails the step when INITIAL_CHUNKS is empty, so an empty read cannot pass" },
  { file: ".github/workflows/db-backup.yml", match: "N=$(grep -cF", reason: "grep -c prints 0 and exits 1 on no match; the next line fails the dump (FAIL=1) when N < 1, so zero rows is a failure" },
  { file: ".github/workflows/db-backup.yml", match: "TABLES=$(grep -cE", reason: "grep -c prints 0 and exits 1 on no match; the floor check right after fails when fewer than 30 tables carry data" },
  { file: ".github/workflows/db-deploy.yml", match: "supabase migration list --", reason: DIAG + "; the real push step below fails on its own if the CLI cannot reach prod" },
  { file: ".github/workflows/db-deploy.yml", match: "VERSIONS=$(echo \"$OUT\"", reason: "an empty VERSIONS is only accepted when the CLI output says nothing is pending ('up to date'); any other empty parse fails the pre-flight" },
  { file: ".github/workflows/db-deploy.yml", match: "f=$(ls supabase/migrations/${v}_*.sql", reason: "a pending version with no local file is collected into MISSING and the step exits 1 — the swallow feeds a failure path, not a pass" },
  { file: ".github/workflows/db-deploy.yml", match: "Notify on failure :: node scripts/ops-alert-ledger.mjs record", reason: LEDGER },
  { file: ".github/workflows/db-deploy.yml", match: "Notify on failure :: curl -sS --fail", reason: SLACK_FAIL },
  { file: ".github/workflows/db-drift-detect.yml", match: "sed 's/^/ /' /tmp/remote-err.txt", reason: "echoes the remote error text into the log on a path that has already decided to fail; a missing error file must not replace that failure" },
  { file: ".github/workflows/db-drift-detect.yml", match: "$(basename \"$FILE\" 2>/dev/null || echo unknown)", reason: "a label inside a report line (which migration file) — the drift verdict is computed elsewhere and does not read this" },
  { file: ".github/workflows/deploy.yml", match: "ESLint (advisory — does not block deploy) :: npm run lint", reason: "advisory on the release path only; lint BLOCKS every push in test.yml (`npm run lint`), so a lint error cannot reach main green" },
  { file: ".github/workflows/deploy.yml", match: "OFFENDERS=$(grep -lE", reason: "grep -v exits 1 when every file is filtered out (= no offenders); the bundle floor added above (Q52) fails first when there is no dist/assets/*.js to scan" },
  { file: ".github/workflows/deploy.yml", match: "npm outdated \"@capacitor/*\"", reason: "npm outdated exits 1 whenever anything is outdated; this is an advisory listing for the release log, not a gate" },
  { file: ".github/workflows/deploy.yml", match: "cp fastlane/changelog.txt", reason: "copies optional App Review notes; fastlane's own upload fails if required metadata is missing, and a missing optional note is not a check" },
  { file: ".github/workflows/deploy.yml", match: "Read final version + build number :: ", reason: "reads the version for a log line and step output, with explicit 0.0.0 / 0 fallbacks; the build itself already succeeded or failed before this step" },
  { file: ".github/workflows/deploy.yml", match: "Notify Slack — failure :: node scripts/ops-alert-ledger.mjs record", reason: LEDGER },
  { file: ".github/workflows/deploy.yml", match: "Notify Slack — failure :: curl -sS --fail", reason: SLACK_FAIL },
  { file: ".github/workflows/deploy.yml", match: "security delete-keychain", reason: "post-run cleanup of a temporary keychain that may not exist when an earlier step failed; deleting nothing is not a check" },
  { file: ".github/workflows/functions-deploy.yml", match: "FUNCTIONS=$(echo \"$CHANGED\"", reason: "grep exits 1 when no function dir changed, which is a real empty set; CHANGED itself comes from a git diff that now fails loudly (Q52), and config/_shared/workflow changes promote to deploy-all below" },
  { file: ".github/workflows/functions-deploy.yml", match: "FUNCTIONS=$(ls supabase/functions/ | grep -v '^_shared$'", reason: "deploy-all listing; grep -v exits 1 only if every entry is _shared, and an empty list still hits the explicit 'nothing to deploy' path which is logged, never reached on a real tree" },
  { file: ".github/workflows/functions-deploy.yml", match: "Notify on failure :: node scripts/ops-alert-ledger.mjs record", reason: LEDGER },
  { file: ".github/workflows/functions-deploy.yml", match: "Notify on failure :: curl -sS --fail", reason: SLACK_FAIL },
  { file: ".github/workflows/ios-beta.yml", match: "Dump Fastlane diagnostics on failure :: ", reason: DIAG + " — this step only runs after the fastlane step already failed" },
  { file: ".github/workflows/ios-beta.yml", match: "Cleanup signing material :: ", reason: "post-run removal of signing material that may not exist when an earlier step failed; removing nothing is not a check" },
  { file: ".github/workflows/main-red-watch.yml", match: "OPEN=$(gh issue list", reason: "a failed read counts 0 open issues, which POSTS to Slack — the swallow fails toward a duplicate alert (noise), never toward silence" },
  { file: ".github/workflows/main-red-watch.yml", match: "Slack, once per new red :: node scripts/ops-alert-ledger.mjs record", reason: LEDGER },
  { file: ".github/workflows/migration-lint.yml", match: "node scripts/check-destructive-ddl.mjs --all", reason: "whole-history fallback that re-reports ~46 settled statements; the destructive-DDL GATE is db-deploy.yml's pending-set pre-flight, which has no bypass (see the step comment)" },
  { file: ".github/workflows/prod-freshness.yml", match: "SERVED=$(grep -oiE", reason: "an empty SERVED records 'no build-commit meta tag' and retries; after the retry budget the step fails — the swallow feeds the retry loop, not a pass" },
  { file: ".github/workflows/prod-freshness.yml", match: "BEHIND=$(git rev-list --count", reason: "a '?' in the 'commits behind' message of a step that is already failing on a stale prod; nothing decides pass/fail from it" },
  { file: ".github/workflows/prod-freshness.yml", match: "STAMP=$(grep -oiE", reason: "writes the served stamp into the step summary for humans; the freshness verdict is the previous step's" },
  { file: ".github/workflows/schedule-heartbeat.yml", match: "STATE=$(gh api", reason: "fail-closed: a failed read becomes state 'unknown', which is != 'active' and counts the workflow STALE with an ::error::" },
  { file: ".github/workflows/schedule-heartbeat.yml", match: "LAST=$(gh api", reason: "fail-closed: a failed read becomes an empty LAST, which is reported as 'no scheduled run ever' with an ::error::" },
  { file: ".github/workflows/security-audit.yml", match: "npm audit --audit-level=low || true", reason: "prints the full all-severity report for review; the gating command is the next one, `npm audit --omit=dev --audit-level=moderate`, with no swallow" },
  { file: ".github/workflows/supabase-usage.yml", match: "Tell Slack :: node scripts/ops-alert-ledger.mjs record", reason: LEDGER },
  { file: ".github/workflows/supabase-usage.yml", match: "Page Vercel usage to Slack :: node scripts/ops-alert-ledger.mjs record", reason: LEDGER },
  { file: ".github/workflows/supabase-usage.yml", match: "Summary :: cat ", reason: "copies a report into the step summary; the usage verdict is decided by the measuring steps above" },
  { file: ".github/workflows/test.yml", match: "git fetch --no-tags --depth=1 origin \"$BASE\"", reason: "a failed fetch is followed by `git cat-file -e` on the base; if it is still missing the step checks the WHOLE tree (--all) instead of the diff — failing toward more checking" },
  { file: ".github/workflows/uptime.yml", match: "Tell Slack :: node scripts/ops-alert-ledger.mjs record", reason: LEDGER },
  { file: ".github/actions/nightly-issue-sync/action.yml", match: "gh label create", reason: "creates a label that already exists on every run after the first; the issue open/close that follows fails loudly on its own" },
  { file: ".github/actions/nightly-issue-sync/action.yml", match: "OPENED_AT=$(gh issue view", reason: "only feeds the optional >24h 'stale' escalation label; nightly-red-age.yml independently reads createdAt and fails on age, so a missed label is not a missed red" },
  { file: ".github/actions/nightly-issue-sync/action.yml", match: "OPENED_S=$(date -u -d", reason: "portable date parse (GNU then BSD) for the same optional stale label as OPENED_AT; age is gated independently by nightly-red-age.yml" },
  { file: ".github/actions/nightly-issue-sync/action.yml", match: "gh issue edit \"$EXISTING\"", reason: "adds/removes the cosmetic -stale label on an issue that stays OPEN either way; the open issue is the signal" },
];
/** `exit 0` before the end of a block. `match` is a substring of `job / step :: line`. */
const EARLY_EXIT_OK: Allow[] = [
  { file: ".github/workflows/db-deploy.yml", match: "Scan the pushed range for destructive DDL :: exit 0", reason: "the pushed range was verified to exist (`git cat-file -e`) and the diff now fails loudly (Q52), so an empty file list really means no migration changed" },
  { file: ".github/workflows/db-deploy.yml", match: "PRE-FLIGHT — destructive DDL in the exact pending set :: exit 0", reason: "reached only when the CLI itself says nothing is pending ('up to date' / 'no migrations'); any other empty parse fails" },
  { file: ".github/workflows/db-deploy.yml", match: "Notify on failure :: exit 0", reason: "Slack secret missing inside a notify-on-FAILURE step: the job is already red and says so with a ::warning:: naming the secret" },
  { file: ".github/workflows/db-smoke.yml", match: "Wait for Postgres :: exit 0", reason: "the SUCCESS path of a readiness loop (Postgres answered); the loop falls through to a failure after its attempts" },
  { file: ".github/workflows/deploy.yml", match: "Notify Slack — failure :: exit 0", reason: "Slack secret missing inside a notify-on-FAILURE step: the job is already red and says so with a ::warning:: naming the secret" },
  { file: ".github/workflows/functions-deploy.yml", match: "Determine functions to deploy :: exit 0", reason: "no function, _shared, config.toml or workflow change in a diff that now fails loudly (Q52) — nothing to deploy is the truthful result" },
  { file: ".github/workflows/functions-deploy.yml", match: "Verify every deploy actually landed :: exit 0", reason: "the SUCCESS path: verify-functions-deployed.mjs confirmed every target landed; the retry loop fails otherwise" },
  { file: ".github/workflows/functions-deploy.yml", match: "Notify on failure :: exit 0", reason: "Slack secret missing inside a notify-on-FAILURE step: the job is already red and says so with a ::warning:: naming the secret" },
  { file: ".github/workflows/ios-beta.yml", match: "Decide :: exit 0", reason: "manual dispatch always builds; this sets should_build=true and stops the schedule-only change detection below" },
  { file: ".github/workflows/ios-beta.yml", match: "Upload iOS sourcemaps to Sentry :: exit 0", reason: "sourcemap upload is a convenience for symbolication, not a check; the missing secrets are named in a ::warning:: on every run" },
  { file: ".github/workflows/ios-icon-sync.yml", match: "Commit regenerated icons :: exit 0", reason: "regeneration produced no diff, so there is nothing to commit — the icons already match" },
  { file: ".github/workflows/main-red-watch.yml", match: "Slack, once per new red :: exit 0", reason: "the nightly-red ISSUE was already filed by the step before; only the Slack copy is skipped, with a ::warning:: naming the secret" },
  { file: ".github/workflows/migration-lint.yml", match: "Find changed migrations :: exit 0", reason: "a real, computed diff range (the diff now fails loudly, Q52) containing no migration change; the no-base case lints ALL migrations instead" },
  { file: ".github/workflows/prod-freshness.yml", match: "Wait for prod to serve this commit :: exit 0", reason: "the SUCCESS paths: prod serves exactly this commit, or a descendant of it" },
  { file: ".github/workflows/race-runner.yml", match: "Wait for Postgres :: pg_isready", reason: "the SUCCESS path of a readiness loop (Postgres answered); the loop falls through to a failure after its attempts" },
];
/** continue-on-error with no outcome read. `match` is the step name. */
const COE_OK: Allow[] = [
  { file: ".github/workflows/deploy.yml", match: "ESLint (advisory — does not block deploy)", reason: "advisory on the release path only; lint BLOCKS every push in test.yml, so nothing unlinted reaches main green" },
  { file: ".github/workflows/deploy.yml", match: "Check outdated Capacitor plugins (advisory)", reason: "an advisory listing (npm outdated exits 1 whenever anything is outdated); not a check of this release" },
];
const PREFLIGHT = "preflight only decides which legs run; a red preflight SKIPS those legs, and a skipped leg is not 'success', so the status already reports failure";
/** needs a nightly-issue-sync status deliberately ignores. `match` is `notifyJob:need`. */
const NOTIFY_NEED_OK: Allow[] = [
  { file: ".github/workflows/e2e-journeys.yml", match: "notify:preflight", reason: PREFLIGHT },
  { file: ".github/workflows/e2e-real-backend.yml", match: "notify:preflight", reason: PREFLIGHT },
  { file: ".github/workflows/prod-audit.yml", match: "notify:preflight", reason: PREFLIGHT },
  { file: ".github/workflows/e2e-real-backend.yml", match: "notify:two-role", reason: "manual-only leg (workflow_dispatch + run_two_role input); it is `skipped` on every schedule, so requiring it would pin the nightly red for a leg that never runs there" },
  { file: ".github/workflows/e2e-real-backend.yml", match: "notify:boundary-report", reason: "a report of which legs did not run; every leg it can report uncovered on a schedule (authenticated, prod-lifecycle) is itself required to be 'success' in status" },
];
/** a check command piped without pipefail. `match` is a substring of `job / step :: line`. */
const PIPE_OK: Allow[] = [];
/** set +e blocks. `match` is the step name. */
const SET_PLUS_E_OK: Allow[] = [
  { file: ".github/workflows/a11y-webkit-prod.yml", match: "Diff WebKit against Chromium", reason: "captures the diff script's own code via PIPESTATUS[0] through `| tee` and ends with `exit \"$rc\"`" },
  { file: ".github/workflows/prod-audit.yml", match: "Shared test accounts carry no strikes", reason: "captures the code and maps it: 0 passes, 1 (strike) and 2 (could not read — fixed to fail in Q52) and anything else all exit non-zero" },
  { file: ".github/workflows/prod-audit.yml", match: "Remove leftover prod-audit jobs this run could not clean up itself", reason: "captures the code and maps it: 0 passes, 1 (cap/delete failed) and 2 (could not read — fixed to fail in Q52) and anything else all exit non-zero" },
  { file: ".github/workflows/stripe-webhook-guard.yml", match: "Self-test — the guard must go red on", reason: "a NEGATIVE self-test: runs the guard on a known-bad fixture and fails the step if the guard exits 0 — errexit must be off to observe the expected failure" },
];

const used = new Set<Allow>();
function allowed(list: Allow[], file: string, text: string): boolean {
  const hit = list.find((a) => a.file === file && text.includes(a.match));
  if (hit) used.add(hit);
  return !!hit;
}
/** What an allowlist `match` is tested against: `job / step :: logical line`. */
const key = (b: { job: string; step: string }, text: string) => `${b.job} / ${b.step} :: ${text}`;
const fmt = (h: Hit) => `${h.file} [${h.job} / ${h.step}]  ${h.text.slice(0, 200)}`;

// ── the scans ──────────────────────────────────────────────────────────────

const SWALLOW_RE = /\|\|\s*(?:true\b|:(?=\s|;|\)|$)|echo\b|printf\b|exit\s+0\b)/;
const CHECKERS = new Set(["npm", "npx", "node", "bash", "sh", "pnpm", "yarn", "deno", "supabase", "psql", "playwright", "vitest", "tsc", "eslint"]);

function stripQuoted(s: string): string {
  return s.replace(/'[^']*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, '""');
}

/** First word of every pipeline segment that sits on the LEFT of a single `|`. */
function pipeLefts(line: string): string[] {
  const s = stripQuoted(line);
  const lefts: string[] = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== "|" || s[i + 1] === "|" || s[i - 1] === "|") continue;
    // walk back to the start of this command
    let j = i - 1;
    let depth = 0;
    for (; j >= 0; j--) {
      const c = s[j];
      if (c === ")") depth++;
      else if (c === "(") { if (depth === 0) break; depth--; }
      else if (depth === 0 && (c === ";" || c === "|" || (c === "&" && s[j - 1] === "&"))) break;
    }
    const seg = s.slice(j + 1, i).trim().replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, "");
    const word = seg.split(/\s+/)[0] ?? "";
    lefts.push(word);
  }
  return lefts;
}

function scanSwallow(): Hit[] {
  const out: Hit[] = [];
  for (const b of blocks) for (const text of b.lines) {
    if (SWALLOW_RE.test(text) && !allowed(SWALLOW_OK, b.file, key(b, text))) out.push({ ...b, text });
  }
  return out;
}

function scanEarlyExit(): Hit[] {
  const out: Hit[] = [];
  for (const b of blocks) b.lines.forEach((text, i) => {
    if (i === b.lines.length - 1) return;
    if (/\bexit\s+0\b/.test(text) && !allowed(EARLY_EXIT_OK, b.file, key(b, text))) out.push({ ...b, text });
  });
  return out;
}

function scanCoe(): { unread: Hit[]; conclusion: Hit[] } {
  const unread: Hit[] = [];
  const conclusion: Hit[] = [];
  for (const { file, jobId, job } of jobsByFile) {
    if (job["continue-on-error"] && !allowed(COE_OK, file, `job:${jobId}`)) {
      unread.push({ file, job: jobId, step: "(job)", text: `job-level continue-on-error: ${String(job["continue-on-error"])}` });
    }
    const steps = job.steps ?? [];
    steps.forEach((s, i) => {
      if (!s["continue-on-error"]) return;
      const name = String(s.name ?? s.id ?? `#${i}`);
      const later = JSON.stringify(steps.slice(i + 1));
      const jobText = JSON.stringify(job);
      if (s.id && new RegExp(`steps\\.${s.id}\\.conclusion`).test(jobText)) {
        conclusion.push({ file, job: jobId, step: name, text: `steps.${s.id}.conclusion is 'success' even when a continue-on-error step FAILED — read .outcome` });
      }
      const read = s.id && new RegExp(`steps\\.${s.id}\\.outcome`).test(later);
      if (!read && !allowed(COE_OK, file, name)) unread.push({ file, job: jobId, step: name, text: "continue-on-error: true and no later step reads its outcome" });
    });
  }
  return { unread, conclusion };
}

function scanNotify(): { reporters: number; hits: Hit[] } {
  const hits: Hit[] = [];
  let reporters = 0;
  for (const { file, jobId, job } of jobsByFile) {
    for (const s of job.steps ?? []) {
      if (!String(s.uses ?? "").includes("nightly-issue-sync")) continue;
      const status = String(s.with?.status ?? "");
      if (!status.includes("needs.")) continue;
      reporters++;
      const needs = typeof job.needs === "string" ? [job.needs] : (job.needs ?? []);
      for (const n of needs) {
        if (status.includes(`needs.${n}.result == 'success'`)) continue;
        if (allowed(NOTIFY_NEED_OK, file, `${jobId}:${n}`)) continue;
        hits.push({ file, job: jobId, step: String(s.name ?? s.uses), text: `needs '${n}' but status ignores needs.${n}.result: ${status}` });
      }
    }
  }
  return { reporters, hits };
}

function scanPipe(): { considered: number; hits: Hit[] } {
  const hits: Hit[] = [];
  let considered = 0;
  for (const b of blocks) {
    const pipefail = b.composite
      ? /\bbash\b/.test(b.shell ?? "") || /set\s+-[a-z]*o\s+pipefail|set\s+-o\s+pipefail/.test(b.lines.join("\n"))
      : (b.shell !== undefined && /^bash$/.test(b.shell.trim())) || /set\s+-[a-z]*o\s+pipefail|set\s+-o\s+pipefail/.test(b.lines.join("\n"));
    if (pipefail) continue;
    for (const text of b.lines) {
      const lefts = pipeLefts(text);
      if (!lefts.length) continue;
      considered++;
      if (lefts.some((w) => CHECKERS.has(w) || w.startsWith("./") || w.startsWith("scripts/")) && !allowed(PIPE_OK, b.file, key(b, text))) {
        hits.push({ ...b, text });
      }
    }
  }
  return { considered, hits };
}

function scanSetPlusE(): Hit[] {
  const out: Hit[] = [];
  for (const b of blocks) {
    if (b.lines.some((l) => /\bset\s+\+e\b/.test(l)) && !allowed(SET_PLUS_E_OK, b.file, b.step)) {
      out.push({ ...b, text: "set +e" });
    }
  }
  return out;
}

function scanShell(): Hit[] {
  const out: Hit[] = [];
  for (const b of blocks) {
    const sh = b.shell?.trim();
    if (!sh || /^(bash|sh|pwsh|powershell|python|cmd)$/.test(sh)) continue;
    // A custom template: it must keep errexit.
    if (/\b(bash|sh)\b/.test(sh) && !/\s-[a-z]*e/.test(sh)) out.push({ ...b, text: `shell: ${sh} (no -e)` });
  }
  return out;
}

// ── the tests ──────────────────────────────────────────────────────────────

describe("workflows cannot go green when the thing they check is broken (Q52)", () => {
  it("read the real workflows (floor — cannot pass on an empty scan)", () => {
    expect(files.length).toBeGreaterThan(40);
    expect(blocks.length).toBeGreaterThan(200);
    expect(blocks.reduce((n, b) => n + b.lines.length, 0)).toBeGreaterThan(1500);
  });

  it("SWALLOW: no `|| true` / `|| :` / `|| echo` / `|| exit 0` hides a failure", () => {
    const hits = scanSwallow();
    expect(hits.map(fmt).join("\n"), "A swallowed exit code turns a broken read into a pass. Fix it (e.g. `|| [ $? -eq 1 ]` for grep's no-match), or list it in SWALLOW_OK with why it is truthful.").toBe("");
  });

  it("EARLY_EXIT: every `exit 0` before the end of a block is a known-truthful path", () => {
    const hits = scanEarlyExit();
    expect(hits.map(fmt).join("\n"), "An early `exit 0` is a green verdict. 'Secret missing' or 'could not read' is not green — exit non-zero, or list it in EARLY_EXIT_OK with why.").toBe("");
  });

  it("COE: continue-on-error is read back through .outcome (never .conclusion)", () => {
    const { unread, conclusion } = scanCoe();
    expect(conclusion.map(fmt).join("\n")).toBe("");
    expect(unread.map(fmt).join("\n"), "continue-on-error with nothing reading steps.<id>.outcome makes a failed step invisible.").toBe("");
  });

  it("NOTIFY: a nightly-issue-sync status names every leg in `needs`", () => {
    const { reporters, hits } = scanNotify();
    expect(reporters).toBeGreaterThan(15);
    expect(hits.map(fmt).join("\n"), "A leg missing from `status` can fail while the issue is closed green.").toBe("");
  });

  it("PIPE: a check piped into a filter runs under pipefail", () => {
    const { considered, hits } = scanPipe();
    expect(considered).toBeGreaterThan(10);
    expect(hits.map(fmt).join("\n"), "Without pipefail the pipe's status is the filter's (tee/grep/head), so the check's failure is lost. Add `set -euo pipefail`.").toBe("");
  });

  it("SET_PLUS_E: every block that turns errexit off is known to re-read its codes", () => {
    expect(scanSetPlusE().map(fmt).join("\n")).toBe("");
  });

  it("SHELL: no custom shell drops -e", () => {
    expect(scanShell().map(fmt).join("\n")).toBe("");
  });

  it("the allowlists do not rot (every entry still matches, every reason is a sentence)", () => {
    // Run every scan so `used` is complete regardless of test order.
    scanSwallow(); scanEarlyExit(); scanCoe(); scanNotify(); scanPipe(); scanSetPlusE();
    const all: [string, Allow[]][] = [["SWALLOW_OK", SWALLOW_OK], ["EARLY_EXIT_OK", EARLY_EXIT_OK], ["COE_OK", COE_OK], ["NOTIFY_NEED_OK", NOTIFY_NEED_OK], ["PIPE_OK", PIPE_OK], ["SET_PLUS_E_OK", SET_PLUS_E_OK]];
    const stale: string[] = [];
    for (const [name, list] of all) for (const a of list) {
      if (!used.has(a)) stale.push(`${name}: ${a.file} :: ${a.match}`);
      expect(a.reason.length, `${name} ${a.file} :: ${a.match} needs a real reason`).toBeGreaterThan(40);
    }
    expect(stale, "listed but no longer matches anything — delete the entry").toEqual([]);
  });

  it("the scanner itself: continuation joining and pipe parsing", () => {
    expect(logicalLines("# c\nnode a \\\n  --b || true\necho x")).toEqual(["node a --b || true", "echo x"]);
    expect(pipeLefts('X=$(node s.mjs | jq -r .a)')).toEqual(["node"]);
    expect(pipeLefts('npm test 2>&1 | tee log.txt')).toEqual(["npm"]);
    expect(pipeLefts('a || b')).toEqual([]);
    expect(pipeLefts('echo "a | b" | grep a')).toEqual(["echo"]);
    expect(SWALLOW_RE.test("grep -c x f || true")).toBe(true);
    expect(SWALLOW_RE.test("M=$(grep x f) || [ $? -eq 1 ]")).toBe(false);
  });
});

/*
 * CADENCE CLAIMS. vacuity.yml's full sweep became WEEKLY on 2026-09-22 (owner,
 * on Actions-minutes cost) while its own comments, scripts/vacuity/*, the
 * GUARD-BURNDOWN doc and an e2e spec kept saying "nightly" — so a reader
 * trusted a drift check that ran a seventh as often as claimed. A workflow
 * whose every cron names a single weekday is not "nightly" anywhere: not in
 * its own file, not in scripts/<name>/, and not on any line of the current docs
 * or code that names it. (History files — docs/OPEN.md, docs/archive, docs/audit,
 * docs/lessons — record what was said and are not claims.)
 */
describe("a weekly workflow is never described as nightly (Q52)", () => {
  const NOT_A_CLAIM = /nightly[- ](red|issue)|nightly result|nightly DB backup|local nightly|nightly that reported green/i;
  const weekly = docs.flatMap(({ file, doc }) => {
    if (!file.startsWith(".github/workflows/")) return [];
    const sched = ((doc.on ?? doc.true) as Record<string, unknown> | undefined)?.schedule as { cron: string }[] | undefined;
    if (!sched?.length) return [];
    const oneDay = sched.every((s) => { const f = s.cron.trim().split(/\s+/); return f[2] === "*" && /^\d$/.test(f[4]); });
    return oneDay ? [file] : [];
  });

  function walk(dir: string, out: string[] = []): string[] {
    if (!existsSync(join(ROOT, dir))) return out;
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== "fixtures") walk(rel, out); }
      else if (/\.(md|mjs|cjs|js|ts|tsx|yml)$/.test(e.name)) out.push(rel);
    }
    return out;
  }
  const claimFiles = [
    "CLAUDE.md", ".claude/AGENT-BRIEF.md",
    ...readdirSync(join(ROOT, "docs")).filter((f) => f.endsWith(".md") && f !== "OPEN.md").map((f) => `docs/${f}`),
    ...walk("scripts"), ...walk("e2e"), ...walk("src/test"), ...walk(".github/workflows"),
  ].filter((f) => existsSync(join(ROOT, f)) && f !== "src/test/workflowFalseGreenShapes.test.ts");

  it("found the weekly workflows and the files that can describe them (floor)", () => {
    expect(weekly.length).toBeGreaterThan(5);
    expect(weekly).toContain(".github/workflows/vacuity.yml");
    expect(claimFiles.length).toBeGreaterThan(300);
  });

  it("no weekly workflow is called nightly", () => {
    const hits: string[] = [];
    for (const wf of weekly) {
      const name = wf.replace(/^.*\//, "").replace(/\.ya?ml$/, "");
      const nameRe = new RegExp(`\\b${name.replace(/[-]/g, "[-]")}\\b`, "i");
      for (const f of claimFiles) {
        const own = f === wf || f.startsWith(`scripts/${name}/`);
        const lines = readFileSync(join(ROOT, f), "utf8").split("\n");
        lines.forEach((l, i) => {
          if (!/\bnightly\b/i.test(l) || NOT_A_CLAIM.test(l)) return;
          if (own || nameRe.test(l)) hits.push(`${f}:${i + 1} (${name} is weekly): ${l.trim().slice(0, 160)}`);
        });
      }
    }
    expect(hits.join("\n"), "This workflow's cron runs on one weekday. Say 'weekly' (or change the cron, subject to prodWorkflowSpacing).").toBe("");
  });
});

// @mutate scripts/vacuity/run.mjs | the full sweep is weekly and has the wall clock | the full sweep is nightly and has the wall clock
// @mutate .github/workflows/write-contract-refresh.yml | # Weekly (Saturdays, see the cron): re-pull | # Nightly: re-pull

// Each registration re-plants a shape on a REAL workflow; the first two are the
// exact bugs this guard was built on (Q52, 2026-09-23).
// @mutate .github/workflows/nightly-red-age.yml | >> /tmp/raw.json\n            # No `\|\| echo '[]'` | >> /tmp/raw.json \|\| echo '[]' >> /tmp/raw.json\n            # No `\|\| echo '[]'`
// @mutate .github/workflows/migration-lint.yml | HEAD -- 'supabase/migrations/*.sql')\n          fi | HEAD -- 'supabase/migrations/*.sql' \|\| true)\n          fi
// @mutate .github/workflows/security-audit.yml | npm audit --omit=dev --audit-level=moderate | npm audit --omit=dev --audit-level=moderate \|\| true
// @mutate .github/workflows/prod-audit.yml | see the log above. Not checked is not clean."; exit 2 ;; | see the log above. Not checked is not clean."; exit 0 ;;
// @mutate .github/workflows/press-every-control.yml | (needs.press.result == 'success' && needs.cleanup.result == 'success') | needs.press.result == 'success'
// @mutate .github/workflows/db-drift-detect.yml | TYPES_FRESH: ${{ steps.types_fresh.outcome }} | TYPES_FRESH: ${{ steps.types_fresh.conclusion }}
// @mutate .github/workflows/prod-errors.yml | set -euo pipefail\n          node scripts/ops-alert-ledger.mjs sync | node scripts/ops-alert-ledger.mjs sync
