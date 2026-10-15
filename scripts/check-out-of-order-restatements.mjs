#!/usr/bin/env node
/**
 * An OLDER migration on a branch must not restate an object that a NEWER
 * migration already on main restates.
 *
 *   node scripts/check-out-of-order-restatements.mjs [--base <ref>] [--head <ref>]
 *
 * --base defaults to origin/main, --head to HEAD. Exit 1 on a conflict, 2 when
 * git cannot answer (an unknown ref is never "no conflicts").
 *
 * WHY. db-deploy.yml runs `supabase db push --include-all`. That flag applies a
 * pending migration even when its version is LOWER than versions prod already
 * has, and it applies it NOW, i.e. after them. A fresh replay (PGlite, a
 * restore, `supabase db reset`) applies the same files in version order. So when
 * a branch carries 20261014210518 that restates public.export_my_data(), and
 * main already has the newer 20261015052622 restating it too:
 *   - prod:   ...052622 (applied earlier), then ...210518 (applied last)
 *             -> prod keeps the OLDER body and silently loses 052622's change;
 *   - replay: ...210518, then ...052622 -> the newer body.
 * Prod and the repo disagree, and nothing reds. The real case (2026-10-15):
 * ready/declutter-4 restated export_my_data in three migrations older than
 * main's 20261015052622_export_my_data_category_suggestions.sql (trades,
 * PR #3138); landed as is, prod would have dropped the category_suggestions
 * section of the data export.
 *
 * WHAT IT CHECKS. Every migration ADDED on --head since its merge-base with
 * --base whose version is lower than --base's newest version (an out-of-order
 * file). For each, the objects it touches: functions and procedures it CREATEs
 * (with or without OR REPLACE) or DROPs, views (incl. materialized) it CREATEs
 * or DROPs, and triggers it CREATEs or DROPs. A DROP counts as touching the
 * object: an older file dropping what a newer file creates (or creating what a
 * newer file drops) diverges the same way. The file conflicts with every
 * migration on --base that is NEWER than it and touches the same object,
 * unless both only DROP it (absent in either order).
 *
 * A conflict is cleared by the reconcile pattern: another migration added on
 * --head, newer than the conflicting base migration, that touches the same
 * object. It runs last on prod and last in a replay, so both end with its body
 * (it must restate the UNION of both changes; this script cannot judge bodies).
 *
 * OVERLOADS. Functions are keyed by schema, name AND argument types (the
 * identity signature: OUT arguments, argument names and DEFAULTs dropped, type
 * spellings normalised, so `integer`/`int4`/`int` and `timestamp with time
 * zone`/`timestamptz` are one type). A DROP FUNCTION without an argument list
 * matches every overload of that name. Views and triggers are keyed by name
 * (triggers by table + name).
 *
 * WHAT IT READS. Comments and single-quoted string literals are blanked first
 * (a COMMENT ON ... IS '... CREATE OR REPLACE FUNCTION public.x ...' is prose,
 * not DDL). Dollar-quoted bodies are read, so DDL inside a DO block or an
 * EXECUTE $q$...$q$ counts. DDL built inside a single-quoted EXECUTE string or
 * a format() call is not seen (1 of 1,096 migrations used EXECUTE '...' DDL on
 * 2026-10-15, measured by grep).
 *
 * Wired in: scripts/land.sh (on the rebased tree, base origin/main) and
 * .github/workflows/migration-lint.yml (PR base on pull_request; the pushed
 * range when db-deploy calls it, so a conflict that reaches main still stops
 * the prod push). Guard: src/test/outOfOrderRestatements.test.ts.
 */
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { stripSqlComments } from "./check-migration-rls.mjs";
import { FILENAME } from "./check-migration-versions.mjs";

const MIGRATIONS = "supabase/migrations";
const DOLLAR_TAG = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/;

/**
 * Blank the body of every single-quoted literal (keeping the quotes and the
 * length), recursing into dollar-quoted bodies, which are SQL. Run AFTER
 * stripSqlComments, so no comment can open a false literal.
 */
