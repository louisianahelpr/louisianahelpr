#!/usr/bin/env node
/**
 * Which partly-done (`- [~]`) items in docs/OPEN.md can be ticked NOW?
 *
 * 2026-09-27: eight `[~]` items said "tick [x] after db-deploy: `SELECT ...`
 * returns X", were already true on prod, and nobody had re-run the check.
 * A `[~]` item now carries one or more machine-checkable markers, and this
 * script runs them:
 *
 *   done-when: sql `SELECT ...` => <expected>     read-only; the first row's
 *        ONE column as text must equal <expected> (bare token, or
 *        `backticked` when it has spaces). Cast arrays with ::text.
 *   done-when: test <path>                          `npx vitest run <path>` exits 0
 *   done-when: issue #N closed                      GitHub issue N is closed
 *   done-when: pr #N merged                         GitHub PR N is merged
 *   done-when: bus <ID> closed                      audit-bus finding <ID> folds to a closed
 *        status (fixed/retracted/duplicate/wontfix/obsolete) in the committed
 *        docs/audit/launch-2026-09/findings.jsonl (scripts/open-sync-trackers.mjs writes it)
 *
 * An item is READY when every one of its markers holds. Exit 0: nothing ready
 * and every marker readable. Exit 1: something is ready to tick, or a marker
 * could not be parsed or run (fail closed: "could not tell" is not "not yet").
 *
 * SQL transport is scripts/lib/opsAlertLedger.mjs `sql()`: in CI the
 * Management API with read_only:true (SUPABASE_ACCESS_TOKEN +
 * SUPABASE_PROJECT_REF, as prod-errors.yml has); locally the linked supabase
 * CLI (LH_SUPABASE_WORKDIR). Only a single SELECT/WITH statement is accepted.
 *
 * Usage: node scripts/open-done-when.mjs [--file docs/OPEN.md] [--no-sql] [--no-test] [--out <md>] [--tick]
 *
 * --tick (owner, 2026-10-04: "the count lags the work"): every READY item is
 * ticked IN the file (`- [~]` -> `- [x]`) with its evidence, and the run exits 0
 * unless a marker could not be read. .github/workflows/open-auto-tick.yml runs it
 * after each deploy and lands the ticks through a refresh PR.
 * Nightly: .github/workflows/open-done-when.yml (one nightly-red issue listing what to tick).
 * Guard: src/test/openPartlyDoneItemsSayDoneWhen.test.ts.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { greenNightlyRunAfter, ledgerWorkflowKey, workflowAliases } from "./lib/opsAlertLedger.mjs";
import { alertLabelOf, alertWorkflowOf } from "./lib/alertIssueLabels.mjs";

const PARTLY = /^- \[~\] /;
const ITEM_START = /^(- \[|#)/;
const MARKER = /done-when:\s*/g;
const KINDS = [
  { kind: "sql", re: /^sql\s+`([^`]+)`\s*=>\s*(?:`([^`]*)`|([^\s`]+?))(?=[\s.,;)]|$)/ },
  { kind: "test", re: /^test\s+([\w./-]+\.(?:test|spec)\.tsx?)/ },
  { kind: "issue", re: /^issue\s+#(\d+)\s+closed\b/ },
  { kind: "pr", re: /^pr\s+#(\d+)\s+merged\b/ },
  { kind: "bus", re: /^bus\s+([A-Z]+-\d+(?:#[\w-]+)?)\s+closed\b/ },
];

/** Every `- [~]` item: its id, full text (with continuation lines), parsed markers and unparseable ones. */
export function partlyDoneItems(md) {
  const lines = md.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!PARTLY.test(lines[i])) continue;
    let text = lines[i];
    for (let j = i + 1; j < lines.length && !ITEM_START.test(lines[j]); j++) text += "\n" + lines[j];
    const id = /^- \[~\] \*\*(Q\d+)/.exec(lines[i])?.[1] ?? lines[i].slice(6, 70);
    const markers = [];
    const malformed = [];
    for (const m of text.matchAll(MARKER)) {
      const rest = text.slice(m.index + m[0].length);
      const hit = KINDS.map((k) => ({ k, x: k.re.exec(rest) })).find((h) => h.x);
      if (!hit) { malformed.push(rest.slice(0, 80)); continue; }
      const x = hit.x;
      if (hit.k.kind === "sql") markers.push({ kind: "sql", query: x[1].trim(), expected: (x[2] ?? x[3]).trim() });
      else if (hit.k.kind === "test") markers.push({ kind: "test", path: x[1] });
      else if (hit.k.kind === "bus") markers.push({ kind: "bus", id: x[1] });
      else markers.push({ kind: hit.k.kind, number: Number(x[1]) });
    }
    out.push({ id, line: i + 1, text, markers, malformed });
  }
  return out;
}

/**
 * The first row's single column as text (arrays as Postgres `{a,b}`). ONE
 * column only: the linked CLI and the Management API return a row's columns
 * in different orders (measured 2026-09-27: `roles::text, cmd` came back as
 * UPDATE|{authenticated}), so a multi-column compare would differ by transport.
 * Concatenate in SQL (`roles::text || '|' || cmd`) when you need two values.
 */
export function rowText(rows) {
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return "(no rows)";
  const vals = Object.values(row);
  if (vals.length !== 1) throw new Error(`sql marker must select exactly one column, got ${vals.length}`);
  const v = vals[0];
  return v === null ? "null" : Array.isArray(v) ? `{${v.join(",")}}` : typeof v === "object" ? JSON.stringify(v) : String(v);
}

/**
 * The app functions (names in `appFns`, lower case) a sql marker's query calls.
 * The read-only role the nightly runs as cannot execute them (#1951), so a
 * marker that calls one can never read true. Pure, so the guard can prove it
 * on a fixed query instead of on whichever marker docs/OPEN.md holds today
 * (vacuity 37262748113: a mutation of a live marker went vacuous once its
 * item stopped being [~]).
 */
export function appFunctionsCalled(query, appFns) {
  return [...String(query).matchAll(/(?:public\.)?(\w+)\s*\(/gi)]
    .map((m) => m[1].toLowerCase())
    .filter((name) => appFns.has(name));
}

const READ_ONLY_SQL = /^\s*(select|with)\b[^;]*;?\s*$/i;

/**
 * Whether an `issue #N closed` marker holds (Q1139's rule, 2026-10-03).
 *
 * An ALERT issue (nightly-red, schedule-stalled, ...: any label in
 * scripts/lib/alertIssueLabels.mjs) is evidence only when its workflow's own
 * green run closed it (github-actions[bot]). One a PERSON closed proves
 * nothing: on 2026-10-02 #1582, #1654, #1754 and #2071 were closed by hand
 * while press-every-control, loading-states-refresh, prod-audit and
 * staleness-watch were still red, and 15 [~] items read READY on them. Such a
 * marker holds only when that workflow's newest scheduled or dispatched run on
 * main is green and started after the issue was opened (greenNightlyRunAfter).
 * Any other issue: closed is closed. `issue` is the REST issue (state,
 * closed_by, labels, created_at); `nightlyRuns` the workflow's runs, or null
 * when no workflow matches the issue (alertWorkflowOf).
 */
export function issueMarkerHolds(issue, nightlyRuns) {
  const n = issue.number;
  if (String(issue.state).toLowerCase() !== "closed") return { ok: false, note: `issue #${n} is ${String(issue.state).toUpperCase()}` };
  const alert = alertLabelOf(issue);
  const by = issue.closed_by?.login ?? "a person";
  if (!alert) return { ok: true, note: `issue #${n} is CLOSED` };
  if (by === "github-actions[bot]") return { ok: true, note: `issue #${n} is CLOSED by its own green run` };
  if (!nightlyRuns) return { ok: false, note: `issue #${n} was closed by ${by}, not by a run, and no workflow matches "${issue.title}"` };
  const green = greenNightlyRunAfter(nightlyRuns, issue.created_at);
  return green
    ? { ok: true, note: `issue #${n} was closed by ${by}; its workflow then ran green (${green.event}): ${green.url}` }
    : { ok: false, note: `issue #${n} was closed by ${by}, not by a run, and its workflow has no green nightly run since it opened` };
}

/** The scheduled and dispatched runs on main of the workflow an alert issue belongs to (its label's, else its title's), or null. */
function nightlyRunsFor(issue) {
  const dir = ".github/workflows";
  const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).map((f) => ({ file: f, text: readFileSync(join(dir, f), "utf8") }));
  const aliases = workflowAliases(files);
  const byTitle = (title) => {
    const key = ledgerWorkflowKey({ source_kind: "nightly_red", title }, aliases);
    return files.find((f) => f.file.replace(/\.ya?ml$/, "") === key)?.file ?? null;
  };
  const wf = alertWorkflowOf(issue, byTitle);
  if (!wf) return null;
  return ["schedule", "workflow_dispatch"].flatMap((event) => JSON.parse(execFileSync("gh", ["run", "list", "--workflow", wf,
    "--branch", "main", "--event", event, "--limit", "5", "--json", "conclusion,status,createdAt,url,event"], { encoding: "utf8" })));
}

async function runMarker(mk, opts) {
  if (mk.kind === "sql") {
    if (opts.noSql) return { ok: null, note: "sql skipped (--no-sql)" };
    if (!READ_ONLY_SQL.test(mk.query)) return { ok: false, error: "only one SELECT/WITH statement is allowed" };
    const { sql } = await import("./lib/opsAlertLedger.mjs");
    const got = rowText(await sql(mk.query, { readOnly: true, timeoutMs: 30000 }));
    return { ok: got === mk.expected, note: `got ${got}, want ${mk.expected}` };
  }
  if (mk.kind === "test") {
    if (opts.noTest) return { ok: null, note: "test skipped (--no-test)" };
    try {
      execFileSync("npx", ["vitest", "run", mk.path], { stdio: "ignore", timeout: 600000 });
      return { ok: true, note: `${mk.path} passes` };
    } catch {
      return { ok: false, note: `${mk.path} fails` };
    }
  }
  if (mk.kind === "bus") {
    const { busStatus, FINDINGS } = await import("./lib/openFeeds.mjs");
    const st = busStatus(readFileSync(FINDINGS, "utf8")).get(`bus ${mk.id}`);
    if (!st) return { ok: false, error: `bus ${mk.id} is not in ${FINDINGS}` };
    return { ok: st === "closed", note: `bus ${mk.id} is ${st}` };
  }
  if (mk.kind === "issue") {
    const issue = JSON.parse(execFileSync("gh", ["api", `repos/{owner}/{repo}/issues/${mk.number}`], { encoding: "utf8" }));
    const handClosedAlert = String(issue.state) === "closed" && issue.closed_by?.login !== "github-actions[bot]" && alertLabelOf(issue) !== null;
    return issueMarkerHolds(issue, handClosedAlert ? nightlyRunsFor(issue) : null);
  }
  const state = JSON.parse(execFileSync("gh", ["pr", "view", String(mk.number), "--json", "state"], { encoding: "utf8" })).state;
  return { ok: state === "MERGED", note: `pr #${mk.number} is ${state}` };
}

/**
 * Tick the READY items in `md`: `- [~] **Qn` becomes `- [x] **Qn` and the line
 * gains the evidence. Only the item's first line changes; an id not in `ready`
 * (or not a `[~]` line) is left exactly as it was.
 * @param {string} md
 * @param {Map<string, string>} ready  item id -> what its markers read
 * @param {string} date  YYYY-MM-DD
 */
export function tickReady(md, ready, date) {
  return md
    .split("\n")
    .map((line) => {
      const id = /^- \[~\] \*\*(Q\d+)\b/.exec(line)?.[1];
      if (!id || !ready.has(id)) return line;
      return `- [x]${line.slice(5)} **DONE ${date} (auto-tick, verified live): every done-when marker on this item read as expected on prod (${ready.get(id)}).**`;
    })
    .join("\n");
}

async function main() {
  const argv = process.argv.slice(2);
  const opt = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
  const opts = { noSql: argv.includes("--no-sql"), noTest: argv.includes("--no-test") };
  const file = opt("file") ?? "docs/OPEN.md";
  const items = partlyDoneItems(readFileSync(file, "utf8"));
  const withMarkers = items.filter((it) => it.markers.length || it.malformed.length);
  const ready = [];
  const readyIds = new Map();
  const problems = [];
  for (const it of withMarkers) {
    for (const bad of it.malformed) problems.push(`${it.id} (line ${it.line}): unparseable marker "done-when: ${bad}"`);
    if (!it.markers.length) continue;
    const res = [];
    for (const mk of it.markers) {
      try { res.push(await runMarker(mk, opts)); } catch (e) {
        const msg = String(e?.message ?? e).split("\n")[0].slice(0, 200);
        problems.push(`${it.id} (line ${it.line}): ${mk.kind} marker could not run: ${msg}`);
        res.push({ ok: false, note: "error" });
      }
    }
    const notes = res.map((r) => r.note ?? r.error).join("; ");
    console.log(`${res.every((r) => r.ok === true) ? "READY  " : "not yet"} ${it.id} (line ${it.line}): ${notes}`);
    if (res.every((r) => r.ok === true)) {
      ready.push(`- **${it.id}** (docs/OPEN.md line ${it.line}): ${notes}`);
      readyIds.set(it.id, notes.replace(/\s+/g, " ").slice(0, 300));
    }
  }
  console.log(`\n${items.length} [~] item(s), ${withMarkers.length} with a done-when marker, ${ready.length} READY to tick, ${problems.length} problem(s).`);
  for (const p of problems) console.log(`::error title=done-when marker::${p}`);
  const report = [
    ready.length ? `### Ready to tick [x] (each item's done-when checks all hold)\n${ready.join("\n")}` : "",
    problems.length ? `### Markers that could not be read\n${problems.map((p) => `- ${p}`).join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
  if (opt("out")) writeFileSync(opt("out"), report);
  if (argv.includes("--tick")) {
    if (readyIds.size) writeFileSync(file, tickReady(readFileSync(file, "utf8"), readyIds, new Date().toISOString().slice(0, 10)));
    console.log(`--tick: ticked ${readyIds.size} item(s) in ${file}`);
    process.exit(problems.length ? 1 : 0);
  }
  process.exit(ready.length || problems.length ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
