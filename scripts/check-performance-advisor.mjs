#!/usr/bin/env node
/**
 * Hold the Supabase PERFORMANCE advisor to an EXACT per-class baseline
 * (docs/OPEN.md Q1321; the sibling of scripts/security-advisor-triage.mjs).
 *
 * The performance advisor is not a security finding, so its classes are not
 * accepted one by one. They are COUNTED: scripts/ci/performance-advisor-baseline.json
 * holds the count of findings per lint name, measured on prod. A run fails
 *   - when a class has MORE findings than its baseline (a new unused index, a
 *     new overlapping permissive policy, ...): fix it, or explain and raise;
 *   - when a class has FEWER (a fix landed, an index got used): lower the
 *     baseline in the same change, or the next regression hides in the slack
 *     (CLAUDE.md: every baseline is exact and fails in both directions);
 *   - when a class appears that the baseline does not name, or a named class
 *     with a non-zero baseline disappears.
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
 * Exit 0: every class at its baseline. Exit 1: a difference, printed.
 * Exit 2: the advisor could not be read, or the run is empty (fails closed).
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { apiBase } from "./lib/apiBase.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export function loadBaseline(root = ROOT) {
  return JSON.parse(readFileSync(join(root, "scripts/ci/performance-advisor-baseline.json"), "utf8"));
}

/** The lints array out of either result shape; throws on anything else. */
export function lintsOf(body) {
  const lints = body?.result?.lints ?? body?.lints;
  if (!Array.isArray(lints)) throw new Error("no lints array (expected {result:{lints}} or {lints})");
  return lints;
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

/**
 * @returns {{ over: string[], under: string[], total: number }}
 */
export function compare(counts, baseline) {
  const want = baseline.counts ?? {};
  const out = { over: [], under: [], total: 0 };
  for (const [name, n] of Object.entries(counts)) {
    out.total += n;
    const b = want[name];
    if (b === undefined) out.over.push(`${name}: ${n} finding(s), a class the baseline does not name`);
    else if (n > b) out.over.push(`${name}: ${n} finding(s), baseline ${b} (+${n - b})`);
    else if (n < b) out.under.push(`${name}: ${n} finding(s), baseline ${b} (-${b - n}): lower the baseline`);
  }
  for (const [name, b] of Object.entries(want)) {
    if (!(name in counts) && b > 0) out.under.push(`${name}: 0 finding(s), baseline ${b}: lower the baseline (or remove the class)`);
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
  const r = compare(countsOf(lints), loadBaseline());
  if (r.total === 0) {
    console.log("::error title=performance advisor::the advisor run holds zero findings — refusing to report clean");
    return 2;
  }
  console.log(`performance advisor: ${r.total} finding(s); ${r.over.length} over baseline, ${r.under.length} under`);
  for (const o of r.over) console.log(`::error title=performance advisor over baseline::${o} (scripts/ci/performance-advisor-baseline.json, Q1321)`);
  for (const u of r.under) console.log(`::error title=performance advisor under baseline::${u} (scripts/ci/performance-advisor-baseline.json, Q1321)`);
  return r.over.length || r.under.length ? 1 : 0;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) main().then((c) => process.exit(c));