export function blankSqlStrings(sql) {
  let out = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    if (c === "'") {
      const escapes = i > 0 && /[eE]/.test(sql[i - 1]) && !/[A-Za-z0-9_]/.test(sql[i - 2] ?? "");
      let j = i + 1;
      while (j < n) {
        if (escapes && sql[j] === "\\") { j += 2; continue; }
        if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue; }
        if (sql[j] === "'") break;
        j++;
      }
      const end = Math.min(j, n);
      out += "'" + sql.slice(i + 1, end).replace(/[^\n]/g, " ") + (j < n ? "'" : "");
      i = j + 1;
      continue;
    }
    if (c === '"') {
      const end = sql.indexOf('"', i + 1);
      const j = end === -1 ? n : end + 1;
      out += sql.slice(i, j);
      i = j;
      continue;
    }
    if (c === "$" && !/[A-Za-z0-9_]/.test(sql[i - 1] ?? "")) {
      const m = DOLLAR_TAG.exec(sql.slice(i, i + 66));
      if (m) {
        const tag = m[0];
        const close = sql.indexOf(tag, i + tag.length);
        const bodyEnd = close === -1 ? n : close;
        out += tag + blankSqlStrings(sql.slice(i + tag.length, bodyEnd));
        if (close !== -1) out += tag;
        i = close === -1 ? n : close + tag.length;
        continue;
      }
    }
    out += c;
    i++;
  }
  return out;
}

const IDENT = String.raw`(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)`;
const QNAME = String.raw`(?:(${IDENT})\s*\.\s*)?(${IDENT})`;
const unquote = (s) => (s.startsWith('"') ? s.slice(1, -1) : s.toLowerCase());

const CREATE_FUNCTION = new RegExp(String.raw`\bcreate\s+(?:or\s+replace\s+)?(?:function|procedure)\s+${QNAME}\s*\(`, "gi");
const DROP_FUNCTION = new RegExp(String.raw`\bdrop\s+(?:function|procedure)\s+(?:if\s+exists\s+)?`, "gi");
const CREATE_VIEW = new RegExp(
  String.raw`\bcreate\s+(?:or\s+replace\s+)?(?:recursive\s+)?(?:materialized\s+)?view\s+(?:if\s+not\s+exists\s+)?${QNAME}`,
  "gi",
);
const DROP_VIEW = new RegExp(String.raw`\bdrop\s+(?:materialized\s+)?view\s+(?:if\s+exists\s+)?`, "gi");
const CREATE_TRIGGER = new RegExp(
  String.raw`\bcreate\s+(?:or\s+replace\s+)?(?:constraint\s+)?trigger\s+(${IDENT})\s[^;]*?\bon\s+${QNAME}`,
  "gi",
);
const DROP_TRIGGER = new RegExp(String.raw`\bdrop\s+trigger\s+(?:if\s+exists\s+)?(${IDENT})\s+on\s+${QNAME}`, "gi");

/** Index just past the `)` matching the `(` at `open`, or -1. */
function closeParen(sql, open) {
  let depth = 0;
  for (let i = open; i < sql.length; i++) {
    if (sql[i] === "(") depth++;
    else if (sql[i] === ")" && --depth === 0) return i + 1;
  }
  return -1;
}

