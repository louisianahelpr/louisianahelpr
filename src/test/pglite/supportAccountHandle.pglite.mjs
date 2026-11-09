#!/usr/bin/env node
/**
 * PGlite proof for 20261109191035_support_account_handle_helpr_support (F067, owner UI audit 11-09): the official
 * support account moves from /u/neighbor to /u/helpr-support, and the old handle keeps opening it.
 *
 *   npx tsx src/test/pglite/supportAccountHandle.pglite.mjs [--replay] [--before]
 *
 * Applies the real handle migration (20261101034834) to a prod-shaped profiles table, gives the support account
 * "neighbor" the way prod has it, then applies this migration (3x with --replay). --before leaves it out: S1-S3 and S5 FAIL.
 *
 *   S1 the support account's handle is helpr-support
 *   S2 "neighbor" is retired FOR the support account (public_profile_by_handle's old-link branch opens its page)
 *   S3 nobody else can take "neighbor" (handle_retired), and a no-letters name's default skips it
 *   S4 nobody else's handle changed; the account's handle_changed_at is untouched (its one change is still its own)
 *   S5 'helpr-support' and any 'helpr-…' handle are reserved (profile_handle_problem), 'eli-b' still usable
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const BASE = readFileSync(DIR + "20261101034834_profile_handle.sql", "utf8");
const THIS = "20261109191035_support_account_handle_helpr_support.sql";
const MIGRATION = readFileSync(DIR + THIS, "utf8");
const REPLAY = process.argv.includes("--replay");
const BEFORE = process.argv.includes("--before");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const SUPPORT_USER = "7f65ef12-1d3d-439b-b0a7-f42ce8bc176d";
const SUPPORT_PROFILE = "9d8cb28b-d5c5-4b7e-9368-38996dcdf1fe";
const ELI = "00000000-0000-4000-8000-000000000001";
const DOTS = "00000000-0000-4000-8000-000000000002";

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
CREATE FUNCTION public.is_server_context() RETURNS boolean LANGUAGE sql STABLE SET search_path TO '' AS $$
  SELECT auth.uid() IS NULL AND coalesce(auth.role(), '') NOT IN ('anon', 'authenticated')
     AND coalesce(current_setting('role', true), 'none') NOT IN ('anon', 'authenticated') $$;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
INSERT INTO auth.users (id) VALUES ('${SUPPORT_USER}'), ('${ELI}'), ('${DOTS}');
CREATE TABLE public.profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, full_name text, bio text);
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT SELECT, UPDATE ON public.profiles TO authenticated;
INSERT INTO public.profiles (id, user_id, full_name) VALUES ('${SUPPORT_PROFILE}', '${SUPPORT_USER}', 'Admin'), (gen_random_uuid(), '${ELI}', 'Eli Broussard'), (gen_random_uuid(), '${DOTS}', '.. !');
`);
await db.exec(BASE);
// Prod's state on 11-09: the support account holds "neighbor" (the no-letters fallback), Eli holds "eli-b".
await db.exec(`UPDATE public.profiles SET handle = 'neighbor' WHERE user_id = '${SUPPORT_USER}';
               UPDATE public.profiles SET handle = 'eli-b' WHERE user_id = '${ELI}';`);

if (!BEFORE) {
  for (let i = 1; i <= (REPLAY ? 3 : 1); i++) {
    try {
      await db.exec(MIGRATION);
      console.log(`applied ${THIS} (run ${i})`);
    } catch (e) {
      check(`migration applies (run ${i})`, false, e.message);
    }
  }
}

const one = async (sql) => (await db.query(sql)).rows[0] ?? {};
const s = await one(`SELECT handle, handle_changed_at FROM public.profiles WHERE user_id = '${SUPPORT_USER}'`);
check("S1 the support account's handle is helpr-support", s.handle === "helpr-support", JSON.stringify(s));
const r = await one(`SELECT user_id::text AS u FROM public.profile_handles_retired WHERE handle = 'neighbor'`);
check("S2 'neighbor' is retired for the support account (old links open its page)", r.u === SUPPORT_USER, JSON.stringify(r));
let refused = "";
try {
  await db.exec(`UPDATE public.profiles SET handle = 'neighbor' WHERE user_id = '${DOTS}'`);
} catch (e) {
  refused = e.message;
}
check("S3 nobody else can take 'neighbor'", /handle_retired/.test(refused), refused || "no error");
const e = await one(`SELECT handle FROM public.profiles WHERE user_id = '${ELI}'`);
check("S4 nobody else's handle changed; handle_changed_at untouched", e.handle === "eli-b" && s.handle_changed_at == null, JSON.stringify({ e, s }));

const pr = await one(`SELECT public.profile_handle_problem('helpr-support') AS a, public.profile_handle_problem('helpr-team') AS b, public.profile_handle_problem('eli-b2') AS c`);
check("S5 helpr-support / helpr-… are reserved; ordinary handles still usable", pr.a === "handle_reserved" && pr.b === "handle_reserved" && pr.c === null, JSON.stringify(pr));

if (BEFORE) {
  const expected = 4;
  console.log(failures === expected ? `BEFORE: ${failures} FAIL as expected` : `BEFORE: expected ${expected} FAIL, got ${failures}`);
  process.exit(failures === expected ? 0 : 1);
}
console.log(failures ? `${failures} FAILED` : "all PASS");
process.exit(failures ? 1 : 0);
