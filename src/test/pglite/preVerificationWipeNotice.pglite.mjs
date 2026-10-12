#!/usr/bin/env node
/**
 * PGlite proof for 20261012170325_pre_verification_wipe_notice (docs/OPEN.md
 * Q1286, owner decision 2026-10-12).
 *
 *   node src/test/pglite/preVerificationWipeNotice.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/preVerificationWipeNotice.pglite.mjs # RED: the state on main
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * public.pre_verification_wipes is created by its own migration's DDL
 * (20261004194257, the CREATE TABLE statement cut verbatim), then the new
 * function runs verbatim. What is proven: the caller's successful wipe reads
 * true; a FAILED wipe ('wipe failed: ...') and another account's wipe read
 * false; no session reads false; anon cannot execute it; authenticated can.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (rel) => readFileSync(new URL(rel, import.meta.url).pathname, "utf8");
const MIGDIR = "../../../supabase/migrations/";
const NEW = read(`${MIGDIR}20261012170325_pre_verification_wipe_notice.sql`);
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the state on main (expect FAILs)`);

const WIPE_MIG = read(`${MIGDIR}20261004194257_pre_verification_takeover_wipe.sql`);
const tStart = WIPE_MIG.search(/CREATE TABLE IF NOT EXISTS public\.pre_verification_wipes/);
const TABLE_DDL = WIPE_MIG.slice(tStart, WIPE_MIG.indexOf(");", tStart) + 2);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.uid', true), '')::uuid $$;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
${TABLE_DDL}
ALTER TABLE public.pre_verification_wipes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pre_verification_wipes FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA public TO anon, authenticated;
-- Prod's pg_default_acl grants EXECUTE on new functions to anon and authenticated.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;
`);

const WIPED = "11111111-1111-4111-8111-111111111111";
const FAILED = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const STORAGE_ERR = "44444444-4444-4444-8444-444444444444";
await db.exec(`
INSERT INTO auth.users (id) VALUES ('${WIPED}'), ('${FAILED}'), ('${OTHER}'), ('${STORAGE_ERR}');
INSERT INTO public.pre_verification_wipes (user_id, objects) VALUES ('${WIPED}', '[]');
INSERT INTO public.pre_verification_wipes (user_id, error) VALUES ('${FAILED}', 'wipe failed: boom');
INSERT INTO public.pre_verification_wipes (user_id, objects, error) VALUES ('${STORAGE_ERR}', '[]', 'storage removal failed: 1 object');
`);

if (MODE !== "skip") {
  for (let i = 0; i < 3; i++) await db.exec(NEW);
  check("migration applies 3x (replay-safe)", true);
}

async function asUser(uid) {
  try {
    await db.exec(`SET ROLE authenticated; SELECT set_config('request.uid', '${uid ?? ""}', false);`);
    const r = await db.query("SELECT public.has_pre_verification_wipe() AS v");
    return r.rows[0].v;
  } catch (e) {
    return `error: ${e.message}`;
  } finally {
    await db.exec("RESET ROLE;");
  }
}

check("the caller's successful wipe reads true", (await asUser(WIPED)) === true, String(await asUser(WIPED)));
check("a FAILED wipe (nothing was cleared) reads false", (await asUser(FAILED)) === false, String(await asUser(FAILED)));
check("any other error text (no writer sets one today) does not hide a clearing that ran", (await asUser(STORAGE_ERR)) === true, String(await asUser(STORAGE_ERR)));
check("an account with no wipe reads false (another account's wipe is not visible)", (await asUser(OTHER)) === false, String(await asUser(OTHER)));
check("no session reads false", (await asUser(null)) === false, String(await asUser(null)));

async function canExecute(role) {
  try {
    const r = await db.query(`SELECT has_function_privilege('${role}', 'public.has_pre_verification_wipe()', 'EXECUTE') AS v`);
    return r.rows[0].v;
  } catch (e) {
    return `error: ${e.message}`;
  }
}
check("anon cannot execute it", (await canExecute("anon")) === false, String(await canExecute("anon")));
check("authenticated can execute it", (await canExecute("authenticated")) === true, String(await canExecute("authenticated")));

console.log(failures ? `\n${failures} FAIL(s)` : "\nall PASS");
process.exit(failures ? 1 : 0);
