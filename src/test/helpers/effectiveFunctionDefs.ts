/*
 * The definition of each SQL function the migrations actually leave in the
 * database — which is NOT always the newest `CREATE FUNCTION` text.
 *
 * Two migrations (20260831232514, 20260901021929) changed notification links
 * by reading `pg_get_functiondef()`, running `regexp_replace` over it and
 * EXECUTE-ing the result. After them, the newest textual definition of e.g.
 * notify_poster_on_status_change still writes '/posts?filter=scheduled',
 * while the database writes '/posts?job=' || NEW.id::text. A restatement
 * copied from the newest TEXT silently undoes the rewrite (Q139, 2026-09-23:
 * a branch restated 16 functions that way and reverted 11 direct links).
 *
 * effectiveDefs() replays every migration in order: a CREATE [OR REPLACE]
 * FUNCTION (any dollar-quote tag, including one nested in EXECUTE $fn$ … $fn$)
 * sets the definition, and a rewrite tuple
 *   (ord, 'fn', $p$pattern$p$, $q$replacement$q$, 'flags')
 * inside a pg_get_functiondef + regexp_replace DO block is applied to it, in
 * `ord` order, exactly as Postgres would (a function that does not exist yet
 * is skipped). The tuple parser and the regexp_replace emulation live in
 * scripts/lib/functionRewrites.mjs, shared with the nightly prod check
 * scripts/audit/function-body-drift.mjs. Comments never define anything:
 * definitions and tuples are located on comment-blanked text, and the
 * statement is cut from the raw text at the same offsets.
 *
 * A DROP FUNCTION removes the name (Q730, 2026-09-27: without this, functions
 * dropped by 20260915191403 stayed "live" for every guard built on this
 * helper). Definitions are keyed by name, so a DROP naming an argument list
 * whose count differs from the current definition's is a different overload
 * and leaves it standing; a DROP with no argument list drops the name.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./blankNonCode";
import { parseRewriteTuples, pgRegexpReplace } from "../../../scripts/lib/functionRewrites.mjs";

export interface FnDef {
  /** Migration whose CREATE FUNCTION text is the base. */
  file: string;
  /** Offset of that CREATE in `file`, so two definitions in one file are told apart. */
  index: number;
  /** Raw statement, CREATE … closing tag … `;`, after later rewrites. */
  stmt: string;
  /** Rewrite migrations applied on top of `file`'s text, in order. */
  rewrites: string[];
}

export interface Rewrite {
  file: string;
  ord: number;
  fn: string;
  pattern: string;
  replacement: string;
  flags: string;
}

const DEF = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?(\w+)"?\s*\(/gi;

/** Every CREATE FUNCTION statement in one migration, with its offset. */
export function parseDefs(sql: string): { name: string; index: number; stmt: string }[] {
  const code = blankSqlComments(sql);
  const out: { name: string; index: number; stmt: string }[] = [];
  for (const m of code.matchAll(DEF)) {
    const rest = code.slice(m.index!);
    const open = /\bAS\s+(\$\w*\$)/i.exec(rest);
    if (!open) continue;
    const start = open.index + open[0].length;
    const end = rest.indexOf(open[1], start);
    if (end === -1) continue;
    const close = end + open[1].length;
    const semi = rest.indexOf(";", close);
    const stop = semi === -1 ? close : semi + 1;
    out.push({ name: m[1].toLowerCase(), index: m.index!, stmt: sql.slice(m.index!, m.index! + stop) });
  }
  return out;
}

const DROP = /\bdrop\s+function\s+(?:if\s+exists\s+)?/gi;
const DROP_ITEM = /^\s*(?:public\.)?"?(\w+)"?\s*(\(([^()]*)\))?/i;

/** Split a parenthesised argument list at top-level commas. */
function splitArgs(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of list) {
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((a) => a.trim()).filter(Boolean);
}

/** Number of arguments in a function's call signature (OUT parameters excluded). */
function signatureArgCount(list: string): number {
  return splitArgs(list).filter((a) => !/^out\s/i.test(a)).length;
}

