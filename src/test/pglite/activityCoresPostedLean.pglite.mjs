#!/usr/bin/env node
/**
 * PGlite proof for 20261115173740_activity_cores_posted_lean (docs/OPEN.md Q2812, Builder 2, 2026-11-15).
 *
 *   npx tsx src/test/pglite/activityCoresPostedLean.pglite.mjs [--replay] [--before]
 *
 * get_my_activity_cores is loaded from its EFFECTIVE definition before this migration (20261106054856, = live prosrc
 * md5 59cb2e2c… on 2026-11-15). --before leaves the migration out: the RED checks must FAIL (count asserted);
 * (NEW_MIGRATION=skip is the same as --before.) --replay applies it 3x. Every call runs AS authenticated, under prod-shaped RLS: jobs (parties), applications
 * (Helpr or poster), job_continue_days (live policy) and backout_notices (live policy: the recipient only).
 *
 *   L1 {posted_lean}: posted_jobs are exactly the jobs Home can act on: not completed / cancelled, or a chargeback,
 *      a failed payment on a job not cancelled, or an open back-out notice TO ME (not one to someone else, not an
 *      acknowledged one); newest first, the same rows as the whole list's                               RED before
 *   L2 poster_applications: exactly the whole list's rows for those jobs                                 RED before
 *   L3 offer_targets: exactly the whole list's rows for those jobs                                       RED before
 *   L4 open / active continue days: exactly the whole list's rows for those jobs (a completed job's out) RED before
 *   L5 keys: the posted part's keys plus posted_lean: true                                               RED before
 *   L6 {posted_lean, applied}: the applied keys equal the {applied} answer                               RED before
 *   L7 every call without posted_lean (NULL, {posted}, {applied}, {posted, applied}) is the old answer
 *   L8 {posted, posted_lean} is refused (bad_parts, 22023); so are three names
 *   L9 one overload, STABLE SECURITY INVOKER; execute authenticated + service_role only; anon refused
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import { effectiveDefs } from "../helpers/effectiveFunctionDefs.ts";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261115173740_activity_cores_posted_lean.sql";
const MIGRATION = readFileSync(DIR + THIS, "utf8");
const BEFORE = process.argv.includes("--before") || process.env.NEW_MIGRATION === "skip";
const REPLAY = process.argv.includes("--replay");

const BEFORE_DEFS = effectiveDefs(DIR, { before: THIS });
function fnStmt(name) {
  const d = BEFORE_DEFS.get(name);
  if (!d) throw new Error(`no migration before ${THIS} defines ${name}`);
  const open = /\bAS\s+(\$\w*\$)/i.exec(d.stmt);
  const end = d.stmt.indexOf(open[1], open.index + open[0].length);
  return `${d.stmt.slice(0, end + open[1].length)};`;
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ME = U(2), HELPR = U(3), OTHER = U(4);
// Jobs I (ME) posted, one per rule, plus two of OTHER's.
const LIVE = U(101), DONE = U(102), CANCELLED = U(103), CB_DONE = U(104), FAILED_CANCELLED = U(105), FAILED_DONE = U(106),
  BACKOUT_MINE = U(107), BACKOUT_ACKED = U(108), BACKOUT_OTHERS = U(109), OPEN_JOB = U(110), NULL_STATUS = U(111),
  OTHERS_JOB = U(120), APPLIED_JOB = U(121);

const SCHEMA = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE TABLE public.jobs (
  id uuid PRIMARY KEY, title text, budget numeric, status text DEFAULT 'open', payment_status text,
  customer_id uuid, helper_id uuid, offered_to_helper_id uuid, direct_offer_status text, created_at timestamptz DEFAULT now());
CREATE TABLE public.applications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid, status text,
  closed_reason text, created_at timestamptz DEFAULT now());
CREATE TABLE public.user_violations (user_id uuid, job_id uuid, violation_type text);
CREATE TABLE public.reviews (reviewer_id uuid, job_id uuid);
CREATE TABLE public.backout_notices (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, user_id uuid, actor_name text,
  backout_kind text, created_at timestamptz DEFAULT now(), acknowledged_at timestamptz, last_push_at timestamptz);
CREATE TABLE public.job_continue_days (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, proposed_by uuid,
  new_date date, new_start_time time, note text, status text, created_at timestamptz DEFAULT now(), decided_at timestamptz,
  decided_by uuid, cleared_done_at timestamptz, helper_confirmed_at timestamptz, closed_at timestamptz);
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY parties ON public.jobs FOR SELECT TO authenticated USING (customer_id = auth.uid() OR helper_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.applications a WHERE a.job_id = jobs.id AND a.helper_id = auth.uid()));
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION public._lh_i_posted(p_job uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = p_job AND j.customer_id = auth.uid()) $$;
GRANT EXECUTE ON FUNCTION public._lh_i_posted(uuid) TO authenticated;
CREATE POLICY mine ON public.applications FOR SELECT TO authenticated USING (helper_id = auth.uid() OR public._lh_i_posted(job_id));
ALTER TABLE public.backout_notices ENABLE ROW LEVEL SECURITY;
-- Live policy (read 2026-11-15).
CREATE POLICY "Recipients read their own back-out notices" ON public.backout_notices FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
ALTER TABLE public.job_continue_days ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Job parties read continue days" ON public.job_continue_days FOR SELECT TO authenticated USING (EXISTS (
  SELECT 1 FROM public.jobs j WHERE j.id = job_continue_days.job_id AND ((SELECT auth.uid()) = j.customer_id OR (SELECT auth.uid()) = j.helper_id)));
CREATE FUNCTION public.get_job_offer_targets() RETURNS TABLE (job_id uuid, offered_to_helper_id uuid) LANGUAGE sql STABLE
  AS $$ SELECT j.id, j.offered_to_helper_id FROM public.jobs j WHERE j.customer_id = auth.uid() AND j.offered_to_helper_id IS NOT NULL $$;
CREATE FUNCTION public.get_jobs_for_my_applications() RETURNS SETOF public.jobs LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT j.* FROM public.jobs j WHERE j.id IN (SELECT a.job_id FROM public.applications a WHERE a.helper_id = auth.uid()) $$;
CREATE FUNCTION public.get_my_pending_direct_offers() RETURNS SETOF public.jobs LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT j.* FROM public.jobs j WHERE j.offered_to_helper_id = auth.uid() AND j.direct_offer_status = 'pending' $$;
GRANT EXECUTE ON FUNCTION public.get_job_offer_targets(), public.get_jobs_for_my_applications(), public.get_my_pending_direct_offers() TO authenticated;

${fnStmt("get_my_activity_cores")}
REVOKE ALL ON FUNCTION public.get_my_activity_cores(text[], text[], text[], text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_activity_cores(text[], text[], text[], text[]) TO authenticated, service_role;

INSERT INTO public.jobs (id, customer_id, helper_id, offered_to_helper_id, title, budget, status, payment_status, created_at) VALUES
  ('${LIVE}', '${ME}', '${HELPR}', NULL, 'Under way', 40, 'in_progress', 'escrow', now() - interval '1 day'),
  ('${DONE}', '${ME}', '${HELPR}', '${HELPR}', 'Done and paid', 40, 'completed', 'released', now() - interval '2 days'),
  ('${CANCELLED}', '${ME}', NULL, NULL, 'Cancelled', 40, 'cancelled', 'refunded', now() - interval '3 days'),
  ('${CB_DONE}', '${ME}', '${HELPR}', NULL, 'Chargeback after done', 40, 'completed', 'chargeback', now() - interval '4 days'),
  ('${FAILED_CANCELLED}', '${ME}', NULL, NULL, 'Declined card, cancelled', 40, 'cancelled', 'failed', now() - interval '5 days'),
  ('${FAILED_DONE}', '${ME}', '${HELPR}', NULL, 'Bank payment failed after done', 40, 'completed', 'failed', now() - interval '6 days'),
  ('${BACKOUT_MINE}', '${ME}', NULL, NULL, 'Cancelled, notice to me', 40, 'cancelled', 'cancelled', now() - interval '7 days'),
  ('${BACKOUT_ACKED}', '${ME}', NULL, NULL, 'Cancelled, notice acknowledged', 40, 'cancelled', 'cancelled', now() - interval '8 days'),
  ('${BACKOUT_OTHERS}', '${ME}', NULL, NULL, 'Cancelled, notice to the Helpr', 40, 'cancelled', 'cancelled', now() - interval '9 days'),
  ('${OPEN_JOB}', '${ME}', NULL, '${OTHER}', 'Open with an offer', 40, 'open', 'unpaid', now() - interval '10 days'),
  ('${NULL_STATUS}', '${ME}', NULL, NULL, 'No status', 40, NULL, NULL, now() - interval '11 days'),
  ('${OTHERS_JOB}', '${OTHER}', NULL, NULL, 'Not mine', 30, 'open', 'unpaid', now()),
  ('${APPLIED_JOB}', '${OTHER}', '${ME}', NULL, 'I work it', 30, 'in_progress', 'escrow', now());
INSERT INTO public.applications (job_id, helper_id, status) VALUES
  ('${LIVE}', '${HELPR}', 'accepted'), ('${OPEN_JOB}', '${HELPR}', 'pending'), ('${DONE}', '${HELPR}', 'accepted'),
  ('${CANCELLED}', '${HELPR}', 'declined'), ('${APPLIED_JOB}', '${ME}', 'accepted');
INSERT INTO public.backout_notices (job_id, user_id, backout_kind, acknowledged_at) VALUES
  ('${BACKOUT_MINE}', '${ME}', 'poster_cancelled', NULL),
  ('${BACKOUT_ACKED}', '${ME}', 'poster_cancelled', now()),
  ('${BACKOUT_OTHERS}', '${HELPR}', 'poster_cancelled', NULL);
INSERT INTO public.job_continue_days (job_id, proposed_by, new_date, new_start_time, note, status) VALUES
  ('${LIVE}', '${HELPR}', '2026-11-20', '09:00', 'live day', 'set'),
  ('${DONE}', '${HELPR}', '2026-11-21', '09:00', 'done job day', 'set'),
  ('${APPLIED_JOB}', '${OTHER}', '2026-11-22', '09:00', 'applied day', 'proposed');
`;

const JOB_COLS = ["id", "title", "budget", "status", "payment_status", "customer_id", "helper_id", "created_at"];
const APP_COLS = ["id", "job_id", "helper_id", "status", "closed_reason", "created_at"];
const KEEP = ["id", "title", "status", "offered_to_helper_id", "direct_offer_status"];
const APPLIED_KEYS = ["my_applications", "application_jobs", "direct_offers", "violations", "reviews"];
const arr = (a) => `ARRAY[${a.map((c) => (c === null ? "NULL" : `'${c}'`)).join(",")}]::text[]`;

const db = new PGlite();
await db.exec(SCHEMA);
const call = async (uid, parts) => {
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${uid}', false); SET ROLE authenticated;`);
  try {
    const sql = `SELECT public.get_my_activity_cores(${arr(JOB_COLS)}, ${arr(APP_COLS)}, ${arr(KEEP)}${parts === undefined ? "" : `, ${parts}`}) AS c`;
    return (await db.query(sql)).rows[0].c;
  } catch (e) {
    return { error: e.message, code: e.code };
  } finally {
    await db.exec("RESET ROLE;");
  }
};

const OLD = {
  all: await call(ME, undefined), posted: await call(ME, arr(["posted"])), applied: await call(ME, arr(["applied"])),
  both: await call(ME, arr(["posted", "applied"])),
};
if (!BEFORE) {
  for (let i = 0; i < (REPLAY ? 3 : 1); i++) {
    try {
      await db.exec(MIGRATION);
      console.log(`applied ${THIS}${REPLAY ? ` (${i + 1}/3)` : ""}`);
    } catch (e) {
      check(`migration applies${REPLAY ? ` (${i + 1}/3)` : ""}`, false, e.message);
    }
  }
} else {
  console.log(`--before: ${THIS} NOT applied (the RED checks must FAIL)`);
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const keys = (o) => (o && !o.error ? Object.keys(o).sort() : []);
const pick = (o, ks) => Object.fromEntries(Object.entries(o ?? {}).filter(([k]) => ks.includes(k)));
const lean = await call(ME, arr(["posted_lean"]));
const leanApplied = await call(ME, arr(["posted_lean", "applied"]));
const whole = await call(ME, arr(["posted"]));
const applied = await call(ME, arr(["applied"]));
const EXPECT = [LIVE, CB_DONE, FAILED_DONE, BACKOUT_MINE, OPEN_JOB, NULL_STATUS]; // newest first
const leanIds = (lean?.posted_jobs ?? []).map((j) => j.id);
check("L1 posted_jobs: exactly the jobs Home can act on, newest first, the whole list's rows",
  same(leanIds, EXPECT) && same(lean.posted_jobs, (whole?.posted_jobs ?? []).filter((j) => EXPECT.includes(j.id))),
  JSON.stringify(lean?.error ?? leanIds));
const inLean = (rows) => (rows ?? []).filter((r) => EXPECT.includes(r.job_id));
check("L2 poster_applications: exactly the whole list's rows for those jobs (and the fixture has others)",
  Array.isArray(lean?.poster_applications) && lean.poster_applications.length === 2 && same(lean.poster_applications, inLean(whole?.poster_applications))
    && (whole?.poster_applications ?? []).length === 4,
  JSON.stringify(lean?.poster_applications));
check("L3 offer_targets: exactly the whole list's rows for those jobs (DONE's offer left out)",
  Array.isArray(lean?.offer_targets) && same(lean.offer_targets.map((o) => o.job_id), [OPEN_JOB]) && same(lean.offer_targets, inLean(whole?.offer_targets))
    && (whole?.offer_targets ?? []).length === 2,
  JSON.stringify(lean?.offer_targets));
check("L4 open / active continue days: the whole list's rows for those jobs only (a completed job's day left out)",
  Array.isArray(lean?.open_continue_days) && Array.isArray(lean?.active_continue_days)
    && same(lean.open_continue_days.map((d) => d.job_id), [LIVE]) && same(lean.active_continue_days.map((d) => d.job_id), [LIVE])
    && same(lean.open_continue_days, inLean(whole?.open_continue_days)) && same(lean.active_continue_days, inLean(whole?.active_continue_days))
    && (whole?.open_continue_days ?? []).length === 2,
  JSON.stringify({ open: lean?.open_continue_days, active: lean?.active_continue_days }));
check("L5 keys: the posted part's keys plus posted_lean: true",
  same(keys(lean), [...keys(whole), "posted_lean"].sort()) && lean.posted_lean === true, JSON.stringify(keys(lean)));
check("L6 {posted_lean, applied}: the applied keys equal the {applied} answer; the posted keys the {posted_lean} one",
  !leanApplied?.error && Object.keys(pick(applied, APPLIED_KEYS)).length === 5 && same(pick(leanApplied, APPLIED_KEYS), pick(applied, APPLIED_KEYS))
    && same(leanApplied.posted_jobs, lean?.posted_jobs) && leanApplied.posted_lean === true,
  JSON.stringify(leanApplied?.error ?? keys(leanApplied)));
const now = { all: await call(ME, undefined), posted: whole, applied, both: await call(ME, arr(["posted", "applied"])) };
check("L7 every call without posted_lean is the old answer, key for key",
  !OLD.all?.error && Object.keys(OLD).every((k) => same(now[k], OLD[k])) && OLD.all.posted_jobs.length === 11);
const both = await call(ME, arr(["posted", "posted_lean"]));
const three = await call(ME, arr(["posted_lean", "applied", "posted"]));
check("L8 {posted, posted_lean} and three names are refused (bad_parts, 22023)",
  both?.code === "22023" && /bad_parts/.test(both.error) && three?.code === "22023", JSON.stringify({ both, three }));

const procs = (await db.query(`SELECT oid::regprocedure::text sig, proacl::text acl, prosecdef, provolatile FROM pg_proc WHERE proname = 'get_my_activity_cores'`)).rows;
let anonRefused = false;
try {
  await db.exec(`SET ROLE anon;`);
  await db.query(`SELECT public.get_my_activity_cores(${arr(JOB_COLS)}, ${arr(APP_COLS)}, ${arr(KEEP)}, ${arr(["posted_lean"])})`);
} catch (e) {
  anonRefused = /permission denied/.test(e.message);
} finally {
  await db.exec(`RESET ROLE;`);
}
check("L9 one overload, STABLE SECURITY INVOKER; execute authenticated + service_role only; anon refused",
  procs.length === 1 && procs[0].sig === "get_my_activity_cores(text[],text[],text[],text[])" && procs[0].prosecdef === false && procs[0].provolatile === "s"
    && /authenticated=X/.test(procs[0].acl) && /service_role=X/.test(procs[0].acl) && !/anon=/.test(procs[0].acl) && !/(^|[{,])=X/.test(procs[0].acl) && anonRefused,
  JSON.stringify({ procs, anonRefused }));

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
if (BEFORE) {
  const expected = 6; // L1-L6 are RED on the old function; L7-L9 hold on both.
  console.log(failures === expected ? `RED as expected (${failures}/${expected})` : `NOT RED: ${failures}/${expected} failed`);
  process.exit(failures === expected ? 0 : 1);
}
process.exit(failures ? 1 : 0);
