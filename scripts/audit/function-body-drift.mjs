#!/usr/bin/env node
/**
 * Function-body drift: does prod RUN the function body the newest migration
 * defines?
 *
 * WHY (2026-09-15). db-drift-detect compares migration VERSIONS, and every
 * repo-side guard (jobsGuardRpcParity, raceClassGuard, …) reads the newest
 * migration FILE. Both were green while prod's report_helper_no_show was a
 * superseded body: 20260915044137 added an "already arrived" guard, then
 * 20260914215112 — older timestamp, applied later — replaced the function.
 * schema_migrations listed both, the repo's newest file had the guard, and prod
 * let a poster strike a Helpr who had arrived. Nothing compared the body that
 * runs with the body the repo says runs.
 *
 * WHAT. Every `CREATE [OR REPLACE] FUNCTION|PROCEDURE [public.]<name>(<args>)
 * … AS $tag$…$tag$` and `DROP FUNCTION` in supabase/migrations is replayed in
 * version order, per name + input signature. Each body is compared with prod's
 * prosrc after removing `--` comments and collapsing whitespace (comment-only
 * differences are not drift). Outcomes:
 *   stale     prod runs a body an OLDER migration wrote — FAIL (the class above)
 *   missing   the newest migration defines it, prod has no such function — FAIL
 *   present   the newest migration drops it, prod still has it — FAIL
 *   unmatched prod's body matches no migration's text — FAIL. Differences only
 *             in notification-link literals are NOT drift: 20260831232514 and
 *             20260901021929 rewrite links in place with regexp_replace over
 *             pg_get_functiondef.
 * In-place rewrites ARE replayed: a migration that rewrites a function through
 * pg_get_functiondef + regexp_replace + EXECUTE, with the
 * (ord, 'fn', $p$pattern$p$, $q$replacement$q$, 'flags') tuples that
 * scripts/lib/functionRewrites.mjs parses, changes the expected body of every
 * overload of `fn` at that point in the replay, exactly as Postgres would (the
 * same parser src/test/helpers/effectiveFunctionDefs.ts uses). Until
 * 2026-09-26 only link literals were tolerated, so 20260925143327 (role-neutral
 * notification copy in 11 functions, applied on prod exactly as written) read as
 * 11 "unmatched" bodies every night (issue #1802).
 * A stale/unmatched body can be accepted in function-body-drift.baseline.json,
 * pinned to prod's exact md5(prosrc) with a reason; if prod's body changes the
 * entry stops matching and the check fails again.
 *
 * Limits: bodies created only inside EXECUTE strings are not seen, other than
 * by the rewrite tuples above (applied to the body, where Postgres applies them
 * to the whole pg_get_functiondef — the same thing unless a pattern matches the
 * header); a signature
 * this parser cannot normalise falls back to name matching when both sides
 * have exactly one overload.
 *
 * Usage:
 *   node scripts/audit/function-body-drift.mjs               # query prod (supabase CLI, linked)
 *   node scripts/audit/function-body-drift.mjs --live f.json # rows of LIVE_SQL from a file
 * Exit 0 = no drift, 1 = drift, 2 = the check could not run.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseRewriteTuples, pgRegexpReplace } from "../lib/functionRewrites.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MIG_DIR = path.join(ROOT, "supabase/migrations");

const BASELINE_PATH = path.join(ROOT, "scripts/audit/function-body-drift.baseline.json");

const md5 = (s) => crypto.createHash("md5").update(s, "utf8").digest("hex");
/** Must stay identical to the SQL in LIVE_SQL: drop `--` comments, collapse whitespace. */
export const normalizeBody = (s) => s.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim();
const nmd5 = (s) => md5(normalizeBody(s));
/**
 * Notification links are rewritten in place by dynamic-SQL migrations
 * (20260831232514, 20260901021929: regexp_replace over pg_get_functiondef), so
 * a live body can legitimately differ from its newest CREATE only in link
 * literals such as '/posts' -> '/posts?job=' || v_job.id::text.
 */
