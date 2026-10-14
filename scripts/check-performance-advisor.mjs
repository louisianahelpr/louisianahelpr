#!/usr/bin/env node
/**
 * Hold the Supabase PERFORMANCE advisor to an EXACT baseline
 * (docs/OPEN.md Q1321, Q1816; the sibling of scripts/security-advisor-triage.mjs).
 *
 * The performance advisor is not a security finding, so its classes are not
 * accepted one by one. scripts/ci/performance-advisor-baseline.json holds two
 * kinds of baseline, measured on prod:
 *
 *   `counts`        CODE-DRIVEN classes (multiple_permissive_policies,
 *                   auth_db_connections_absolute), an exact count per lint
 *                   name. A run fails when a class has MORE findings (a new
 *                   overlapping policy), FEWER (a fix landed and its baseline
 *                   was not lowered: the next regression would hide in the
 *                   slack), or when a class appears that no section names, or
 *                   a named class with a non-zero count disappears.
 *
 *   `unused_index`  an exact SET of `schema.table.index` names. unused_index is
 *                   USAGE-driven: an index leaves the lint the first time real
 *                   traffic scans it, with no code change. As a count it went
 *                   red twice in two days (119 -> 118 -> 117, db-drift-detect
 *                   runs 38611385251 and 38645447224) and could never stay
 *                   green, so it is tracked by name:
 *                     - a NEW name fails: a migration added an index nothing
 *                       uses, or an index fell out of use. Fix it, or add the
 *                       name with the reason in the baseline's note;
 *                     - a name that LEAVES passes and prints the line to remove
 *                       (traffic used it; not a code change, not a regression);
 *                     - the code-driven way a name leaves (a migration DROPs or
 *                       RENAMEs the index) is held exact by
 *                       src/test/performanceAdvisorBaseline.test.ts on every
 *                       push: the baseline must lose that name in the same
 *                       change.
 *                   The same split as e2e/happy-path/overlay-sweep.baseline.json
 *                   (src/test/baselinesAreTwoWay.test.ts): "not seen this run"
 *                   is not proof of a fix there either, so the deterministic
 *                   half is what fails.
 *
 * Usage:
 *   node scripts/check-performance-advisor.mjs            reads prod live through the
 *       Management API (GET /v1/projects/{ref}/advisors/performance; env
 *       SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF; LH_SUPABASE_API_BASE for tests).
 *       Runs nightly in .github/workflows/db-drift-detect.yml.
 *   node scripts/check-performance-advisor.mjs <advisor.json | ->
 *       grades a saved result: the Supabase MCP `get_advisors` (type
 *       performance) body ({"result":{"lints":[...]}}) or the Management API
 *       body ({"lints":[...]}).
 * Exit 0: every class at its baseline (departed unused indexes are printed as
 * notices). Exit 1: a difference, printed. Exit 2: the advisor could not be
 * read, the run is empty, or an unused_index finding names no index (fails
 * closed).
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { apiBase } from "./lib/apiBase.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Lint names tracked as an exact SET of object names (usage-driven), keyed in the baseline by the lint name. */
export const SET_CLASSES = ["unused_index"];

export function loadBaseline(root = ROOT) {
  return JSON.parse(readFileSync(join(root, "scripts/ci/performance-advisor-baseline.json"), "utf8"));
}

/** The lints array out of either result shape; throws on anything else. */
export function lintsOf(body) {
  const lints = body?.result?.lints ?? body?.lints;
  if (!Array.isArray(lints)) throw new Error("no lints array (expected {result:{lints}} or {lints})");
  return lints;
}

/** The findings of one lint: a grouped lint's `findings`, or the flat row itself. */
function findingsOf(lint) {
  return Array.isArray(lint.findings) ? lint.findings : [lint];
}

/** Findings per lint name. A grouped lint counts its findings (or its `count`); a flat row counts 1. */
export function countsOf(lints) {
  const out = {};
  for (const lint of lints) {
    const n = Array.isArray(lint.findings) ? lint.findings.length : typeof lint.count === "number" ? lint.count : 1;
    out[lint.name] = (out[lint.name] ?? 0) + n;
  }
  return out;
}

