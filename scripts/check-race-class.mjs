#!/usr/bin/env node
/**
 * check-race-class — the job-row race, as a class.
 *
 * Two races were PROVEN on prod 2026-09-12 and fixed in
 * 20260913014328_lock_job_row_on_apply_and_confirm.sql (d0471d07f):
 *
 *   1. enforce_application_job_state() read public.jobs with a plain SELECT,
 *      judged status = 'open', and let the application INSERT through — while
 *      poster_cancel_job() held the row FOR UPDATE. 14/20 applications landed
 *      on a cancelled job. Fix: the read takes FOR SHARE.
 *   2. The helper's confirm was a client UPDATE jobs SET helper_confirmed_at
 *      with no status predicate; queued behind the cancel it stamped a
 *      CANCELLED job and the payout cron would have charged the poster 25%.
 *      5/20. Fix: .eq("status","accepted") + trigger trg_confirm_on_live_job.
 *
 * Both are instances of one shape, and this script flags the shape:
 *
 *   SQL    — a plpgsql function (latest definition across supabase/migrations/
 *            wins; DROP FUNCTION removes it) that reads public.jobs WITHOUT
 *            FOR UPDATE / FOR SHARE / FOR NO KEY UPDATE / FOR KEY SHARE, makes
 *            a decision (IF / CASE / RAISE), and writes somewhere other than
 *            jobs — an INSERT/UPDATE/DELETE on another table, or, for a
 *            trigger function, the very row write it is gating.
 *   CLIENT — a `.from("jobs")` chain in src/ that calls `.update(...)` with a
 *            lifecycle column (status, payment_status, helper_id,
 *            helper_confirmed_at, poster_confirmed_at, *_completed_at) — or a
 *            payload the script cannot read (a variable, a computed key, a
 *            spread) — and has no `.eq("status", …)` / `.in("status", …)`.
 *
 * Existing hits live in scripts/race-class-baseline.json, each with a reason.
 * A hit not in the baseline fails. A baseline entry that no longer matches
 * ALSO fails: the list may only shrink, and it shrinks in the same commit
 * that fixes the entry.
 *
 * Usage:
 *   node scripts/check-race-class.mjs            # check repo against baseline
 *   node scripts/check-race-class.mjs --list     # print every current hit key
 *   node scripts/check-race-class.mjs --exclude-migration 20260913014328
 *                                                # replay without a migration
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, "..");
export const BASELINE_PATH = join(REPO, "scripts/race-class-baseline.json");

// ─── SQL ─────────────────────────────────────────────────────────────────

function stripSqlComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

function qualify(raw) {
  const clean = raw.replace(/"/g, "").toLowerCase();
  return clean.includes(".") ? clean : `public.${clean}`;
}

/**
 * Collect every CREATE [OR REPLACE] FUNCTION in `files` (in order), keyed by
 * schema-qualified name. Later definitions overwrite earlier ones; DROP
 * FUNCTION deletes. Overloads collapse to one key on purpose — a lock missing
 * from any overload is the same bug.
 */
export function collectFunctions(files) {
  const fns = new Map();
  const events =
    /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+((?:"?[a-z0-9_]+"?\.)?"?[a-z0-9_]+"?)\s*\(|DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?((?:"?[a-z0-9_]+"?\.)?"?[a-z0-9_]+"?)/gi;
  for (const { name: file, sql: rawSql } of files) {
    const sql = stripSqlComments(rawSql);
    let m;
    events.lastIndex = 0;
    while ((m = events.exec(sql)) !== null) {
      if (m[2]) {
        fns.delete(qualify(m[2]));
        continue;
      }
      const key = qualify(m[1]);
      const from = events.lastIndex;
      const rest = sql.slice(from);
      const open = rest.match(/\bAS\s+(\$[a-z0-9_]*\$)/i);
      if (!open) continue;
      const tag = open[1];
      const bodyStart = open.index + open[0].length;
      const bodyEnd = rest.indexOf(tag, bodyStart);
      if (bodyEnd < 0) continue;
      const header = rest.slice(0, open.index);
      const trailer = rest.slice(bodyEnd + tag.length, bodyEnd + tag.length + 400).split(";")[0];
      const lang = `${header} ${trailer}`.match(/LANGUAGE\s+'?([a-z]+)'?/i);
      fns.set(key, {
        file,
        body: rest.slice(bodyStart, bodyEnd),
        language: lang ? lang[1].toLowerCase() : "unknown",
        returnsTrigger: /RETURNS\s+trigger\b/i.test(header),
      });
      events.lastIndex = from + bodyEnd + tag.length;
    }
  }
  return fns;
}

const JOBS_REF = /\b(?:FROM|JOIN)\s+(?:ONLY\s+)?(?:public\.)?jobs\b(?!\s*\.)/i;
const ROW_LOCK = /\bFOR\s+(?:UPDATE|SHARE|NO\s+KEY\s+UPDATE|KEY\s+SHARE)\b/i;
const OTHER_WRITE =
  /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:ONLY\s+)?(?!(?:public\.)?jobs\b)(?:public\.)?([a-z_][a-z0-9_]*)/gi;
