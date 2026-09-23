/*
 * The definition of each SQL function the migrations actually leave in the
 * database — which is NOT always the newest `CREATE FUNCTION` text.
 *
 * Two migrations (20260831232514, 20260901021929) changed notification links
 * by reading `pg_get_functiondef()`, running `regexp_replace` over it and
 * EXECUTE-ing the result. After them, the newest textual definition of e.g.
 * notify_poster_on_status_change still writes '/my-posts?filter=scheduled',
 * while the database writes '/my-posts?job=' || NEW.id::text. A restatement
 * copied from the newest TEXT silently undoes the rewrite (Q139, 2026-09-23:
 * a branch restated 16 functions that way and reverted 11 direct links).
 *
 * effectiveDefs() replays every migration in order: a CREATE [OR REPLACE]
 * FUNCTION (any dollar-quote tag, including one nested in EXECUTE $fn$ … $fn$)
 * sets the definition, and a rewrite tuple
 *   (ord, 'fn', $p$pattern$p$, $q$replacement$q$, 'flags')
 * inside a pg_get_functiondef + regexp_replace DO block is applied to it, in
 * `ord` order, exactly as Postgres would (a function that does not exist yet
 * is skipped). Comments never define anything: definitions and tuples are
 * located on comment-blanked text, and the statement is cut from the raw text
 * at the same offsets.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./blankNonCode";

export interface FnDef {
  /** Migration whose CREATE FUNCTION text is the base. */
  file: string;
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
const TUPLE =
  /\(\s*(\d+)\s*,\s*'(\w+)'\s*,\s*\$p\$([\s\S]*?)\$p\$\s*,\s*\$q\$([\s\S]*?)\$q\$\s*,\s*'(\w*)'\s*\)/g;

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

/** Rewrite tuples of a pg_get_functiondef + regexp_replace migration. */
export function parseRewrites(sql: string, file = ""): Rewrite[] {
  const code = blankSqlComments(sql);
  if (!/pg_get_functiondef\s*\(/i.test(code) || !/regexp_replace\s*\(/i.test(code)) return [];
  const out: Rewrite[] = [];
  for (const m of code.matchAll(TUPLE)) {
    out.push({
      file,
      ord: Number(m[1]),
      fn: m[2].toLowerCase(),
      pattern: m[3],
      replacement: m[4],
      flags: m[5],
    });
  }
  return out.sort((a, b) => a.ord - b.ord);
}

/** Postgres regexp_replace, in JS. ARE `.` spans newlines unless flag `n`. */
function pgRegexpReplace(src: string, pattern: string, replacement: string, flags: string): string {
  const jsFlags = (flags.includes("g") ? "g" : "") + (flags.includes("n") ? "" : "s") + (flags.includes("i") ? "i" : "");
  const rep = replacement
    .replace(/\$/g, "$$$$")
    .replace(/\\&/g, "$$&")
    .replace(/\\(\d)/g, "$$$1");
  return src.replace(new RegExp(pattern, jsFlags), rep);
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
  for (const d of parseDefs(sql)) {
    if (d.index > rewriteAt) flushRewrites();
    defs.set(d.name, { file, stmt: d.stmt, rewrites: [] });
  }
  if (rewrites.length) flushRewrites();
}
