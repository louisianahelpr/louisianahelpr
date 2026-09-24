#!/usr/bin/env node
/**
 * PGlite proof for 20260924044812_recurring_helper_rpc_only (Q356).
 *
 *   node scripts/probes/recurring-helper-rpc-only.pglite.mjs
 *
 * pglite is not a dependency (CLAUDE.md):
 *   mkdir -p ~/.lh-pglite-probe && cd ~/.lh-pglite-probe && npm i @electric-sql/pglite
 *
 * The "before" schema is the prod state this fixes: the Q346 migration
 * (20260924042503) verbatim, the previous enforce_jobs_insert_column_lock
 * verbatim from 20260915101102, and stamp_recurring_series_helper verbatim from
 * live (pg_get_functiondef, 2026-09-24) on its live trigger name, so the live
 * trigger ORDER (trg_hire_columns_rpc_only < trg_stamp_recurring_series_helper
 * < ... ; trg_jobs_insert_column_lock before stamp on INSERT) is reproduced.
 * Client seat = `SET ROLE authenticated` with request.jwt.claim.sub = the user.
 *
 *   RED-BEFORE: poster PATCH recurring_helper_id=<anyone> lands; direct-offer
 *     target PATCH recurring_helper_id=self lands; poster INSERT of a job with
 *     recurring_helper_id=<anyone> keeps it.
 *   AFTER (migration verbatim, applied 3x): all three refused / nulled; the
 *     legit stamp (hired helper's helper_confirmed_at PATCH) still stamps
 *     recurring_helper_id = helper_id; clearing still allowed; service_role
 *     still writes; the Q346 refusals still hold.
 */
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${process.env.HOME}/.lh-pglite-probe`;
let PGlite;
try {
  ({ PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`));
} catch {
  console.error(`Could not load pglite from ${PGLITE_DIR} (npm i @electric-sql/pglite there).`);
  process.exit(2);
}
import { readFileSync } from "node:fs";

const mig = (f) => readFileSync(new URL(`../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const MIGRATION = mig("20260924044812_recurring_helper_rpc_only.sql");
const Q346 = mig("20260924042503_hire_columns_rpc_only.sql");
const oldLockSrc = mig("20260915101102_null_uid_is_not_server.sql");
const OLD_INSERT_LOCK = (() => {
  const start = oldLockSrc.indexOf("CREATE OR REPLACE FUNCTION public.enforce_jobs_insert_column_lock()");
  const end = oldLockSrc.indexOf("$function$;", start);
  if (start < 0 || end < 0) throw new Error("old enforce_jobs_insert_column_lock not found");
  return oldLockSrc.slice(start, end + "$function$;".length);
})();

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const P = "11111111-1111-1111-1111-111111111111"; // poster
const H = "22222222-2222-2222-2222-222222222222"; // helper (hired / offered)
const X = "33333333-3333-3333-3333-333333333333"; // someone who never applied
const J = (n) => `a0000000-0000-0000-0000-00000000000${n}`;

const SETUP = `
  DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF; END $$;
  DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF; END $$;
  DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF; END $$;
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
    $f$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  GRANT USAGE ON SCHEMA auth TO authenticated, anon, service_role;
  CREATE FUNCTION public.is_server_context() RETURNS boolean LANGUAGE sql STABLE AS
    $f$ SELECT current_setting('request.jwt.claim.sub', true) IS NULL OR current_setting('request.jwt.claim.sub', true) = '' $f$;
  CREATE TYPE public.job_status AS ENUM ('open','accepted','in_progress','completed','cancelled');
  CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, is_seed boolean DEFAULT false);
  CREATE TABLE public.jobs (
    id uuid PRIMARY KEY, customer_id uuid, helper_id uuid, status public.job_status DEFAULT 'open',
    title text, offered_to_helper_id uuid, direct_offer_status text,
    recurrence_days int[], parent_job_id uuid, recurring_helper_id uuid,
    payment_status text, stripe_payment_intent_id text, stripe_session_id text,
    boosted_at timestamptz, boost_expires_at timestamptz, is_seed boolean,
    helper_confirmed_at timestamptz, helper_on_the_way_at timestamptz, helper_arrived_at timestamptz,
    helper_arrival_verified_at timestamptz, helper_arrival_near_miss_at timestamptz,
    helper_arrival_near_miss_ft numeric, poster_confirmed_at timestamptz,
    helper_completed_at timestamptz, poster_completed_at timestamptz, payout_scheduled_at timestamptz,
    response_deadline timestamptz);
  GRANT USAGE ON SCHEMA public TO authenticated, anon, service_role;
  GRANT SELECT, INSERT, UPDATE ON public.jobs TO authenticated, service_role;
  GRANT SELECT ON public.profiles TO authenticated, service_role;
  -- stamp_recurring_series_helper, verbatim from live 2026-09-24.
  CREATE OR REPLACE FUNCTION public.stamp_recurring_series_helper()
   RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
  AS $function$
  BEGIN
    IF NEW.recurrence_days IS NOT NULL
       AND NEW.parent_job_id IS NULL
       AND NEW.helper_confirmed_at IS NOT NULL
       AND (TG_OP = 'INSERT' OR OLD.helper_confirmed_at IS NULL)
       AND NEW.helper_id IS NOT NULL
       AND NEW.recurring_helper_id IS NULL THEN
      NEW.recurring_helper_id := NEW.helper_id;
    END IF;
    IF TG_OP = 'UPDATE'
       AND OLD.recurring_helper_id IS NOT NULL
       AND OLD.helper_id = OLD.recurring_helper_id
       AND NEW.helper_id IS NULL THEN
      NEW.recurring_helper_id := NULL;
    END IF;
    RETURN NEW;
  END;
  $function$;
  CREATE TRIGGER trg_stamp_recurring_series_helper BEFORE INSERT OR UPDATE ON public.jobs
    FOR EACH ROW EXECUTE FUNCTION public.stamp_recurring_series_helper();
  CREATE TABLE public.group_job_helpers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid);
  ${Q346}
  ${OLD_INSERT_LOCK}
  CREATE TRIGGER trg_jobs_insert_column_lock BEFORE INSERT ON public.jobs
    FOR EACH ROW EXECUTE FUNCTION public.enforce_jobs_insert_column_lock();
