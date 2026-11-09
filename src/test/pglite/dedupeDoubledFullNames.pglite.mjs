#!/usr/bin/env node
/**
 * PGlite proof for 20261109184020_dedupe_doubled_full_names (F085, owner 11-09: "fix the 3 doubled names").
 *
 *   node src/test/pglite/dedupeDoubledFullNames.pglite.mjs                     # after (the migration run 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/dedupeDoubledFullNames.pglite.mjs  # RED: the names before it
 *
 * World: public.profiles with the columns the rule reads (user_id, full_name, updated_at) and its updated_at trigger
 * (update_updated_at_column, as on prod). The migration file is applied verbatim. The three prod shapes (a two-word
 * name, a three-word name, a street address typed as a name) are fixed; a one-word name said twice, near-repeats, a
 * repeat with two spaces, a repeat with a trailing word and a null are left exactly as they were.
 * [fix] checks FAIL on the before state; [keep] checks pass in both.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const FILE = fileURLToPath(new URL("../../../supabase/migrations/20261109184020_dedupe_doubled_full_names.sql", import.meta.url));
const SKIP = process.env.NEW_MIGRATION === "skip";

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };

const db = new PGlite();
await db.exec(`
  CREATE TABLE public.profiles (
    user_id uuid PRIMARY KEY,
    full_name text,
    updated_at timestamptz NOT NULL DEFAULT '2026-01-01T00:00:00Z'
  );
  CREATE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
  CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
`);

const rows = [
  ["doubled two words", "Annette Washum Annette Washum", "Annette Washum", true],
  ["doubled three words", "Andrea M Martinez Andrea M Martinez", "Andrea M Martinez", true],
  ["doubled address", "107 E. Tampico Street 107 E. Tampico Street", "107 E. Tampico Street", true],
  ["one word said twice", "Mary Mary", "Mary Mary", false],
  ["near repeat", "John Johnson", "John Johnson", false],
  ["prefix repeat", "Ann Annette", "Ann Annette", false],
  ["two spaces between", "Annette Washum  Annette Washum", "Annette Washum  Annette Washum", false],
  ["repeat plus a word", "Annette Washum Annette Washum Jr", "Annette Washum Annette Washum Jr", false],
  ["ordinary", "Mindy Braquet", "Mindy Braquet", false],
  ["null", null, null, false],
];
for (const [i, [, name]] of rows.entries()) {
  await db.query(`INSERT INTO public.profiles (user_id, full_name) VALUES ($1, $2)`, [`00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, name]);
}

const migration = readFileSync(FILE, "utf8");
if (!SKIP) for (let run = 0; run < 3; run++) await db.exec(migration);

const after = (await db.query(`SELECT user_id, full_name, updated_at FROM public.profiles ORDER BY user_id`)).rows;
for (const [i, [label, , want, fixed]] of rows.entries()) {
  const got = after[i];
  check(got.full_name === want, `[${fixed ? "fix" : "keep"}] ${label}: ${JSON.stringify(got.full_name)}`);
  if (!fixed) check(new Date(got.updated_at).toISOString() === "2026-01-01T00:00:00.000Z", `[keep] ${label}: row not written`);
}
const left = (await db.query(`SELECT count(*)::int n FROM public.profiles WHERE full_name ~ '^(\\S+(?: \\S+)+) \\1$'`)).rows[0].n;
check(left === 0, `[fix] no doubled name is left (${left})`);

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
