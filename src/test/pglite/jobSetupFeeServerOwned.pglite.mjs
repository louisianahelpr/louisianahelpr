#!/usr/bin/env node
/**
 * PGlite proof for 20261007140847_job_setup_fee_stamp (docs/OPEN.md Q1346).
 *
 *   node src/test/pglite/jobSetupFeeServerOwned.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/jobSetupFeeServerOwned.pglite.mjs # RED: the live state
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * jobs.onboarding_fee_amount is the setup fee a job's checkout collected; only
 * the payment webhook (service role) may write it. Fixture: the two LIVE
 * trigger functions it is locked by (scripts/probes/fixtures/
 * prevent_job_field_escalation.live.sql, enforce_jobs_insert_column_lock.live.sql,
 * read 2026-10-07), is_server_context and sync_jobs_select_grants verbatim, and a jobs table with the
 * columns those bodies read. `SET ROLE authenticated` with request.uid set is
 * PostgREST with a user JWT.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (rel) => readFileSync(new URL(rel, import.meta.url).pathname, "utf8");
const NEW = read("../../../supabase/migrations/20261007140847_job_setup_fee_stamp.sql");
const LIVE_UPDATE_LOCK = read("../../../scripts/probes/fixtures/prevent_job_field_escalation.live.sql");
const LIVE_INSERT_LOCK = read("../../../scripts/probes/fixtures/enforce_jobs_insert_column_lock.live.sql");
const SYNC_GRANTS = `CREATE OR REPLACE FUNCTION public.sync_jobs_select_grants()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_private   text[] := public.jobs_private_select_columns();
  v_readable  text[];
  v_needs_fix boolean := false;
  v_col       text;
BEGIN
  IF to_regclass('public.jobs') IS NULL THEN
    RETURN jsonb_build_object('repaired', false, 'reason', 'public.jobs absent');
  END IF;

  SELECT array_agg(a.attname::text ORDER BY a.attnum)
    INTO v_readable
    FROM pg_attribute a
   WHERE a.attrelid = 'public.jobs'::regclass
     AND a.attnum > 0
     AND NOT a.attisdropped
     AND NOT (a.attname::text = ANY (v_private));

  IF v_readable IS NULL OR array_length(v_readable, 1) IS NULL THEN
    -- Refuse to revoke SELECT and grant nothing back.
    RETURN jsonb_build_object('repaired', false, 'reason', 'no readable columns resolved');
  END IF;

  -- Drift test, lock-free: a table-level SELECT anywhere, a private column
  -- still selectable, or a readable column that is not.
  IF has_table_privilege('authenticated', 'public.jobs', 'SELECT')
     OR has_table_privilege('anon', 'public.jobs', 'SELECT') THEN
    v_needs_fix := true;
  ELSE
    FOREACH v_col IN ARRAY v_private LOOP
      IF EXISTS (SELECT 1 FROM pg_attribute
                  WHERE attrelid = 'public.jobs'::regclass AND attname = v_col AND NOT attisdropped)
         AND (has_column_privilege('authenticated', 'public.jobs', v_col, 'SELECT')
              OR has_column_privilege('anon', 'public.jobs', v_col, 'SELECT')) THEN
        v_needs_fix := true;
      END IF;
    END LOOP;
    IF NOT v_needs_fix THEN
      FOREACH v_col IN ARRAY v_readable LOOP
        IF NOT has_column_privilege('authenticated', 'public.jobs', v_col, 'SELECT') THEN
          v_needs_fix := true;
          EXIT;
        END IF;
      END LOOP;
    END IF;
  END IF;

  IF NOT v_needs_fix THEN
    RETURN jsonb_build_object('repaired', false,
                              'private_columns', to_jsonb(v_private),
                              'granted_columns', array_length(v_readable, 1));
  END IF;

  -- A table-level REVOKE also removes every column-level SELECT grant, so this
  -- starts from nothing. anon gets nothing back: it held no SELECT on jobs
  -- before this migration (guest browse reads open_jobs_browse).
  REVOKE SELECT ON public.jobs FROM PUBLIC, anon, authenticated;
  EXECUTE format(
    'GRANT SELECT (%s) ON public.jobs TO authenticated',
    (SELECT string_agg(quote_ident(c), ', ') FROM unnest(v_readable) AS c)
  );

  RETURN jsonb_build_object('repaired', true,
                            'private_columns', to_jsonb(v_private),
                            'granted_columns', array_length(v_readable, 1));
END;
$function$;`;
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the LIVE (unfixed) state (expect FAILs)`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const POSTER = "71c56dfb-b326-4010-b960-b18dd3966e7f";
const HELPR = "437de07d-1bd7-46c8-a451-6b46aa3bcad5";
const JOB = "10000000-0000-4000-8000-000000000001";

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.uid', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO anon, authenticated, service_role;
CREATE FUNCTION public.is_server_context() RETURNS boolean LANGUAGE sql STABLE SET search_path TO '' AS $function$
  SELECT auth.uid() IS NULL
     AND coalesce(auth.role(), '') NOT IN ('anon', 'authenticated')
     AND coalesce(current_setting('role', true), 'none') NOT IN ('anon', 'authenticated')
$function$;
CREATE TABLE public.user_roles (user_id uuid, role text);
CREATE FUNCTION public.has_role(u uuid, r text) RETURNS boolean LANGUAGE sql STABLE
  AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = u AND role = r) $$;
CREATE TABLE public.profiles (user_id uuid, is_seed boolean DEFAULT false);
CREATE TABLE public.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid, helper_id uuid, status text DEFAULT 'open',
  title text, budget numeric, payment_status text DEFAULT 'unpaid', stripe_payment_intent_id text, stripe_session_id text,
  boosted_at timestamptz, boost_expires_at timestamptz, is_seed boolean, recurring_helper_id uuid,
  helper_confirmed_at timestamptz, helper_on_the_way_at timestamptz, helper_arrived_at timestamptz,
  helper_arrival_verified_at timestamptz, helper_arrival_near_miss_at timestamptz, helper_arrival_near_miss_ft numeric,
  poster_confirmed_at timestamptz, helper_completed_at timestamptz, poster_completed_at timestamptz,
  payout_scheduled_at timestamptz, created_at timestamptz DEFAULT now(), offered_to_helper_id uuid,
  direct_offer_status text, direct_offer_expires_at timestamptz, customer_fee_amount numeric
);
GRANT INSERT, UPDATE ON public.jobs TO authenticated;
-- As live: authenticated reads jobs by COLUMN grant (no table-level SELECT),
-- so a new column is unreadable until a migration grants it.
DO $g$ DECLARE c text; BEGIN
  FOR c IN SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'jobs' LOOP
    EXECUTE format('GRANT SELECT (%I) ON public.jobs TO authenticated', c);
  END LOOP;
END $g$;
GRANT ALL ON public.jobs TO service_role;
GRANT SELECT ON public.profiles TO authenticated;
`);
// Live sync_jobs_select_grants (read 2026-10-07) with its private-column list.
await db.exec(`CREATE FUNCTION public.jobs_private_select_columns() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT ARRAY['offered_to_helper_id'] $$;`);
await db.exec(SYNC_GRANTS);
await db.exec(LIVE_UPDATE_LOCK);
await db.exec(LIVE_INSERT_LOCK);
await db.exec(`
CREATE TRIGGER trg_prevent_job_field_escalation BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.prevent_job_field_escalation();
CREATE TRIGGER trg_jobs_insert_column_lock BEFORE INSERT ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.enforce_jobs_insert_column_lock();
INSERT INTO public.profiles (user_id) VALUES ('${POSTER}');
INSERT INTO public.jobs (id, customer_id, title, budget, payment_status, stripe_payment_intent_id)
  VALUES ('${JOB}', '${POSTER}', 'First job', 10, 'escrow', 'pi_1');
`);
if (MODE !== "skip") for (let i = 0; i < 3; i++) await db.exec(NEW);

async function as(who, sql) {
  await db.exec(`RESET ROLE; SELECT set_config('request.uid', '${who && who !== "service" ? who : ""}', false);`);
  await db.exec(`SELECT set_config('request.jwt.claim.role', '${who === "service" ? "service_role" : who ? "authenticated" : "anon"}', false)`);
  await db.exec(who === "service" ? "SET ROLE service_role" : "SET ROLE authenticated");
  try { const r = await db.query(sql); return { ok: true, rows: r.rows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("RESET ROLE"); }
}
const fee = async (id = JOB) => {
  try { return (await db.query(`SELECT onboarding_fee_amount::text AS f FROM public.jobs WHERE id = '${id}'`)).rows[0]?.f ?? null; }
  catch (e) { return `ERR ${e.message}`; }
};

// ── the webhook (service role) stamps it ─────────────────────────────────
{
  const r = await as("service", `UPDATE public.jobs SET onboarding_fee_amount = 2.00 WHERE id = '${JOB}' RETURNING id`);
  check("S1 the payment webhook (service role) stamps the setup fee", r.ok && r.rows.length === 1 && (await fee()) === "2.00", r.ok ? String(await fee()) : r.err);
}
// ── no client seat may write it ──────────────────────────────────────────
{
  const r = await as(POSTER, `UPDATE public.jobs SET onboarding_fee_amount = 0 WHERE id = '${JOB}' RETURNING id`);
  check("C1 the poster cannot clear it (their Spent would drop the fee)", !r.ok && /set by the platform/.test(r.err) && (await fee()) === "2.00", r.ok ? "updated" : r.err);
  const h = await as(HELPR, `UPDATE public.jobs SET onboarding_fee_amount = 50 WHERE id = '${JOB}' RETURNING id`);
  check("C2 nobody else can write it either", !h.ok || h.rows.length === 0, h.ok ? `${h.rows.length} row(s)` : h.err);
  const ins = await as(POSTER, `INSERT INTO public.jobs (customer_id, title, budget, onboarding_fee_amount) VALUES ('${POSTER}', 'Second', 10, 99) RETURNING id`);
  const insFee = ins.ok ? await fee(ins.rows[0].id) : null;
  check("C3 a poster's INSERT cannot plant one (cleared to NULL)", ins.ok && insFee === null, ins.ok ? `fee=${insFee}` : ins.err);
  const other = await as(POSTER, `UPDATE public.jobs SET title = 'First job, renamed' WHERE id = '${JOB}' RETURNING id`);
  check("C4 control: the poster's ordinary edits still land", other.ok && other.rows.length === 1, other.ok ? "" : other.err);
}
// ── the client can read it (column grant) ────────────────────────────────
{
  const r = await as(POSTER, `SELECT onboarding_fee_amount FROM public.jobs WHERE id = '${JOB}'`);
  check("R1 authenticated may SELECT the column (Spent reads it)", r.ok && String(r.rows[0]?.onboarding_fee_amount) === "2.00", r.ok ? JSON.stringify(r.rows) : r.err);
}

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
