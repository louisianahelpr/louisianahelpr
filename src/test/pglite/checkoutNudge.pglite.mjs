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
CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid, title text, status text NOT NULL DEFAULT 'open', payment_status text);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.jobs TO service_role;
`);
await db.exec(SWITCHES);
await db.exec(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;`);
if (process.env.NEW_MIGRATION !== "skip") {
  for (let i = 0; i < 3; i++) {
    let err = null;
    try {
      await db.exec(MIGRATION);
    } catch (e) {
      err = e.message;
    }
    check(`migration applies (pass ${i + 1} of 3)`, !err, err ?? "");
  }
}

const JOB = "11111111-1111-1111-1111-111111111111";
const JOB2 = "22222222-2222-2222-2222-222222222222";
const PAID = "44444444-4444-4444-4444-444444444444";
const CANCELLED = "55555555-5555-5555-5555-555555555555";
const POSTER = "33333333-3333-3333-3333-333333333333";
const TESTER = "66666666-6666-6666-6666-666666666666";
const TJOB = "77777777-7777-7777-7777-777777777777";
await db.exec(`INSERT INTO public.jobs (id, customer_id, title, status, payment_status) VALUES
  ('${JOB}', '${POSTER}', 'Mow', 'open', 'unpaid'), ('${JOB2}', '${POSTER}', 'Haul', 'open', 'abandoned'),
  ('${PAID}', '${POSTER}', 'Paid', 'open', 'escrow'), ('${CANCELLED}', '${POSTER}', 'Gone', 'cancelled', 'unpaid'),
  ('${TJOB}', '${TESTER}', 'Tester job', 'open', 'unpaid');
  INSERT INTO public.test_accounts (user_id) VALUES ('${TESTER}');`);
const claim = (job, user, approved = false) =>
  asRole(db, "service_role", `SELECT public.claim_checkout_nudge('${job}', '${user}', 'cs_1', ${approved}) AS r`);

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
  r = await asRole(db, role, `SELECT public.claim_checkout_nudge('${JOB}', '${POSTER}', 'cs_1', true)`);
  check(`${role} cannot call claim_checkout_nudge`, !!r.error, r.error ?? "call succeeded");
}

// 2. The switch: created 'testers', so an ordinary poster is off and a tester is on.
r = await claim(JOB, POSTER);
check("switch at testers: an ordinary poster's job answers switch_off and writes nothing", r.rows[0]?.r === "switch_off", JSON.stringify(r));
r = await tryq(db, `SELECT count(*)::int AS n FROM public.job_checkout_nudges`);
check("nothing claimed while the switch is off", r.rows[0]?.n === 0, JSON.stringify(r.rows));
r = await claim(TJOB, TESTER);
check("a test account's job is claimed (testers)", r.rows[0]?.r === "claimed", JSON.stringify(r));

// 3. The owner-approved one-job backfill skips the switch, and the claim makes it once.
r = await claim(JOB2, POSTER, true);
check("owner-approved: an ABANDONED job of an ordinary poster is claimed", r.rows[0]?.r === "claimed", JSON.stringify(r));
r = await claim(JOB2, POSTER, true);
check("owner-approved twice: duplicate, nothing sent again", r.rows[0]?.r === "duplicate", JSON.stringify(r));
r = await claim(PAID, POSTER, true);
check("a funded job is not nudgeable", r.rows[0]?.r === "not_nudgeable", JSON.stringify(r));
r = await claim(CANCELLED, POSTER, true);
check("a cancelled job is not nudgeable", r.rows[0]?.r === "not_nudgeable", JSON.stringify(r));
r = await claim(JOB, TESTER, true);
check("another poster's job is not nudgeable", r.rows[0]?.r === "not_nudgeable", JSON.stringify(r));

// 4. Everyone on: the webhook's ordinary claim, then a duplicate.
await db.exec(`UPDATE public.feature_switches SET audience = 'everyone' WHERE key = 'checkout_nudge'`);
r = await claim(JOB, POSTER);
check("switch on: the poster's unpaid job is claimed", r.rows[0]?.r === "claimed", JSON.stringify(r));
r = await claim(JOB, POSTER);
check("a re-delivered expiry answers duplicate", r.rows[0]?.r === "duplicate", JSON.stringify(r));
r = await asRole(db, "service_role", `UPDATE public.job_checkout_nudges SET notification_id = gen_random_uuid(), emailed = true WHERE job_id = '${JOB}' RETURNING job_id`);
check("the service role stamps the outcome", r.rows.length === 1 && !r.error, r.error ?? "");
await db.exec(`DELETE FROM public.jobs WHERE id = '${JOB2}'`);
r = await tryq(db, `SELECT count(*)::int AS n FROM public.job_checkout_nudges WHERE job_id = '${JOB2}'`);
check("deleting the job deletes its claim", r.rows[0]?.n === 0, JSON.stringify(r.rows));
await db.exec(`UPDATE public.feature_switches SET audience = 'testers' WHERE key = 'checkout_nudge'`);

// 5. A replay never resets an admin's choice (ON CONFLICT DO NOTHING).
await db.exec(`UPDATE public.feature_switches SET audience = 'off' WHERE key = 'checkout_nudge'`);
if (process.env.NEW_MIGRATION !== "skip") await db.exec(MIGRATION);
r = await tryq(db, `SELECT audience FROM public.feature_switches WHERE key = 'checkout_nudge'`);
check("the checkout_nudge switch exists, and a replay kept the admin's choice", r.rows[0]?.audience === "off", JSON.stringify(r.rows));
const created = /VALUES\s*\(\s*'checkout_nudge',\s*'testers'/.test(MIGRATION);
check("the migration creates the switch at 'testers'", created);

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
