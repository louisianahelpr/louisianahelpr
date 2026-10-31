#!/usr/bin/env node
/**
 * PGlite proof for 20261031211327_reports_close_when_target_deleted (NOID-24 M6): an open 'user' or 'job' report
 * whose target is gone is dismissed, once at deploy and from then on when the profile or job is deleted. Support rows
 * (reported_id NULL), other report types, closed reports and reports on live targets are untouched; no row is deleted;
 * the trigger function is not callable by PUBLIC, anon or authenticated.
 *
 *   node src/test/pglite/reportsCloseWhenTargetDeleted.pglite.mjs                  # the migration 3x
 *   NEW_MIGRATION=skip node src/test/pglite/reportsCloseWhenTargetDeleted.pglite.mjs # RED: without it
 *   MUTANT=<name> node src/test/pglite/reportsCloseWhenTargetDeleted.pglite.mjs    # a planted defect: must FAIL
 *
 * Base: minimal prod-shaped stubs of auth.users, public.profiles, public.jobs and public.reports (prod columns and
 * reports_status_check / reports_reported_type_check read with pg_get_constraintdef, 10-31).
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG = fileURLToPath(new URL("../../../supabase/migrations/20261031211327_reports_close_when_target_deleted.sql", import.meta.url));
const MUTANTS = {
  // Support rows (no target) swept too.
  nilrows: ["   AND r.reported_id IS NOT NULL\n", ""],
  // A user report closed while the account still exists (profile gone only).
  authonly: ["       AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = r.reported_id)\n", ""],
  // No trigger on profile delete.
  notrigger: ["CREATE TRIGGER trg_reports_dismiss_deleted_profile\n  AFTER DELETE ON public.profiles\n  FOR EACH ROW EXECUTE FUNCTION public.reports_dismiss_for_deleted_target();", ""],
  // The grant is not restated.
  nogrants: ["REVOKE ALL ON FUNCTION public.reports_dismiss_for_deleted_target() FROM PUBLIC, anon, authenticated;", ""],
};
let mig = readFileSync(MIG, "utf8");
const MUTANT = process.env.MUTANT ?? "";
if (MUTANT) {
  const m = MUTANTS[MUTANT];
  if (!m || !mig.includes(m[0])) throw new Error(`mutant ${MUTANT} did not apply`);
  mig = mig.replace(m[0], m[1]);
}
const skip = process.env.NEW_MIGRATION === "skip";

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };
const U = (n) => `11111111-0000-0000-0000-${String(n).padStart(12, "0")}`;

const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY);
  CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, full_name text);
  CREATE TABLE public.jobs (id uuid PRIMARY KEY, title text);
  CREATE TABLE public.reports (
    id uuid PRIMARY KEY, reporter_id uuid, reported_type text NOT NULL, reported_id uuid, reason text, description text,
    status text DEFAULT 'pending', created_at timestamptz DEFAULT now(), assigned_to uuid, reported_content text,
    CONSTRAINT reports_status_check CHECK (status = ANY (ARRAY['pending','new','investigating','reviewed','resolved','dismissed'])),
    CONSTRAINT reports_reported_type_check CHECK (reported_type = ANY (ARRAY['job','message','user','support','review','application','declutter_item','declutter_wanted'])));
  INSERT INTO auth.users VALUES ('${U(1)}'), ('${U(2)}'), ('${U(3)}');
  INSERT INTO public.profiles VALUES ('${U(1)}', 'Live'), ('${U(3)}', 'To delete');
  INSERT INTO public.jobs VALUES ('${U(50)}', 'Live job'), ('${U(51)}', 'Job to delete');
  INSERT INTO public.reports (id, reported_type, reported_id, status) VALUES
    ('${U(100)}', 'user', '${U(102)}', 'investigating'), -- the 130-day one: no auth user, no profile
    ('${U(101)}', 'user', '${U(1)}', 'pending'),          -- live user
    ('${U(103)}', 'user', '${U(2)}', 'pending'),          -- auth user without a profile: still a person
    ('${U(104)}', 'job', '${U(99)}', 'new'),              -- job gone
    ('${U(105)}', 'job', '${U(50)}', 'investigating'),    -- live job
    ('${U(106)}', 'support', NULL, 'pending'),            -- guest support row
    ('${U(107)}', 'message', '${U(98)}', 'pending'),      -- other type: untouched
    ('${U(108)}', 'user', '${U(97)}', 'resolved'),        -- already closed: untouched
    ('${U(109)}', 'user', '${U(3)}', 'pending'),          -- profile deleted below
    ('${U(110)}', 'job', '${U(51)}', 'reviewed'),         -- job deleted below
    ('${U(111)}', 'user', NULL, 'pending');               -- no target id at all: left alone
`);
if (!skip) for (let i = 0; i < 3; i++) await db.exec(mig);
const st = async (n) => (await db.query(`SELECT status FROM public.reports WHERE id = '${U(n)}'`)).rows[0]?.status;

check((await st(100)) === "dismissed", "the 130-day report on a target that never existed is dismissed");
check((await st(104)) === "dismissed", "an open report on a job that is gone is dismissed");
check((await st(101)) === "pending" && (await st(105)) === "investigating", "reports on live targets stay open");
check((await st(103)) === "pending", "a user with an auth row but no profile is still a person: open");
check((await st(106)) === "pending" && (await st(111)) === "pending", "a row with no target id (support, or any type) is left alone");
check((await st(107)) === "pending", "other report types are left alone");
check((await st(108)) === "resolved", "a closed report keeps its status");

await db.exec(`DELETE FROM public.profiles WHERE user_id = '${U(3)}'; DELETE FROM public.jobs WHERE id = '${U(51)}';`);
check((await st(109)) === "dismissed", "deleting a profile dismisses that user's open report");
check((await st(110)) === "dismissed", "deleting a job dismisses its open report");
await db.exec(`DELETE FROM public.jobs WHERE id = '${U(50)}';`);
check((await st(105)) === "dismissed", "a delete with a matching open report works on a second job too");
check(Number((await db.query(`SELECT count(*)::int n FROM public.reports`)).rows[0].n) === 11, "no report row is deleted (11 in, 11 out)");

const acl = (await db.query(`SELECT proacl::text a FROM pg_proc WHERE proname = 'reports_dismiss_for_deleted_target'`)).rows[0]?.a ?? "";
check(!!acl && !/(^|[{,])=/.test(acl) && !/anon=/.test(acl) && !/authenticated=/.test(acl), `the trigger function is not callable by PUBLIC/anon/authenticated (${acl})`);

console.log(failures ? `FAILED ${failures}` : "ALL PASS");
process.exit(failures ? 1 : 0);
