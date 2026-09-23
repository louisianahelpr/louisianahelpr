#!/usr/bin/env node
/**
 * THE SCOREBOARD (docs/OPEN.md Q59) and the "Everything open" block at the top
 * of docs/OPEN.md (Q58b) — one generator, so the two can never disagree.
 *
 * Owner, 2026-09-23: "all tracked in 1 place so new sessions can easily pick up
 * and leave" and "always keep a current ledger to show numbers ... like it
 * should show numbers of we test this this is what's passing / failing".
 *
 * Every row is one signal: status, pass / fail / skipped / total, WHEN it was
 * measured, and the run or source it came from. The rules:
 *   - a row that cannot be measured renders UNKNOWN with the reason. Never
 *     green. A fetch that throws, a log with no summary line, a workflow with
 *     no completed run, a query with no credentials: all UNKNOWN;
 *   - a CI result older than MAX_RUN_AGE_DAYS renders STALE, never green;
 *   - every row carries its own measured-at stamp.
 *
 * TWO KINDS OF ROW, two sections in each output:
 *   LOCAL  computed from files in the repo (the OPEN.md queue, the audit bus,
 *          the guard burn-down, baselines). Deterministic at a given commit;
 *          check-generated-current.mjs regenerates and diffs them on EVERY
 *          push, so they are never stale.
 *   LIVE   measured from outside the repo (GitHub Actions runs and issues,
 *          read-only SQL against prod, git remote refs, the local gate
 *          record). They change without a commit, so they are refreshed by
 *          `--write` (a person, or .github/workflows/scoreboard.yml daily at
 *          19:17 UTC) and the committed copy is carried forward VERBATIM by the
 *          offline run — the push check proves its SHAPE (every row has a
 *          status, a stamp, a reason when UNKNOWN), and check-staleness.mjs
 *          fails nightly when the live section is older than 72h.
 *   The scheduled workflow lands the fresh live rows itself through a
 *   refresh PR that merges on green (Q57, .github/actions/refresh-pr), built
 *   on latest main with `--live-from`; a session can still run `--write`.
 *
 * Usage:
 *   node scripts/scoreboard.mjs              # offline: LOCAL rows recomputed, LIVE carried forward (what CI diffs)
 *   node scripts/scoreboard.mjs --write      # measure everything, write docs/SCOREBOARD.md + the OPEN.md block
 *   node scripts/scoreboard.mjs --open-block # print the Everything-open block, live where fast (session start; never fails)
 *   node scripts/scoreboard.mjs --check      # shape check of the committed files only
 *   node scripts/scoreboard.mjs --live-from <dir>  # offline, LIVE sections taken from <dir>'s copies (Q57 refresh PR)
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { queueCounts } from "./queue-count.mjs";
import { countFindings, foldFindings, parseFindingsLog } from "./lib/auditFindings.mjs";
import { INVENTORY as EXPIRY_INVENTORY, inventoryCounts, runAll as runExpiry, scoreboardRows as expiryScoreboardRows } from "./lib/expiryMonitor.mjs";
import { measureSlos, realIo, sloRecord, sloTargetRows } from "./slo.mjs";

export const REPO = resolve(import.meta.dirname, "..");
export const SCOREBOARD = "docs/SCOREBOARD.md";
export const OPEN = "docs/OPEN.md";
export const FINDINGS = "docs/audit/launch-2026-09/findings.jsonl";

export const SB_START = "<!-- generated: scoreboard (node scripts/scoreboard.mjs --write) — do not hand-edit -->";
export const SB_END = "<!-- /generated: scoreboard -->";
export const EO_START = "<!-- generated: everything-open (node scripts/scoreboard.mjs --write) -->";
export const EO_END = "<!-- /generated: everything-open -->";
/** Inside each generated region, the LIVE part sits between these. */
export const LIVE_START = "<!-- live: carried forward verbatim offline; refreshed by node scripts/scoreboard.mjs --write -->";
export const LIVE_END = "<!-- /live -->";

export const STATUSES = ["PASS", "FAIL", "WARN", "STALE", "UNKNOWN", "INFO"];
export const MAX_RUN_AGE_DAYS = 8;
export const MAX_LIVE_HOURS = 72;

const HEADER = "| group | signal | status | pass | fail | skipped | total | measured at | source | note |";
const RULE = "|---|---|---|---|---|---|---|---|---|---|";

// ── rendering ───────────────────────────────────────────────────────────────

const cell = (v) => (v === null || v === undefined || v === "" ? "—" : String(v).replace(/\|/g, "\\|").replace(/\n/g, " "));

/** @param {{group:string, signal:string, status:string, pass?:any, fail?:any, skipped?:any, total?:any, at:string, source?:string, note?:string}} r */
export function renderRow(r) {
  if (!STATUSES.includes(r.status)) throw new Error(`row ${r.signal}: bad status ${r.status}`);
  return `| ${cell(r.group)} | ${cell(r.signal)} | **${r.status}** | ${cell(r.pass)} | ${cell(r.fail)} | ${cell(r.skipped)} | ${cell(r.total)} | ${cell(r.at)} | ${cell(r.source)} | ${cell(r.note)} |`;
}

/** An UNKNOWN row. `why` is mandatory: an UNKNOWN without a reason fails the shape check. */
export const unknown = (group, signal, why, extra = {}) => ({ group, signal, at: "not measured", ...extra, status: "UNKNOWN", note: `UNKNOWN: ${why}` });

function table(rows) {
  return [HEADER, RULE, ...rows.map(renderRow)].join("\n");
}

// ── LOCAL rows (deterministic at a commit) ──────────────────────────────────

const AT_HEAD = "HEAD (diffed every push)";