const JOBS_WRITE =
  /^\s*(?:UPDATE\s+(?:ONLY\s+)?(?:public\.)?jobs\b|DELETE\s+FROM\s+(?:public\.)?jobs\b)/i;
const DECISION = /\b(?:IF|CASE|RAISE)\b/i;
// Words that follow UPDATE / INSERT / DELETE in plpgsql without naming a table.
const NOT_TABLES = new Set(["of", "on", "set", "or", "nowait", "skip", "the", "a", "to", "for"]);

/** Returns null if clean, or a description of the unlocked read + dependent write. */
export function analyzeFunctionBody(fn) {
  if (fn.language !== "plpgsql") return null;
  const body = stripSqlComments(fn.body).replace(/'(?:[^']|'')*'/g, "''");
  const statements = body.split(";");
  const unlocked = statements.filter(
    (s) => JOBS_REF.test(s) && !ROW_LOCK.test(s) && !JOBS_WRITE.test(s),
  );
  if (unlocked.length === 0) return null;
  if (!DECISION.test(body)) return null;
  const writes = new Set();
  OTHER_WRITE.lastIndex = 0;
  let m;
  while ((m = OTHER_WRITE.exec(body)) !== null) {
    if (!NOT_TABLES.has(m[1].toLowerCase())) writes.add(m[1].toLowerCase());
  }
  if (writes.size === 0 && !fn.returnsTrigger) return null;
  return { unlockedReads: unlocked.length, writes: [...writes].sort(), trigger: fn.returnsTrigger };
}

export function readMigrations({ dir = join(REPO, "supabase/migrations"), exclude = [] } = {}) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .filter((f) => !exclude.some((p) => f.startsWith(p)))
    .sort()
    .map((f) => ({ name: f, sql: readFileSync(join(dir, f), "utf8") }));
}

export function sqlHits(files) {
  const hits = [];
  for (const [name, fn] of collectFunctions(files)) {
    const detail = analyzeFunctionBody(fn);
    if (detail) hits.push({ key: `sql:${name}`, file: fn.file, detail });
  }
  return hits;
}

// ─── CLIENT ──────────────────────────────────────────────────────────────

export const LIFECYCLE_COLUMN =
  /^(?:status|payment_status|helper_id|helper_confirmed_at|poster_confirmed_at|[a-z0-9_]*_completed_at)$/;

/** From `start` (index of an opening bracket), return the index just past its match. */
function matchBracket(src, start) {
  let depth = 0;
  let quote = null;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return src.length;
}