export const linkNormalize = (s) =>
  normalizeBody(s)
    .replace(/'\/[^']*'(\s*\|\|\s*[a-z_][a-z0-9_.]*::text)?/gi, "'<link>'")
    .replace(/format\('<link>'/g, "format('<link>'");

export const LIVE_SQL =
  "select p.proname, oidvectortypes(p.proargtypes) as sig, p.prosrc " +
  "from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f','p')";

/** Live rows as the diff wants them. */
export const hashLive = (rows) =>
  rows.map((r) => ({ proname: r.proname, sig: r.sig, md5: md5(r.prosrc), nmd5: nmd5(r.prosrc), lmd5: md5(linkNormalize(r.prosrc)) }));

/** Is `index` inside a `--` line comment? (Good enough for statement starts.) */
function inLineComment(text, index) {
  const lineStart = text.lastIndexOf("\n", index - 1) + 1;
  return text.slice(lineStart, index).includes("--");
}

const TYPE_ALIASES = {
  int: "integer", int4: "integer", int8: "bigint", int2: "smallint", bool: "boolean",
  timestamptz: "timestamp with time zone", timestamp: "timestamp without time zone",
  varchar: "character varying", float8: "double precision", float4: "real", decimal: "numeric",
  timetz: "time with time zone", time: "time without time zone",
};
const TYPE_WORDS = new Set([
  "integer", "bigint", "smallint", "boolean", "text", "uuid", "numeric", "jsonb", "json", "date", "real",
  "double", "character", "timestamp", "time", "interval", "bytea", "inet", "void", "trigger", "record",
  "setof", "anyelement", "tsvector", "geography", "geometry", "point", "oid", "regclass", "name", "citext",
  ...Object.keys(TYPE_ALIASES),
]);

/** Split on top-level commas. */
function splitArgs(list) {
  const out = [];
  let depth = 0, cur = "";
  for (const ch of list.replace(/--[^\n]*/g, "")) {
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** "p_job_id uuid, p_lat numeric DEFAULT NULL" -> "uuid,numeric" (input types only, as pg's oidvectortypes). */
export function normalizeSignature(list) {
  const types = [];
  for (let arg of splitArgs(list)) {
    arg = arg.replace(/\s+(DEFAULT|=)\s[\s\S]*$/i, "").replace(/--[^\n]*/g, "").trim().toLowerCase().replace(/"/g, "");
    if (!arg) continue;
    let words = arg.split(/\s+/);
    if (words[0] === "out") continue;
    if (["in", "inout", "variadic"].includes(words[0])) words = words.slice(1);
    if (words.length > 1 && !TYPE_WORDS.has(words[0].replace(/\[\]$/, "").replace(/\(.*$/, "").replace(/^public\./, ""))) words = words.slice(1);
    let t = words.join(" ").replace(/^public\./, "").replace(/\s*\(\s*[\d\s,]+\)/g, "");
    const arr = t.endsWith("[]") ? "[]" : "";
    t = t.replace(/\[\]$/, "");
    types.push((TYPE_ALIASES[t] ?? t) + arr);
  }
  return types.join(",");
}

/** The text of the parenthesised list starting at `open` (index of "("), and the index after ")". */
function parenList(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return { list: text.slice(open + 1, i), after: i + 1 };
  }
  return null;
}

/**
 * Every public function definition and drop in one migration, in file order.
 * Unqualified names count as public (this project's search_path).
 * A rewrite tuple is a `rewrite` event on every overload of its function.
 * @returns {{kind: "create"|"drop"|"rewrite", name: string, sig: string|null, body?: string, at: number, ord?: number, pattern?: string, replacement?: string, flags?: string}[]}
 */
export function extractFunctionEvents(text) {
  const events = [];
  const createRe = /CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\s+(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?\s*\(/gi;
  for (let m; (m = createRe.exec(text)); ) {
    if (inLineComment(text, m.index)) continue;
    // Another schema (`auth.x`, `private.x`) is not public.
    if (/[a-z_"]\.\s*$/i.test(text.slice(m.index, m.index + m[0].length - m[1].length - 1).replace(/"?public"?\.$/i, "")) && !/public"?\.\s*"?$/i.test(text.slice(0, m.index + m[0].length - m[1].length - 1))) continue;
    const args = parenList(text, createRe.lastIndex - 1);
    if (!args) continue;
    // The body is the first dollar-quoted string after the header: `AS $tag$`.
    const asRe = /\bAS\s+(\$[A-Za-z_0-9]*\$)/gi;
    asRe.lastIndex = args.after;
    const as = asRe.exec(text);
    if (!as) continue;
    // A header that runs into another statement is not this function's body.
    if (text.slice(args.after, as.index).includes(";")) continue;
    const tag = as[1];
    const start = as.index + as[0].length;
    const end = text.indexOf(tag, start);
    if (end < 0) continue;
    events.push({ kind: "create", name: m[1].toLowerCase(), sig: normalizeSignature(args.list), body: text.slice(start, end), at: m.index });
    createRe.lastIndex = end + tag.length;
  }
  const dropRe = /DROP\s+(?:FUNCTION|PROCEDURE)\s+(?:IF\s+EXISTS\s+)?(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?\s*(\()?/gi;
  for (let m; (m = dropRe.exec(text)); ) {
    if (inLineComment(text, m.index)) continue;
    const args = m[2] ? parenList(text, dropRe.lastIndex - 1) : null;
    events.push({ kind: "drop", name: m[1].toLowerCase(), sig: args ? normalizeSignature(args.list) : null, at: m.index });
  }
  // In-place rewrites run when their DO block runs: all at once, in `ord` order.
  const tuples = parseRewriteTuples(text).filter((t) => !inLineComment(text, t.index));
  const rewriteAt = tuples.length ? Math.min(...tuples.map((t) => t.index)) : 0;
  for (const t of tuples) {
    events.push({ kind: "rewrite", name: t.fn, sig: null, ord: t.ord, pattern: t.pattern, replacement: t.replacement, flags: t.flags, at: rewriteAt });
  }
  // Stable sort: rewrites sharing `at` keep their `ord` order.
  return events.sort((a, b) => a.at - b.at);
}

/**
 * "name(sig)" -> {name, sig, state: "defined", md5, version, history} | {…, state: "dropped"}.
 * `history` is every md5 an earlier migration gave that function.
 */
export function expectedFunctions(migDir = MIG_DIR) {
  const files = fs.readdirSync(migDir).filter((f) => /^\d{14}_.+\.sql$/.test(f)).sort();
  const expected = new Map();
  const history = new Map();
  for (const f of files) {
    const version = f.slice(0, 14);
    const text = fs.readFileSync(path.join(migDir, f), "utf8");
    for (const e of extractFunctionEvents(text)) {
      if (e.kind === "rewrite") {
        for (const [key, v] of expected) {
          if (v.name !== e.name || v.state !== "defined") continue;
          const body = pgRegexpReplace(v.body, e.pattern, e.replacement, e.flags);
          if (body === v.body) continue; // pattern no longer matches: Postgres changes nothing
          const h = nmd5(body);
          const prior = history.get(e.name) ?? new Set();
          prior.add(v.md5);
          expected.set(key, { ...v, body, md5: h, lmd5: md5(linkNormalize(body)), version, history: new Set([...prior].filter((x) => x !== h)), rewrites: [...(v.rewrites ?? []), `${version}#${e.ord}`] });
          // A later CREATE makes this body OLDER, so prod still running it reads as stale.
          prior.add(h);
          history.set(e.name, prior);
        }
        continue;
      }
      if (e.kind === "drop") {
        for (const [key, v] of expected) {
          if (v.name === e.name && (e.sig === null || v.sig === e.sig)) expected.set(key, { ...v, state: "dropped", version });
        }
        continue;
      }
      const key = `${e.name}(${e.sig})`;
      const h = nmd5(e.body);
      const prior = history.get(e.name) ?? new Set();
      expected.set(key, { name: e.name, sig: e.sig, state: "defined", body: e.body, md5: h, lmd5: md5(linkNormalize(e.body)), version, history: new Set(prior), rewrites: [] });
      prior.add(h);
      history.set(e.name, prior);
    }
  }
  return expected;
}

/**
 * @param live {proname: string, sig: string, md5: string}[]
 * Kinds: "stale" — prod runs a body an OLDER migration wrote (the 2026-09-15 class);
 * "missing" / "present" — defined-but-absent / dropped-but-live;
 * "unmatched" — prod's body matches no body any migration wrote (patched by
 * dynamic SQL, or by hand): reported against a baseline, not failed outright.
 */
export function diffFunctions(expected, live, baseline = {}) {
  const liveByKey = new Map(live.map((r) => [`${r.proname}(${normalizeSignature(r.sig)})`, r]));
  const liveByName = new Map();
  for (const r of live) liveByName.set(r.proname, [...(liveByName.get(r.proname) ?? []), r]);
  const drift = [];
  for (const [key, exp] of expected) {
    let row = liveByKey.get(key);
    const accepted = (r) => !!r && baseline[key]?.md5 === r.md5;
    // Signature spelling this parser can't normalise: one overload each side is the same function.
    const sameName = [...expected.values()].filter((v) => v.name === exp.name && v.state === "defined");
    if (!row && sameName.length === 1 && (liveByName.get(exp.name) ?? []).length === 1) row = liveByName.get(exp.name)[0];
    if (exp.state === "dropped") {
      if (row && !sameName.some((v) => liveByKey.get(`${v.name}(${v.sig})`) === row)) {
        drift.push({ key, name: exp.name, version: exp.version, kind: "present", problem: `dropped by ${exp.version}, but present live` });
      }
    } else if (!row) {
      drift.push({ key, name: exp.name, version: exp.version, kind: "missing", problem: `defined by ${exp.version}, but absent live` });
    } else if (row.nmd5 !== exp.md5 && !accepted(row)) {
      const stale = exp.history.has(row.nmd5);
      if (!stale && row.lmd5 === exp.lmd5) continue; // link literals rewritten in place

      drift.push({
        key, name: exp.name, version: exp.version, kind: stale ? "stale" : "unmatched",
        problem: stale
          ? `prod runs an OLDER migration's body, not ${exp.version}'s (out-of-order apply or a later overwrite)`
          : `prod's body matches no migration's body (newest: ${exp.version}) — patched by dynamic SQL or by hand`,
      });
    }
  }
  return drift.sort((a, b) => a.key.localeCompare(b.key));
}

function fetchLive() {
  const raw = execFileSync("supabase", ["db", "query", "--linked", "-o", "json", LIVE_SQL], {
    cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "inherit"],
  });
  // Shapes seen: {rows:[…]} locally, a bare […] in CI (same as write-contract.mjs).
  const start = Math.min(...["{", "["].map((c) => raw.indexOf(c)).filter((i) => i >= 0));
  const parsed = JSON.parse(raw.slice(start, Math.max(raw.lastIndexOf("}"), raw.lastIndexOf("]")) + 1));
  const rows = Array.isArray(parsed) ? parsed : parsed.rows;
  if (!Array.isArray(rows) || rows.length < 50 || typeof rows[0].prosrc !== "string") throw new Error(`live function list looks wrong (${rows?.length ?? "no"} rows)`);
  return hashLive(rows);
}

export function loadBaseline(p = BASELINE_PATH) {
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")).accepted ?? {} : {};
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  let live;
  try {
    const i = process.argv.indexOf("--live");
    live = i > 0 ? hashLive(JSON.parse(fs.readFileSync(process.argv[i + 1], "utf8"))) : fetchLive();
  } catch (e) {
    console.error(`::error::function-body-drift could not read prod's functions: ${e.message}`);
    process.exit(2);
  }
  const expected = expectedFunctions();
  // FLOOR (Q52, 2026-09-23). diffFunctions walks the EXPECTED side, so a
  // migration parser that read nothing would compare nothing and print OK.
  // The repo defines hundreds of public functions; under 50 is a broken parse.
  if (expected.size < 50) {
    console.error(`::error::function-body-drift parsed only ${expected.size} function signatures from supabase/migrations — refusing to report clean.`);
    process.exit(2);
  }
  const baseline = loadBaseline();
  const drift = diffFunctions(expected, live, baseline);
  console.log(`function-body-drift: ${expected.size} function signatures from migrations, ${live.length} live in public, ${Object.keys(baseline).length} baselined`);
  // An accepted entry is spent once prod's body changed or the newest migration now matches it.
  // TWO-WAY (was a printed `note:` that exited 0 until 2026-09-22, so a spent
  // entry could sit in the baseline forever): a spent entry FAILS the run.
  const liveByKey = new Map(live.map((r) => [`${r.proname}(${normalizeSignature(r.sig)})`, r]));
  const staleEntries = Object.entries(baseline)
    .filter(([key, entry]) => {
      const row = liveByKey.get(key);
      return !row || row.md5 !== entry.md5 || row.nmd5 === expected.get(key)?.md5;
    })
    .map(([key]) => key);
  for (const key of staleEntries) {
    console.log(`::error::stale baseline entry ${key} — remove it (lower the baseline) from scripts/audit/function-body-drift.baseline.json: it is no longer needed or no longer matches prod`);
  }
  if (staleEntries.length) process.exit(1);
  if (!drift.length) {
    console.log("OK: prod runs the newest migration's body for every function (baselined drift excepted)");
    process.exit(0);
  }
  for (const d of drift) console.log(`::error::function-body-drift ${d.kind} ${d.key}: ${d.problem}`);
  process.exit(1);
}