export function localRows(read = (p) => readFileSync(join(REPO, p), "utf8")) {
  const rows = [];

  const q = queueCounts(read(OPEN));
  rows.push({ group: "open work", signal: "OPEN.md queue (done / partly / open)", status: q.open + q.partial ? "WARN" : "PASS",
    pass: q.done, fail: q.open, skipped: `${q.partial} partly`, total: q.total, at: AT_HEAD, source: "[docs/OPEN.md](OPEN.md) · scripts/queue-count.mjs",
    note: `${q.done} done, ${q.partial} partly done (fixed, protection pending), ${q.open} open` });

  try {
    const c = countFindings(foldFindings(parseFindingsLog(read(FINDINGS))));
    rows.push({ group: "open work", signal: "audit bus findings (open / launch blockers)", status: c.openBlockers ? "FAIL" : c.open ? "WARN" : "PASS",
      pass: c.fixed, fail: c.open, skipped: null, total: c.filed, at: AT_HEAD, source: "[ROLLUP.md](audit/launch-2026-09/ROLLUP.md) · `node scripts/audit-bus.mjs list --blockers`",
      note: `${c.open} open, ${c.openBlockers} open launch blockers; ${c.fixed} fixed, ${c.retracted} retracted, ${c.duplicate} duplicate, ${c.wontfix} wontfix, ${c.obsolete} obsolete` });
  } catch (e) {
    rows.push(unknown("open work", "audit bus findings (open / launch blockers)", `could not fold ${FINDINGS}: ${e.message}`, { at: AT_HEAD }));
  }

  // Guard burn-down: parsed from the GENERATED block of GUARD-BURNDOWN.md
  // (burndown-score.mjs writes it; check-generated-current diffs it per push).
  try {
    const m = /\| \*\*total\*\* \| \*\*(\d+)\*\* \| \*\*(\d+)[^|]*\| \*\*(\d+)\*\* \| \*\*(\d+)\*\* \|/.exec(read("docs/GUARD-BURNDOWN.md"));
    if (!m) throw new Error("no total row in the generated burn-down block");
    const [, files, proven, exempt, owed] = m.map(Number);
    rows.push({ group: "guards", signal: "vacuity: guards proven able to fail / exempt / owed", status: owed ? "FAIL" : "PASS",
      pass: proven, fail: owed, skipped: `${exempt} exempt`, total: files, at: AT_HEAD, source: "[GUARD-BURNDOWN.md](GUARD-BURNDOWN.md) · `npm run vacuity`",
      note: "registered @mutate per guard; whether each mutation is KILLED is the full-sweep row below" });
  } catch (e) {
    rows.push(unknown("guards", "vacuity: guards proven able to fail / exempt / owed", e.message, { at: AT_HEAD }));
  }

  try {
    const d = JSON.parse(read("scripts/deadcode-baseline.json"));
    rows.push({ group: "number currency", signal: "dead-code baseline (unused exports / types ceiling)", status: "INFO",
      pass: null, fail: null, skipped: null, total: `${d.exports} exports, ${d.types} types`, at: AT_HEAD,
      source: "scripts/deadcode-baseline.json · src/test/deadcodeRatchet.test.ts", note: "a ratchet ceiling; whether knip stays under it is the test.yml Dead code step (live section)" });
  } catch (e) {
    rows.push(unknown("number currency", "dead-code baseline (unused exports / types ceiling)", e.message, { at: AT_HEAD }));
  }

  try {
    const b = JSON.parse(read("scripts/stated-counts-baseline.json"));
    const n = (b.undated ?? []).length;
    rows.push({ group: "number currency", signal: "undated stated counts (baselined, may only shrink)", status: n ? "WARN" : "PASS",
      pass: null, fail: n, skipped: null, total: n, at: AT_HEAD, source: "scripts/stated-counts-baseline.json · `npm run check:counts`",
      note: "each is a number in prose with no date; new ones already fail check:counts" });
  } catch (e) {
    rows.push(unknown("number currency", "undated stated counts (baselined, may only shrink)", e.message, { at: AT_HEAD }));
  }

  // Q62 expiry monitor: what is inventoried and how each is read. The dates
  // themselves change without a commit, so they are LIVE rows (expiryRows).
  try {
    const c = inventoryCounts(JSON.parse(read(EXPIRY_INVENTORY)));
    rows.push({ group: "expiry", signal: "expiry inventory (items with no date source yet)", status: c.manualNoDate ? "WARN" : "PASS",
      pass: c.measured + c.manualDated, fail: c.manualNoDate, skipped: `${c.noExpiry} no-expiry`, total: c.items, at: AT_HEAD,
      source: `${EXPIRY_INVENTORY} · src/test/expiryMonitor.test.ts`,
      note: `${c.measured} read by handshake/RDAP/JWT/API (${c.ciReadable} in CI), ${c.manualDated} owner-recorded dates, ${c.manualNoDate} manual with no date recorded, ${c.noExpiry} vendor no-expiry; ${c.undated} referenced names classified undated` });
  } catch (e) {
    rows.push(unknown("expiry", "expiry inventory (items with no date source yet)", `could not read ${EXPIRY_INVENTORY}: ${e.message}`, { at: AT_HEAD }));
  }
  // Q66: what "working" means, as targets. The verdicts are live rows.
  rows.push(...sloTargetRows(AT_HEAD));

  rows.push({ group: "notes", signal: "Zod v4 `script-src eval` CSP report per page", status: "INFO", at: "2026-09-23 (Q13 note)",
    source: "node_modules/zod/v4/core/schemas.js (`jit && allowsEval.value`)",
    note: "harmless: Zod's allowsEval probe tries `new Function` once per page and the CSP blocks it, so each page logs one violation. `z.config({ jitless: true })` short-circuits the probe (measured in zod 4.5.4 source) — queued as Q83" });

  return rows;
}

// ── LIVE rows ───────────────────────────────────────────────────────────────

function sh(cmd, args, { timeout = 30000, cwd = REPO } = {}) {
  return execFileSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 1 << 28, timeout, stdio: ["ignore", "pipe", "pipe"] });
}
const ghJson = (args, timeout) => JSON.parse(sh("gh", args, { timeout }) || "null");
const errMsg = (e) => String(e?.stderr || e?.message || e).split("\n").find((l) => l.trim())?.slice(0, 160) ?? "error";
const iso = (d) => (d ? new Date(d).toISOString().replace(/:\d\d\.\d{3}Z$/, "Z") : "—");
const ageDays = (d, now) => (now - new Date(d)) / 864e5;

const FAILED = new Set(["failure", "timed_out", "startup_failure", "action_required"]);
const CONCLUSIVE = new Set(["success", ...FAILED]);

/** Newest completed runs of one workflow on main, newest first. */
function mainRuns(workflowId, event = "") {
  const j = ghJson(["api", `repos/{owner}/{repo}/actions/workflows/${workflowId}/runs?branch=main&status=completed&per_page=40${event ? `&event=${event}` : ""}`], 30000);
  return (j.workflow_runs ?? []).map((r) => ({ id: r.id, conclusion: r.conclusion, event: r.event, createdAt: r.created_at, updatedAt: r.updated_at, url: r.html_url }));
}

/**
 * Last conclusive result and how long it has been red. Pure, for the test.
 * @returns {{last:any, redSince:string|null, redSinceFloor:boolean, cancelledAfter:number}}
 */
export function streak(runs) {
  let cancelledAfter = 0;
  let last = null;
  let i = 0;
  for (; i < runs.length; i++) {
    if (CONCLUSIVE.has(runs[i].conclusion)) { last = runs[i]; break; }
    cancelledAfter++;
  }
  if (!last || last.conclusion === "success") return { last, redSince: null, redSinceFloor: false, cancelledAfter };
  let redSince = last.createdAt;
  let floor = true;
  for (let k = i + 1; k < runs.length; k++) {
    if (runs[k].conclusion === "success") { floor = false; break; }
    if (FAILED.has(runs[k].conclusion)) redSince = runs[k].createdAt;
  }
  return { last, redSince, redSinceFloor: floor, cancelledAfter };
}

/** Status for a CI result: never green without a recent conclusive success. */
export function ciStatus(last, now = new Date()) {
  if (!last) return "UNKNOWN";
  if (ageDays(last.updatedAt ?? last.createdAt, now) > MAX_RUN_AGE_DAYS) return "STALE";
  return last.conclusion === "success" ? "PASS" : "FAIL";
}

// ── log parsers (pure; each returns null when the summary is absent) ───────