// splinter's unused_index detail, as prod returned it 2026-10-14:
//   Index \`payment_fingerprints_kind_hash_idx\` on table \`public.payment_fingerprints\` has not been used
// (the backslash before each backtick is literal in the body; accepted with or without it).
const UNUSED_INDEX_DETAIL = /Index \\?`([^`\\]+)\\?` on table \\?`([^`\\.]+)\.([^`\\]+)\\?`/;

/** `schema.table.index` of one unused_index finding; throws when the detail names no index. */
export function unusedIndexKey(finding) {
  const m = UNUSED_INDEX_DETAIL.exec(String(finding?.detail ?? ""));
  if (!m) throw new Error(`an unused_index finding names no index: ${JSON.stringify(finding?.detail ?? null).slice(0, 160)}`);
  return `${m[2]}.${m[3]}.${m[1]}`;
}

/** The names per set class seen in a run: { unused_index: Set<string> }. Throws on an unparseable finding. */
export function namesOf(lints) {
  const out = Object.fromEntries(SET_CLASSES.map((c) => [c, new Set()]));
  for (const lint of lints) {
    if (!SET_CLASSES.includes(lint.name)) continue;
    for (const f of findingsOf(lint)) out[lint.name].add(unusedIndexKey(f));
  }
  return out;
}

/**
 * @returns {{ over: string[], under: string[], departed: string[], total: number }}
 *   over/under fail the run; departed is printed and passes.
 */
export function compare(lints, baseline) {
  const want = baseline.counts ?? {};
  const out = { over: [], under: [], departed: [], total: 0 };
  for (const c of SET_CLASSES) {
    if (c in want) throw new Error(`${c} is tracked by name; it may not also sit in "counts"`);
    if (!Array.isArray(baseline[c])) throw new Error(`the baseline has no "${c}" name list`);
  }
  const counts = countsOf(lints);
  for (const [name, n] of Object.entries(counts)) {
    out.total += n;
    if (SET_CLASSES.includes(name)) continue;
    const b = want[name];
    if (b === undefined) out.over.push(`${name}: ${n} finding(s), a class the baseline does not name`);
    else if (n > b) out.over.push(`${name}: ${n} finding(s), baseline ${b} (+${n - b})`);
    else if (n < b) out.under.push(`${name}: ${n} finding(s), baseline ${b} (-${b - n}): lower the baseline`);
  }
  for (const [name, b] of Object.entries(want)) {
    if (!(name in counts) && b > 0) out.under.push(`${name}: 0 finding(s), baseline ${b}: lower the baseline (or remove the class)`);
  }
  const seen = namesOf(lints);
  for (const c of SET_CLASSES) {
    const known = new Set(baseline[c]);
    for (const k of [...seen[c]].sort()) {
      if (!known.has(k)) out.over.push(`${c}: NEW ${k}: an index nothing scans (drop it, or add it to "${c}" with the reason)`);
    }
    if (seen[c].size === 0 && known.size > 0) {
      // Every index used at once is not what traffic does; an advisor that
      // stopped reporting the class is. Fail rather than read it as 117 passes.
      out.under.push(`${c}: 0 finding(s), the baseline names ${known.size}: the class vanished entirely (check the advisor before emptying the list)`);
      continue;
    }
    for (const k of [...known].sort()) {
      if (!seen[c].has(k)) out.departed.push(`${c}: ${k} left the set (real traffic scanned it): remove the line "${k}" from "${c}"`);
    }
  }
  return out;
}

/** The live advisor body from the Management API. */
async function readLive() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.SUPABASE_PROJECT_REF;
  if (!token || !ref) throw new Error("SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF are required");
  const base = apiBase(process.env.LH_SUPABASE_API_BASE, "https://api.supabase.com");
  const res = await fetch(`${base}/v1/projects/${ref}/advisors/performance`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Management API GET /advisors/performance ${res.status}`);
  return res.json();
}

async function main() {
  const src = process.argv[2];
  let lints;
  try {
    const body = src ? JSON.parse(readFileSync(src === "-" ? 0 : src, "utf8")) : await readLive();
    if (Array.isArray(body) && body.length === 0) {
      console.log("::error title=performance advisor::the advisor returned no result — refusing to report clean");
      return 2;
    }
    lints = lintsOf(body);
  } catch (err) {
    console.log(`::error title=performance advisor::could not read the performance advisor: ${err instanceof Error ? err.message : "parse failed"}`);
    return 2;
  }
  let r;
  try {
    r = compare(lints, loadBaseline());
  } catch (err) {
    console.log(`::error title=performance advisor::could not grade the performance advisor: ${err instanceof Error ? err.message : "grading failed"}`);
    return 2;
  }
  if (r.total === 0) {
    console.log("::error title=performance advisor::the advisor run holds zero findings — refusing to report clean");
    return 2;
  }
  console.log(`performance advisor: ${r.total} finding(s); ${r.over.length} over baseline, ${r.under.length} under, ${r.departed.length} unused index(es) now used`);
  for (const o of r.over) console.log(`::error title=performance advisor over baseline::${o} (scripts/ci/performance-advisor-baseline.json, Q1321)`);
  for (const u of r.under) console.log(`::error title=performance advisor under baseline::${u} (scripts/ci/performance-advisor-baseline.json, Q1321)`);
  for (const d of r.departed) console.log(`::notice title=performance advisor: index now used::${d} (scripts/ci/performance-advisor-baseline.json; not a failure)`);
  return r.over.length || r.under.length ? 1 : 0;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) main().then((c) => process.exit(c));
