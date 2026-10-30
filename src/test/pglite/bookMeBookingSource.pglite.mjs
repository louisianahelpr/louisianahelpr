#!/usr/bin/env node
/**
 * PGlite proof for 20261030013347_book_me_booking_source ("Book me on Helpr", B59).
 *
 *   node src/test/pglite/bookMeBookingSource.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/bookMeBookingSource.pglite.mjs   # RED: nothing records the source
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 * Roles are real: `SET ROLE authenticated` with request.uid is a PostgREST call with a user JWT.
 * The migration is applied 3x, then:
 *   - a new poster records the Helpr whose link they came through; set once (first link wins);
 *   - self, a banned Helpr, and a caller who already posted are skipped;
 *   - anon has no EXECUTE; a signed-out call is refused; the table is unreadable by authenticated;
 *   - admin_booking_sources counts posters per Helpr, never a test account, and refuses a non-admin.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const NEW = readFileSync(new URL("../../../supabase/migrations/20261030013347_book_me_booking_source.sql", import.meta.url).pathname, "utf8");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running without the migration (expect FAILs)`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const ADMIN = "aaaaaaaa-0000-4000-8000-000000000001";
const HELPR = "bbbbbbbb-0000-4000-8000-000000000001";
const HELPR2 = "bbbbbbbb-0000-4000-8000-000000000002";
const BANNED = "bbbbbbbb-0000-4000-8000-000000000003";
const NEWBIE = "cccccccc-0000-4000-8000-000000000001";
const VETERAN = "cccccccc-0000-4000-8000-000000000002";
const TESTER = "cccccccc-0000-4000-8000-000000000003";

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.uid', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
CREATE TABLE public.user_roles (user_id uuid NOT NULL, role public.app_role NOT NULL);
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $function$;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
CREATE TABLE public.profiles (
  user_id uuid PRIMARY KEY, full_name text, email_verified boolean NOT NULL DEFAULT true,
  anonymized_at timestamptz, ban_status text, auto_suspended_until timestamptz,
  under_13_blocked_at timestamptz, is_seed boolean NOT NULL DEFAULT false
);
CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY, enrolled_at timestamptz NOT NULL DEFAULT now(), note text);
CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid);
CREATE OR REPLACE FUNCTION public.is_caller_banned()
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
     WHERE user_id = auth.uid()
       AND (
         (ban_status IN ('banned', 'temp_banned', 'permanently_banned')
          AND (ban_status <> 'temp_banned' OR auto_suspended_until IS NULL OR auto_suspended_until > now()))
         OR under_13_blocked_at IS NOT NULL
       )
  );
$function$;
-- display_name_for_viewer as in 20261021131322 (member_display_name simplified to "First L."; is_server_context false).
CREATE FUNCTION public.is_server_context() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.member_display_name(p_full_name text, p_fallback text DEFAULT 'A neighbor') RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN coalesce(btrim(p_full_name), '') = '' THEN p_fallback
              WHEN position(' ' in btrim(p_full_name)) > 0 THEN split_part(btrim(p_full_name), ' ', 1) || ' ' || left(regexp_replace(btrim(p_full_name), '^.* ', ''), 1) || '.'
              ELSE btrim(p_full_name) END $$;
CREATE FUNCTION public.display_name_for_viewer(p_full_name text, p_owner_id uuid) RETURNS text LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT CASE
           WHEN p_owner_id IS NOT NULL AND p_owner_id = (SELECT auth.uid()) THEN p_full_name
           WHEN (SELECT public.is_server_context()) THEN p_full_name
           WHEN (SELECT auth.uid()) IS NOT NULL AND public.has_role((SELECT auth.uid()), 'admin'::public.app_role) THEN p_full_name
           ELSE public.member_display_name(p_full_name, NULL)
         END $$;
INSERT INTO auth.users VALUES ('${ADMIN}'),('${HELPR}'),('${HELPR2}'),('${BANNED}'),('${NEWBIE}'),('${VETERAN}'),('${TESTER}');
INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin');
INSERT INTO public.profiles (user_id, full_name, ban_status, is_seed) VALUES
  ('${ADMIN}', 'Owner Person', NULL, false),
  ('${HELPR}', 'Marie Thibodeaux', NULL, false),
  ('${HELPR2}', 'Jean Broussard', NULL, false),
  ('${BANNED}', 'Bad Actor', 'permanently_banned', false),
  ('${NEWBIE}', 'New Poster', NULL, false),
  ('${VETERAN}', 'Old Poster', NULL, false),
  ('${TESTER}', 'Test Poster', NULL, true);
INSERT INTO public.test_accounts (user_id) VALUES ('${TESTER}');
INSERT INTO public.jobs (customer_id) VALUES ('${VETERAN}');
`);

if (!MODE) for (let i = 0; i < 3; i++) await db.exec(NEW);

async function as(uid, role, sql) {
  await db.exec(`RESET ROLE; SELECT set_config('request.uid', '${uid ?? ""}', false); SET ROLE ${role};`);
  try {
    const r = await db.query(sql);
    return { rows: r.rows };
  } catch (e) {
    return { error: String(e.message) };
  } finally {
    await db.exec("RESET ROLE;");
  }
}
const rec = (uid, helpr) => as(uid, "authenticated", `SELECT public.record_booking_source('${helpr}') AS r`);

{
  const r = await rec(NEWBIE, HELPR);
  check("a new poster records the Helpr whose link brought them", r.rows?.[0]?.r === "recorded", JSON.stringify(r));
  const again = await rec(NEWBIE, HELPR2);
  check("set once: a second link does not overwrite the first", again.rows?.[0]?.r === "skipped", JSON.stringify(again));
  const row = await as(null, "service_role", `SELECT helpr_id FROM public.booking_sources WHERE user_id = '${NEWBIE}'`);
  check("the stored Helpr is the first one", row.rows?.[0]?.helpr_id === HELPR, JSON.stringify(row));
}
{
  const self = await rec(HELPR, HELPR);
  check("your own link never records", self.rows?.[0]?.r === "skipped", JSON.stringify(self));
  const banned = await rec(HELPR2, BANNED);
  check("a banned Helpr is never recorded", banned.rows?.[0]?.r === "skipped", JSON.stringify(banned));
  const vet = await rec(VETERAN, HELPR);
  check("someone who already posted is not a new poster", vet.rows?.[0]?.r === "skipped", JSON.stringify(vet));
}
{
  const out = await as(null, "authenticated", `SELECT public.record_booking_source('${HELPR}')`);
  check("signed out is refused", /not_signed_in/.test(out.error ?? ""), out.error);
  const anon = await as(null, "anon", `SELECT public.record_booking_source('${HELPR}')`);
  check("anon has no EXECUTE", /permission denied/.test(anon.error ?? ""), anon.error);
  const tbl = await as(NEWBIE, "authenticated", "SELECT * FROM public.booking_sources");
  check("the table is unreadable by a member", /permission denied/.test(tbl.error ?? ""), tbl.error);
  const ins = await as(NEWBIE, "authenticated", `INSERT INTO public.booking_sources (user_id, helpr_id) VALUES ('${VETERAN}', '${HELPR2}')`);
  check("a member cannot write the table directly", /permission denied/.test(ins.error ?? ""), ins.error);
}
{
  await rec(TESTER, HELPR); // a test account's source is stored but never counted
  await db.exec(`RESET ROLE; INSERT INTO public.jobs (customer_id) VALUES ('${NEWBIE}');`);
  const r = await as(ADMIN, "authenticated", "SELECT * FROM public.admin_booking_sources()");
  const m = r.rows?.find((x) => x.helpr_id === HELPR);
  check("admin sees posters brought per Helpr, test accounts excluded", m?.posters_brought === 1, JSON.stringify(r));
  check("admin sees how many of them went on to post", m?.posters_who_posted === 1, JSON.stringify(m));
  const no = await as(NEWBIE, "authenticated", "SELECT * FROM public.admin_booking_sources()");
  check("a non-admin is refused", /admin_only/.test(no.error ?? ""), no.error);
  const anon = await as(null, "anon", "SELECT * FROM public.admin_booking_sources()");
  check("anon has no EXECUTE on the admin read", /permission denied/.test(anon.error ?? ""), anon.error);
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