const stripAnsi = (s) => s.replace(/(?:\x1b|\^\[)\[[0-9;]*[A-Za-z]/g, ""); // gh prints ESC as a literal "^["
/** `gh run view --log` prefixes every line with "job\tstep\t<timestamp> ". */
export const logContent = (log) => stripAnsi(log).split("\n").map((l) => l.replace(/^[^\t]*\t[^\t]*\t\S+ ?/, ""));

export function parsePlaywright(log) {
  const t = { passed: 0, failed: 0, flaky: 0, skipped: 0, "did not run": 0, interrupted: 0 };
  let seen = false;
  for (const l of logContent(log)) {
    const m = /^ {2}(\d+) (passed|failed|flaky|skipped|did not run|interrupted)(?: \(|$)/.exec(l);
    if (m) { t[m[2]] += Number(m[1]); seen = true; }
  }
  if (!seen) return null;
  const skipped = t.skipped + t["did not run"] + t.interrupted;
  return { pass: t.passed + t.flaky, fail: t.failed, skipped, total: t.passed + t.flaky + t.failed + skipped, note: t.flaky ? `${t.flaky} flaky` : "" };
}

export function parseVitest(log) {
  let files = null, tests = null;
  const count = (s) => {
    const o = { passed: 0, failed: 0, skipped: 0 };
    for (const m of s.matchAll(/(\d+) (passed|failed|skipped|todo)/g)) o[m[2] === "todo" ? "skipped" : m[2]] += Number(m[1]);
    return o;
  };
  for (const l of logContent(log)) {
    let m = /^\s*Test Files\s+(.*)\((\d+)\)\s*$/.exec(l);
    if (m) files = { ...count(m[1]), total: Number(m[2]) };
    m = /^\s*Tests\s+(.*)\((\d+)\)\s*$/.exec(l);
    if (m) tests = { ...count(m[1]), total: Number(m[2]) };
  }
  if (!tests) return null;
  return { pass: tests.passed, fail: tests.failed, skipped: tests.skipped, total: tests.total,
    note: files ? `files: ${files.passed} passed, ${files.failed} failed of ${files.total}` : "" };
}

export function parsePress(log) {
  let last = null, deaths = 0;
  for (const l of logContent(log)) {
    const m = /found=(\d+) pressed=(\d+) failed=(\d+) undocumented-skips=(\d+) coverage=([\d.]+)%/.exec(l);
    if (m) last = m;
    const d = /SESSION DEATH: GoTrue refused a session (\d+) time/.exec(l);
    if (d) deaths = Number(d[1]);
  }
  if (!last) return null;
  const [, found, pressed, failed, undoc, cov] = last;
  return { pass: Number(pressed) - Number(failed), fail: Number(failed), skipped: Number(found) - Number(pressed), total: Number(found),
    note: `found ${found}, pressed ${pressed} (skipped = not pressed), ${undoc} unpressed WITHOUT a documented reason, coverage ${cov}%, session deaths ${deaths}` };
}

export function parseVacuity(log) {
  let m = null;
  const v = { killed: 0, SURVIVED: 0, other: 0 };
  for (const l of logContent(log)) {
    const x = /mutation: (\d+)\/(\d+) killed, (\d+) known-vacuous, (\d+) not run/.exec(l);
    if (x) m = x;
    const y = /^\s+(killed|SURVIVED|\w+)\s+\S+ ⟵ \S/.exec(l);
    if (y) v[y[1] in v ? y[1] : "other"]++;
  }
  if (!m && v.killed + v.SURVIVED + v.other) {
    // index.mjs prints no "mutation: N/M killed" line when a guard SURVIVES
    // (it errors instead; seen in run 35601005794) or when the sweep is cut
    // off. Its per-guard verdict lines are still real measurements.
    return { pass: v.killed, fail: v.SURVIVED, skipped: v.other, total: v.killed + v.SURVIVED + v.other,
      note: `counted from per-guard verdict lines (no summary line: a guard survived, or the sweep was cut off — then a floor); skipped = inconclusive/not run` };
  }
  if (!m) return null;
  const [, killed, total, known, notRun] = m.map(Number);
  const survived = total - killed - notRun;
  return { pass: killed, fail: survived, skipped: notRun, total, note: `killed ${killed}, not killed ${survived} (${known} known-vacuous), not run ${notRun}` };
}

export function parseLoadingStates(log) {
  let surf = null, br = null;
  for (const l of logContent(log)) {
    const a = /^(\d+) surfaces · (\d+) measured/.exec(l.trim());
    if (a) surf = a;
    const b = /^breaches:\s+(\d+) \((\d+) baselined debt, (\d+) by design\)/.exec(l.trim());
    if (b) br = b;
  }
  if (!surf) return null;
  const total = Number(surf[1]), measured = Number(surf[2]);
  // fail stays blank: "breaches" counts breaches, not surfaces, and the checker
  // prints no count of the ones that failed it — the note carries its own line.
  return { pass: measured, fail: null, skipped: total - measured, total,
    note: br ? `pass = surfaces measured, skipped = not measured; checker: ${br[1]} breaches (${br[2]} baselined debt, ${br[3]} by design)` : "breach line not in log (shape check did not run?)" };
}

/** Test/spec suites whose counts come from their newest conclusive main run's log. */
export const SUITES = [
  { workflow: "vitest.yml", signal: "Vitest (tests; files in note)", parse: parseVitest, group: "tests" },
  { workflow: "prod-audit.yml", signal: "prod-audit specs", parse: parsePlaywright, group: "suites on prod" },
  { workflow: "e2e-journeys.yml", signal: "e2e-journeys specs", parse: parsePlaywright, group: "suites on prod" },
  // Its push run is the unauthenticated tier with no spec summary; the specs run on schedule/dispatch.
  { workflow: "e2e-real-backend.yml", signal: "e2e-real-backend specs", parse: parsePlaywright, group: "suites on prod", events: ["schedule", "workflow_dispatch"] },
  { workflow: "nightly-webkit.yml", signal: "nightly-webkit specs", parse: parsePlaywright, group: "suites on prod" },
  { workflow: "ui-sweep.yml", signal: "ui-sweep specs", parse: parsePlaywright, group: "suites on prod" },
  { workflow: "loading-states-refresh.yml", signal: "loading-states-refresh surfaces", parse: parseLoadingStates, group: "suites on prod" },
  { workflow: "press-every-control.yml", signal: "press-every-control (controls)", parse: parsePress, group: "suites on prod" },
  { workflow: "vacuity.yml", signal: "vacuity full sweep (mutations killed)", parse: parseVacuity, group: "guards", events: ["schedule"] },
];

function suiteRow(s, runs, now) {
  const pool = (s.events ? runs.filter((r) => s.events.includes(r.event)) : runs).filter((r) => CONCLUSIVE.has(r.conclusion));
  if (!pool.length) return unknown(s.group, s.signal, `no conclusive ${s.events ? s.events.join("/") + " " : ""}run of ${s.workflow} on main in the last 40`, { source: s.workflow });
  // The newest conclusive run decides the status. Its counts come from the
  // newest of the last few runs whose log carries a summary (a push-mode run
  // of some suites runs nothing); the note names every newer run that had none.
  const newest = pool[0];
  let parsed = null, from = null;
  const skippedRuns = [];
  for (const r of pool.slice(0, 4)) {
    try {
      parsed = s.parse(sh("gh", ["run", "view", String(r.id), "--log"], { timeout: 90000 }));
    } catch (e) {
      skippedRuns.push(`run ${r.id}: log unreadable (${errMsg(e)})`);
      continue;
    }
    if (parsed) { from = r; break; }
    skippedRuns.push(`run ${r.id} (${r.event}, ${r.conclusion}) has no summary line`);
  }
  let status = ciStatus(newest, now);
  // A successful run whose counts we could not read is not a verified pass.
  if (!parsed && status === "PASS") status = "UNKNOWN";
  if (parsed && status === "PASS" && (parsed.fail || from.conclusion !== "success")) status = "FAIL";
  const note = [
    parsed ? `counts from run ${from.id} (${from.event}, ${from.conclusion})` : "UNKNOWN: no summary line in the last runs' logs",
    parsed?.note,
    skippedRuns.length && `newer without counts: ${skippedRuns.join(", ")}`,
  ].filter(Boolean).join("; ");
  return {
    group: s.group, signal: s.signal, status, ...(parsed ?? {}), at: iso(newest.updatedAt),
    source: `[${newest.conclusion}, ${newest.event}](${newest.url})`, note,
  };
}

function testYmlStepRows(runs, now) {
  const { last } = streak(runs);
  if (!last) return [unknown("tests", "test.yml steps", "no completed test.yml run on main", { source: "test.yml" })];
  let jobs;
  try { jobs = ghJson(["run", "view", String(last.id), "--json", "jobs"], 30000).jobs; } catch (e) {
    return [unknown("tests", "test.yml steps", `could not read jobs of run ${last.id}: ${errMsg(e)}`, { source: `[run ${last.id}](${last.url})` })];
  }
  const steps = jobs.flatMap((j) => j.steps ?? []).filter((s) => !/^(Set up job|Complete job|Post |Run actions\/)/.test(s.name));
  const by = (c) => steps.filter((s) => s.conclusion === c).length;
  const src = `[run ${last.id}](${last.url})`;
  const at = iso(last.updatedAt);
  const stale = ageDays(last.updatedAt, now) > MAX_RUN_AGE_DAYS;
  const stepRow = (signal, re) => {
    const s = steps.find((x) => re.test(x.name));
    if (!s) return unknown("tests", signal, `no step matching ${re} in run ${last.id}`, { source: src, at });
    const status = stale ? "STALE" : s.conclusion === "success" ? "PASS" : s.conclusion === "skipped" ? "UNKNOWN" : "FAIL";
    return { group: "tests", signal, status, at, source: src, note: s.conclusion === "skipped" ? "UNKNOWN: step skipped (an earlier step failed)" : `step ${s.conclusion}` };
  };
  const failedNames = steps.filter((s) => FAILED.has(s.conclusion)).map((s) => s.name);
  return [
    { group: "tests", signal: "test.yml steps (push to main)", status: stale ? "STALE" : failedNames.length ? "FAIL" : by("skipped") ? "WARN" : "PASS",
      pass: by("success"), fail: failedNames.length, skipped: by("skipped"), total: steps.length, at, source: src,
      note: failedNames.length ? `failed: ${failedNames.join(", ")}` : "" },
    stepRow("ESLint (test.yml)", /^ESLint$/),
    stepRow("TypeScript type check (test.yml)", /^TypeScript type check$/),
    stepRow("dead code / knip under baseline (test.yml)", /^Dead code \(knip\)$/),
  ];
}

function gateRow() {
  const p = join(homedir(), ".lh-gate", "last.json");
  if (!existsSync(p)) return unknown("tests", "`npm run gate` (last local run)", "no ~/.lh-gate/last.json on this machine — the gate runs locally only (scripts/gate.mjs writes it)", { source: "scripts/gate.mjs" });
  try {
    const g = JSON.parse(readFileSync(p, "utf8"));
    const by = (s) => g.steps.filter((x) => x.state === s).length;
    const status = by("FAILED") ? "FAIL" : by("SKIPPED") || g.fast ? "WARN" : "PASS";
    return { group: "tests", signal: "`npm run gate` (last local run)", status, pass: by("ok"), fail: by("FAILED"), skipped: by("SKIPPED"), total: g.steps.length,
      at: iso(g.measuredAt), source: `scripts/gate.mjs @ ${String(g.head).slice(0, 9)}`,
      note: [g.fast ? "--fast: vitest did not run, NOT a clean gate" : "", g.steps.filter((x) => x.state !== "ok").map((x) => `${x.state} ${x.label}`).join(", ")].filter(Boolean).join("; ") };
  } catch (e) {
    return unknown("tests", "`npm run gate` (last local run)", `unreadable ~/.lh-gate/last.json: ${e.message}`);
  }
}

export function workflowFiles(dir = join(REPO, ".github", "workflows")) {
  return readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort();
}

function workflowRows(now) {
  const files = workflowFiles();
  let api;
  try { api = ghJson(["api", "repos/{owner}/{repo}/actions/workflows?per_page=100"], 30000).workflows; } catch (e) {
    return { rows: [unknown("CI", "every workflow on main", `gh api workflows failed: ${errMsg(e)}`)], runsByFile: new Map(), idsByFile: new Map(), summary: null };
  }
  const rows = [];
  const runsByFile = new Map();
  const idsByFile = new Map();
  const counts = { PASS: 0, FAIL: 0, STALE: 0, UNKNOWN: 0 };
  for (const f of files) {
    const w = api.find((x) => x.path === `.github/workflows/${f}`);
    const signal = `workflow ${f}`;
    if (!w) { rows.push(unknown("CI", signal, "GitHub has no workflow for this file yet")); counts.UNKNOWN++; continue; }
    if (w.state !== "active") { rows.push({ group: "CI", signal, status: "FAIL", at: iso(now), source: `[${w.name}](${w.html_url})`, note: `workflow is ${w.state} — it runs nothing` }); counts.FAIL++; continue; }
    let runs;
    try { runs = mainRuns(w.id); } catch (e) { rows.push(unknown("CI", signal, `runs unreadable: ${errMsg(e)}`)); counts.UNKNOWN++; continue; }
    runsByFile.set(f, runs);
    idsByFile.set(f, w.id);
    const { last, redSince, redSinceFloor, cancelledAfter } = streak(runs);
    if (!last) { rows.push(unknown("CI", signal, runs.length ? `last ${runs.length} completed runs on main were all cancelled/skipped` : "never completed on main", { source: w.name })); counts.UNKNOWN++; continue; }
    const status = ciStatus(last, now);
    counts[status]++;
    const notes = [];
    if (redSince) notes.push(`red since ${redSinceFloor ? "before " : ""}${iso(redSince)} (${ageDays(redSince, now).toFixed(1)}d)`);
    if (status === "STALE") notes.push(`last conclusive run ${ageDays(last.updatedAt, now).toFixed(1)}d ago (limit ${MAX_RUN_AGE_DAYS}d)`);
    if (cancelledAfter) notes.push(`${cancelledAfter} cancelled/skipped run(s) since`);
    rows.push({ group: "CI", signal, status, at: iso(last.updatedAt), source: `[${last.conclusion}, ${last.event}](${last.url})`, note: notes.join("; ") });
  }
  return { rows, runsByFile, idsByFile, summary: { ...counts, total: files.length } };
}

async function ledgerRows(sqlFn) {
  try {
    const rows = await sqlFn("SELECT status, severity, count(*)::int AS n FROM public.ops_alert_ledger GROUP BY 1, 2");
    const at = iso(new Date());
    const by = (st) => rows.filter((r) => r.status === st);
    const sum = (rs) => rs.reduce((t, r) => t + Number(r.n), 0);
    const sev = (rs) => ["fatal", "critical", "error", "warning", "info"].map((s) => [s, sum(rs.filter((r) => r.severity === s))]).filter(([, n]) => n).map(([s, n]) => `${n} ${s}`).join(", ") || "none";
    const open = by("open"), ver = by("verifying"), closed = by("closed");
    return {
      summary: { open: sum(open), verifying: sum(ver), closed: sum(closed), openBySeverity: sev(open), at },
      rows: [{ group: "alerts", signal: "ops alert ledger (open / verifying / closed)", status: sum(open) + sum(ver) ? "FAIL" : "PASS",
        pass: sum(closed), fail: sum(open), skipped: `${sum(ver)} verifying`, total: sum(open) + sum(ver) + sum(closed), at,
        source: "public.ops_alert_ledger · `node scripts/ops-alert-ledger.mjs list`", note: `open by severity: ${sev(open)}; verifying: ${sev(ver)}` }],
    };
  } catch (e) {
    return { summary: null, rows: [unknown("alerts", "ops alert ledger (open / verifying / closed)", `read-only SQL failed: ${errMsg(e)}`)] };
  }
}

function nightlyRedRows(now, timeout = 20000) {
  try {
    const issues = ghJson(["issue", "list", "--label", "nightly-red", "--state", "open", "--limit", "100", "--json", "number,title,createdAt"], timeout);
    const oldest = issues.reduce((m, i) => (!m || i.createdAt < m ? i.createdAt : m), null);
    return {
      summary: { open: issues.length, at: iso(now), oldest },
      rows: [{ group: "alerts", signal: "open nightly-red issues", status: issues.length ? "FAIL" : "PASS", fail: issues.length, total: issues.length, at: iso(now),
        source: "`gh issue list -l nightly-red`", note: issues.map((i) => `#${i.number} ${i.title.replace(/^nightly-red:\s*/, "")} (${ageDays(i.createdAt, now).toFixed(1)}d)`).join("; ") }],
    };
  } catch (e) {
    return { summary: null, rows: [unknown("alerts", "open nightly-red issues", `gh issue list failed: ${errMsg(e)}`)] };
  }
}

async function dbHealthRows(sqlFn, now) {
  const rows = [];
  try {
    const [r] = await sqlFn(`SELECT (SELECT count(*) FROM pg_stat_activity)::int AS all_conns,
      (SELECT count(*) FROM pg_stat_activity WHERE backend_type = 'client backend')::int AS client_conns,
      current_setting('max_connections')::int AS max_conns,
      (SELECT count(*) FROM public.error_logs WHERE created_at > now() - interval '24 hours' AND message ILIKE '%statement timeout%')::int AS el_timeouts,
      (SELECT count(*) FROM public.error_logs WHERE created_at > now() - interval '24 hours')::int AS el_all,
      (SELECT round(max(mean_exec_time)::numeric, 1) FROM extensions.pg_stat_statements WHERE calls > 50) AS slowest_mean_ms`);
    const at = iso(now);
    // Client backends, not all rows of pg_stat_activity: background workers
    // (checkpointer, walwriter, pg_cron launcher, pg_net) do not count against
    // max_connections. Same threshold as db_saturation_thresholds() (Q53).
    const pct = Math.round((100 * r.client_conns) / r.max_conns);
    rows.push({ group: "DB health", signal: "connection use (client backends / max_connections)", status: pct >= 90 ? "FAIL" : pct >= 75 ? "WARN" : "PASS",
      fail: null, total: `${r.client_conns} / ${r.max_conns} (${pct}%)`, at, source: "pg_stat_activity (read-only)",
      note: `${r.all_conns} rows in pg_stat_activity incl. background workers; one instantaneous sample — the trend is the db-saturation-check samples below` });
    rows.push({ group: "DB health", signal: "statement timeouts reported to error_logs (24h)", status: Number(r.el_timeouts) ? "FAIL" : "PASS",
      fail: Number(r.el_timeouts), total: Number(r.el_all), at, source: "public.error_logs (read-only)",
      note: "client-reported only; a timeout nobody reported is invisible here — the Postgres-log row below is the server's count" });
    rows.push({ group: "DB health", signal: "slowest query, mean ms (pg_stat_statements, >50 calls)", status: "INFO", total: r.slowest_mean_ms ?? "—", at,
      source: "extensions.pg_stat_statements (read-only)", note: "cumulative since the last stats reset" });
  } catch (e) {
    rows.push(unknown("DB health", "connection use / error_logs timeouts / slowest query", `read-only SQL failed: ${errMsg(e)}`));
  }
  // The server's own count of statement timeouts lives in the Postgres logs
  // (Logflare), reachable only through the Management API with a token.
  const token = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_PROJECT_REF;
  if (!token || !ref) {
    rows.push(unknown("DB health", "statement timeouts in Postgres logs (24h)", "needs SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF (the scheduled workflow has them; a local run does not)"));
  } else {
    try {
      const start = new Date(now - 864e5).toISOString();
      const q = "select count(*) as n from postgres_logs where regexp_contains(event_message, 'canceling statement due to statement timeout')";
      const url = `https://api.supabase.com/v1/projects/${ref}/analytics/endpoints/logs.all?sql=${encodeURIComponent(q)}&iso_timestamp_start=${encodeURIComponent(start)}&iso_timestamp_end=${encodeURIComponent(new Date(now).toISOString())}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`Management API ${res.status}`);
      const body = await res.json();
      if (body.error) throw new Error(JSON.stringify(body.error).slice(0, 160));
      const n = Number(body.result?.[0]?.n);
      if (!Number.isFinite(n)) throw new Error("no count in the response");
      rows.push({ group: "DB health", signal: "statement timeouts in Postgres logs (24h)", status: n ? "FAIL" : "PASS", fail: n, at: iso(now), source: "Management API logs.all (postgres_logs)", note: "" });
    } catch (e) {
      rows.push(unknown("DB health", "statement timeouts in Postgres logs (24h)", `logs query failed: ${errMsg(e)}`));
    }
  }
  return rows;
}

/**
 * Q53's saturation monitor: the newest 5-minute sample (pg_cron) and the newest
 * hourly statement-timeout sample (prod-errors workflow), judged by the
 * database's own db_saturation_thresholds(). A sample older than its cadence
 * allows is STALE, never PASS — a dead monitor must not read as a quiet one.
 */
async function dbSaturationRows(sqlFn, now) {
  const rows = [];
  try {
    const got = await sqlFn(`SELECT origin, sampled_at, client_conns, max_conns, conn_pct, active_conns, longest_active_s,
        idle_in_xact, calls_per_s, exec_ms_per_s, p95_ms, window_app_calls, log_timeouts, log_window_minutes,
        db_problems, log_problem,
        (SELECT count(*) FROM public.db_saturation_samples s2
          WHERE s2.origin = s.origin AND s2.sampled_at > now() - interval '24 hours'
            AND (cardinality(s2.db_problems) > 0 OR s2.log_problem IS NOT NULL))::int AS bad_24h,
        (SELECT count(*) FROM public.db_saturation_samples s2
          WHERE s2.origin = s.origin AND s2.sampled_at > now() - interval '24 hours')::int AS n_24h
      FROM (SELECT DISTINCT ON (origin) * FROM public.db_saturation_samples
             WHERE origin IN ('cron', 'workflow') ORDER BY origin, sampled_at DESC) s`);
    const by = Object.fromEntries(got.map((r) => [r.origin, r]));
    const ageMin = (r) => (now - new Date(r.sampled_at)) / 60000;
    const c = by.cron;
    const cronSignal = "saturation: conns / active / long stmt / idle-in-xact / SQL ms/s / app p95 (5-min check)";
    if (!c) rows.push(unknown("DB health", cronSignal, "no db_saturation_samples from the cron yet (migration 20260923090536)"));
    else {
      const probs = Array.isArray(c.db_problems) ? c.db_problems : [];
      rows.push({ group: "DB health", signal: cronSignal,
        status: ageMin(c) > 20 ? "STALE" : probs.length ? "FAIL" : "PASS",
        pass: c.n_24h - c.bad_24h, fail: c.bad_24h, total: `${c.n_24h} samples/24h`, at: iso(new Date(c.sampled_at)),
        source: "public.db_saturation_samples (read-only) · check_db_saturation() · OPEN.md Q53",
        note: `latest: ${c.client_conns}/${c.max_conns} conns (${c.conn_pct}%), ${c.active_conns} active, longest ${c.longest_active_s}s, `
          + `idle-in-xact ${c.idle_in_xact}, ${c.calls_per_s ?? "—"} calls/s, ${c.exec_ms_per_s ?? "—"} SQL ms/s, app p95 ${c.p95_ms ?? "—"} ms`
          + (probs.length ? `; PROBLEM: ${probs.join("; ")}` : "") });
    }
    const w = by.workflow;
    const wfSignal = "saturation: statement timeouts in postgres_logs (hourly, prod-errors)";
    if (!w) rows.push(unknown("DB health", wfSignal, "no workflow sample yet (scripts/db-saturation-check.mjs in prod-errors.yml)"));
    else rows.push({ group: "DB health", signal: wfSignal,
      status: ageMin(w) > 150 ? "STALE" : w.log_problem ? "FAIL" : "PASS",
      fail: w.log_timeouts, total: `${w.log_timeouts} in ${w.log_window_minutes} min`, at: iso(new Date(w.sampled_at)),
      source: "public.db_saturation_samples origin=workflow (read-only)", note: w.log_problem ?? `${w.bad_24h} breaching hour(s) in 24h` });
  } catch (e) {
    rows.push(unknown("DB health", "saturation monitor samples", `read-only SQL failed: ${errMsg(e)}`));
  }
  return rows;
}

/** Q82's live monitor, read the same way its daily cron reads it. */
/** Q62: one row per inventoried credential/cert, read where this runs (CI reads more: expiry-monitor.yml). */
async function expiryRows(now) {
  try {
    const inv = JSON.parse(readFileSync(join(REPO, EXPIRY_INVENTORY), "utf8"));
    const { results } = await runExpiry(inv, now, { root: REPO });
    return expiryScoreboardRows(results, iso(now));
  } catch (e) {
    return [unknown("expiry", "credential and certificate expiry", `expiry readers failed: ${errMsg(e)}`)];
  }
}

async function pushTokenRows(sqlFn, now) {
  const signal = "push notifications can reach a device (check_push_token_health)";
  try {
    const [r] = await sqlFn("SELECT public.check_push_token_health() AS h");
    const h = typeof r.h === "string" ? JSON.parse(r.h) : r.h;
    if (!h || typeof h.ok !== "boolean") throw new Error("unexpected result shape");
    return [{ group: "alerts", signal, status: h.ok ? "PASS" : "FAIL", pass: h.tokens, fail: h.skipped_no_device_7d, at: iso(now),
      source: "public.check_push_token_health() (read-only) · OPEN.md Q82",
      note: `pass = device tokens, fail = pushes skipped for no device in 7d; ${h.registered_14d} registered in 14d, ${h.native_users_14d} native users signed in in 14d` }];
  } catch (e) {
    return [unknown("alerts", signal, `read-only SQL failed: ${errMsg(e)}`)];
  }
}

/**
 * Q240: every verified profile carries its identity fingerprint. The webhook
 * writes identity_sha256 only for verifications after 20260908002148; older
 * ones need scripts/backfill-identity-fingerprints.mjs (STRIPE_SECRET_KEY).
 * Until that runs, the identity ban-evasion layer does not bind for them.
 */
export const IDENTITY_FP_SQL =
  "SELECT count(*) FILTER (WHERE idv_status = 'verified' AND idv_session_id IS NOT NULL AND identity_sha256 IS NULL)::int AS missing, " +
  "count(*) FILTER (WHERE idv_status = 'verified' AND idv_session_id IS NOT NULL)::int AS verified FROM public.profiles";
export async function identityFingerprintRows(sqlFn, now) {
  const signal = "verified profiles carry an identity fingerprint (identity_sha256)";
  try {
    const [r] = await sqlFn(IDENTITY_FP_SQL);
    // Number(null) is 0: a null must read as "not measured", never as PASS.
    const num = (v) => (typeof v === "number" || (typeof v === "string" && /^\d+$/.test(v)) ? Number(v) : NaN);
    const missing = num(r?.missing);
    const verified = num(r?.verified);
    if (!Number.isInteger(missing) || !Number.isInteger(verified)) throw new Error("unexpected result shape");
    return [{ group: "alerts", signal, status: missing === 0 ? "PASS" : "FAIL", pass: verified - missing, fail: missing, total: verified, at: iso(now),
      source: "public.profiles (read-only) · OPEN.md Q240",
      note: missing === 0 ? "every verified profile has its fingerprint" : `${missing} verified profile(s) lack it: run scripts/backfill-identity-fingerprints.mjs --apply (needs STRIPE_SECRET_KEY)` }];
  } catch (e) {
    return [unknown("alerts", signal, `read-only SQL failed: ${errMsg(e)}`)];
  }
}

function remoteBranchRows(now) {
  try {
    sh("git", ["fetch", "--quiet", "--prune", "origin"], { timeout: 60000 });
    const refs = sh("git", ["for-each-ref", "--format=%(refname:short)", "refs/remotes/origin"]).split("\n").filter((r) => r && r !== "origin" && r !== "origin/HEAD" && r !== "origin/main");
    const merged = new Set(sh("git", ["branch", "-r", "--merged", "origin/main"]).split("\n").map((s) => s.trim()).filter(Boolean));
    let unlanded = 0;
    for (const r of refs) {
      if (merged.has(r)) continue;
      if (/^\+/m.test(sh("git", ["cherry", "origin/main", r]))) unlanded++;
    }
    const m = refs.filter((r) => merged.has(r)).length;
    return { summary: { total: refs.length, merged: m, unlanded, at: iso(now) },
      rows: [{ group: "open work", signal: "remote branches (merged / carrying patches not on main)", status: unlanded ? "WARN" : "PASS",
        pass: m, fail: unlanded, skipped: `${refs.length - m - unlanded} patch-equivalent`, total: refs.length, at: iso(now),
        source: "`git branch -r --merged origin/main` + `git cherry`", note: "queue item Q79 lands or deletes each" }] };
  } catch (e) {
    return { summary: null, rows: [unknown("open work", "remote branches (merged / carrying patches not on main)", `git failed: ${errMsg(e)}`)] };
  }
}

/** Rows derived from workflows already fetched: the number-currency checks that run in CI. */
function currencyRows(runsByFile, now) {
  const pick = (file, signal, note) => {
    const runs = runsByFile.get(file);
    if (!runs) return unknown("number currency", signal, `no run data for ${file}`);
    const pool = runs.filter((r) => r.event !== "push");
    const { last, redSince } = streak(pool.length ? pool : runs);
    if (!last) return unknown("number currency", signal, `no conclusive run of ${file}`);
    return { group: "number currency", signal, status: ciStatus(last, now), at: iso(last.updatedAt), source: `[${file} ${last.conclusion}](${last.url})`,
      note: [note, redSince && `red since ${iso(redSince)}`].filter(Boolean).join("; ") };
  };
  return [
    pick("staleness-watch.yml", "staleness watch (evidence age, workflow-bound baselines)", "scheduled run of scripts/check-staleness.mjs"),
    pick("db-drift-detect.yml", "migration drift + types.ts freshness vs prod", "db-drift-detect.yml nightly (supabase migration list + check-types-fresh.mjs)"),
  ];
}

export async function liveRows({ now = new Date(), sqlFn } = {}) {
  if (!sqlFn) sqlFn = (await import("./lib/opsAlertLedger.mjs")).sql;
  const readOnly = (q) => sqlFn(q, { readOnly: true, timeoutMs: 20000 });
  const wf = workflowRows(now);
  const rows = [];
  const suiteRows = SUITES.map((s) => {
    let runs = wf.runsByFile.get(s.workflow);
    // A weekly event (the vacuity full sweep) is buried under 40 push runs.
    if (runs && s.events) {
      try {
        runs = s.events.flatMap((ev) => mainRuns(wf.idsByFile.get(s.workflow), ev)).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      } catch (e) { return unknown(s.group, s.signal, `${s.events.join("/")} runs unreadable: ${errMsg(e)}`); }
    }
    return runs ? suiteRow(s, runs, now) : unknown(s.group, s.signal, `no run data for ${s.workflow}`);
  });
  rows.push(gateRow());
  rows.push(...(wf.runsByFile.get("test.yml") ? testYmlStepRows(wf.runsByFile.get("test.yml"), now) : [unknown("tests", "test.yml steps", "no run data for test.yml")]));
  rows.push(...suiteRows);
  const ledger = await ledgerRows(readOnly);
  const red = nightlyRedRows(now);
  rows.push(...ledger.rows, ...red.rows, ...(await pushTokenRows(readOnly, now)), ...(await identityFingerprintRows(readOnly, now)));
  rows.push(...currencyRows(wf.runsByFile, now));
  const branches = remoteBranchRows(now);
  rows.push(...branches.rows);
  rows.push(...(await dbHealthRows(readOnly, now)));
  rows.push(...(await dbSaturationRows(readOnly, now)));
  rows.push(...(await expiryRows(now)));
  // Q66: each target measured against its own source (scripts/slo.mjs).
  const slo = await measureSlos({ now, ...(await realIo(readOnly)) });
  rows.push(...slo);
  if (wf.summary) {
    const s = wf.summary;
    rows.push({ group: "CI", signal: "all workflows on main (last conclusive run)", status: s.FAIL || s.UNKNOWN || s.STALE ? "FAIL" : "PASS",
      pass: s.PASS, fail: s.FAIL, skipped: `${s.STALE} stale, ${s.UNKNOWN} unknown`, total: s.total, at: iso(now), source: "`gh api .../actions/workflows/<id>/runs?branch=main`", note: "one row per workflow below" });
  }
  rows.push(...wf.rows);
  // An UNKNOWN still says when the attempt was made.
  for (const r of rows) if (r.at === "not measured") r.at = `attempted ${iso(now)}`;
  return { rows, at: iso(now), ledger: ledger.summary, red: red.summary, wf: wf.summary, branches: branches.summary, slo: sloRecord(slo, now) };
}

// ── documents ───────────────────────────────────────────────────────────────

const between = (text, a, b) => {
  const i = text.indexOf(a), j = text.indexOf(b, i + a.length);
  return i >= 0 && j > i ? text.slice(i + a.length, j) : null;
};

/** The LIVE section of a committed document, verbatim, or null. */
export function committedLive(text) {
  if (!text) return null;
  const inner = between(text, LIVE_START, LIVE_END);
  return inner === null ? null : inner.replace(/^\n/, "").replace(/\n$/, "");
}

const NEVER_MEASURED = "**Live rows: never measured.** Run `node scripts/scoreboard.mjs --write` (needs `gh` and the linked Supabase CLI).";

export function renderScoreboard(local, liveBlock) {
  return `# Scoreboard — everything we test or track

${SB_START}

**What this is (Q59).** One row per signal we test or track: its status, pass / fail /
skipped / total, when it was measured and the run or source it came from. A row that
cannot be measured says **UNKNOWN** and why — never green. A CI result older than
${MAX_RUN_AGE_DAYS} days says **STALE**. Open work in one list: [docs/OPEN.md](OPEN.md).

Statuses: PASS · FAIL · WARN (open work, not a failure) · STALE · UNKNOWN · INFO (a number, no verdict).

## From the repo at this commit

Recomputed from committed files and diffed on every push by
\`scripts/check-generated-current.mjs\`, so these cannot be stale.

${table(local)}

## Measured live

GitHub Actions, prod (read-only SQL), git remotes and the local gate record. Refreshed by
\`node scripts/scoreboard.mjs --write\` and daily (19:17 UTC) by
\`.github/workflows/scoreboard.yml\`, which lands them through an auto-merging refresh PR (Q57).
\`scripts/check-staleness.mjs\` fails nightly when this section is older than ${MAX_LIVE_HOURS}h.

${LIVE_START}
${liveBlock ?? NEVER_MEASURED}
${LIVE_END}

${SB_END}
`;
}

export function renderLiveScoreboard(live) {
  return `**Live rows measured at ${live.at}.**\n\n${table(live.rows)}`;
}

export function renderOpenBlock(local, liveBlock) {
  const q = local.find((r) => r.signal.startsWith("OPEN.md queue"));
  const bus = local.find((r) => r.signal.startsWith("audit bus"));
  return `${EO_START}
**Everything open — start here** (Q58). Every tracker, its live count, and where to look.
Numbers for everything we test: **[docs/SCOREBOARD.md](SCOREBOARD.md)**.

- **Queue (this file):** ${q.note}. Source of truth for work.
- **Audit bus:** ${bus.status === "UNKNOWN" ? bus.note : bus.note.split(";")[0]} — \`node scripts/audit-bus.mjs list --blockers\` · [ROLLUP](audit/launch-2026-09/ROLLUP.md).
${LIVE_START}
${liveBlock ?? "- **Live trackers (alert ledger, nightly-red issues, CI, branches): never measured** — run `node scripts/scoreboard.mjs --write`."}
${LIVE_END}
${EO_END}`;
}

export function renderLiveOpen(live) {
  const L = live.ledger, R = live.red, W = live.wf, B = live.branches;
  const lines = [
    L ? `- **Ops alert ledger:** ${L.open} open (${L.openBySeverity}), ${L.verifying} verifying — \`node scripts/ops-alert-ledger.mjs list\` · /admin?view=health. _(${L.at})_`
      : "- **Ops alert ledger:** UNKNOWN — the read-only query failed; see SCOREBOARD.md.",
    R ? `- **nightly-red issues:** ${R.open} open — \`gh issue list -l nightly-red\`. _(${R.at})_` : "- **nightly-red issues:** UNKNOWN — `gh issue list` failed.",
    W ? `- **Workflows on main:** ${W.FAIL} red, ${W.STALE} stale, ${W.UNKNOWN} unknown, ${W.PASS} green of ${W.total} — [SCOREBOARD](SCOREBOARD.md). _(${live.at})_` : "- **Workflows on main:** UNKNOWN — `gh api` failed.",
    B ? `- **Remote branches:** ${B.unlanded} carry patches not on main, ${B.merged} fully merged, of ${B.total} (Q79). _(${B.at})_` : "- **Remote branches:** UNKNOWN — git fetch failed.",
  ];
  return lines.join("\n");
}

/** Replace [start..end] in `text` (inclusive of the markers) or insert after the H1. */
export function spliceOpen(text, block) {
  const i = text.indexOf(EO_START), j = text.indexOf(EO_END);
  if (i >= 0 && j > i) return text.slice(0, i) + block + text.slice(j + EO_END.length);
  const h1 = text.indexOf("\n", text.indexOf("# "));
  return text.slice(0, h1 + 1) + "\n" + block + "\n" + text.slice(h1 + 1);
}

// ── shape check (per push, offline) ─────────────────────────────────────────

/** Problems with a rendered scoreboard/open block. Empty = well-formed. */
export function shapeProblems(sb, open) {
  const p = [];
  if (!sb.includes(SB_START) || !sb.includes(SB_END)) p.push(`${SCOREBOARD}: generated markers missing`);
  if (!open.includes(EO_START) || !open.includes(EO_END)) p.push(`${OPEN}: Everything-open markers missing`);
  if (!between(open, EO_START, EO_END)?.includes("SCOREBOARD.md")) p.push(`${OPEN}: Everything-open block does not link docs/SCOREBOARD.md`);
  const live = committedLive(sb);
  if (live === null) p.push(`${SCOREBOARD}: live markers missing`);
  else if (live !== NEVER_MEASURED && !/^\*\*Live rows measured at \d{4}-\d\d-\d\dT\d\d:\d\dZ\.\*\*/.test(live)) p.push(`${SCOREBOARD}: live section has no "measured at" stamp`);
  const rows = sb.split("\n").filter((l) => /^\| (?!group \||---)/.test(l));
  if (rows.length < 5) p.push(`${SCOREBOARD}: only ${rows.length} rows — the table did not render`);
  for (const l of rows) {
    const c = l.split(/(?<!\\)\|/).slice(1, -1).map((s) => s.trim());
    if (c.length !== 10) { p.push(`row with ${c.length} cells: ${l.slice(0, 100)}`); continue; }
    const status = c[2].replace(/\*/g, "");
    if (!STATUSES.includes(status)) p.push(`row "${c[1]}": status "${status}" is not one of ${STATUSES.join("/")}`);
    if (!c[7] || c[7] === "—" || c[7] === "not measured" && status !== "UNKNOWN") p.push(`row "${c[1]}": no measured-at stamp`);
    if (status === "UNKNOWN" && !/UNKNOWN[^:]*: \S/.test(c[9])) p.push(`row "${c[1]}": UNKNOWN without a reason`);
    if (status === "PASS" && (c[7] === "not measured")) p.push(`row "${c[1]}": PASS but never measured`);
  }
  return p;
}

/** Hours since the live section was measured, or null when there is none. */
export function liveAgeHours(sb, now = new Date()) {
  const m = /\*\*Live rows measured at (\d{4}-\d\d-\d\dT\d\d:\d\dZ)\.\*\*/.exec(sb ?? "");
  return m ? (now - new Date(m[1])) / 36e5 : null;
}

// ── main ────────────────────────────────────────────────────────────────────

function readRepo(p) { return existsSync(join(REPO, p)) ? readFileSync(join(REPO, p), "utf8") : null; }

async function main() {
  const argv = process.argv.slice(2);
  const local = localRows();

  if (argv.includes("--open-block")) {
    // Session start: fast, capped, never fails. Local rows are exact; the two
    // cheap live trackers are re-measured with short timeouts; the slow ones
    // (every workflow, branches) come from the committed block with their stamp.
    let live = committedLive(between(readRepo(OPEN) ?? "", EO_START, EO_END) ?? "");
    try {
      const now = new Date();
      const { sql } = await import("./lib/opsAlertLedger.mjs");
      const ledger = await ledgerRows((q) => sql(q, { readOnly: true, timeoutMs: 6000 }));
      const red = nightlyRedRows(now, 6000);
      const fresh = renderLiveOpen({ ledger: ledger.summary, red: red.summary, wf: null, branches: null, at: iso(now) }).split("\n");
      const old = (live ?? "").split("\n");
      const keep = (prefix, freshLine) => (freshLine.includes("UNKNOWN") ? old.find((l) => l.startsWith(prefix)) ?? freshLine : freshLine);
      live = [
        keep("- **Ops alert ledger:**", fresh[0]),
        keep("- **nightly-red issues:**", fresh[1]),
        old.find((l) => l.startsWith("- **Workflows on main:**")) ?? "- **Workflows on main:** not measured yet.",
        old.find((l) => l.startsWith("- **Remote branches:**")) ?? "- **Remote branches:** not measured yet.",
      ].join("\n");
    } catch { /* keep the committed live lines */ }
    console.log(renderOpenBlock(local, live).split("\n").filter((l) => !l.startsWith("<!--")).join("\n"));
    return;
  }

  const sbPath = join(REPO, SCOREBOARD), openPath = join(REPO, OPEN);
  const sbText = readRepo(SCOREBOARD), openText = readRepo(OPEN);

  if (argv.includes("--check")) {
    const p = shapeProblems(sbText ?? "", openText ?? "");
    for (const x of p) console.error(`::error::${x}`);
    if (p.length) process.exit(1);
    console.log("scoreboard shape OK");
    return;
  }

  let sbLive, openLive;
  if (argv.includes("--write")) {
    const live = await liveRows();
    // The dated SLO record (Q66): scoreboard.yml uploads test-results/ as its artifact.
    const dir = join(REPO, "test-results", "slo");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `slo-${live.slo.measuredAt.slice(0, 10)}.json`), JSON.stringify(live.slo, null, 2) + "\n");
    sbLive = renderLiveScoreboard(live);
    openLive = renderLiveOpen(live);
  } else if (argv.includes("--live-from")) {
    // Q57 refresh PR: .github/workflows/scoreboard.yml measured the live rows
    // on an older checkout; rebuild on THIS (latest main) tree, taking only
    // the LIVE sections from that measurement — never the whole OPEN.md, which
    // lanes edit all day.
    const from = argv[argv.indexOf("--live-from") + 1];
    const read = (p) => (from && existsSync(join(from, p)) ? readFileSync(join(from, p), "utf8") : null);
    sbLive = committedLive(read(SCOREBOARD));
    openLive = committedLive(between(read(OPEN) ?? "", EO_START, EO_END) ?? "");
    if (sbLive === null || openLive === null) {
      console.error(`::error::--live-from ${from}: no live section in its ${SCOREBOARD} / ${OPEN}`);
      process.exit(1);
    }
  } else {
    sbLive = committedLive(sbText);
    openLive = committedLive(between(openText ?? "", EO_START, EO_END) ?? "");
  }
  const sb = renderScoreboard(local, sbLive);
  const open = spliceOpen(openText, renderOpenBlock(local, openLive));
  writeFileSync(sbPath, sb);
  writeFileSync(openPath, open);
  const problems = shapeProblems(sb, open);
  for (const x of problems) console.error(`::error::${x}`);
  if (problems.length) process.exit(1);
  console.log(`scoreboard: ${local.length} local row(s)${argv.includes("--write") ? ", live rows re-measured" : ", live rows carried forward"} → ${SCOREBOARD} + ${OPEN} (Everything open)`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
