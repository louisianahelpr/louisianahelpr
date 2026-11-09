#!/usr/bin/env node
/**
 * PGlite proof for 20261108201000_jobs_notices_email (Jobs audit 11-08 #2 High, #6 Medium).
 *
 *   node src/test/pglite/jobsNoticesEmail.pglite.mjs                    # GREEN (the migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/jobsNoticesEmail.pglite.mjs # RED (no email; switch off drops the row)
 *   MUTANT=<name> node src/test/pglite/jobsNoticesEmail.pglite.mjs      # a planted defect: must FAIL
 *
 * send_notice_email is stubbed to record (user, title, email type): what it does with that is
 * 20261108160000's (send-notification-email reads the switch for the type, the master switch, and refuses test and
 * seed recipients). The three restated senders are loaded from the migration; their newest definitions run on a
 * minimal schema (jobs, tips, reviews, profiles, notification_preferences, payout_holds).
 *   E1 every listed Jobs notice emails, under its switch (money: the row's own type; dispute/reschedule: job_updates)
 *   E2 the admins' "Job disputed", a Declutter row, an unlisted title and a 'warning' "Job cancelled" never email
 *   E3 #6: Financial alerts OFF: the hire notice, "Payout released" and the tip rows are still written (and emailed:
 *      send-notification-email then reads the switch); Reviews OFF: "review received" is still written
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261108201000_jobs_notices_email.sql";
const skip = process.env.NEW_MIGRATION === "skip";
const MUTANT = process.env.MUTANT ?? "";
const MUTANTS = {
  hire: ["p_title IN ('Job funded', 'Payout released', 'You received a tip!')", "p_title IN ('Payout released', 'You received a tip!')"],
  tip: ["WHEN p_type = 'financial_alerts' AND p_title LIKE '% tipped you %' THEN p_type", "WHEN false THEN p_type"],
  checkIn: ["OR p_title LIKE '% started working again'", ""],
  disputeSwitch: ["'Revision deadline passed — dispute opened') THEN 'job_updates'", "'Revision deadline passed — dispute opened') THEN p_type"],
  declutter: ["        AND COALESCE(NEW.link, '') NOT LIKE '/declutter%'\n", ""],
  escrowGate: ["IF true THEN -- CHANGED 20261108201000 (audit 11-08 #6): the row is always written; the switch gates push\n        -- A3-38", "IF false THEN\n        -- A3-38"],
  reviewGate: ["IF true THEN -- CHANGED 20261108201000 (audit 11-08 #6): the row is always written; the switch gates push\n    INSERT INTO public.notifications (user_id, title, message, type, link, job_id)\n    VALUES (NEW.reviewee_id", "IF false THEN\n    INSERT INTO public.notifications (user_id, title, message, type, link, job_id)\n    VALUES (NEW.reviewee_id"],
};
if (MUTANT && !MUTANTS[MUTANT]) throw new Error(`unknown MUTANT ${MUTANT}`);

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const [POSTER, HELPR, ADMIN] = [1, 2, 3].map(id);
const JOB = id(11);

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, title text NOT NULL, message text NOT NULL,
  type text, link text, job_id uuid, read boolean DEFAULT false);
CREATE TABLE public.emails (user_id uuid, title text, type text, job_id uuid);
CREATE FUNCTION public.send_notice_email(p_user_id uuid, p_title text, p_message text, p_type text, p_link text, p_job_id uuid)
  RETURNS void LANGUAGE sql AS $$ INSERT INTO public.emails VALUES (p_user_id, p_title, p_type, p_job_id) $$;
CREATE FUNCTION public.log_notification(uuid, text, text, text, text, uuid, text DEFAULT NULL) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.member_display_name(n text, f text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT COALESCE(n, f) $$;
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, full_name text);
CREATE TABLE public.notification_preferences (user_id uuid PRIMARY KEY, financial_alerts boolean DEFAULT true, reviews boolean DEFAULT true);
CREATE TABLE public.payout_holds (helper_id uuid PRIMARY KEY);
CREATE TABLE public.group_job_helpers (job_id uuid, helper_id uuid);
CREATE TABLE public.jobs (id uuid PRIMARY KEY, title text, customer_id uuid, helper_id uuid, status text, payment_status text,
  date_needed date, start_time time, helper_confirmed_at timestamptz, is_group_job boolean DEFAULT false);
CREATE TABLE public.tips (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid, tipper_id uuid, amount numeric, payment_status text);
CREATE TABLE public.reviews (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, reviewer_id uuid, reviewee_id uuid, rating int,
  comment text, feedback_visible_at timestamptz, created_at timestamptz DEFAULT now());
INSERT INTO public.profiles VALUES ('${POSTER}', 'Pat Poster'), ('${HELPR}', 'Yusef Helpr');
`);
const base = (f) => readFileSync(DIR + f, "utf8");
// The live senders before this migration (newest definitions), with their triggers.
const cutFn = (file, name) => {
  const sql = base(file);
  const m = [...sql.matchAll(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(\\)`, "g"))].at(-1);
  const open = /\bAS\s+(\$\w*\$)/i.exec(sql.slice(m.index));
  const start = m.index + open.index + open[0].length;
  return sql.slice(m.index, sql.indexOf(open[1], start) + open[1].length) + ";";
};
await db.exec(cutFn("20261102084222_a3_stack_reconcile.sql", "notify_on_payment_escrowed"));
await db.exec(cutFn("20261102045334_paid_tip_tells_the_helpr_once.sql", "notify_helper_on_tip"));
await db.exec(cutFn("20261102230737_review_held_notice_names_reviewer.sql", "notify_user_on_review"));
await db.exec(`
CREATE TRIGGER trg_notify_payment_escrowed AFTER UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.notify_on_payment_escrowed();
CREATE TRIGGER trg_notify_helper_on_tip AFTER INSERT OR UPDATE ON public.tips FOR EACH ROW EXECUTE FUNCTION public.notify_helper_on_tip();
CREATE TRIGGER trg_notify_user_on_review AFTER INSERT ON public.reviews FOR EACH ROW EXECUTE FUNCTION public.notify_user_on_review();`);
if (!skip) {
  let sql = base(THIS);
  if (MUTANT) {
    const [find, repl] = MUTANTS[MUTANT];
    if (!sql.includes(find)) throw new Error(`MUTANT ${MUTANT}: text not found`);
    sql = sql.replace(find, repl);
  }
  for (let i = 0; i < 3; i++) await db.exec(sql);
  console.log("migration applied 3x");
} else console.log("NEW_MIGRATION=skip: the live senders, no Jobs email trigger");

let failed = 0;
const ok = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : `  ${extra}`}`);
  if (!cond) failed++;
};
const rows = async (q) => (await db.query(q)).rows;
const reset = () => db.exec(`DELETE FROM public.notifications; DELETE FROM public.emails;`);
const insert = (user, title, type, link = `/jobs?job=${JOB}`) => db.query(
  `INSERT INTO public.notifications (user_id, title, message, type, link, job_id) VALUES ($1, $2, 'm', $3, $4, $5)`, [user, title, type, link, JOB]);
const emailed = async (title) => (await rows(`SELECT type FROM public.emails WHERE title = '${title.replace(/'/g, "''")}'`)).map((r) => r.type);

// E1: each listed notice, with the switch its email must follow.
const LISTED = [
  ["Job funded", "financial_alerts", "financial_alerts"], ["Payout released", "financial_alerts", "financial_alerts"],
  ["Yusef tipped you $5.00", "financial_alerts", "financial_alerts"], ["You received a tip!", "financial_alerts", "financial_alerts"],
  ["Job approved!", "payment", "payment"], ["Job complete", "info", "info"], ["Job complete", "payment", "payment"],
  ["Helpr support approved your job", "payment", "payment"], ["Job completed!", "payment", "payment"],
  ["Job cancelled", "job_updates", "job_updates"], ["Job cancelled — you'll be compensated", "payment", "payment"],
  ["A dispute was opened", "job_updates", "job_updates"], ["Revision deadline passed — dispute opened", "warning", "job_updates"],
  ["New date or time requested", "job_updates", "job_updates"], ["New date or time accepted", "job_updates", "job_updates"],
  ["New date or time declined", "job_updates", "job_updates"], ["Your new time wasn't answered", "warning", "job_updates"],
  ["Start time passed", "work_status", "work_status"], ["Job day ended", "work_status", "work_status"],
  ["Please review the work", "work_status", "work_status"],
  ["Yusef is on the way back", "job_updates", "job_updates"], ["Yusef is back at the job", "job_updates", "job_updates"],
  ["Yusef started working again", "job_updates", "job_updates"],
];
for (const [title, type, want] of LISTED) {
  await reset();
  await insert(POSTER, title, type);
  const got = await emailed(title);
  ok(`E1 "${title}" (${type}) emails under ${want}`, got.length === 1 && got[0] === want, JSON.stringify(got));
}

// E2: never emailed from here.
for (const [title, type, link, why] of [
  ["Job disputed", "job_updates", `/admin?view=disputes`, "the admins' copy"],
  ["Job funded", "financial_alerts", "/declutter?view=sales", "a Declutter link"],
  ["Something else", "job_updates", `/jobs?job=${JOB}`, "an unlisted title"],
  ["Job cancelled", "warning", `/jobs?job=${JOB}`, "a 'warning' Job cancelled (the always-on Don't go reminder)"],
]) {
  await reset();
  await insert(ADMIN, title, type, link);
  ok(`E2 ${why} is not emailed`, (await emailed(title)).length === 0);
}

// E3 (#6): switches off, rows still written.
await reset();
await db.exec(`INSERT INTO public.notification_preferences (user_id, financial_alerts, reviews) VALUES ('${HELPR}', false, false), ('${POSTER}', false, false);
  INSERT INTO public.jobs (id, title, customer_id, helper_id, status, payment_status) VALUES ('${JOB}', 'Yard', '${POSTER}', '${HELPR}', 'accepted', 'pending');
  UPDATE public.jobs SET payment_status = 'escrow' WHERE id = '${JOB}';`);
const hire = await rows(`SELECT title FROM public.notifications WHERE user_id = '${HELPR}' AND title = 'Job funded'`);
ok("E3 Financial alerts off: the Helpr's hire notice ('Job funded') is still written", hire.length === 1);
ok("E3 ... and handed to the email (send-notification-email then reads the switch)", (await emailed("Job funded")).length === 1);
await db.exec(`UPDATE public.jobs SET status = 'completed', payment_status = 'released' WHERE id = '${JOB}';`);
ok("E3 Financial alerts off: 'Payout released' is still written", (await rows(`SELECT 1 FROM public.notifications WHERE title = 'Payout released'`)).length === 1);
await db.exec(`INSERT INTO public.tips (job_id, helper_id, tipper_id, amount, payment_status) VALUES ('${JOB}', '${HELPR}', '${POSTER}', 5, 'paid');`);
ok("E3 Financial alerts off: the tip notice is still written", (await rows(`SELECT 1 FROM public.notifications WHERE title LIKE '% tipped you %'`)).length === 1);
await db.exec(`INSERT INTO public.reviews (job_id, reviewer_id, reviewee_id, rating, comment) VALUES ('${JOB}', '${POSTER}', '${HELPR}', 5, 'Great');`);
ok("E3 Reviews off: the review notice is still written", (await rows(`SELECT 1 FROM public.notifications WHERE type = 'review' AND user_id = '${HELPR}'`)).length === 1);

if (!skip) {
  const g = (await rows(`SELECT has_function_privilege('authenticated', 'public.jobs_notice_email_type(text, text)', 'EXECUTE') AS a,
    has_function_privilege('anon', 'public.email_jobs_notice()', 'EXECUTE') AS b`))[0];
  ok("grants: the matcher and the trigger function are not member-callable", !g.a && !g.b, JSON.stringify(g));
}

console.log(failed ? `\n${failed} FAILED` : "\nall PASS");
process.exit(failed ? 1 : 0);
