#!/usr/bin/env node
/**
 * PGlite proof for 20261007132616_policy_helpers_answer_only_for_the_caller
 * (docs/OPEN.md Q1328).
 *
 *   node src/test/pglite/policyHelpersCallerScoped.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/policyHelpersCallerScoped.pglite.mjs # RED: the live state
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * Fixture, READ 2026-10-07 from LIVE prod (read-only pg_get_functiondef /
 * pg_policies): has_role, user_may_see_job_address, group_member_slot,
 * is_server_context and rpc_poster_confirm_member_arrival verbatim; the reviews
 * INSERT policy "Users can create reviews for eligible jobs" verbatim. Stubs:
 * auth.uid() reads request.uid, auth.role() reads request.jwt.claim.role (as
 * scripts/probes/fixtures/applications.live.sql); tables carry only the columns
 * these read. `SET ROLE authenticated` with request.uid set is PostgREST with a
 * user JWT; RESET ROLE with no uid is pg_cron.
 *
 * T* = token swap: a stranger asking about someone else must learn nothing.
 * K* = every caller the live inventory found keeps working.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const NEW = readFileSync(
  new URL("../../../supabase/migrations/20261007132616_policy_helpers_answer_only_for_the_caller.sql", import.meta.url).pathname,
  "utf8",
);
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the LIVE (unfixed) state (expect FAILs)`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const ADMIN = "68c11a39-0000-4000-8000-000000000001";
const POSTER = "96c9899e-87a2-49e2-bbdd-268717d52aee";
const MEMBER = "437de07d-1bd7-46c8-a451-6b46aa3bcad5";
const MEMBER2 = "71c56dfb-b326-4010-b960-b18dd3966e7f";
const STRANGER = "f6cc3ebb-9478-473c-8eb8-62b406f0734f";
const HIRED = "7f65ef12-0000-4000-8000-000000000002";
const CREW = "def709bf-0000-4000-8000-000000000001";
const SOLO = "10000000-0000-4000-8000-000000000001";
const SLOT = "30000000-0000-4000-8000-000000000001";

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.uid', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO anon, authenticated, service_role;

CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
CREATE TYPE public.job_status AS ENUM ('open', 'accepted', 'in_progress', 'revision_requested', 'completed', 'cancelled');
CREATE TABLE public.user_roles (user_id uuid, role public.app_role);
CREATE TABLE public.jobs (
  id uuid PRIMARY KEY, customer_id uuid, helper_id uuid, status public.job_status, payment_status text,
  is_group_job boolean DEFAULT false, has_active_dispute boolean DEFAULT false, dispute_resolved_at timestamptz,
  poster_completed_at timestamptz, helper_completed_at timestamptz, updated_at timestamptz DEFAULT now(),
  offered_to_helper_id uuid, direct_offer_status text, direct_offer_expires_at timestamptz);
CREATE TABLE public.group_job_helpers (
  id uuid PRIMARY KEY, job_id uuid, helper_id uuid, helper_arrived_at timestamptz,
  poster_confirmed_arrival_at timestamptz, poster_confirmed_working_at timestamptz);
CREATE TABLE public.applications (id uuid DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid, status text);
CREATE TABLE public.reviews (id uuid DEFAULT gen_random_uuid(), job_id uuid, reviewer_id uuid, reviewee_id uuid);
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.jobs TO authenticated;
GRANT INSERT, SELECT ON public.reviews TO authenticated;

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

CREATE OR REPLACE FUNCTION public.user_may_see_job_address(_job_id uuid, _user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT _user_id IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id = _job_id
        AND (
          j.customer_id = _user_id
          OR j.helper_id = _user_id
          OR (
            j.offered_to_helper_id = _user_id
            AND j.direct_offer_status = 'pending'
            AND (j.direct_offer_expires_at IS NULL OR j.direct_offer_expires_at > now())
          )
        )
    )
    OR EXISTS (
      SELECT 1 FROM public.group_job_helpers g
      WHERE g.job_id = _job_id AND g.helper_id = _user_id
    )
    OR EXISTS (
      SELECT 1 FROM public.applications a
      WHERE a.job_id = _job_id AND a.helper_id = _user_id AND a.status = 'accepted'
    )
  );
$function$;

CREATE OR REPLACE FUNCTION public.group_member_slot(_job_id uuid, _user_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT g.id
  FROM public.group_job_helpers g
  WHERE g.job_id = _job_id
    AND _user_id IS NOT NULL
    AND g.helper_id = _user_id
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_poster_confirm_member_arrival(_job_id uuid, _helper_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_slot uuid;
  v_row record;
  v_customer uuid;
  v_status text;
  v_now timestamptz := now();
  v_stamp timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT j.customer_id, j.status::text INTO v_customer, v_status
    FROM public.jobs j WHERE j.id = _job_id;
  IF v_customer IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'not_the_poster' USING ERRCODE = '42501';
  END IF;
  IF v_status NOT IN ('accepted', 'in_progress', 'revision_requested') THEN
    RAISE EXCEPTION 'job_not_active' USING ERRCODE = '23514';
  END IF;

  v_slot := public.group_member_slot(_job_id, _helper_id);
  IF v_slot IS NULL THEN
    RAISE EXCEPTION 'not_on_this_crew' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_row FROM public.group_job_helpers WHERE id = v_slot FOR UPDATE;

  IF v_row.helper_arrived_at IS NULL THEN
    RAISE EXCEPTION 'arrival_confirm_before_arrival' USING ERRCODE = '23514',
      HINT = 'That Helpr has not marked arrived yet.';
  END IF;

  UPDATE public.group_job_helpers
     SET poster_confirmed_arrival_at = COALESCE(poster_confirmed_arrival_at, v_now),
         poster_confirmed_working_at = COALESCE(poster_confirmed_working_at, v_now)
   WHERE id = v_slot
   RETURNING poster_confirmed_arrival_at INTO v_stamp;

  RETURN jsonb_build_object('poster_confirmed_arrival_at', v_stamp);
END;
$function$;

-- A definer admin RPC shaped like the live admin_* family: v_uid := auth.uid(), then has_role(v_uid).
CREATE FUNCTION public.zz_admin_only() RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF NOT public.has_role(v_uid, 'admin'::public.app_role) THEN RAISE EXCEPTION 'admin_only'; END IF;
  RETURN 'ok';
END $f$;
-- lift_ban_settlement_review's shape: an admin id passed in, service_role only.
CREATE FUNCTION public.zz_lift(p_admin_id uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
BEGIN
  IF NOT public.has_role(p_admin_id, 'admin'::public.app_role) THEN RAISE EXCEPTION 'admin_only'; END IF;
  RETURN 'ok';
END $f$;
REVOKE ALL ON FUNCTION public.zz_lift(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zz_lift(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.zz_admin_only(), public.rpc_poster_confirm_member_arrival(uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role), public.user_may_see_job_address(uuid, uuid), public.group_member_slot(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role), public.user_may_see_job_address(uuid, uuid), public.group_member_slot(uuid, uuid) TO authenticated, service_role;

CREATE POLICY "Users can create reviews for eligible jobs" ON public.reviews AS PERMISSIVE FOR INSERT TO authenticated
WITH CHECK (((( SELECT auth.uid() AS uid) = reviewer_id) AND (EXISTS ( SELECT 1
   FROM jobs j
  WHERE ((j.id = reviews.job_id) AND (((j.customer_id = ( SELECT auth.uid() AS uid)) AND (j.helper_id = reviews.reviewee_id)) OR ((j.helper_id = ( SELECT auth.uid() AS uid)) AND (j.customer_id = reviews.reviewee_id)) OR ((j.is_group_job IS TRUE) AND (((j.customer_id = ( SELECT auth.uid() AS uid)) AND (group_member_slot(j.id, reviews.reviewee_id) IS NOT NULL)) OR ((group_member_slot(j.id, ( SELECT auth.uid() AS uid)) IS NOT NULL) AND (j.customer_id = reviews.reviewee_id))))) AND (j.status = 'completed'::job_status) AND (j.payment_status = ANY (ARRAY['released'::text, 'payout_pending'::text])) AND ((j.has_active_dispute = false) OR (j.dispute_resolved_at IS NOT NULL)) AND (COALESCE(j.poster_completed_at, j.helper_completed_at, j.updated_at) > (now() - '30 days'::interval)))))));
CREATE POLICY "read own" ON public.reviews FOR SELECT TO authenticated USING (true);

INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin');
INSERT INTO public.jobs (id, customer_id, status, payment_status, is_group_job) VALUES ('${CREW}', '${POSTER}', 'in_progress', 'escrow', true);
INSERT INTO public.jobs (id, customer_id, helper_id, status, payment_status) VALUES ('${SOLO}', '${POSTER}', '${HIRED}', 'accepted', 'escrow');
INSERT INTO public.group_job_helpers (id, job_id, helper_id, helper_arrived_at) VALUES ('${SLOT}', '${CREW}', '${MEMBER}', now());
INSERT INTO public.group_job_helpers (id, job_id, helper_id) VALUES (gen_random_uuid(), '${CREW}', '${MEMBER2}');
`);
if (MODE !== "skip") for (let i = 0; i < 3; i++) await db.exec(NEW);

async function as(who, sql) {
  const cron = who === "cron";
  await db.exec(`RESET ROLE; SELECT set_config('request.uid', '${who && who !== "service" && !cron ? who : ""}', false);`);
  await db.exec(`SELECT set_config('request.jwt.claim.role', '${cron ? "" : who === "service" ? "service_role" : who ? "authenticated" : "anon"}', false)`);
  if (!cron) await db.exec(who === "service" ? "SET ROLE service_role" : who ? "SET ROLE authenticated" : "SET ROLE anon");
  try { const r = await db.query(sql); return { ok: true, rows: r.rows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("RESET ROLE"); }
}
const one = async (who, sql) => {
  const r = await as(who, sql);
  return r.ok ? Object.values(r.rows[0])[0] : `ERR ${r.err}`;
};

// ── T: a stranger asking about someone else learns nothing (RED on live) ──
check("T1 a stranger cannot learn that an id is an admin", (await one(STRANGER, `SELECT public.has_role('${ADMIN}', 'admin')`)) === false);
check("T2 a stranger cannot learn who is hired on a job", (await one(STRANGER, `SELECT public.user_may_see_job_address('${SOLO}', '${HIRED}')`)) === false);
check("T3 a stranger cannot learn who is on a crew", (await one(STRANGER, `SELECT public.group_member_slot('${CREW}', '${MEMBER}')`)) === null);
check("T4 a crew member cannot look up a co-member's slot", (await one(MEMBER2, `SELECT public.group_member_slot('${CREW}', '${MEMBER}')`)) === null);
check("T5 the hired Helpr cannot ask about the poster's other jobs' parties", (await one(HIRED, `SELECT public.user_may_see_job_address('${CREW}', '${MEMBER}')`)) === false);
check("T6 an anonymous caller still has no EXECUTE", String(await one(null, `SELECT public.has_role('${ADMIN}', 'admin')`)).startsWith("ERR"));

// ── K: every caller in the live inventory keeps its answer ────────────────
check("K1 has_role(auth.uid()) for an admin is true", (await one(ADMIN, `SELECT public.has_role(auth.uid(), 'admin')`)) === true);
check("K2 has_role(auth.uid()) for a non-admin is false (never NULL)", (await one(STRANGER, `SELECT public.has_role(auth.uid(), 'admin')`)) === false);
check("K3 an admin RPC (v_uid := auth.uid()) admits the admin", (await one(ADMIN, `SELECT public.zz_admin_only()`)) === "ok");
check("K4 an admin RPC refuses a non-admin", String(await one(STRANGER, `SELECT public.zz_admin_only()`)).includes("admin_only"));
check("K5 service_role passing an admin id (lift_ban_settlement_review) still passes", (await one("service", `SELECT public.zz_lift('${ADMIN}')`)) === "ok");
check("K6 cron (no JWT) asking about another id still gets the truth", (await one("cron", `SELECT public.has_role('${ADMIN}', 'admin')`)) === true);
check("K7 an admin may still ask about another id", (await one(ADMIN, `SELECT public.user_may_see_job_address('${SOLO}', '${HIRED}')`)) === true);
check("K7b an admin may ask has_role about another id", (await one(ADMIN, `SELECT public.has_role('${ADMIN}', 'admin') AND NOT public.has_role('${STRANGER}', 'admin')`)) === true && (await one(ADMIN, `SELECT public.has_role('${POSTER}', 'admin')`)) === false);
await db.exec(`INSERT INTO public.user_roles VALUES ('${HIRED}', 'admin')`);
check("K7c an admin may ask has_role about ANOTHER admin (the admin branch, not the self branch)", (await one(ADMIN, `SELECT public.has_role('${HIRED}', 'admin')`)) === true);
await db.exec(`DELETE FROM public.user_roles WHERE user_id = '${HIRED}'`);
check("K7d an admin may ask group_member_slot about a crew member", (await one(ADMIN, `SELECT public.group_member_slot('${CREW}', '${MEMBER}')`)) === SLOT);
// NULL arguments under a user JWT (db-smoke covers them only in server context).
check("N1 has_role(NULL) under a user JWT is false, not NULL", (await one(ADMIN, `SELECT public.has_role(NULL, 'admin')`)) === false);
check("N2 user_may_see_job_address(job, NULL) under a user JWT is false", (await one(HIRED, `SELECT public.user_may_see_job_address('${SOLO}', NULL)`)) === false);
check("N3 group_member_slot(job, NULL) under a user JWT is NULL", (await one(POSTER, `SELECT public.group_member_slot('${CREW}', NULL)`)) === null);
check("K8 the hired Helpr asking about themselves is true", (await one(HIRED, `SELECT public.user_may_see_job_address('${SOLO}', auth.uid())`)) === true);
check("K9 a member asking for their own slot gets it", (await one(MEMBER, `SELECT public.group_member_slot('${CREW}', auth.uid())`)) === SLOT);
check("K10 the poster may look up a member of THEIR crew", (await one(POSTER, `SELECT public.group_member_slot('${CREW}', '${MEMBER}')`)) === SLOT);
{
  const r = await as(POSTER, `SELECT public.rpc_poster_confirm_member_arrival('${CREW}', '${MEMBER}') AS r`);
  check("K11 rpc_poster_confirm_member_arrival (poster asks about a member) still confirms", r.ok && !!r.rows[0].r.poster_confirmed_arrival_at, r.ok ? "" : r.err);
}
await db.exec(`UPDATE public.jobs SET status = 'completed', payment_status = 'released', poster_completed_at = now() WHERE id = '${CREW}'`);
{
  const r = await as(POSTER, `INSERT INTO public.reviews (job_id, reviewer_id, reviewee_id) VALUES ('${CREW}', '${POSTER}', '${MEMBER}') RETURNING id`);
  check("K12 reviews policy: the poster reviews a crew member", r.ok && r.rows.length === 1, r.ok ? "" : r.err);
  const m = await as(MEMBER, `INSERT INTO public.reviews (job_id, reviewer_id, reviewee_id) VALUES ('${CREW}', '${MEMBER}', '${POSTER}') RETURNING id`);
  check("K13 reviews policy: a crew member reviews the poster", m.ok && m.rows.length === 1, m.ok ? "" : m.err);
  const s = await as(STRANGER, `INSERT INTO public.reviews (job_id, reviewer_id, reviewee_id) VALUES ('${CREW}', '${STRANGER}', '${POSTER}') RETURNING id`);
  check("K14 reviews policy: a stranger still cannot review the poster", !s.ok, s.ok ? "inserted" : "refused");
}

// ── grants are what live has ─────────────────────────────────────────────
{
  const acl = (await db.query(`SELECT p.proname, p.proacl::text a FROM pg_proc p WHERE p.proname IN ('has_role','user_may_see_job_address','group_member_slot') ORDER BY 1`)).rows;
  const bad = acl.filter((r) => !/authenticated=X/.test(r.a) || /anon=/.test(r.a) || /(^|[{,])=X/.test(r.a));
  check("G1 authenticated + service_role keep EXECUTE; no PUBLIC, no anon", bad.length === 0 && acl.length === 3, acl.map((r) => `${r.proname}:${r.a}`).join(" "));
}

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
