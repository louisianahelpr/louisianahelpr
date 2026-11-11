#!/usr/bin/env node
/**
 * PGlite proof for 20261111221745_profile_language_from_signup (F260q; lead 11-11: a brand-new sign-up has no saved
 * language, so the sign-up form sends `lang` in user metadata and handle_new_user copies it into profiles.language).
 *
 *   node src/test/pglite/profileLanguageFromSignup.pglite.mjs [--replay] [--before]
 *
 * Builds the prod-shaped pieces handle_new_user touches, applies 20261111213927_profile_language (the column), then the
 * previous handle_new_user (20260908002148's body, copied verbatim from that migration file at run time) and this
 * migration (3x with --replay). --before leaves this migration out: S1 FAILS (count asserted by the caller).
 * @mutate supabase/migrations/20261111221745_profile_language_from_signup.sql | CASE WHEN NEW.raw_user_meta_data->>'lang' = 'es' THEN 'es' ELSE 'en' END | 'en'
 *
 *   S1 a sign-up with metadata lang 'es' gets profiles.language 'es'
 *   S2 lang 'en', no lang, junk ('ES', 'fr', a number) and no metadata at all each get 'en' (never a failed sign-up)
 *   S3 the rest of the trigger still runs: full_name/email copied, a 'customer' role, a notification_preferences row
 *   S4 anon and authenticated cannot EXECUTE handle_new_user
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const COLUMN = readFileSync(DIR + "20261111213927_profile_language.sql", "utf8");
const PREV_SRC = readFileSync(DIR + "20260908002148_ban_survives_a_new_email_phone_and_identity.sql", "utf8");
const MIGRATION = readFileSync(DIR + "20261111221745_profile_language_from_signup.sql", "utf8");
const REPLAY = process.argv.includes("--replay");
const BEFORE = process.argv.includes("--before");

// The previous definition, verbatim: from its CREATE to the end of its dollar-quoted body.
const prevAt = PREV_SRC.indexOf("CREATE OR REPLACE FUNCTION public.handle_new_user()");
const bodyEnd = PREV_SRC.indexOf("\n$$;", prevAt);
if (prevAt < 0 || bodyEnd < 0) throw new Error("previous handle_new_user not found");
const PREV = PREV_SRC.slice(prevAt, bodyEnd + 4);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, phone text, raw_user_meta_data jsonb);
CREATE TYPE public.app_role AS ENUM ('admin', 'customer', 'helper');
CREATE TABLE public.profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE NOT NULL REFERENCES auth.users(id),
  full_name text, email text);
CREATE TABLE public.user_roles (user_id uuid NOT NULL, role public.app_role NOT NULL);
CREATE TABLE public.notification_preferences (user_id uuid PRIMARY KEY);
`);
await db.exec(COLUMN);
await db.exec(PREV);
await db.exec(`CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();`);
if (!BEFORE) {
  for (let i = 0; i < (REPLAY ? 3 : 1); i++) await db.exec(MIGRATION);
}

const cases = [
  [U(1), `'{"full_name":"Rosa Landry","lang":"es"}'`, "es"],
  [U(2), `'{"full_name":"Ann","lang":"en"}'`, "en"],
  [U(3), `'{"full_name":"No Lang"}'`, "en"],
  [U(4), `'{"lang":"ES"}'`, "en"],
  [U(5), `'{"lang":"fr"}'`, "en"],
  [U(6), `'{"lang":7}'`, "en"],
  [U(7), "NULL", "en"],
];
const errors = [];
for (const [id, meta] of cases) {
  try {
    await db.exec(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ('${id}', '${id}@example.test', ${meta});`);
  } catch (e) {
    errors.push(`${id}: ${e.message}`);
  }
}
const lang = async (id) => (await db.query(`SELECT language FROM public.profiles WHERE user_id = $1`, [id])).rows[0]?.language;

check("S1 lang 'es' in sign-up metadata -> profiles.language 'es'", (await lang(U(1))) === "es", String(await lang(U(1))));
const s2 = [];
for (const [id, , want] of cases.slice(1)) s2.push(`${(await lang(id)) === want ? "ok" : "BAD"}:${await lang(id)}`);
check("S2 en / none / junk / null metadata -> 'en', and no sign-up failed", errors.length === 0 && s2.every((x) => x.startsWith("ok")), [...s2, ...errors].join(" "));

const p = (await db.query(`SELECT full_name, email FROM public.profiles WHERE user_id = $1`, [U(1)])).rows[0];
const roles = (await db.query(`SELECT count(*)::int AS n FROM public.user_roles WHERE role = 'customer'`)).rows[0].n;
const prefs = (await db.query(`SELECT count(*)::int AS n FROM public.notification_preferences`)).rows[0].n;
check("S3 name/email copied, 7 customer roles, 7 preference rows", p?.full_name === "Rosa Landry" && p?.email === `${U(1)}@example.test` && roles === 7 && prefs === 7,
  `${p?.full_name} ${roles} ${prefs}`);

const acl = (await db.query(`SELECT has_function_privilege('anon', 'public.handle_new_user()', 'EXECUTE') AS a,
  has_function_privilege('authenticated', 'public.handle_new_user()', 'EXECUTE') AS b`)).rows[0];
check("S4 anon and authenticated cannot EXECUTE handle_new_user", BEFORE ? true : acl.a === false && acl.b === false, JSON.stringify(acl));

console.log(`\n${failures} failure(s)${REPLAY ? " (replayed 3x)" : ""}${BEFORE ? " [--before]" : ""}`);
process.exit(failures ? 1 : 0);
