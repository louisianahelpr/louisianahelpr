#!/usr/bin/env node
/**
 * PGlite proof for 20261025170841_checkout_nudge (lead 2026-10-25): the
 * abandoned-checkout nudge's claim table is server-only and lets each job be
 * nudged at most once, and the checkout_nudge switch is created 'testers'
 * and never reset by a replay.
 *
 *   node src/test/pglite/checkoutNudge.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/checkoutNudge.pglite.mjs   # RED
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/checkoutNudge.pglite.mjs
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite
 * (PGLITE_DIR). The REAL switch migration (20261012031120) is applied first,
 * then this migration 3x (replay-safety), on a prod-shaped jobs stub.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const SWITCHES = mig("20261012031120_hidden_feature_switches.sql");
const MIGRATION = process.env.MIGRATION_PATH
  ? readFileSync(process.env.MIGRATION_PATH, "utf8")
  : mig("20261025170841_checkout_nudge.sql");

let failures = 0;
let passes = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (ok) passes++;
  else failures++;
};
const tryq = async (db, q) => {
  try {
    return { rows: (await db.query(q)).rows, error: null, code: null };
  } catch (e) {
    return { rows: [], error: e.message, code: e.code ?? null };
  }
};
const asRole = async (db, role, q) => {
  await db.exec(`SET ROLE ${role}`);
  try {
    return await tryq(db, q);
  } finally {
    await db.exec("RESET ROLE");
  }
};

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
-- Prod's default ACL: new tables are open to the client roles unless the migration closes them.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE TABLE auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text);
CREATE TYPE public.app_role AS ENUM ('admin', 'customer', 'helper');
CREATE TABLE public.user_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, role public.app_role NOT NULL);
CREATE FUNCTION public.has_role(_user_id uuid, _role app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
  AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;
CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY, enrolled_at timestamptz NOT NULL DEFAULT now(), note text);
CREATE TABLE public.admin_audit_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), admin_id uuid, action text NOT NULL,
  target_type text, target_id text, details jsonb, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid, title text, payment_status text);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.jobs TO service_role;
`);
await db.exec(SWITCHES);
await db.exec(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;`);
if (process.env.NEW_MIGRATION !== "skip") {
  for (let i = 0; i < 3; i++) {
    let err = null;
    try {
      await db.exec(MIGRATION);
      // An admin turns the switch on after the first pass: a replay must not reset it.
      if (i === 0) await db.exec(`UPDATE public.feature_switches SET audience = 'everyone' WHERE key = 'checkout_nudge'`).catch(() => {});
    } catch (e) {
      err = e.message;
    }
    check(`migration applies (pass ${i + 1} of 3)`, !err, err ?? "");
  }
}

const JOB = "11111111-1111-1111-1111-111111111111";
const JOB2 = "22222222-2222-2222-2222-222222222222";
const POSTER = "33333333-3333-3333-3333-333333333333";
await db.exec(`INSERT INTO public.jobs (id, customer_id, title, payment_status) VALUES
  ('${JOB}', '${POSTER}', 'Mow', 'unpaid'), ('${JOB2}', '${POSTER}', 'Haul', 'abandoned')`);

// 1. The table exists, RLS on, and no client role can touch it.
let r = await tryq(db, `SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.job_checkout_nudges')`);
check("job_checkout_nudges exists with row level security on", r.rows[0]?.relrowsecurity === true, JSON.stringify(r.rows));
for (const role of ["anon", "authenticated"]) {
  r = await tryq(db, `SELECT has_table_privilege('${role}', 'public.job_checkout_nudges', 'SELECT') s,
                             has_table_privilege('${role}', 'public.job_checkout_nudges', 'INSERT') i,
                             has_table_privilege('${role}', 'public.job_checkout_nudges', 'UPDATE') u,
                             has_table_privilege('${role}', 'public.job_checkout_nudges', 'DELETE') d`);
  const p = r.rows[0] ?? {};
  check(`${role} has no privilege on it`, r.rows.length === 1 && !p.s && !p.i && !p.u && !p.d, JSON.stringify(r.rows));
  r = await asRole(db, role, `SELECT count(*) FROM public.job_checkout_nudges`);
  check(`${role} cannot read it`, !!r.error, r.error ?? "read succeeded");
}

// 2. The claim: once per job.
r = await asRole(db, "service_role", `INSERT INTO public.job_checkout_nudges (job_id, user_id, stripe_session_id) VALUES ('${JOB}', '${POSTER}', 'cs_1') RETURNING job_id`);
check("the service role claims a job", r.rows.length === 1 && !r.error, r.error ?? "");
r = await asRole(db, "service_role", `INSERT INTO public.job_checkout_nudges (job_id, user_id, stripe_session_id) VALUES ('${JOB}', '${POSTER}', 'cs_2') RETURNING job_id`);
check("a second claim for the same job is refused with 23505", r.code === "23505", `${r.code} ${r.error}`);
r = await asRole(db, "service_role", `INSERT INTO public.job_checkout_nudges (job_id, user_id) VALUES ('${JOB2}', '${POSTER}') RETURNING job_id`);
check("another job (an abandoned one, the backfill) claims on its own", r.rows.length === 1 && !r.error, r.error ?? "");
r = await asRole(db, "service_role", `UPDATE public.job_checkout_nudges SET notification_id = gen_random_uuid(), emailed = true, email_note = null WHERE job_id = '${JOB}' RETURNING job_id`);
check("the service role stamps the outcome", r.rows.length === 1 && !r.error, r.error ?? "");

// 3. A job deleted takes its claim with it.
await db.exec(`DELETE FROM public.jobs WHERE id = '${JOB2}'`);
r = await tryq(db, `SELECT count(*)::int AS n FROM public.job_checkout_nudges WHERE job_id = '${JOB2}'`);
check("deleting the job deletes its claim", r.rows[0]?.n === 0, JSON.stringify(r.rows));

// 4. The switch: created 'testers', never reset by a replay.
r = await tryq(db, `SELECT audience FROM public.feature_switches WHERE key = 'checkout_nudge'`);
check("the checkout_nudge switch exists, and the replays kept the admin's choice", r.rows[0]?.audience === "everyone", JSON.stringify(r.rows));
const created = /VALUES\s*\(\s*'checkout_nudge',\s*'testers'/.test(MIGRATION);
check("the migration creates the switch at 'testers'", created);

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
