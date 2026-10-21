#!/usr/bin/env node
/**
 * PGlite proof for 20261021001940_job_photos_share_opt_out (owner 2026-10-20:
 * job photos on social media, with an opt-out).
 *
 *   node src/test/pglite/jobPhotosShareable.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/jobPhotosShareable.pglite.mjs   # RED: no column, no function
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 * Fixture: profiles / jobs with the columns the function reads, the own-row
 * profile UPDATE policy, has_role verbatim (md5 checked as in
 * adminListSignupLeads.pglite.mjs), and job_booked_helpr_ids modelled as the
 * job's helper_id plus a crew table. The migration is applied 3x, then:
 *   - the column defaults to true and a member can turn their OWN flag off,
 *     never another member's;
 *   - job_photos_shareable is true only when the poster AND every booked Helpr
 *     allow it; false when either side opted out, when no Helpr is booked,
 *     when a crew member opted out, and for a missing job;
 *   - a signed-in non-admin is refused (admin_only); anon has no EXECUTE;
 *   - profiles UPDATE is granted by column, as on prod, so S11 proves the GRANT;
 *   - a banned member may turn sharing OFF but not back ON (ban lock exemption).
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const NEW = readFileSync(new URL("../../../supabase/migrations/20261021001940_job_photos_share_opt_out.sql", import.meta.url).pathname, "utf8");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running without the migration (expect FAILs)`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const ADMIN = "aaaaaaaa-0000-4000-8000-000000000001";
const POSTER = "bbbbbbbb-0000-4000-8000-000000000001";
const HELPR = "cccccccc-0000-4000-8000-000000000001";
const CREW = "dddddddd-0000-4000-8000-000000000001";
const J_SOLO = "11111111-0000-4000-8000-000000000001";
const J_CREW = "11111111-0000-4000-8000-000000000002";
const J_OPEN = "11111111-0000-4000-8000-000000000003";

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.uid', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
CREATE TABLE public.user_roles (user_id uuid NOT NULL, role public.app_role NOT NULL);
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$function$;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;

CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, full_name text, bio text, ban_status text, updated_at timestamptz);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own row read" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "own row update" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
-- Prod (live, 2026-10-20): SELECT on the table, but UPDATE only on a NAMED column list.
GRANT SELECT ON public.profiles TO authenticated;
GRANT UPDATE (full_name, bio) ON public.profiles TO authenticated;
-- The ban lock's helpers, modelled: a member is banned when listed here.
CREATE TABLE public.banned (user_id uuid);
CREATE FUNCTION public.is_server_context() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT EXISTS (SELECT 1 FROM public.banned WHERE user_id = auth.uid()) $$;

CREATE TABLE public.jobs (id uuid PRIMARY KEY, customer_id uuid, helper_id uuid);
CREATE TABLE public.crew (job_id uuid, helper_id uuid);
CREATE FUNCTION public.job_booked_helpr_ids(p_job_id uuid) RETURNS uuid[] LANGUAGE sql STABLE AS $$
  SELECT coalesce(array_agg(DISTINCT h) FILTER (WHERE h IS NOT NULL), '{}')
    FROM (SELECT helper_id AS h FROM public.jobs WHERE id = p_job_id
          UNION ALL SELECT helper_id FROM public.crew WHERE job_id = p_job_id) x
$$;

INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin');
INSERT INTO public.profiles (user_id, full_name) VALUES ('${ADMIN}', 'A'), ('${POSTER}', 'P'), ('${HELPR}', 'H'), ('${CREW}', 'C');
INSERT INTO public.jobs VALUES ('${J_SOLO}', '${POSTER}', '${HELPR}'), ('${J_CREW}', '${POSTER}', '${HELPR}'), ('${J_OPEN}', '${POSTER}', NULL);
INSERT INTO public.crew VALUES ('${J_CREW}', '${CREW}');
`);
{
  const m = (await db.query(`SELECT md5(prosrc) AS m FROM pg_proc WHERE proname = 'has_role'`)).rows[0].m;
  check("fixture: has_role is prod's code (md5 of prosrc)", m === "dae5cfc5a8d92461a428f6702e4e65af", m);
}
await db.exec("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;");
if (MODE !== "skip") for (let i = 0; i < 3; i++) await db.exec(NEW);
// The ban lock is a BEFORE UPDATE trigger on prod; attach the (migration's) function the same way.
if (MODE !== "skip") await db.exec("CREATE TRIGGER tr_ban_lock BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.enforce_banned_profile_text_lock();");

async function as(who, sql) {
  const role = who ? "authenticated" : "anon";
  await db.exec(`RESET ROLE; SELECT set_config('request.uid', '${who ?? ""}', false);`);
  await db.exec(`SET ROLE ${role}`);
  try { const r = await db.query(sql); return { ok: true, rows: r.rows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("RESET ROLE"); }
}
const shareable = async (job) => {
  const r = await as(ADMIN, `SELECT public.job_photos_shareable('${job}') AS s`);
  return r.ok ? r.rows[0].s : `ERR ${r.err}`;
};
const setFlag = async (who, on) => db.exec(`UPDATE public.profiles SET share_job_photos = ${on} WHERE user_id = '${who}'`);

{
  const r = await as(POSTER, `SELECT share_job_photos FROM public.profiles WHERE user_id = '${POSTER}'`);
  check("S1 the switch defaults to ON", r.ok && r.rows[0]?.share_job_photos === true, r.ok ? JSON.stringify(r.rows) : r.err);
}
check("S2 shareable when the poster and the Helpr both allow it", (await shareable(J_SOLO)) === true, String(await shareable(J_SOLO)));
await setFlag(POSTER, false);
check("S3 NOT shareable when the poster opted out", (await shareable(J_SOLO)) === false, String(await shareable(J_SOLO)));
await setFlag(POSTER, true); await setFlag(HELPR, false);
check("S4 NOT shareable when the Helpr opted out", (await shareable(J_SOLO)) === false, String(await shareable(J_SOLO)));
await setFlag(HELPR, true);
check("S5 a crew job is shareable when everyone allows it", (await shareable(J_CREW)) === true, String(await shareable(J_CREW)));
await setFlag(CREW, false);
check("S6 a crew job is NOT shareable when one crew Helpr opted out", (await shareable(J_CREW)) === false, String(await shareable(J_CREW)));
await setFlag(CREW, true);
check("S7 no Helpr booked: nothing to share", (await shareable(J_OPEN)) === false, String(await shareable(J_OPEN)));
check("S8 a missing job is never shareable", (await shareable("11111111-0000-4000-8000-0000000000ff")) === false);
{
  const r = await as(POSTER, `SELECT public.job_photos_shareable('${J_SOLO}')`);
  check("S9 a signed-in non-admin is refused (admin_only)", !r.ok && /admin_only/.test(r.err), r.ok ? "read it" : r.err);
  const r2 = await as(null, `SELECT public.job_photos_shareable('${J_SOLO}')`);
  check("S10 anon has no EXECUTE", !r2.ok && /permission denied/.test(r2.err), r2.ok ? "ran" : r2.err);
}
{
  const own = await as(HELPR, `UPDATE public.profiles SET share_job_photos = false WHERE user_id = '${HELPR}' RETURNING share_job_photos`);
  check("S11 a member turns their OWN switch off", own.ok && own.rows[0]?.share_job_photos === false, own.ok ? JSON.stringify(own.rows) : own.err);
  const other = await as(HELPR, `UPDATE public.profiles SET share_job_photos = false WHERE user_id = '${POSTER}' RETURNING user_id`);
  check("S12 ...and can never change another member's", other.ok && other.rows.length === 0, other.ok ? JSON.stringify(other.rows) : other.err);
}
{
  await db.exec(`INSERT INTO public.banned VALUES ('${CREW}')`);
  const off = await as(CREW, `UPDATE public.profiles SET share_job_photos = false WHERE user_id = '${CREW}' RETURNING share_job_photos`);
  check("S13 a banned member can still turn sharing OFF", off.ok && off.rows[0]?.share_job_photos === false, off.ok ? JSON.stringify(off.rows) : off.err);
  const on = await as(CREW, `UPDATE public.profiles SET share_job_photos = true WHERE user_id = '${CREW}' RETURNING share_job_photos`);
  check("S14 ...but cannot turn it back ON (account_restricted)", !on.ok && /account_restricted/.test(on.err), on.ok ? JSON.stringify(on.rows) : on.err);
}
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