/** The method chain that follows `.from("jobs")`: [{name, args}, …]. */
function chainAt(src, idx) {
  const calls = [];
  let i = idx;
  for (;;) {
    const m = src
      .slice(i, i + 2000)
      .match(/^(?:\s|\/\/[^\n]*\n)*\??\.\s*([A-Za-z_$][\w$]*)\s*(?:<[^>()]*>)?\s*\(/);
    if (!m) break;
    const open = i + m[0].length - 1;
    const close = matchBracket(src, open);
    calls.push({ name: m[1], args: src.slice(open + 1, close - 1) });
    i = close;
  }
  return calls;
}

function payloadColumns(arg) {
  const a = arg.trim();
  if (!a.startsWith("{")) return { opaque: true, cols: [] };
  const inner = a.slice(1, matchBracket(a, 0) - 1);
  const cols = [];
  let opaque = false;
  let depth = 0;
  let quote = null;
  let seg = "";
  const flush = () => {
    const s = seg.replace(/\/\/[^\n]*/g, "").trim();
    seg = "";
    if (!s) return;
    if (s.startsWith("...") || s.startsWith("[")) {
      opaque = true;
      return;
    }
    const k = s.match(/^["']?([A-Za-z_$][\w$]*)["']?\s*(?::|$)/);
    if (k) cols.push(k[1]);
    else opaque = true;
  };
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (quote) {
      seg += c;
      if (c === "\\") seg += inner[++i] ?? "";
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    if (c === "(" || c === "{" || c === "[") depth++;
    if (c === ")" || c === "}" || c === "]") depth--;
    if (c === "," && depth === 0) flush();
    else seg += c;
  }
  flush();
  return { opaque, cols };
}

export function clientHitsInSource(relPath, src) {
  const hits = [];
  const seen = new Map();
  const re = /\.from\(\s*["'`]jobs["'`]\s*\)/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const chain = chainAt(src, m.index + m[0].length);
    const upd = chain.find((c) => c.name === "update");
    if (!upd) continue;
    const { opaque, cols } = payloadColumns(upd.args);
    const lifecycle = cols.filter((c) => LIFECYCLE_COLUMN.test(c)).sort();
    if (!opaque && lifecycle.length === 0) continue;
    const guarded = chain.some(
      (c) => (c.name === "eq" || c.name === "in") && /^\s*["'`]status["'`]\s*,/.test(c.args),
    );
    if (guarded) continue;
    const what = opaque
      ? `opaque:${upd.args.trim().replace(/\s+/g, " ").slice(0, 30)}`
      : lifecycle.join("+");
    const base = `client:${relPath}::${what}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const line = src.slice(0, m.index).split("\n").length;
    hits.push({ key: n === 1 ? base : `${base}#${n}`, file: relPath, line });
  }
  return hits;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "node_modules" || name === "test" || name === "__tests__") continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) && !name.endsWith(".d.ts")) {
      out.push(p);
    }
  }
  return out;
}

export function clientHits(root = join(REPO, "src")) {
  return walk(root).flatMap((p) =>
    clientHitsInSource(relative(REPO, p).split("\\").join("/"), readFileSync(p, "utf8")),
  );
}

// ─── BASELINE ────────────────────────────────────────────────────────────

export function loadBaseline() {
  return JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
}

export function compare(hits, baseline) {
  const hitKeys = new Set(hits.map((h) => h.key));
  const allowed = Object.keys(baseline.allow);
  return {
    unexpected: hits.filter((h) => !(h.key in baseline.allow)),
    stale: allowed.filter((k) => !hitKeys.has(k)),
  };
}

export function allHits({ exclude = [] } = {}) {
  return [...sqlHits(readMigrations({ exclude })), ...clientHits()];
}

function main() {
  const args = process.argv.slice(2);
  const exclude = [];
  for (let i = 0; i < args.length; i++) if (args[i] === "--exclude-migration") exclude.push(args[++i]);
  const hits = allHits({ exclude });
  if (args.includes("--list")) {
    for (const h of hits) console.log(h.key, h.line ? `(line ${h.line})` : `(${h.file})`);
    console.error(`${hits.length} hit(s)`);
    return;
  }
  const { unexpected, stale } = compare(hits, loadBaseline());
  for (const h of unexpected) {
    console.error(
      `::error::race-class NEW HIT ${h.key} ${h.line ? `${h.file}:${h.line}` : `(latest definition in ${h.file})`}`,
    );
  }
  for (const k of stale) {
    console.error(
      `::error::race-class baseline entry no longer matches — delete it from scripts/race-class-baseline.json: ${k}`,
    );
  }
  if (unexpected.length || stale.length) {
    console.error(
      '\nA public.jobs read that decides a write must lock it (FOR SHARE / FOR UPDATE); a client lifecycle UPDATE on jobs must carry .eq("status", …). See migration 20260913014328.',
    );
    process.exit(1);
  }
  console.log(`race-class: ${hits.length} hit(s), all baselined with reasons; 0 new, 0 stale`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
