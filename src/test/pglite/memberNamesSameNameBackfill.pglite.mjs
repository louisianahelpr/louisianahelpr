#!/usr/bin/env node
/**
 * PGlite proof for 20261021083241_member_names_same_name_backfill.sql (Q2292 follow-up).
 *
 *   node src/test/pglite/memberNamesSameNameBackfill.pglite.mjs                    # AFTER: 061341 then the fix, 3x
 *   NEW_MIGRATION=skip node src/test/pglite/memberNamesSameNameBackfill.pglite.mjs # RED: 061341's text rule alone
 *
 * The prod shape (2026-10-21): two DIFFERENT members both named "Lexi Lombas"; a notice from one to
 * the other about their job ("Lexi Lombas accepted your offer") was left in full by 061341, which read
 * the shared name as the recipient's own. Checks:
 *  - a job's poster, hired Helpr, applicant and crew member (by id) are shortened even when the
 *    recipient shares the name;
 *  - a same-name row with NO job is still left alone (nothing identifies the member by id);
 *  - a same-name row whose job does not name that member is left alone;
 *  - staff rows keep full names; a different-name row is shortened as before;
 *  - a 2nd and 3rd apply change nothing.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const BASE = read("20261021061341_member_display_name.sql");
const FIX = read("20261021083241_member_names_same_name_backfill.sql");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: 061341's rule alone (expect FAILs)`);

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const LEXI_A = U(1), LEXI_B = U(2), LEXI_C = U(3), LEXI_D = U(4), ADMIN = U(5), ANN = U(6);
const J1 = U(91), J2 = U(92), J3 = U(93), J4 = U(94);
const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TYPE public.job_status AS ENUM ('open', 'accepted', 'in_progress', 'completed');
  CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, full_name text);
  CREATE TABLE public.user_roles (user_id uuid, role text);
  CREATE TABLE public.notification_preferences (user_id uuid PRIMARY KEY, transit_updates boolean, work_status boolean, reviews boolean);
  CREATE TABLE public.notifications (id serial PRIMARY KEY, user_id uuid, title text, message text, type text, link text,
    job_id uuid, read boolean DEFAULT false, created_at timestamptz DEFAULT now());
  CREATE TABLE public.jobs (id uuid PRIMARY KEY, title text, customer_id uuid, helper_id uuid, status public.job_status,
    helper_on_the_way_at timestamptz, helper_arrived_at timestamptz, helper_completed_at timestamptz);
  CREATE TABLE public.applications (id serial PRIMARY KEY, job_id uuid, helper_id uuid, status text);
  CREATE TABLE public.group_job_helpers (id serial PRIMARY KEY, job_id uuid, helper_id uuid, status text);
  CREATE TABLE public.reviews (id serial PRIMARY KEY, job_id uuid, reviewer_id uuid, reviewee_id uuid, rating int);
  CREATE FUNCTION public.log_notification(uuid, text, text, text, text, uuid, text DEFAULT NULL) RETURNS void LANGUAGE sql AS $$ SELECT $$;
  INSERT INTO public.profiles VALUES ('${LEXI_A}', 'Lexi Lombas'), ('${LEXI_B}', 'Lexi Lombas'), ('${LEXI_C}', 'Lexi Lombas'),
    ('${LEXI_D}', 'Lexi Lombas'), ('${ADMIN}', 'Ada Admin'), ('${ANN}', 'Ann Lee');
  INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin');
  -- J1: A posted, B hired. J2: A posted, C applied. J3: A posted, D on the crew.
  INSERT INTO public.jobs (id, title, customer_id, helper_id, status) VALUES
    ('${J1}', 'clean my house', '${LEXI_A}', '${LEXI_B}', 'accepted'),
    ('${J2}', 'Mow', '${LEXI_A}', NULL, 'open'),
    ('${J3}', 'Move a couch', '${LEXI_A}', NULL, 'accepted'),
    ('${J4}', 'Only B on it', '${LEXI_B}', NULL, 'open');
  INSERT INTO public.applications (job_id, helper_id, status) VALUES ('${J2}', '${LEXI_C}', 'pending');
  INSERT INTO public.group_job_helpers (job_id, helper_id, status) VALUES ('${J3}', '${LEXI_D}', 'accepted');
  INSERT INTO public.notifications (user_id, job_id, title, message, type, link) VALUES
    ('${LEXI_A}', '${J1}', 'Lexi Lombas accepted your offer', 'Lexi Lombas accepted "clean my house". You''re all set.', 'job_updates', '/posts?job=1'),
    ('${LEXI_B}', '${J1}', 'You''re all set', 'You''ve accepted "clean my house", and Lexi Lombas has been told.', 'job_updates', '/jobs?job=1'),
    ('${LEXI_A}', '${J2}', 'Lexi Lombas applied', 'Lexi Lombas applied to "Mow".', 'job_updates', '/posts?job=2'),
    ('${LEXI_A}', '${J3}', 'Lexi Lombas joined your crew', 'Lexi Lombas took a spot on "Move a couch".', 'job_updates', '/posts?job=3'),
    ('${LEXI_A}', NULL, 'Lexi Lombas, welcome', 'No job: nothing names the member by id', 'job_updates', '/jobs'),
    ('${LEXI_B}', '${J2}', 'Lexi Lombas applied', 'J2''s poster and applicant share the name', 'job_updates', '/jobs'),
    ('${ADMIN}', '${J1}', 'Lexi Lombas accepted', 'Lexi Lombas accepted a job.', 'admin_alert', '/admin?view=jobs'),
    ('${LEXI_A}', NULL, 'Ann Lee offered you a job', 'Ann Lee offered you a job', 'new_offers', '/jobs'),
    ('${LEXI_B}', '${J4}', 'Lexi Lombas, your job is live', 'Nobody else is on this job', 'job_updates', '/posts');
`);
await db.exec(BASE);
if (MODE !== "skip") for (let i = 0; i < 3; i++) await db.exec(FIX);

let fails = 0, n = 0;
const check = (name, ok, got) => { n++; if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  got ${JSON.stringify(got)}`}`); };
const rows = (await db.query(`SELECT title, message FROM public.notifications ORDER BY id`)).rows;
const want = [
  ["the hired Helpr, recipient shares the name (the prod rows)", "Lexi L. accepted your offer", 'Lexi L. accepted "clean my house". You\'re all set.'],
  ["the poster, recipient shares the name", "You're all set", 'You\'ve accepted "clean my house", and Lexi L. has been told.'],
  ["an applicant, by id", "Lexi L. applied", 'Lexi L. applied to "Mow".'],
  ["a crew member, by id", "Lexi L. joined your crew", 'Lexi L. took a spot on "Move a couch".'],
  ["no job and the same name: left alone", "Lexi Lombas, welcome", "No job: nothing names the member by id"],
  // B's row on J2: J2's parties are A (poster) and C (applicant), both other than B, so the name is theirs.
  ["a job whose parties (other than the recipient) carry the name: shortened", "Lexi L. applied", "J2's poster and applicant share the name"],
  ["staff row keeps the full name", "Lexi Lombas accepted", "Lexi Lombas accepted a job."],
  ["a different name: shortened as before", "Ann L. offered you a job", "Ann L. offered you a job"],
  ["same name, and the job names no one else by id: left alone", "Lexi Lombas, your job is live", "Nobody else is on this job"],
];
want.forEach(([label, t, m], i) => check(`backfill: ${label}`, rows[i]?.title === t && rows[i]?.message === m, rows[i]));

const before = JSON.stringify(rows);
await db.exec(FIX);
check("another apply changes no row", JSON.stringify((await db.query(`SELECT title, message FROM public.notifications ORDER BY id`)).rows) === before);

console.log(`\n${n - fails}/${n} passed`);
process.exit(fails ? 1 : 0);