/** Split on commas at paren depth 0. */
function splitTop(s) {
  const parts = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) { parts.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

const MULTI_WORD_TYPES = [
  [/\bdouble\s+precision\b/g, "float8"],
  [/\bcharacter\s+varying\b/g, "varchar"],
  [/\btimestamp\s+with\s+time\s+zone\b/g, "timestamptz"],
  [/\btimestamp\s+without\s+time\s+zone\b/g, "timestamp"],
  [/\btime\s+with\s+time\s+zone\b/g, "timetz"],
  [/\btime\s+without\s+time\s+zone\b/g, "time"],
  [/\bbit\s+varying\b/g, "varbit"],
];
const TYPE_ALIASES = new Map([
  ["integer", "int4"], ["int", "int4"], ["bigint", "int8"], ["smallint", "int2"],
  ["boolean", "bool"], ["real", "float4"], ["decimal", "numeric"],
  ["character", "bpchar"], ["char", "bpchar"],
]);
const MODES = new Set(["in", "out", "inout", "variadic"]);

/** One argument's identity type, or null for an OUT argument (not part of the signature). */
export function argIdentityType(arg) {
  let a = arg.toLowerCase();
  // Cut the default: `DEFAULT expr` or `= expr` at the top level.
  const def = /\s(?:default)\s|=/.exec(a);
  if (def) a = a.slice(0, def.index);
  a = a.replace(/\(\s*[\d\s,]*\)/g, " "); // numeric(10,2), varchar(255)
  for (const [re, short] of MULTI_WORD_TYPES) a = a.replace(re, short);
  a = a.replace(/\s+\[/g, "[").replace(/"/g, "").trim();
  const tokens = a.split(/\s+/).filter(Boolean);
  if (tokens.length && MODES.has(tokens[0]) && tokens.length > 1) {
    const mode = tokens.shift();
    if (mode === "out") return null;
  }
  let type = tokens.length >= 2 ? tokens.slice(1).join(" ") : (tokens[0] ?? "");
  type = type.replace(/^public\./, "");
  const arr = /(\[\])+$/.exec(type)?.[0] ?? "";
  const bare = arr ? type.slice(0, -arr.length) : type;
  return (TYPE_ALIASES.get(bare) ?? bare) + arr;
}

/** `int4,text` for an argument list's text (between the parens). */
export function identitySignature(argList) {
  return splitTop(argList)
    .map(argIdentityType)
    .filter((t) => t !== null)
    .join(",");
}

function fnObject(schema, name, args, via) {
  const s = schema ? unquote(schema) : "public";
  const n = unquote(name);
  return { kind: "function", base: `${s}.${n}`, args, via, label: `${s}.${n}(${args ?? "*any overload*"})` };
}

/**
 * Every function, view and trigger the migration text CREATEs or DROPs.
 * `args` is the identity signature, or null for a name-only DROP (matches
 * every overload).
 */
export function touchedObjects(sqlText) {
  const sql = blankSqlStrings(stripSqlComments(sqlText));
  const out = [];
  for (const m of sql.matchAll(CREATE_FUNCTION)) {
    const open = m.index + m[0].length - 1;
    const close = closeParen(sql, open);
    if (close === -1) continue;
    out.push(fnObject(m[1], m[2], identitySignature(sql.slice(open + 1, close - 1)), "create"));
  }
  for (const m of sql.matchAll(DROP_FUNCTION)) {
    // DROP FUNCTION [IF EXISTS] a(args), b, c(args) [CASCADE|RESTRICT];
    let i = m.index + m[0].length;
    const item = new RegExp(String.raw`^\s*${QNAME}\s*`, "i");
    for (;;) {
      const it = item.exec(sql.slice(i));
      if (!it) break;
      i += it[0].length;
      let args = null;
      if (sql[i] === "(") {
        const close = closeParen(sql, i);
        if (close === -1) break;
        args = identitySignature(sql.slice(i + 1, close - 1));
        i = close;
      }
      out.push(fnObject(it[1], it[2], args, "drop"));
      const comma = /^\s*,/.exec(sql.slice(i));
      if (!comma) break;
      i += comma[0].length;
    }
  }
  const view = (schema, name, via) => {
    const s = schema ? unquote(schema) : "public";
    const n = unquote(name);
    return { kind: "view", base: `${s}.${n}`, args: null, via, label: `${s}.${n} (view)` };
  };
  for (const m of sql.matchAll(CREATE_VIEW)) out.push(view(m[1], m[2], "create"));
  for (const m of sql.matchAll(DROP_VIEW)) {
    let i = m.index + m[0].length;
    const item = new RegExp(String.raw`^\s*${QNAME}\s*(,)?`, "i");
    for (;;) {
      const it = item.exec(sql.slice(i));
      if (!it) break;
      out.push(view(it[1], it[2], "drop"));
      i += it[0].length;
      if (!it[3]) break;
    }
  }
  const trigger = (tname, schema, table, via) => {
    const s = schema ? unquote(schema) : "public";
    const key = `${s}.${unquote(table)}.${unquote(tname)}`;
    return { kind: "trigger", base: key, args: null, via, label: `trigger ${unquote(tname)} on ${s}.${unquote(table)}` };
  };
  for (const m of sql.matchAll(CREATE_TRIGGER)) out.push(trigger(m[1], m[2], m[3], "create"));
  for (const m of sql.matchAll(DROP_TRIGGER)) out.push(trigger(m[1], m[2], m[3], "drop"));
  return out;
}

/** Same object? A null (name-only) function signature matches every overload. */
export function sameObject(a, b) {
  if (a.kind !== b.kind || a.base !== b.base) return false;
  if (a.kind !== "function") return true;
  return a.args === null || b.args === null || a.args === b.args;
}

const versionOf = (file) => FILENAME.exec(file.split("/").pop())?.[1] ?? null;

/**
 * The pure check.
 *   added: [{ file, sql }]  migrations added on the branch (not on base)
 *   base:  [{ file, sql }]  migrations on base; only files newer than the
 *                           oldest added one can matter, so a caller may pass
 *                           just those (the newest base file must be among them)
 * Returns [{ older, newer, object }] for every uncleared conflict.
 */
export function outOfOrderRestatements({ added, base }) {
  const baseNewest = base.map((b) => versionOf(b.file)).filter(Boolean).sort().pop() ?? null;
  if (!baseNewest) return [];
  const addedObjs = added.map((a) => ({ ...a, version: versionOf(a.file), objects: touchedObjects(a.sql) }));
  const baseObjs = base.map((b) => ({ ...b, version: versionOf(b.file) })).filter((b) => b.version);
  const parsedBase = new Map();
  const objectsOf = (b) => {
    if (!parsedBase.has(b.file)) parsedBase.set(b.file, touchedObjects(b.sql));
    return parsedBase.get(b.file);
  };
  const conflicts = [];
  for (const a of addedObjs) {
    // The out-of-order test: older than the newest migration base already has.
    if (!a.version || a.version >= baseNewest) continue;
    const seen = new Set();
    for (const b of baseObjs) {
      // Fast path only: the reconcile test below would clear an older b anyway
      // (a itself is newer than it), so this line carries no rule of its own.
      if (b.version <= a.version) continue;
      for (const o of a.objects) {
        const hits = objectsOf(b).filter((x) => sameObject(o, x));
        if (hits.length === 0) continue;
        // Both sides only DROP it: absent either way round, so no divergence
        // (both declutter-4 and trades `DROP FUNCTION IF EXISTS export_my_data()`).
        const aCreates = a.objects.some((x) => x.via === "create" && sameObject(o, x));
        if (!aCreates && hits.every((x) => x.via === "drop")) continue;
        // Reconcile: a branch migration newer than b that touches the object.
        const reconciled = addedObjs.some((r) => r.version > b.version && r.objects.some((x) => sameObject(o, x)));
        if (reconciled) continue;
        const key = `${b.file}|${o.label}`;
        if (seen.has(key)) continue;
        seen.add(key);
        conflicts.push({ older: a.file, newer: b.file, object: o.label });
      }
    }
  }
  return conflicts;
}

/** Human-readable failure lines, naming both files and the fix. */
export function describeConflicts(conflicts, baseRef = "origin/main") {
  const lines = [];
  for (const c of conflicts) {
    lines.push(
      `::error file=${c.older}::${c.older.split("/").pop()} restates ${c.object}, but ${baseRef}'s NEWER ` +
        `${c.newer.split("/").pop()} already restates it.`,
    );
  }
  if (conflicts.length) {
    lines.push(
      "",
      "db-deploy runs `supabase db push --include-all`, which applies an out-of-order migration AFTER the newer",
      "ones prod already has: prod would end with the OLDER definition and silently lose the newer change, while",
      "a fresh replay (version order) ends with the newer one.",
      "Fix, either:",
      "  1. add a reconcile migration with the NEWEST timestamp (`npm run migration:new -- <slug>`) that restates",
      "     the UNION of both definitions (the newer file's change AND this branch's), or",
      "  2. re-timestamp this branch's migrations (`npm run migration:new` stamps) so they sort after",
      `     every migration on ${baseRef}, then merge in the newer file's change by hand.`,
    );
  }
  return lines;
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}

function parseArgs(argv) {
  const opts = { base: "origin/main", head: "HEAD" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--base") opts.base = argv[++i];
    else if (argv[i] === "--head") opts.head = argv[++i];
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  if (!opts.base || !opts.head) throw new Error("--base and --head need a ref");
  return opts;
}

function main() {
  let opts;
  let added;
  let base;
  try {
    opts = parseArgs(process.argv.slice(2));
    const mergeBase = git(["merge-base", opts.base, opts.head]).trim();
    const baseFiles = git(["ls-tree", "--name-only", `${opts.base}:${MIGRATIONS}`])
      .split("\n")
      .filter((f) => FILENAME.test(f));
    if (baseFiles.length === 0) throw new Error(`${opts.base} has no migrations under ${MIGRATIONS}`);
    const onBase = new Set(baseFiles);
    const addedFiles = git(["diff", "--name-only", "--no-renames", "--diff-filter=A", mergeBase, opts.head, "--", MIGRATIONS])
      .split("\n")
      .filter((p) => p.endsWith(".sql") && FILENAME.test(p.split("/").pop()))
      .filter((p) => !onBase.has(p.split("/").pop()));
    added = addedFiles.map((p) => ({ file: p, sql: git(["show", `${opts.head}:${p}`]) }));
    const oldest = added.map((a) => versionOf(a.file)).sort()[0];
    base = oldest
      ? baseFiles
          .filter((f) => versionOf(f) > oldest)
          .map((f) => ({ file: `${MIGRATIONS}/${f}`, sql: git(["show", `${opts.base}:${MIGRATIONS}/${f}`]) }))
      : [];
  } catch (e) {
    console.error(`::error::check-out-of-order-restatements: could not read the migrations: ${e.message}`);
    process.exit(2);
  }
  const conflicts = outOfOrderRestatements({ added, base });
  for (const l of describeConflicts(conflicts, opts.base)) console.error(l);
  const outOfOrder = added.filter((a) => base.length && versionOf(a.file) < base.map((b) => versionOf(b.file)).sort().pop());
  console.log(
    `out-of-order-restatements: ${added.length} migration(s) added on ${opts.head} since its merge-base with ` +
      `${opts.base}, ${outOfOrder.length} older than its newest; ${conflicts.length} conflict(s).`,
  );
  process.exit(conflicts.length ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
