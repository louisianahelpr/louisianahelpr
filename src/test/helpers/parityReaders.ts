/**
 * Readers shared by the Q54 front/back parity guards
 * (textLimitParity, amountBoundsParity, enumRangeParity, aiJobBuilderBoundsParity).
 *
 * Each reader pulls ONE number or list out of real source, the way the
 * running code sees it:
 *   - TS/TSX/Deno sources are read with comments blanked (`blankComments`), so
 *     a commented-out constant or a number quoted in prose never counts;
 *   - migrations are replayed in apply order with SQL comments blanked
 *     (`blankSqlComments`), and the NEWEST event for a constraint wins: a later
 *     `ADD CONSTRAINT x CHECK` replaces an earlier one, a `DROP CONSTRAINT x`
 *     with no later re-add removes it. Function bodies come from
 *     `latestFunctionDefs`, which accepts any dollar-quote tag.
 *
 * Every reader THROWS when it cannot find what it was asked for. A parity
 * guard that silently reads `undefined` compares nothing and stays green.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments, blankSqlComments } from "./blankNonCode";
import { latestFunctionDefs, type FunctionDef } from "./rpcErrorInventory";

const REPO = resolve(__dirname, "../../..");
const MIGRATIONS = join(REPO, "supabase/migrations");

export function readCode(rel: string): string {
  return blankComments(readFileSync(join(REPO, rel), "utf8"));
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `[export] const NAME[: T] = <number>` (underscores and `a * b * c` allowed). */
export function numericConst(rel: string, name: string): number {
  const code = readCode(rel);
  const m = new RegExp(
    `\\b(?:export\\s+)?const\\s+${escapeRe(name)}\\s*(?::[^=]+)?=\\s*([\\d_.]+(?:\\s*\\*\\s*[\\d_.]+)*)`,
  ).exec(code);
  if (!m) throw new Error(`${rel}: no numeric const ${name}`);
  return m[1]
    .split("*")
    .map((p) => Number(p.trim().replace(/_/g, "")))
    .reduce((a, b) => a * b, 1);
}

/** `[export] const NAME = /regex/flags` — the regex SOURCE text. */
export function regexConst(rel: string, name: string): string {
  const code = readCode(rel);
  const m = new RegExp(`\\bconst\\s+${escapeRe(name)}\\s*=\\s*(\\/(?:\\\\.|[^/\\n])+\\/[a-z]*)`).exec(code);
  if (!m) throw new Error(`${rel}: no regex const ${name}`);
  return m[1];
}

/** `[export] type NAME = "a" | "b" …` — the string members, in order. */
export function stringUnion(rel: string, name: string): string[] {
  const code = readCode(rel);
  const m = new RegExp(`\\btype\\s+${escapeRe(name)}\\s*=\\s*([^;]+);`).exec(code);
  if (!m) throw new Error(`${rel}: no type ${name}`);
  const members = [...m[1].matchAll(/"([^"]*)"|'([^']*)'/g)].map((x) => x[1] ?? x[2]);
  if (!members.length) throw new Error(`${rel}: type ${name} has no string members`);
  return members;
}

/** A property's string union inside an interface/type body: `status: "a" | "b";` */
export function propertyUnion(rel: string, prop: string): string[] {
  const code = readCode(rel);
  const m = new RegExp(`\\b${escapeRe(prop)}\\s*:\\s*((?:"[^"]*"\\s*\\|\\s*)+"[^"]*")\\s*;`).exec(code);
  if (!m) throw new Error(`${rel}: no string-union property ${prop}`);
  return [...m[1].matchAll(/"([^"]*)"/g)].map((x) => x[1]);
}

/** `[export] const NAME = [ "a", "b" ] [as const]` — the string members. */
export function stringArrayConst(rel: string, name: string): string[] {
  const code = readCode(rel);
  const m = new RegExp(`\\bconst\\s+${escapeRe(name)}\\s*(?::[^=]+)?=\\s*\\[([^\\]]*)\\]`).exec(code);
  if (!m) throw new Error(`${rel}: no array const ${name}`);
  return [...m[1].matchAll(/"([^"]*)"|'([^']*)'/g)].map((x) => x[1] ?? x[2]);
}

type CheckDef = { file: string; body: string };

/**
 * The newest `ADD CONSTRAINT <name> CHECK (...)` body in apply order, or null
 * when the newest event for that name is a DROP (or it never existed).
 */
function newestCheck(name: string): CheckDef | null {
  let cur: CheckDef | null = null;
  const add = new RegExp(`ADD\\s+CONSTRAINT\\s+"?${escapeRe(name)}"?\\s+CHECK\\s*\\(`, "gi");
  const drop = new RegExp(`DROP\\s+CONSTRAINT\\s+(?:IF\\s+EXISTS\\s+)?"?${escapeRe(name)}"?\\b`, "gi");
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = blankSqlComments(readFileSync(join(MIGRATIONS, f), "utf8"));
    const events: { at: number; body: string | null }[] = [];
    for (const m of sql.matchAll(drop)) events.push({ at: m.index!, body: null });
    for (const m of sql.matchAll(add)) {
      const open = m.index! + m[0].length - 1;
      let depth = 0;
      let end = -1;
      for (let i = open; i < sql.length; i++) {
        if (sql[i] === "(") depth++;
        else if (sql[i] === ")" && --depth === 0) {
          end = i;
          break;
        }
      }
      if (end < 0) throw new Error(`${f}: unbalanced CHECK for ${name}`);
      events.push({ at: m.index!, body: sql.slice(open + 1, end) });
    }
    for (const e of events.sort((a, b) => a.at - b.at)) cur = e.body === null ? null : { file: f, body: e.body };
  }
  return cur;
}

/** `[char_]length(col) <= N` inside the newest CHECK called `name`. */
export function checkMaxLength(name: string, column: string): { max: number; file: string } {
  const def = newestCheck(name);
  if (!def) throw new Error(`no live CHECK constraint ${name}`);
  const m = new RegExp(`(?:char_)?length\\s*\\(\\s*${escapeRe(column)}\\s*\\)\\s*<=\\s*(\\d+)`, "i").exec(def.body);
  if (!m) throw new Error(`${def.file}: CHECK ${name} has no length(${column}) <= N`);
  return { max: Number(m[1]), file: def.file };
}

let defsCache: Map<string, FunctionDef> | null = null;
/** The newest definition of a public function (any dollar tag, comments blanked). */
export function newestFunction(name: string): FunctionDef {
  defsCache ??= latestFunctionDefs(MIGRATIONS);
  const d = defsCache.get(name);
  if (!d) throw new Error(`no live definition of public.${name}`);
  return d;
}