`;
// Seeded as the server (no jwt sub => is_server_context), so the insert lock passes.
const SEED = `
  INSERT INTO public.jobs (id, customer_id, title, recurrence_days) VALUES
    ('${J(1)}', '${P}', 'A', NULL);
  INSERT INTO public.jobs (id, customer_id, title, recurrence_days, offered_to_helper_id, direct_offer_status) VALUES
    ('${J(2)}', '${P}', 'B', '{2}', '${H}', 'pending');
  INSERT INTO public.jobs (id, customer_id, title, recurrence_days, helper_id, status) VALUES
    ('${J(3)}', '${P}', 'stamp', '{5}', '${H}', 'accepted');
  INSERT INTO public.jobs (id, customer_id, title, recurrence_days, recurring_helper_id) VALUES
    ('${J(4)}', '${P}', 'clear', '{4}', '${X}'), ('${J(5)}', '${P}', 'sr', '{3}', NULL);
`;

async function as(db, role, uid, sql) {
  try {
    await db.exec(`SET request.jwt.claim.sub = '${uid ?? ""}'; SET ROLE ${role}; ${sql}; RESET ROLE; RESET request.jwt.claim.sub;`);
    return "ok";
  } catch (e) {
    await db.exec("RESET ROLE; RESET request.jwt.claim.sub;");
    return String(e.message).split("\n")[0];
  }
}

async function run(label, migration, times) {
  const db = new PGlite();
  await db.exec(SETUP);
  for (let i = 0; i < times; i++) await db.exec(migration);
  await db.exec(SEED);
  const r = {
    A: await as(db, "authenticated", P, `UPDATE public.jobs SET recurrence_days='{1,3}', recurring_helper_id='${X}' WHERE id='${J(1)}'`),
    B: await as(db, "authenticated", H, `UPDATE public.jobs SET recurring_helper_id='${H}' WHERE id='${J(2)}'`),
    insert: await as(db, "authenticated", P, `INSERT INTO public.jobs (id, customer_id, title, recurrence_days, recurring_helper_id) VALUES ('${J(6)}', '${P}', 'ins', '{1}', '${X}')`),
    stamp: await as(db, "authenticated", H, `UPDATE public.jobs SET helper_confirmed_at=now(), response_deadline=NULL WHERE id='${J(3)}'`),
    clear: await as(db, "authenticated", P, `UPDATE public.jobs SET recurring_helper_id=NULL WHERE id='${J(4)}'`),
    sr: await as(db, "service_role", null, `UPDATE public.jobs SET recurring_helper_id='${X}' WHERE id='${J(5)}'`),
    q346: await as(db, "authenticated", P, `UPDATE public.jobs SET helper_id='${X}', status='accepted' WHERE id='${J(1)}'`),
    editTitle: await as(db, "authenticated", P, `UPDATE public.jobs SET title='renamed' WHERE id='${J(2)}'`),
  };
  const rows = (await db.query(`SELECT id, helper_id, recurring_helper_id FROM public.jobs ORDER BY id`)).rows;
  await db.close();
  console.log(`-- ${label}: ${JSON.stringify(r)}`);
  return { r, rows: Object.fromEntries(rows.map((x) => [x.id, x])) };
}

const before = await run("RED-BEFORE (Q346 only)", "", 1);
check("before: poster PATCH recurring_helper_id=<anyone> lands", before.r.A === "ok" && before.rows[J(1)].recurring_helper_id === X, before.r.A);
check("before: offer target PATCH recurring_helper_id=self lands", before.r.B === "ok" && before.rows[J(2)].recurring_helper_id === H, before.r.B);
check("before: client INSERT keeps recurring_helper_id=<anyone>", before.r.insert === "ok" && before.rows[J(6)]?.recurring_helper_id === X, before.r.insert);

const after = await run("AFTER (migration verbatim, 3x)", MIGRATION, 3);
const refused = (v) => /hire_requires_rpc/.test(v);
check("after: A poster PATCH refused", refused(after.r.A), after.r.A);
check("after: A row unchanged", after.rows[J(1)].recurring_helper_id === null);
check("after: B offer-target PATCH refused", refused(after.r.B), after.r.B);
check("after: B row unchanged", after.rows[J(2)].recurring_helper_id === null);
check("after: client INSERT has recurring_helper_id nulled", after.r.insert === "ok" && after.rows[J(6)]?.recurring_helper_id === null, after.r.insert);
check("after: hired helper's confirm still stamps recurring_helper_id = helper_id",
  after.r.stamp === "ok" && after.rows[J(3)].recurring_helper_id === H, after.r.stamp);
check("after: client can clear recurring_helper_id", after.r.clear === "ok" && after.rows[J(4)].recurring_helper_id === null, after.r.clear);
check("after: service_role still writes", after.r.sr === "ok" && after.rows[J(5)].recurring_helper_id === X, after.r.sr);
check("after: Q346 helper_id refusal still holds", refused(after.r.q346), after.r.q346);
check("after: client can edit an unrelated column", after.r.editTitle === "ok", after.r.editTitle);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
