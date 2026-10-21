#!/usr/bin/env node
/**
 * PGlite proof for 20261021061341_member_display_name.sql + 20261021062140_member_display_name_crew_confirm.sql (Q2292).
 *
 *   node src/test/pglite/memberDisplayName.pglite.mjs
 *
 * The whole migration applied 3x (replay + the backfill's idempotency). Checks:
 *  - member_display_name follows formatName (src/lib/utils.ts): trim, no name -> fallback verbatim,
 *    one word -> itself, two or more -> first + last initial + '.'; anon has no EXECUTE.
 *  - two restated producers (Helpr arrived, review revealed) now write "First L.", never the full name.
 *  - the backfill renamed stored rows that named ANOTHER member, as whole words only, and left alone:
 *    staff rows (admin recipient + /admin link), the recipient's own name, a name inside a longer word,
 *    and a single-letter last name whose display form contains it; a 2nd and 3rd apply changed nothing.
 * Red check: LH_PROOF_REVERT=1 swaps the arrival producer back to the full name and the proof fails.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
let SQL = read("20261021061341_member_display_name.sql") + "\n" + read("20261021062140_member_display_name_crew_confirm.sql");
if (process.env.LH_PROOF_REVERT) {
  SQL = SQL.replace("SELECT public.member_display_name(full_name, 'Your Helpr') INTO v_helper_name", "SELECT COALESCE(full_name, 'Your Helpr') INTO v_helper_name");
}

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const POSTER = U(1), HELPR = U(2), ADMIN = U(3), ANN = U(4), SHORT = U(5), TWIN = U(6);
const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TYPE public.job_status AS ENUM ('open', 'assigned', 'in_progress', 'completed');
  CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, full_name text);
  CREATE TABLE public.user_roles (user_id uuid, role text);
  CREATE TABLE public.notification_preferences (user_id uuid PRIMARY KEY, transit_updates boolean, work_status boolean, reviews boolean);
  CREATE TABLE public.notifications (id serial PRIMARY KEY, user_id uuid, title text, message text, type text, link text,
    job_id uuid, read boolean DEFAULT false, created_at timestamptz DEFAULT now());
  CREATE TABLE public.jobs (id uuid PRIMARY KEY, title text, customer_id uuid, helper_id uuid, status public.job_status,
    helper_on_the_way_at timestamptz, helper_arrived_at timestamptz, helper_completed_at timestamptz);
  CREATE TABLE public.reviews (id serial PRIMARY KEY, job_id uuid, reviewer_id uuid, reviewee_id uuid, rating int);
  CREATE FUNCTION public.log_notification(uuid, text, text, text, text, uuid, text DEFAULT NULL) RETURNS void LANGUAGE sql AS $$ SELECT $$;
  INSERT INTO public.profiles VALUES ('${POSTER}', 'Paula  Poster'), ('${HELPR}', '  Andre Jean Landry '), ('${ADMIN}', 'Ada Admin'),
    ('${ANN}', 'Ann Lee'), ('${SHORT}', 'Bo K'), ('${TWIN}', 'Paula  Poster');
  INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin');
  -- Stored rows from before the fix.
  INSERT INTO public.notifications (user_id, title, message, type, link) VALUES
    ('${POSTER}', 'Andre Jean Landry has arrived', 'Andre Jean Landry has arrived for "Mow"', 'transit_updates', '/posts?job=1'),
    ('${HELPR}', 'New review from Paula  Poster', 'You got a 5-star review', 'review', '/profile?tab=reviews'),
    ('${ADMIN}', 'New member joined', 'Andre Jean Landry just joined and can post and apply now.', 'admin_alert', '/admin?view=people&user=x'),
    ('${ADMIN}', 'Andre Jean Landry accepted your offer', 'Andre Jean Landry accepted "Fix sink".', 'job_updates', '/posts?job=2'),
    ('${HELPR}', 'Hi Andre Jean Landry', 'Your own name stays', 'job_updates', '/jobs'),
    ('${POSTER}', 'Joann Leeds and Ann Lee', 'Ann Lee offered you a job', 'new_offers', '/jobs'),
    ('${POSTER}', 'Bo K accepted your offer', 'Bo K accepted', 'job_updates', '/posts'),
    ('${POSTER}', 'Paula  Poster, welcome', 'Same name as another member', 'job_updates', '/jobs');
`);
for (let i = 0; i < 3; i++) await db.exec(SQL);

let fails = 0, n = 0;
const check = (name, ok, got) => { n++; if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  got ${JSON.stringify(got)}`}`); };
const one = async (q) => (await db.query(q)).rows[0];

// 1. The helper.
for (const [input, fb, want] of [
  ["Andre Landry", null, "Andre L."], ["  Andre   Jean   Landry  ", null, "Andre L."], ["Madonna", null, "Madonna"],
  ["", "Someone", "Someone"], ["   ", "Someone", "Someone"], [null, "Your Helpr", "Your Helpr"], [null, null, null],
  ["élodie ñúñez", null, "élodie ñ."],
]) {
  const r = await one(`SELECT public.member_display_name(${input === null ? "NULL" : `'${input}'`}, ${fb === null ? "NULL" : `'${fb}'`}) AS d`);
  check(`member_display_name(${JSON.stringify(input)}, ${JSON.stringify(fb)}) = ${JSON.stringify(want)}`, r.d === want, r.d);
}
check("default fallback is formatName's 'A neighbor'", (await one(`SELECT public.member_display_name(NULL) AS d`)).d === "A neighbor");
const acl = (await one(`SELECT proacl::text AS a FROM pg_proc WHERE proname = 'member_display_name'`)).a;
check("anon and PUBLIC have no EXECUTE; authenticated does", !/(^|[{,])anon=/.test(acl) && !/(^|[{,])=X/.test(acl) && /authenticated=X/.test(acl), acl);

// 2. Producers write "First L.".
await db.exec(`
  INSERT INTO public.jobs (id, title, customer_id, helper_id, status) VALUES ('${U(90)}', 'Paint fence', '${POSTER}', '${HELPR}', 'assigned');
  CREATE TRIGGER t_status AFTER UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.notify_poster_on_status_change();
  CREATE TRIGGER t_review AFTER INSERT ON public.reviews FOR EACH ROW EXECUTE FUNCTION public.notify_user_on_review();
  UPDATE public.jobs SET helper_arrived_at = now() WHERE id = '${U(90)}';
  INSERT INTO public.reviews (job_id, reviewer_id, reviewee_id, rating) VALUES ('${U(90)}', '${HELPR}', '${POSTER}', 5);
  INSERT INTO public.reviews (job_id, reviewer_id, reviewee_id, rating) VALUES ('${U(90)}', '${POSTER}', '${HELPR}', 5);
`);
const arrived = await one(`SELECT title, message FROM public.notifications WHERE job_id = '${U(90)}' AND type = 'transit_updates'`);
check("arrival notice says 'Andre L. has arrived'", arrived?.title === "Andre L. has arrived" && arrived.message === 'Andre L. has arrived for "Paint fence"', arrived);
const review = await one(`SELECT title FROM public.notifications WHERE job_id = '${U(90)}' AND type = 'review' AND title LIKE 'New review from%'`);
check("revealed review says 'New review from Paula P.'", review?.title === "New review from Paula P.", review);

// 3. Backfill.
const rows = (await db.query(`SELECT user_id, type, title, message FROM public.notifications WHERE job_id IS NULL ORDER BY id`)).rows;
const want = [
  ["Andre L. has arrived", 'Andre L. has arrived for "Mow"'],
  ["New review from Paula P.", "You got a 5-star review"],
  ["New member joined", "Andre Jean Landry just joined and can post and apply now."],
  ["Andre L. accepted your offer", 'Andre L. accepted "Fix sink".'],
  ["Hi Andre Jean Landry", "Your own name stays"],
  ["Joann Leeds and Ann L.", "Ann L. offered you a job"],
  ["Bo K accepted your offer", "Bo K accepted"],
  ["Paula  Poster, welcome", "Same name as another member"],
];
const labels = ["member row renamed", "double-space full name renamed", "staff row keeps the full name", "admin's own member notice renamed",
  "recipient's own name kept", "whole words only (Joann Leeds untouched)", "single-letter last name skipped (display contains it)",
  "a twin's name that is also the recipient's own stays"];
want.forEach(([t, m], i) => check(`backfill: ${labels[i]}`, rows[i]?.title === t && rows[i]?.message === m, rows[i]));

// 4. A 4th apply changes nothing (idempotent).
const before = JSON.stringify((await db.query(`SELECT id, title, message FROM public.notifications ORDER BY id`)).rows);
await db.exec(SQL);
check("a 4th apply changes no row", JSON.stringify((await db.query(`SELECT id, title, message FROM public.notifications ORDER BY id`)).rows) === before);

console.log(`\n${n - fails}/${n} passed`);
process.exit(fails ? 1 : 0);
