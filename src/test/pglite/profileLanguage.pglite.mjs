#!/usr/bin/env node
/**
 * PGlite proof for F260q's profiles.language (20261111213927_profile_language.sql).
 *
 *   npx tsx src/test/pglite/profileLanguage.pglite.mjs [--skip]
 *
 * The migration verbatim (applied 3x for replay-safety) on a prod-shaped profiles table: RLS on, the own-row UPDATE
 * policy ("Users can update their own safe fields", auth.uid() = user_id), column-level UPDATE grants only.
 * --skip runs a naive version (no CHECK, the grant to anon as well): L2 and L5 FAIL.
 *
 *   L1 the column exists, NOT NULL, default 'en' (an existing row reads 'en')
 *   L2 only 'en' or 'es' can be stored (CHECK), and NULL cannot
 *   L3 a member can set their OWN language (column grant + own-row policy)
 *   L4 a member cannot change another member's language (own-row policy: no row changes)
 *   L5 anon holds no UPDATE on the column
 *   L6 the grant is column-level: the same member still cannot write a column that was never granted (is_seed)
 *   L7 replay-safe: three applies leave exactly one CHECK constraint
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261111213927_profile_language.sql";
const SKIP = process.argv.includes("--skip");
const MIGRATION = SKIP
  ? `ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'en';
     GRANT UPDATE (language) ON public.profiles TO authenticated, anon;`
  : readFileSync(DIR + THIS, "utf8");

let failures = 0;
let checks = 0;
const check = (name, ok, detail = "") => {
  checks++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ME = U(1), OTHER = U(2);

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE NOT NULL,
  full_name text,
  is_seed boolean NOT NULL DEFAULT false
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view profiles" ON public.profiles FOR SELECT TO authenticated, anon USING (true);
CREATE POLICY "Users can update their own safe fields" ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
GRANT SELECT ON public.profiles TO authenticated, anon;
GRANT UPDATE (full_name) ON public.profiles TO authenticated;
INSERT INTO public.profiles (user_id, full_name) VALUES ('${ME}', 'Me'), ('${OTHER}', 'Other');
`);
for (let i = 0; i < 3; i++) await db.exec(MIGRATION);

const asUser = async (uid, sql, role = "authenticated") => {
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${uid ?? ""}', false);`);
  await db.exec(`SET ROLE ${role};`);
  try { return await db.query(sql); } finally { await db.exec("RESET ROLE;"); }
};
const langOf = async (uid) => (await db.query(`SELECT language FROM public.profiles WHERE user_id='${uid}'`)).rows[0].language;
const fails = async (fn) => { try { await fn(); return false; } catch { return true; } };

const col = (await db.query(`SELECT is_nullable, column_default FROM information_schema.columns
  WHERE table_schema='public' AND table_name='profiles' AND column_name='language'`)).rows[0];
check("L1 NOT NULL, default 'en', existing rows read 'en'", col?.is_nullable === "NO" && /'en'/.test(col?.column_default ?? "") && (await langOf(ME)) === "en", JSON.stringify(col));

const badFr = await fails(() => db.query(`UPDATE public.profiles SET language='fr' WHERE user_id='${OTHER}'`));
const badNull = await fails(() => db.query(`UPDATE public.profiles SET language=NULL WHERE user_id='${OTHER}'`));
check("L2 only 'en' or 'es' (CHECK), never NULL", badFr && badNull, `fr refused=${badFr} null refused=${badNull}`);
await db.exec(`UPDATE public.profiles SET language='en' WHERE user_id='${OTHER}'`);

let ownOk = false;
try {
  const r = await asUser(ME, `UPDATE public.profiles SET language='es' WHERE user_id='${ME}' RETURNING user_id`);
  ownOk = r.rows.length === 1 && (await langOf(ME)) === "es";
} catch (e) { console.log("  L3 error:", e.message); }
check("L3 a member sets their own language", ownOk);

let otherRows = -1;
try { otherRows = (await asUser(ME, `UPDATE public.profiles SET language='es' WHERE user_id='${OTHER}' RETURNING user_id`)).rows.length; }
catch (e) { console.log("  L4 error:", e.message); }
check("L4 another member's language is untouched (0 rows)", otherRows <= 0 && (await langOf(OTHER)) === "en", `rows=${otherRows}`);

const anonPriv = (await db.query(`SELECT has_column_privilege('anon', 'public.profiles', 'language', 'UPDATE') AS p`)).rows[0].p;
const anonWrite = await fails(() => asUser(null, `UPDATE public.profiles SET language='es' WHERE user_id='${OTHER}'`, "anon"));
check("L5 anon has no UPDATE on the column", anonPriv === false && anonWrite, `privilege=${anonPriv}`);

const seedWrite = await fails(() => asUser(ME, `UPDATE public.profiles SET is_seed=true WHERE user_id='${ME}'`));
check("L6 the grant is column-level (is_seed still refused)", seedWrite);

const nChecks = (await db.query(`SELECT count(*)::int AS n FROM pg_constraint WHERE conrelid='public.profiles'::regclass AND conname='profiles_language_check'`)).rows[0].n;
check("L7 three applies leave one CHECK", nChecks === 1, `n=${nChecks}`);

console.log(`\n${checks - failures}/${checks} PASS${SKIP ? " (--skip: naive migration; FAILs expected)" : ""}`);
process.exit(failures ? 1 : 0);
