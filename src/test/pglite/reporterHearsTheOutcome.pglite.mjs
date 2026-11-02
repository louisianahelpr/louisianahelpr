#!/usr/bin/env node
/**
 * PGlite proof for 20261102015348_reporter_hears_the_outcome (A3-113): when a report is resolved or dismissed, the
 * reporter gets one server-built notice that never names who was reported or what was done.
 *
 *   node src/test/pglite/reporterHearsTheOutcome.pglite.mjs                  # the migration 3x
 *   NEW_MIGRATION=skip node src/test/pglite/reporterHearsTheOutcome.pglite.mjs # RED: prod sends nothing
 *   MUTANT=<name> node src/test/pglite/reporterHearsTheOutcome.pglite.mjs    # a planted defect: must FAIL
 *
 * Base: prod-shaped stubs of auth.users, profiles, jobs, reports (reports_status_check and reports_reported_type_check
 * as in 20261101021934), notifications (notifications_user_id_fkey to auth.users, and a CHECK on type holding the
 * values this proof needs, prod's list includes 'system_alert'), error_logs, a stand-in is_test_subject, and the real
 * 20261031211327_reports_close_when_target_deleted (the deleted-target dismissal must stay silent).
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (n) => readFileSync(fileURLToPath(new URL(`../../../supabase/migrations/${n}`, import.meta.url)), "utf8");
const MUTANTS = {
  // The reported member's/job's existence check dropped: a deletion dismissal tells the reporter "no rule broken".
  deletedtarget: ["    IF NEW.status = 'dismissed' AND NEW.reported_id IS NOT NULL AND (", "    IF false AND ("],
  // Only an account with no auth row counts as gone: the profile delete (auth row still there) tells the reporter.
  authonly: ["NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = NEW.reported_id))", "NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = NEW.reported_id))"],
  // Test and seed reporters notified.
  testreporter: ["       OR public.is_test_subject(NEW.reporter_id)\n", ""],
  // Support tickets told "we looked into your report".
  support: [" OR NEW.reported_type = 'support'", ""],
  // Both outcomes say "took action".
  oneword: ["CASE WHEN NEW.status = 'resolved'\n             THEN", "CASE WHEN true\n             THEN"],
  // A closed -> closed move notifies again.
  reclose: ["        AND OLD.status NOT IN ('resolved', 'dismissed'))", "        )"],
  // A failing notice fails the admin's update.
  noguard: ["  EXCEPTION WHEN OTHERS THEN\n    INSERT INTO public.error_logs", "  EXCEPTION WHEN division_by_zero THEN\n    INSERT INTO public.error_logs"],
  // The reported text leaks into the notice.
  leak: ["'Thanks for your report about ' || v_noun", "'Thanks for your report about ' || v_noun || ' ' || coalesce(NEW.description, '')"],
  // The release restatement left at 'resolved' for a member's report.
  releaseresolved: ["SET status = CASE WHEN reporter_id IS NULL THEN 'resolved' ELSE 'dismissed' END", "SET status = 'resolved'"],
  // Grants not restated.
  nogrants: ["REVOKE ALL ON FUNCTION public.notify_reporter_report_outcome() FROM PUBLIC, anon, authenticated;", ""],
};
let NEWSQL = mig("20261102015348_reporter_hears_the_outcome.sql");
const MUTANT = process.env.MUTANT ?? "";
if (MUTANT) {
  const m = MUTANTS[MUTANT];
  if (!m || !NEWSQL.includes(m[0])) throw new Error(`mutant ${MUTANT} did not apply`);
  NEWSQL = NEWSQL.replace(m[0], m[1]);
}
const skip = process.env.NEW_MIGRATION === "skip";

let failures = 0;
const check = (ok, name, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? `  (${extra})` : ""}`); if (!ok) failures++; };
const U = (n) => `${String(n).padStart(8, "0")}-0000-0000-0000-${String(n).padStart(12, "0")}`;
const REPORTER = U(1), TESTER = U(2), SEEDER = U(3), GONE_REPORTER = U(4), BAD = U(5), BAD2 = U(6), ADMIN = U(9);
const JOB = U(50), JOB2 = U(51);

const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY);
  CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, full_name text, is_seed boolean NOT NULL DEFAULT false);
  CREATE TABLE public.jobs (id uuid PRIMARY KEY, title text);
  CREATE TABLE public.test_subjects (user_id uuid PRIMARY KEY);
  CREATE FUNCTION public.is_test_subject(p uuid) RETURNS boolean LANGUAGE sql STABLE AS
    $$ SELECT p IS NOT NULL AND EXISTS (SELECT 1 FROM public.test_subjects t WHERE t.user_id = p) $$;
  CREATE TABLE public.reports (
    id uuid PRIMARY KEY, reporter_id uuid, reported_type text NOT NULL, reported_id uuid, reason text NOT NULL DEFAULT 'r',
    description text, status text NOT NULL DEFAULT 'pending', created_at timestamptz DEFAULT now(), assigned_to uuid,
    CONSTRAINT reports_status_check CHECK (status = ANY (ARRAY['pending','new','investigating','reviewed','resolved','dismissed'])),
    CONSTRAINT reports_reported_type_check CHECK (reported_type = ANY (ARRAY['job','message','user','support','review','application','declutter_item','declutter_wanted','declutter_question','declutter_answer'])));
  CREATE TABLE public.notifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id), title text NOT NULL,
    message text NOT NULL, type text NOT NULL CHECK (type IN ('info','system_alert','admin_alert','warning')), link text,
    read boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.error_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), severity text, message text, tags jsonb, context jsonb);
  CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
  CREATE TABLE public.user_roles (user_id uuid, role public.app_role);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
  CREATE FUNCTION public.has_role(u uuid, r public.app_role) RETURNS boolean LANGUAGE sql STABLE AS
    $$ SELECT EXISTS (SELECT 1 FROM public.user_roles x WHERE x.user_id = u AND x.role = r) $$;
  CREATE FUNCTION public.require_feature(k text) RETURNS void LANGUAGE sql AS $$ SELECT $$;
  CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
  CREATE TABLE public.declutter_wanted (id uuid PRIMARY KEY, user_id uuid, removed_at timestamptz,
    photo_paths text[] NOT NULL DEFAULT '{}', photos_held text[] NOT NULL DEFAULT '{}', photos_cleared text[] NOT NULL DEFAULT '{}');
  CREATE TABLE public.admin_audit_log (admin_id uuid, action text, target_type text, target_id text, details jsonb);
  INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin');
  INSERT INTO auth.users VALUES ('${REPORTER}'), ('${TESTER}'), ('${SEEDER}'), ('${BAD}'), ('${BAD2}'), ('${ADMIN}');
  INSERT INTO public.profiles (user_id, full_name, is_seed) VALUES
    ('${REPORTER}', 'Rita Reporter', false), ('${TESTER}', 'T', false), ('${SEEDER}', 'S', true),
    ('${BAD}', 'Bad Actor', false), ('${BAD2}', 'Gone Soon', false);
  INSERT INTO public.test_subjects VALUES ('${TESTER}');
  INSERT INTO public.jobs VALUES ('${JOB}', 'Live job'), ('${JOB2}', 'Job to delete');
`);
await db.exec(mig("20261031211327_reports_close_when_target_deleted.sql"));
// Prod's release RPC as it stands (its only CREATE, 20261030225143), cut out by name.
{
  const src = mig("20261030225143_declutter_wanted_report_block_photo_check.sql");
  const from = src.indexOf("CREATE OR REPLACE FUNCTION public.declutter_admin_release_wanted_photos");
  const to = src.indexOf("TO authenticated, service_role;", from) + "TO authenticated, service_role;".length;
  if (from < 0 || to <= from) throw new Error("prod release RPC not found");
  await db.exec(src.slice(from, to));
}
if (!skip) for (let i = 0; i < 3; i++) await db.exec(NEWSQL);

const q = async (sql) => (await db.query(sql)).rows;
let n = 100;
const file = async (reporter, type, target, desc = "SECRET-TYPED-WORDS") => {
  const id = U(n++);
  await db.query(`INSERT INTO public.reports (id, reporter_id, reported_type, reported_id, description) VALUES ($1,$2,$3,$4,$5)`, [id, reporter, type, target, desc]);
  return id;
};
const setStatus = (id, s) => db.query(`UPDATE public.reports SET status = $2 WHERE id = $1`, [id, s]);
const notes = (uid = REPORTER) => q(`SELECT title, message, type, link FROM public.notifications WHERE user_id = '${uid}' ORDER BY created_at, id`);
const clear = () => db.exec(`DELETE FROM public.notifications; DELETE FROM public.error_logs;`);
const caseOf = (id) => `HLP-${id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;

// 1. resolved
let r = await file(REPORTER, "declutter_item", U(70));
await setStatus(r, "investigating");
check((await notes()).length === 0, "moving to investigating sends nothing");
await setStatus(r, "resolved");
let ns = await notes();
check(ns.length === 1, "resolving sends the reporter one notice", `${ns.length}`);
check(ns[0]?.message === `Thanks for your report about a listing (case ${caseOf(r)}). We looked into it and took action.`, "resolved words: took action, the kind and the case number", ns[0]?.message);
check(ns[0]?.title === "We looked into your report" && ns[0]?.type === "system_alert", "title and type system_alert", `${ns[0]?.title}/${ns[0]?.type}`);
check(ns[0]?.link === null, "a resolved notice has no link", ns[0]?.link);

// 2. dismissed
await clear();
r = await file(REPORTER, "user", BAD);
await setStatus(r, "dismissed");
ns = await notes();
check(ns.length === 1 && ns[0].message === `Thanks for your report about a member (case ${caseOf(r)}). We looked into it and didn't find a rule broken. If it keeps happening, report it again or contact support.`,
  "dismissed words: no rule broken, report again or contact support", ns[0]?.message);
check(ns[0]?.link === "/support?topic=message", "a dismissed notice opens Support", ns[0]?.link);

// 3. never who or what
const all = JSON.stringify(await q(`SELECT * FROM public.notifications`));
check(!all.includes("SECRET") && !all.includes("Bad Actor") && !all.includes(BAD), "the notice never carries the reported member, their id or anything typed");
check((await notes(BAD)).length === 0, "the reported member is told nothing");

// 4. closed -> closed, closed -> open -> closed once more
await clear();
await setStatus(r, "resolved");
check((await notes()).length === 0, "a move between two closed values sends nothing");

// 5. who is never told
await clear();
for (const [who, type, target, label] of [
  [TESTER, "job", JOB, "a test reporter"],
  [SEEDER, "job", JOB, "a seed reporter"],
  [GONE_REPORTER, "job", JOB, "a reporter with no account"],
  [null, "support", null, "a guest support row"],
  [REPORTER, "support", REPORTER, "a member's support ticket"],
]) {
  const id = await file(who, type, target);
  await setStatus(id, "resolved");
  const c = Number((await q(`SELECT count(*)::int c FROM public.notifications`))[0].c);
  check(c === 0, `${label} is told nothing`, `${c}`);
}
check(Number((await q(`SELECT count(*)::int c FROM public.error_logs`))[0].c) === 0, "skipping those logs no error");

// 6. dismissed because the target was deleted: silent
await clear();
const rj = await file(REPORTER, "job", JOB2);
const ru = await file(REPORTER, "user", BAD2);
await db.exec(`DELETE FROM public.jobs WHERE id = '${JOB2}'; DELETE FROM public.profiles WHERE user_id = '${BAD2}'; DELETE FROM auth.users WHERE id = '${BAD2}';`);
const st = await q(`SELECT status FROM public.reports WHERE id IN ('${rj}', '${ru}')`);
check(st.length === 2 && st.every((x) => x.status === "dismissed"), "deleting the job or member still dismisses the reports");
check((await notes()).length === 0, "a dismissal because the target is gone tells the reporter nothing");
// ...but an admin who acts and then resolves still says so.
const rk2 = await file(REPORTER, "job", U(77));
await setStatus(rk2, "resolved");
check((await notes()).length === 1, "resolving a report whose job an admin removed still tells the reporter");

// 7. a failing notice never fails the admin's change
await clear();
await db.exec(`ALTER TABLE public.notifications ADD CONSTRAINT boom CHECK (title <> 'We looked into your report')`);
const rf = await file(REPORTER, "message", U(80));
let ok = true;
try { await setStatus(rf, "resolved"); } catch { ok = false; }
const fst = (await q(`SELECT status FROM public.reports WHERE id = '${rf}'`))[0]?.status;
const logs = await q(`SELECT message FROM public.error_logs`);
check(ok && fst === "resolved", "a failing notice never fails the status change", `${ok}/${fst}`);
check(logs.length === 1 && logs[0].message === "report outcome notice could not be sent", "and it is logged", `${logs.length}`);
await db.exec(`ALTER TABLE public.notifications DROP CONSTRAINT boom`);

// 8. every kind gets its noun
await clear();
const nouns = { job: "a job", message: "a message", review: "a review", application: "an application", declutter_wanted: "a Wanted post", declutter_question: "a question", declutter_answer: "an answer" };
for (const [type, noun] of Object.entries(nouns)) {
  await clear();
  const id = await file(REPORTER, type, type === "job" ? JOB : U(90));
  await setStatus(id, "resolved");
  const last = (await notes()).at(-1);
  check(last?.message.startsWith(`Thanks for your report about ${noun} (case ${caseOf(id)})`), `${type} reads "${noun}"`, last?.message);
}

// 9. releasing a Wanted post's held photos: a member's report is dismissed ("no rule broken"); the auto row stays resolved
await clear();
const W = U(60), W2 = U(61);
await db.exec(`INSERT INTO public.declutter_wanted (id, user_id, photo_paths, photos_held) VALUES
  ('${W}', '${BAD}', '{a.jpg}', '{a.jpg}'), ('${W2}', '${BAD}', '{b.jpg}', '{b.jpg}')`);
const rw = await file(REPORTER, "declutter_wanted", W);
const rauto = await file(null, "declutter_wanted", W2);
await db.exec(`SELECT set_config('test.uid', '${ADMIN}', false)`);
await db.query(`SELECT public.declutter_admin_release_wanted_photos($1, $2)`, [W, rw]);
await db.query(`SELECT public.declutter_admin_release_wanted_photos($1, $2)`, [W2, rauto]);
await db.exec(`SELECT set_config('test.uid', '', false)`);
const wst = Object.fromEntries((await q(`SELECT id::text, status FROM public.reports WHERE id IN ('${rw}', '${rauto}')`)).map((x) => [x.id, x.status]));
check(wst[rw] === "dismissed", "a member's report on photos the admin released is dismissed", wst[rw]);
check(wst[rauto] === "resolved", "the automatic photo-check row is still resolved", wst[rauto]);
ns = await notes();
check(ns.length === 1 && ns[0].message.includes("about a Wanted post") && ns[0].message.includes("didn't find a rule broken"),
  "the member who reported the photos hears 'didn't find a rule broken', never 'took action'", ns[0]?.message);
const relAcl = (await q(`SELECT proacl::text a FROM pg_proc WHERE proname = 'declutter_admin_release_wanted_photos'`))[0]?.a ?? "";
check(/authenticated=X/.test(relAcl) && !/anon=/.test(relAcl) && !/(^|[{,])=/.test(relAcl), `the release RPC keeps its grants (${relAcl})`);

const acl = (await q(`SELECT proacl::text a FROM pg_proc WHERE proname = 'notify_reporter_report_outcome'`))[0]?.a ?? "";
check(!!acl && !/(^|[{,])=/.test(acl) && !/anon=/.test(acl) && !/authenticated=/.test(acl), `the trigger function is not callable by PUBLIC/anon/authenticated (${acl})`);

console.log(failures ? `FAILED ${failures}` : "ALL PASS");
process.exit(failures ? 1 : 0);
