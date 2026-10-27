#!/usr/bin/env node
/**
 * PGlite proof for 20261027201848_find_helprs_directory (Q2437, owner-approved
 * 2026-10-27): "Find a Helpr" lists Helprs by skill and town to signed-in
 * members only, with first name + last initial and never a rate or address.
 *
 *   node src/test/pglite/findHelprsDirectory.pglite.mjs                    # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/findHelprsDirectory.pglite.mjs # RED: main (no directory)
 *
 * The helpers it calls are prod's bodies, read live 2026-10-27
 * (pg_get_functiondef): display_name_for_viewer, member_display_name,
 * has_role, is_caller_banned, is_server_context, member_under_18,
 * seed_hidden_from_caller, seed_jobs_hidden_publicly. Applied 3x (replay-safe).
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const NEW = readFileSync(new URL("../../../supabase/migrations/20261027201848_find_helprs_directory.sql", import.meta.url).pathname, "utf8");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running WITHOUT the new migration (expect FAILs)`);
let failures = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); if (!ok) failures++; };

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ME = id(1), ANA = id(2), BEN = id(3), NOSKILL = id(4), BANNED = id(5), MINOR = id(6), BLOCKED = id(7), SEED = id(8), UNVER = id(9), GONE = id(10), TRICK = id(11), BLOCKER = id(12), ADMIN = id(13), BANNEDME = id(14);

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.uid', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.role', true), '') $$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO anon, authenticated;
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
CREATE TABLE public.user_roles (user_id uuid, role public.app_role);
CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY);
CREATE TABLE public.platform_settings (feature_flags jsonb, updated_at timestamptz DEFAULT now());
CREATE TABLE public.user_blocks (blocker_id uuid, blocked_id uuid);
CREATE TABLE public.profiles (
  id uuid DEFAULT gen_random_uuid(), user_id uuid PRIMARY KEY, full_name text, avatar_url text, bio text, skills text,
  location text, parish text, hourly_rate numeric, phone text, email text, idv_status text, email_verified boolean NOT NULL DEFAULT true,
  anonymized_at timestamptz, ban_status text, auto_suspended_until timestamptz, under_13_blocked_at timestamptz,
  is_seed boolean NOT NULL DEFAULT false, date_of_birth date, created_at timestamptz NOT NULL DEFAULT now());
`);
// Prod's helper bodies, read live 2026-10-27.
await db.exec("SET check_function_bodies = off;");
await db.exec(`-- live display_name_for_viewer(text,uuid)
CREATE OR REPLACE FUNCTION public.display_name_for_viewer(p_full_name text, p_owner_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT CASE
           WHEN p_owner_id IS NOT NULL AND p_owner_id = (SELECT auth.uid()) THEN p_full_name
           WHEN (SELECT public.is_server_context()) THEN p_full_name
           WHEN (SELECT auth.uid()) IS NOT NULL
                AND public.has_role((SELECT auth.uid()), 'admin'::public.app_role) THEN p_full_name
           ELSE public.member_display_name(p_full_name, NULL)
         END
$function$;

-- live has_role(uuid,app_role)
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT _user_id IS NOT NULL
     AND (
       _user_id IS NOT DISTINCT FROM auth.uid()
       OR public.is_server_context()
       OR pg_trigger_depth() > 0
       OR EXISTS (
         SELECT 1 FROM public.user_roles c
         WHERE c.user_id = auth.uid() AND c.role = 'admin'::public.app_role
       )
     )
     AND EXISTS (
       SELECT 1 FROM public.user_roles
       WHERE user_id = _user_id AND role = _role
     )
$function$;

-- live is_caller_banned()
CREATE OR REPLACE FUNCTION public.is_caller_banned()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
     WHERE user_id = auth.uid()
       AND (
         (ban_status IN ('banned', 'temp_banned', 'permanently_banned')
          -- A lapsed suspension the sweeper hasn't lifted yet does not block:
          -- the sweep runs on a timer, rights come back on the clock.
          AND (ban_status <> 'temp_banned'
               OR auto_suspended_until IS NULL
               OR auto_suspended_until > now()))
         -- Q1803: an under-13 account waiting to be deleted.
         OR under_13_blocked_at IS NOT NULL
       )
  );
$function$;

-- live is_server_context()
CREATE OR REPLACE FUNCTION public.is_server_context()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT auth.uid() IS NULL
     AND coalesce(auth.role(), '') NOT IN ('anon', 'authenticated')
     AND coalesce(current_setting('role', true), 'none') NOT IN ('anon', 'authenticated')
$function$;

-- live member_display_name(text,text)
CREATE OR REPLACE FUNCTION public.member_display_name(p_full_name text, p_fallback text DEFAULT 'A neighbor'::text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
  SELECT CASE
           WHEN v.t = '' THEN p_fallback
           WHEN array_length(v.parts, 1) > 1
             THEN v.parts[1] || ' ' || left(v.parts[array_length(v.parts, 1)], 1) || '.'
           ELSE v.parts[1]
         END
    FROM (SELECT x.t,
                 regexp_split_to_array(x.t, '[\\t\\n\\v\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]+') AS parts
            FROM (SELECT regexp_replace(coalesce(p_full_name, ''),
                                        '^[\\t\\n\\v\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]+|[\\t\\n\\v\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]+$',
                                        '', 'g') AS t) x) v
$function$;

-- live member_under_18(uuid)
CREATE OR REPLACE FUNCTION public.member_under_18(p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(
    (SELECT (p.date_of_birth + interval '18 years') > (now() AT TIME ZONE 'America/Chicago')::date
       FROM public.profiles p
      WHERE p.user_id = p_user_id
        AND p.date_of_birth IS NOT NULL
      LIMIT 1),
    false)
$function$;

-- live seed_hidden_from_caller()
CREATE OR REPLACE FUNCTION public.seed_hidden_from_caller()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- A KNOWN counterpart (profile row, stats, review): hidden like discovery,
  -- except from an admin.
  SELECT public.seed_jobs_hidden_publicly()
     AND NOT EXISTS (
       SELECT 1 FROM public.profiles me
        WHERE me.user_id = (SELECT auth.uid()) AND me.is_seed IS TRUE
          AND EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = me.user_id)
     )
     AND NOT COALESCE(public.has_role((SELECT auth.uid()), 'admin'::app_role), false);
$function$;

-- live seed_jobs_hidden_publicly()
CREATE OR REPLACE FUNCTION public.seed_jobs_hidden_publicly()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- Named for the exception so every failure mode (key absent, blob reset,
  -- no settings row at all) resolves to FALSE = fixtures visible = today's
  -- behaviour. Only a deliberate \`true\` written into feature_flags hides them.
  SELECT COALESCE(
    (
      SELECT s.feature_flags -> 'seed_jobs_hidden_publicly' = 'true'::jsonb
      FROM public.platform_settings s
      ORDER BY s.updated_at DESC NULLS LAST
      LIMIT 1
    ),
    false
  );
$function$;

`);
await db.exec("RESET check_function_bodies;");
await db.exec(`
INSERT INTO public.platform_settings (feature_flags) VALUES ('{"seed_jobs_hidden_publicly": true}');
INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin');
INSERT INTO public.profiles (user_id, full_name, skills, location, parish, hourly_rate, phone, email, avatar_url, ban_status, is_seed, email_verified, anonymized_at, date_of_birth, idv_status, created_at) VALUES
  ('${ME}', 'Me Poster', 'Cleaning', 'Lafayette', 'Lafayette', null, null, null, null, null, false, true, null, null, null, now() - interval '9 days'),
  ('${ANA}', 'Ana Marie Broussard', 'Yard work, Pressure washing', 'New Iberia', 'Iberia', 40, '337-555-0101', 'ana@example.com', 'a.png', null, false, true, null, '1990-01-01', 'verified', now() - interval '8 days'),
  ('${BEN}', 'Ben Thibodeaux', 'Cleaning, Moving help', 'Lafayette', 'Lafayette', 25, null, null, null, null, false, true, null, null, null, now() - interval '7 days'),
  ('${NOSKILL}', 'No Skills', '  ', 'Lafayette', 'Lafayette', null, null, null, null, null, false, true, null, null, null, now()),
  ('${BANNED}', 'Banned Person', 'Cleaning', 'Lafayette', 'Lafayette', null, null, null, null, 'permanently_banned', false, true, null, null, null, now()),
  ('${MINOR}', 'Young Helpr', 'Cleaning', 'Lafayette', 'Lafayette', null, null, null, null, null, false, true, null, (now() - interval '16 years')::date, null, now()),
  ('${BLOCKED}', 'Blocked One', 'Cleaning', 'Lafayette', 'Lafayette', null, null, null, null, null, false, true, null, null, null, now()),
  ('${BLOCKER}', 'Blocks Me', 'Cleaning', 'Lafayette', 'Lafayette', null, null, null, null, null, false, true, null, null, null, now()),
  ('${SEED}', 'Seed Helpr', 'Cleaning', 'Lafayette', 'Lafayette', null, null, null, null, null, true, true, null, null, null, now()),
  ('${UNVER}', 'Unverified Email', 'Cleaning', 'Lafayette', 'Lafayette', null, null, null, null, null, false, false, null, null, null, now()),
  ('${GONE}', 'Deleted Account', 'Cleaning', 'Lafayette', 'Lafayette', null, null, null, null, null, false, true, now(), null, null, now()),
  ('${TRICK}', 'Percent Person', '100% effort_guaranteed', 'Scott', 'Lafayette', null, null, null, null, null, false, true, null, null, null, now()),
  ('${ADMIN}', 'Admin Person', null, 'Lafayette', 'Lafayette', null, null, null, null, null, false, true, null, null, null, now()),
  ('${BANNEDME}', 'Banned Caller', null, 'Lafayette', 'Lafayette', null, null, null, null, 'permanently_banned', false, true, null, null, null, now());
INSERT INTO public.user_blocks VALUES ('${ME}', '${BLOCKED}'), ('${BLOCKER}', '${ME}');
`);
if (MODE !== "skip") { for (let i = 0; i < 3; i++) await db.exec(NEW); check("migration applies 3x (replay-safe)", true); }

async function find(role, uid, skill = null, town = null, limit = null) {
  try {
    await db.exec(`SET ROLE ${role}; SELECT set_config('request.uid', '${uid ?? ""}', false), set_config('request.role', '${role}', false);`);
    const r = await db.query(`SELECT * FROM public.find_helprs($1, $2, $3)`, [skill, town, limit]);
    return r;
  } catch (e) { return { error: e.message }; } finally { await db.exec("RESET ROLE;"); }
}
const ids = (r) => (r.rows ?? []).map((x) => x.user_id);

const all = await find("authenticated", ME);
check("a signed-in member gets the directory", !all.error && all.rows?.length > 0, all.error ?? String(all.rows?.length));
check("it lists only members with skills who may be hired, in a stable order",
  JSON.stringify(ids(all)) === JSON.stringify([ANA, BEN, TRICK]), JSON.stringify(ids(all)));
for (const [who, name] of [[ME, "the caller"], [NOSKILL, "a member with no skills"], [BANNED, "a banned member"], [MINOR, "an under-18 member"],
  [BLOCKED, "someone the caller blocked"], [BLOCKER, "someone who blocked the caller"], [SEED, "a test account (seed hidden)"],
  [UNVER, "an unverified email"], [GONE, "a deleted (anonymised) account"]]) {
  check(`leaves out ${name}`, !ids(all).includes(who));
}
const ana = all.rows?.find((r) => r.user_id === ANA) ?? {};
check("names are first name + last initial", ana.full_name === "Ana B.", ana.full_name);
check("returns the town and parish, never a rate, phone, email or address",
  ana.town === "New Iberia" && ana.parish === "Iberia" && !("hourly_rate" in ana) && !("phone" in ana) && !("email" in ana) && !("location" in ana),
  JSON.stringify(Object.keys(ana)));
check("carries the ID-verified badge", ana.is_id_verified === true);

check("skill filter, case-insensitive", JSON.stringify(ids(await find("authenticated", ME, "pressure"))) === JSON.stringify([ANA]));
check("town filter matches the town", JSON.stringify(ids(await find("authenticated", ME, null, "new ib"))) === JSON.stringify([ANA]));
check("town filter matches the parish", JSON.stringify(ids(await find("authenticated", ME, null, "Lafay"))) === JSON.stringify([BEN, TRICK]));
check("both filters together", JSON.stringify(ids(await find("authenticated", ME, "cleaning", "lafayette"))) === JSON.stringify([BEN]));
check("% and _ are literal text, not wildcards", JSON.stringify(ids(await find("authenticated", ME, "%"))) === JSON.stringify([TRICK]));
check("an underscore is literal too (ef_ort finds nothing; effort_g finds the literal)", JSON.stringify(ids(await find("authenticated", ME, "ef_ort"))) === "[]" && JSON.stringify(ids(await find("authenticated", ME, "effort_g"))) === JSON.stringify([TRICK]));
check("the limit is capped at 50 and at least 1", ids(await find("authenticated", ME, null, null, 1)).length === 1 && !(await find("authenticated", ME, null, null, 5000)).error);
check("a search longer than 60 characters is refused", String((await find("authenticated", ME, "x".repeat(61))).error).includes("search_too_long"));

check("anon cannot call it", String((await find("anon", null)).error).match(/permission denied|not_signed_in/) !== null, (await find("anon", null)).error);
check("an authenticated call with no user is refused", String((await find("authenticated", null)).error).includes("not_signed_in"));
check("a caller whose email is not confirmed is refused", String((await find("authenticated", UNVER)).error).includes("email_not_confirmed"));
check("a banned caller is refused", String((await find("authenticated", BANNEDME)).error).includes("account_restricted"));

const admin = await find("authenticated", ADMIN);
check("an admin sees full names and test accounts", admin.rows?.some((r) => r.full_name === "Ana Marie Broussard") && ids(admin).includes(SEED), JSON.stringify(ids(admin)));

const acl = (await db.query(`SELECT coalesce(proacl::text, '') a FROM pg_proc WHERE proname = 'find_helprs'`)).rows[0]?.a;
check("EXECUTE for authenticated only (not PUBLIC, not anon)", acl !== undefined && /authenticated=X/.test(acl) && !/(^|[{,])(=|anon=)[^,}]*X/.test(acl), String(acl));

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
