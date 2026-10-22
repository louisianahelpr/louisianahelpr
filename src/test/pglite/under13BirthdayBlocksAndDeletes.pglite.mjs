#!/usr/bin/env node
/**
 * PGlite proof for 20261022002144_under_13_birthday_blocks_and_deletes (Q1803).
 *
 *   npx tsx src/test/pglite/under13BirthdayBlocksAndDeletes.pglite.mjs [--replay] [--before]
 *
 * lock_under_18_birthday is PROD's, read live 2026-10-21 with
 * pg_get_functiondef (read-only), with its trigger; the profiles grants and
 * policies mirror prod's (authenticated: table SELECT and INSERT, column
 * UPDATE on the fields saved here; "Users can update their own safe fields",
 * "Admins can update all profiles"). Writes run under the REAL authenticated
 * role with RLS on. vault and net are stubbed (net.http_post records its call)
 * for the "delete at once" checks, and dropped for the "never fails the write"
 * check. --before leaves the migration out and the RED checks must FAIL;
 * without it the migration is applied (3x with --replay) and every check must
 * PASS.
 *
 *   R1 a member saving their OWN under-13 birthday: the birthday is NOT stored  RED before
 *   R2 ...the account is stamped under_13_blocked_at                            RED before
 *   R3 ...under-13-delete is called once with that user_id                      RED before
 *   R4 the service role (complete-signup) writing one: not stored, stamped      RED before
 *   R5 an admin typing an under-13 birthday on someone else's account is
 *      refused (under_13_birthday), never a deletion                           RED before
 *   K1 an adult birthday saves unchanged and stamps nothing (before and after)
 *   K2 a 13th birthday today is NOT under 13 (stored, no stamp)
 * After only:
 *   A1 with no vault/net the write still succeeds (not stored, stamped): the cron finishes it
 *   A2 a member cannot clear their own stamp
 *   A3 a second under-13 save on a stamped account calls nothing again
 *   A4 a 13-17 member claiming under 13 is stamped and deleted like complete-signup does
 *      (the stored birthday is kept, so lock_under_18 never turns it into a refusal)
 *   A5 a stamped account is locked on the server: is_caller_banned() is true for it,
 *      false for an adult (every write gate that asks it refuses)
 *   A6 a birthday after today is refused (a typo, never a child), nothing stamped
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const REPLAY = process.argv.includes("--replay");
const BEFORE = process.argv.includes("--before");

const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261022002144_under_13_birthday_blocks_and_deletes.sql";
const MIGRATION = readFileSync(DIR + THIS, "utf8");

let failures = 0;
let redFailures = 0;
const check = (name, ok, detail = "", red = false) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? `  (${detail})` : ""}`);
  if (!ok) {
    failures++;
    if (red) redFailures++;
  }
};

const db = new PGlite();
await db.exec(`
DO $r$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
END $r$;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, service_role;
-- prod's is_server_context() (pg_get_functiondef 2026-10-22): no uid AND the role is neither anon nor authenticated.
CREATE FUNCTION public.is_server_context() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT auth.uid() IS NULL
     AND coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), '') NOT IN ('anon', 'authenticated')
     AND coalesce(current_setting('role', true), 'none') NOT IN ('anon', 'authenticated') $$;
GRANT EXECUTE ON FUNCTION public.is_server_context() TO anon, authenticated, service_role;
CREATE TABLE public.user_roles (user_id uuid, role text);
CREATE FUNCTION public.has_role(u uuid, r text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = u AND role = r) $$;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, text) TO authenticated;
CREATE TABLE public.profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text, phone text, bio text, date_of_birth date,
  ban_status text DEFAULT 'active', auto_suspended_until timestamptz
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON TABLE public.profiles TO authenticated;
GRANT UPDATE (full_name, phone, bio, date_of_birth) ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;
CREATE POLICY "Users can view their own profile" ON public.profiles FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "Admins can view all profiles" ON public.profiles FOR SELECT TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'));
CREATE POLICY "Users can update their own safe fields" ON public.profiles FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "Admins can update all profiles" ON public.profiles FOR UPDATE TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin')) WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'));

-- PROD's lock_under_18_birthday (pg_get_functiondef, 2026-10-21) and its trigger.
CREATE OR REPLACE FUNCTION public.lock_under_18_birthday()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.date_of_birth IS DISTINCT FROM OLD.date_of_birth
     AND OLD.date_of_birth IS NOT NULL
     AND (OLD.date_of_birth + interval '18 years') > (now() AT TIME ZONE 'America/Chicago')::date
     AND auth.uid() IS NOT NULL
     AND auth.uid() = OLD.user_id THEN
    RAISE EXCEPTION 'under_18_birthday_locked'
      USING ERRCODE = '42501', HINT = 'A saved birthday under 18 can only be corrected by Louisiana Helpr support.';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER trg_profiles_lock_under_18_birthday BEFORE UPDATE OF date_of_birth ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.lock_under_18_birthday();

-- vault + net stubs: net.http_post records each call.
CREATE SCHEMA vault;
CREATE TABLE vault.decrypted_secrets (name text, decrypted_secret text);
INSERT INTO vault.decrypted_secrets VALUES ('supabase_url', 'https://x.supabase.co'), ('service_role_key', 'sk');
CREATE SCHEMA net;
CREATE TABLE net.calls (url text, body jsonb);
CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO net.calls VALUES (url, body); SELECT 1::bigint $$;

INSERT INTO auth.users (id) VALUES
  ('00000000-0000-4000-8000-000000000001'), ('00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000003'), ('00000000-0000-4000-8000-000000000004'),
  ('00000000-0000-4000-8000-000000000005'), ('00000000-0000-4000-8000-000000000006'),
  ('00000000-0000-4000-8000-0000000000ad');
INSERT INTO public.profiles (user_id, full_name) SELECT id, 'm' FROM auth.users;
INSERT INTO public.user_roles VALUES ('00000000-0000-4000-8000-0000000000ad', 'admin');
`);

const U = (n) => `00000000-0000-4000-8000-00000000000${n}`;
const ADMIN = "00000000-0000-4000-8000-0000000000ad";
// Dates on the America/Chicago calendar, as the trigger reads them.
const today = (await db.query(`SELECT (now() AT TIME ZONE 'America/Chicago')::date AS d`)).rows[0].d;
const iso = (d) => (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);
const yearsAgo = async (y, plusDays = 0) =>
  iso((await db.query(`SELECT ((((now() AT TIME ZONE 'America/Chicago')::date - make_interval(years => $1::int))::date + $2::int))::text AS d`, [y, plusDays])).rows[0].d);
void today;

if (!BEFORE) {
  for (let i = 0; i < (REPLAY ? 3 : 1); i++) await db.exec(MIGRATION);
  console.log(`applied ${THIS} ${REPLAY ? "3x" : "1x"}`);
}

async function as(uid, sql, params = []) {
  await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${uid}', false);`);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);`);
  }
}
async function asService(sql, params = []) {
  await db.exec(`SET ROLE service_role; SELECT set_config('request.jwt.claim.sub', '', false);`);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec(`RESET ROLE;`);
  }
}
const row = async (uid) => (await db.query(`SELECT * FROM public.profiles WHERE user_id = $1`, [uid])).rows[0];
const calls = async (uid) => Number((await db.query(`SELECT count(*)::int AS n FROM net.calls WHERE body->>'user_id' = $1`, [uid])).rows[0].n);

const twelve = await yearsAgo(12);
const adult = await yearsAgo(30);
const thirteenToday = await yearsAgo(13);

// R1-R3: a member's own under-13 birthday.
await as(U(1), `UPDATE public.profiles SET date_of_birth = $1, bio = 'hi' WHERE user_id = $2`, [twelve, U(1)]);
let r = await row(U(1));
check("R1 a member's own under-13 birthday is not stored", r.date_of_birth === null, `stored ${r.date_of_birth}`, true);
check("R2 ...the account is stamped under_13_blocked_at", r.under_13_blocked_at != null, "no stamp", true);
check("R3 ...under-13-delete is called once with that user_id", (await calls(U(1))) === 1 &&
  (await db.query(`SELECT url FROM net.calls WHERE body->>'user_id' = $1`, [U(1)])).rows[0]?.url === "https://x.supabase.co/functions/v1/under-13-delete",
  `calls ${await calls(U(1))}`, true);

// R4: the service role (complete-signup).
await asService(`UPDATE public.profiles SET date_of_birth = $1 WHERE user_id = $2`, [twelve, U(2)]);
r = await row(U(2));
check("R4 a service-role write of an under-13 birthday is not stored and is stamped", r.date_of_birth === null && r.under_13_blocked_at != null, JSON.stringify(r), true);

// R5: an admin on someone else's account.
let refused = "";
try {
  await as(ADMIN, `UPDATE public.profiles SET date_of_birth = $1 WHERE user_id = $2`, [twelve, U(3)]);
} catch (e) {
  refused = String(e.message);
}
r = await row(U(3));
check("R5 an admin typing an under-13 birthday on another account is refused, nothing stamped",
  /under_13_birthday/.test(refused) && r.date_of_birth === null && !r.under_13_blocked_at && (await calls(U(3))) === 0,
  `refused="${refused}" row=${JSON.stringify(r)}`, true);

// K1, K2
await as(U(4), `UPDATE public.profiles SET date_of_birth = $1 WHERE user_id = $2`, [adult, U(4)]);
r = await row(U(4));
check("K1 an adult birthday saves unchanged and stamps nothing", iso(r.date_of_birth) === adult && !r.under_13_blocked_at, JSON.stringify(r));
await as(U(5), `UPDATE public.profiles SET date_of_birth = $1 WHERE user_id = $2`, [thirteenToday, U(5)]);
r = await row(U(5));
check("K2 a 13th birthday today is not under 13 (stored, no stamp)", iso(r.date_of_birth) === thirteenToday && !r.under_13_blocked_at, JSON.stringify(r));

if (!BEFORE) {
  // A2: a member cannot clear their own stamp.
  let cleared = "";
  try {
    await as(U(1), `UPDATE public.profiles SET under_13_blocked_at = NULL WHERE user_id = $1`, [U(1)]);
  } catch (e) {
    cleared = String(e.message);
  }
  check("A2 a member cannot clear their own stamp", /permission denied/.test(cleared) && (await row(U(1))).under_13_blocked_at != null, cleared);

  // A3: a second under-13 save on a stamped account calls nothing again.
  await as(U(1), `UPDATE public.profiles SET date_of_birth = $1 WHERE user_id = $2`, [twelve, U(1)]);
  check("A3 a second under-13 save on a stamped account calls nothing again", (await calls(U(1))) === 1 && (await row(U(1))).date_of_birth === null);

  // A4: a 13-17 member claiming under 13 is stamped and deleted, never refused.
  const sixteen = await yearsAgo(16);
  await asService(`UPDATE public.profiles SET date_of_birth = $1 WHERE user_id = $2`, [sixteen, U(6)]);
  let locked = "";
  try {
    await as(U(6), `UPDATE public.profiles SET date_of_birth = $1 WHERE user_id = $2`, [twelve, U(6)]);
  } catch (e) {
    locked = String(e.message);
  }
  r = await row(U(6));
  check("A4 a 13-17 member claiming under 13 is stamped and deleted (stored birthday kept), not refused",
    locked === "" && iso(r.date_of_birth) === sixteen && r.under_13_blocked_at != null && (await calls(U(6))) === 1, `${locked} ${JSON.stringify(r)}`);

  // A5: locked on the server.
  const banned = async (uid) => (await as(uid, `SELECT public.is_caller_banned() AS b`)).rows[0].b;
  check("A5 a stamped account is locked on the server (is_caller_banned), an adult is not", (await banned(U(1))) === true && (await banned(U(4))) === false,
    `stamped=${await banned(U(1))} adult=${await banned(U(4))}`);

  // A6: a future birthday is refused.
  const tomorrow = await yearsAgo(0, 1);
  let future = "";
  try {
    await as(U(5), `UPDATE public.profiles SET date_of_birth = $1 WHERE user_id = $2`, [tomorrow, U(5)]);
  } catch (e) {
    future = String(e.message);
  }
  r = await row(U(5));
  check("A6 a birthday after today is refused, nothing stamped", /birthday_in_future/.test(future) && !r.under_13_blocked_at && iso(r.date_of_birth) === thirteenToday, `${future} ${JSON.stringify(r)}`);

  // A1: with no vault/net the write still succeeds.
  await db.exec(`DROP SCHEMA net CASCADE; DROP SCHEMA vault CASCADE;`);
  await db.exec(`INSERT INTO auth.users (id) VALUES ('00000000-0000-4000-8000-000000000007'); INSERT INTO public.profiles (user_id, full_name) VALUES ('00000000-0000-4000-8000-000000000007', 'm');`);
  let threw = "";
  try {
    await as(U(7), `UPDATE public.profiles SET date_of_birth = $1 WHERE user_id = $2`, [twelve, U(7)]);
  } catch (e) {
    threw = String(e.message);
  }
  r = await row(U(7));
  check("A1 with no vault/net the write still succeeds, not stored, stamped (the cron finishes it)",
    threw === "" && r.date_of_birth === null && r.under_13_blocked_at != null, `${threw} ${JSON.stringify(r)}`);
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}${BEFORE ? ` (RED: ${redFailures})` : ""}`);
process.exit(BEFORE ? (redFailures >= 5 ? 0 : 1) : failures === 0 ? 0 : 1);