/** Argument count of a CREATE FUNCTION statement's signature, or null when unparsable. */
function defArgCount(stmt: string): number | null {
  const code = blankSqlComments(stmt);
  const open = code.indexOf("(");
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === "(") depth++;
    else if (code[i] === ")" && --depth === 0) return signatureArgCount(code.slice(open + 1, i));
  }
  return null;
}

/**
 * Every DROP FUNCTION target in one migration, with its offset. Text inside a
 * CREATE FUNCTION body (`skip` ranges) is not a migration-level drop.
 */
export function parseDrops(
  sql: string,
  skip: { index: number; end: number }[] = [],
): { name: string; index: number; argCount: number | null }[] {
  const code = blankSqlComments(sql);
  const out: { name: string; index: number; argCount: number | null }[] = [];
  for (const m of code.matchAll(DROP)) {
    const at = m.index!;
    if (skip.some((r) => at >= r.index && at < r.end)) continue;
    let rest = code.slice(at + m[0].length);
    const semi = rest.search(/;|'/);
    if (semi !== -1) rest = rest.slice(0, semi);
    rest = rest.replace(/\s+(cascade|restrict)\s*$/i, "");
    let pos = 0;
    while (pos < rest.length) {
      const item = DROP_ITEM.exec(rest.slice(pos));
      if (!item) break;
      out.push({
        name: item[1].toLowerCase(),
        index: at,
        argCount: item[2] === undefined ? null : signatureArgCount(item[3]),
      });
      pos += item[0].length;
      const comma = /^\s*,/.exec(rest.slice(pos));
      if (!comma) break;
      pos += comma[0].length;
    }
  }
  return out;
}

/** Rewrite tuples of a pg_get_functiondef + regexp_replace migration (shared parser). */
export function parseRewrites(sql: string, file = ""): Rewrite[] {
  return parseRewriteTuples(sql, blankSqlComments(sql), file).map(({ index: _index, ...r }) => r);
}

export function migrationFiles(dir: string): string[] {
  return readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
}

/**
 * name -> effective definition after replaying every migration in `dir`
 * (only those sorting strictly before `before`, when given).
 */
export function effectiveDefs(dir: string, opts: { before?: string } = {}): Map<string, FnDef> {
  const out = new Map<string, FnDef>();
  for (const file of migrationFiles(dir)) {
    if (opts.before && file >= opts.before) break;
    const sql = readFileSync(join(dir, file), "utf8");
    applyMigration(out, file, sql);
  }
  return out;
}

/** Apply one migration's definitions and rewrites, in file order, to `defs`. */
export function applyMigration(defs: Map<string, FnDef>, file: string, sql: string): void {
  const rewrites = parseRewrites(sql, file);
  const rewriteAt = rewrites.length ? blankSqlComments(sql).search(/\$p\$/) : Infinity;
  let rewritten = false;
  const flushRewrites = () => {
    if (rewritten) return;
    rewritten = true;
    for (const r of rewrites) {
      const cur = defs.get(r.fn);
      if (!cur) continue;
      const next = pgRegexpReplace(cur.stmt, r.pattern, r.replacement, r.flags);
      if (next !== cur.stmt) {
        defs.set(r.fn, { ...cur, stmt: next, rewrites: [...cur.rewrites, `${file}#${r.ord}`] });
      }
    }
  };
  const created = parseDefs(sql);
  const bodies = created.map((d) => ({ index: d.index, end: d.index + d.stmt.length }));
  const events = [
    ...created.map((d) => ({ at: d.index, def: d })),
    ...parseDrops(sql, bodies).map((dr) => ({ at: dr.index, drop: dr })),
  ].sort((a, b) => a.at - b.at);
  for (const e of events) {
    if (e.at > rewriteAt) flushRewrites();
    if ("def" in e && e.def) {
      const d = e.def;
      defs.set(d.name, { file, index: d.index, stmt: d.stmt, rewrites: [] });
    } else if ("drop" in e && e.drop) {
      const cur = defs.get(e.drop.name);
      if (!cur) continue;
      const have = defArgCount(cur.stmt);
      if (e.drop.argCount === null || have === null || have === e.drop.argCount) defs.delete(e.drop.name);
    }
  }
  if (rewrites.length) flushRewrites();
}
