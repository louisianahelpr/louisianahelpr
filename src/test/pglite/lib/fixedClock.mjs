/**
 * Q1357: run a migration's function at a FIXED instant in PGlite.
 *
 * PGlite cannot move now(). A probe installs public._probe_now() (a one-row
 * table it sets per case) and loads the function with every clock read in its
 * body (now(), CURRENT_TIMESTAMP, current_date) pointed at it. The body is the
 * NEWEST CREATE of that function across supabase/migrations (any dollar tag),
 * so the probe proves what prod runs.
 *
 *   import { installClock, newestFunction, onFixedClock, setClock } from "./lib/fixedClock.mjs";
 */
import { readdirSync, readFileSync } from "node:fs";

const MIGRATIONS = new URL("../../../../supabase/migrations/", import.meta.url).pathname;

/** The newest `CREATE [OR REPLACE] FUNCTION public.<name>(` statement, through its closing tag and `;`. */
export function newestFunction(name) {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  const head = new RegExp(String.raw`create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?${name}"?\s*\(`, "gi");
  for (let i = files.length - 1; i >= 0; i--) {
    const sql = readFileSync(MIGRATIONS + files[i], "utf8");
    const starts = [...sql.matchAll(head)];
    if (!starts.length) continue;
    const at = starts[starts.length - 1].index;
    const tag = /\bas\s+(\$[A-Za-z_]*\$)/i.exec(sql.slice(at));
    if (!tag) throw new Error(`${name} in ${files[i]}: no dollar-quoted body`);
    const open = at + tag.index + tag[0].length;
    const close = sql.indexOf(tag[1], open);
    const end = sql.indexOf(";", close + tag[1].length);
    return { file: files[i], stmt: sql.slice(at, end + 1) };
  }
  throw new Error(`no CREATE FUNCTION public.${name} in supabase/migrations`);
}

/** `stmt` with every clock read pointed at public._probe_now(). */
export function onFixedClock(stmt) {
  return stmt
    .replace(/\bnow\s*\(\s*\)/gi, "public._probe_now()")
    .replace(/\bcurrent_timestamp\b/gi, "public._probe_now()")
    .replace(/\bcurrent_date\b/gi, "(public._probe_now())::date");
}

export async function installClock(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS public._probe_clock (t timestamptz NOT NULL);
    CREATE OR REPLACE FUNCTION public._probe_now() RETURNS timestamptz LANGUAGE sql STABLE
      AS $c$ SELECT t FROM public._probe_clock LIMIT 1 $c$;
  `);
}

export async function setClock(db, iso) {
  await db.exec(`DELETE FROM public._probe_clock;`);
  await db.query(`INSERT INTO public._probe_clock VALUES ($1::timestamptz)`, [iso]);
}
