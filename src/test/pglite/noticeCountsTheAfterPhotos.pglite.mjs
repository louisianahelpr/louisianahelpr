#!/usr/bin/env node
/**
 * PGlite proof for 20261023151519_notice_counts_the_after_photos.sql (owner, 2026-10-23, Q2361: "ben also did not
 * receive any before or after pictures"; the "marked the job complete" notice says how many photos are waiting).
 *
 *   node src/test/pglite/noticeCountsTheAfterPhotos.pglite.mjs
 *
 * member_display_name is its newest definition (20261021131322); log_notification is a recording stub; the trigger
 * is bound as prod binds it (AFTER UPDATE on jobs). The migration is applied 3x. Checks:
 *  - completion with 2 after photos: 'Yusef H. finished "Mow two lawns" and added 2 after photos. Review them and confirm.'
 *  - with 1: "... added 1 after photo. Review them and confirm."
 *  - with none (no photos asked): the old sentence, unchanged;
 *  - the title, link, type and the other branches (on the way, arrived) are unchanged;
 *  - the poster's preference off: no bell row, a 'skipped' log;
 *  - blank or NULL paths are not counted; a Helpr with no profiles row does not roll the completion back;
 *  - the 3rd apply changes nothing.
 * Red checks: LH_PROOF_REVERT=1 applies the old completed sentence; LH_PROOF_REVERT_NAME=1 drops the no-profile
 * fallback (the completion then rolls back on the NOT NULL). Both fail.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");

const names = read("20261021131322_member_names_first_and_initial.sql");
const MDN = names.match(/CREATE OR REPLACE FUNCTION public\.member_display_name\([\s\S]*?\n\$fn\$;/)?.[0];
if (!MDN) throw new Error("member_display_name not found in 20261021131322");

let SQL = read("20261023151519_notice_counts_the_after_photos.sql");
if (process.env.LH_PROOF_REVERT) {
  const from = "    IF v_after > 0 THEN";
  if (!SQL.includes(from)) throw new Error("revert target not found");
  SQL = SQL.replace(from, "    IF false THEN");
}

if (process.env.LH_PROOF_REVERT_NAME) {
  const from = "  v_helper_name := COALESCE(v_helper_name, 'Your Helpr');\n";
  if (!SQL.includes(from)) throw new Error("name revert target not found");
  SQL = SQL.replace(from, "");
}

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const POSTER = U(1), YUSEF = U(2), QUIET = U(3), GHOST = U(4);
const J = (n) => U(100 + n);
const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TYPE public.job_status AS ENUM ('open','accepted','in_progress','completed','cancelled','disputed','revision_requested','pending_approval');
  CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, full_name text);
  CREATE TABLE public.notification_preferences (user_id uuid PRIMARY KEY, transit_updates boolean, work_status boolean);
  -- Prod's NOT NULLs (information_schema on prod, 2026-10-23): a NULL sentence must fail here as it would there.
  CREATE TABLE public.notifications (id serial PRIMARY KEY, user_id uuid NOT NULL, title text NOT NULL, message text NOT NULL, type text NOT NULL, link text, job_id uuid);
  CREATE TABLE public.notif_log (user_id uuid, category text, channel text, status text, title text, job_id uuid, reason text);
  CREATE FUNCTION public.log_notification(p_user uuid, p_cat text, p_channel text, p_status text, p_title text, p_job uuid, p_reason text DEFAULT NULL)
    RETURNS void LANGUAGE sql AS $$ INSERT INTO public.notif_log VALUES (p_user, p_cat, p_channel, p_status, p_title, p_job, p_reason) $$;
  CREATE TABLE public.jobs (id uuid PRIMARY KEY, title text NOT NULL, customer_id uuid, helper_id uuid, status public.job_status,
    helper_on_the_way_at timestamptz, helper_arrived_at timestamptz, helper_completed_at timestamptz, proof_after_urls text[]);
`);
await db.exec(MDN);
for (let i = 0; i < 3; i++) await db.exec(SQL);
await db.exec(`CREATE TRIGGER notify_poster_on_status_change AFTER UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.notify_poster_on_status_change();`);
await db.exec(`
  INSERT INTO public.profiles VALUES ('${POSTER}', 'Ben Poster'), ('${YUSEF}', 'Yusef Helpr');
  INSERT INTO public.notification_preferences VALUES ('${QUIET}', true, false);
  INSERT INTO public.jobs (id, title, customer_id, helper_id, status, helper_arrived_at, proof_after_urls) VALUES
    ('${J(1)}', 'Mow two lawns', '${POSTER}', '${YUSEF}', 'in_progress', now(), ARRAY['a/after-1.jpg','a/after-2.jpg']),
    ('${J(2)}', 'Hang one shelf', '${POSTER}', '${YUSEF}', 'in_progress', now(), ARRAY['b/after-1.jpg']),
    ('${J(3)}', 'No photos asked', '${POSTER}', '${YUSEF}', 'in_progress', now(), '{}'),
    ('${J(4)}', 'Null photos', '${POSTER}', '${YUSEF}', 'in_progress', now(), NULL),
    ('${J(5)}', 'Quiet poster', '${QUIET}', '${YUSEF}', 'in_progress', now(), ARRAY['c/after-1.jpg']),
    ('${J(6)}', 'On the way job', '${POSTER}', '${YUSEF}', 'accepted', NULL, NULL),
    ('${J(7)}', 'Blank paths', '${POSTER}', '${YUSEF}', 'in_progress', now(), ARRAY['', NULL, 'd/after-1.jpg']),
    ('${J(8)}', 'Helpr with no profile', '${POSTER}', '${GHOST}', 'in_progress', now(), ARRAY['e/after-1.jpg','e/after-2.jpg']);
`);
await db.exec(`UPDATE public.jobs SET helper_completed_at = now() WHERE id IN ('${J(1)}','${J(2)}','${J(3)}','${J(4)}','${J(5)}','${J(7)}');`);
// A Helpr with no profiles row: the completion itself must go through (a NULL sentence would roll it back).
let ghostError = null;
try { await db.exec(`UPDATE public.jobs SET helper_completed_at = now() WHERE id = '${J(8)}';`); } catch (e) { ghostError = String(e.message ?? e); }
await db.exec(`UPDATE public.jobs SET helper_on_the_way_at = now() WHERE id = '${J(6)}';`);

let n = 0, fails = 0;
const check = (name, ok, got) => { n++; if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  got ${JSON.stringify(got)}`}`); };
const row = async (j) => (await db.query(`SELECT title, message, type, link FROM public.notifications WHERE job_id = $1`, [j])).rows;

const r1 = await row(J(1));
check("2 after photos: the count and the ask", r1.length === 1 && r1[0].message === 'Yusef H. finished "Mow two lawns" and added 2 after photos. Review them and confirm.', r1);
check("title, type and link unchanged", r1[0]?.title === "Yusef H. marked the job complete" && r1[0]?.type === "work_status" && r1[0]?.link === `/posts?job=${J(1)}`, r1);
const r2 = await row(J(2));
check("1 after photo: singular", r2[0]?.message === 'Yusef H. finished "Hang one shelf" and added 1 after photo. Review them and confirm.', r2);
const r3 = await row(J(3));
check("no photos (empty array): the old sentence", r3[0]?.message === 'Yusef H. has finished "No photos asked". Please review and confirm.', r3);
const r4 = await row(J(4));
check("no photos (NULL): the old sentence", r4[0]?.message === 'Yusef H. has finished "Null photos". Please review and confirm.', r4);
const r5 = await row(J(5));
const log5 = (await db.query(`SELECT status, reason FROM public.notif_log WHERE job_id = $1`, [J(5)])).rows;
check("preference off: no bell row, a skipped log", r5.length === 0 && log5.length === 1 && log5[0].status === "skipped" && log5[0].reason === "preference_off", { r5, log5 });
const r6 = await row(J(6));
check("other branches unchanged (on the way)", r6[0]?.message === 'Yusef H. is heading to your job: "On the way job"' && r6[0]?.title === "Yusef H. is on the way", r6);

const r7 = await row(J(7));
check("blank and NULL paths are not photos", r7[0]?.message === 'Yusef H. finished "Blank paths" and added 1 after photo. Review them and confirm.', r7);
const r8 = await row(J(8));
const done8 = (await db.query(`SELECT helper_completed_at IS NOT NULL AS done FROM public.jobs WHERE id = $1`, [J(8)])).rows[0]?.done;
check("a Helpr with no profiles row: the completion goes through, the notice says Your Helpr",
  ghostError === null && done8 === true && r8[0]?.message === 'Your Helpr finished "Helpr with no profile" and added 2 after photos. Review them and confirm.', { ghostError, done8, r8 });

const snap = async () => JSON.stringify((await db.query(`SELECT pg_get_functiondef('public.notify_poster_on_status_change()'::regprocedure) d`)).rows);
const before = await snap();
await db.exec(SQL);
check("a 4th apply changes nothing", (await snap()) === before);

console.log(`\n${n - fails}/${n} passed`);
process.exit(fails ? 1 : 0);
