#!/usr/bin/env node
/**
 * PGlite proof for 20261030135219_applicant_nudges_and_filled_notice.sql (owner 2026-10-29, audit
 * page UX-3, Q2484: "nudge posters after 24 h; tell other applicants kindly when a job fills, with
 * similar jobs").
 *
 *   node src/test/pglite/applicantNudgesAndFilledNotice.pglite.mjs
 *
 * The migration is applied 3x. member_display_name is its newest definition (20261021131322);
 * job_category_group and are_users_blocked are prod's bodies (pg_get_functiondef 2026-10-30 /
 * 2026-10-21). "sweep_unanswered_applications" is then reloaded on ./lib/fixedClock.mjs (Q1357) and
 * every window edge is run at a fixed instant. Checks:
 *  - the filled notice: when a Helpr's accept closes the other pending applications (the
 *    complete_job_accept UPDATE), each other applicant gets 'This job was filled' / 'Thanks for
 *    applying to "<job>". The poster picked someone else this time. Tap to see similar open jobs.'
 *    linked to '/jobs?tab=browse&cat=<group>', bell and email; no category -> '/jobs?tab=browse';
 *  - unchanged: a poster's decline on an unfilled job ("was not selected"), a decline note after the
 *    job filled ("not selected: <note>"), the offered Helpr told of a cancel, a block (no notice);
 *  - the nudge: once per job, 24 h <= oldest pending < 72 h, open job with no Helpr, no pending direct
 *    offer, not expired; counts every pending applicant ("1 person ... is", "2 people ... are");
 *    in-app row (type application, job_id set, '/posts?job=<id>') and email (type application);
 *    nothing from 8 PM to 8 AM Louisiana time (and nothing claimed then); a second run sends nothing;
 *  - the sweep is not executable by anon or authenticated.
 * Red check: LH_PROOF_REVERT=1 removes the filled branch and the 24-hour floor; the proof fails.
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import { installClock, newestFunction, onFixedClock, setClock } from "./lib/fixedClock.mjs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");

const names = read("20261021131322_member_names_first_and_initial.sql");
const MDN = names.match(/CREATE OR REPLACE FUNCTION public\.member_display_name\([\s\S]*?\n\$fn\$;/)?.[0];
if (!MDN) throw new Error("member_display_name not found in 20261021131322");

const FILE = "20261030135219_applicant_nudges_and_filled_notice.sql";
let SQL = read(FILE);
if (process.env.LH_PROOF_REVERT) {
  const filled = SQL.indexOf("    ELSIF NEW.closed_reason IS NULL AND job_helper IS NOT NULL");
  const els = SQL.indexOf("    ELSE\n      v_message := 'Your application for", filled);
  if (filled < 0 || els < 0) throw new Error("revert target (filled branch) not found");
  SQL = SQL.slice(0, filled) + SQL.slice(els);
  const floor = "      HAVING min(a.created_at) <= v_now - interval '24 hours'\n         AND ";
  if (!SQL.includes(floor)) throw new Error("revert target (24-hour floor) not found");
  SQL = SQL.replace(floor, "      HAVING ");
}
const SKIP = "         AND NOT COALESCE(j.is_seed, false)\n         AND NOT public.is_test_member(j.customer_id)\n";

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const POSTER = U(1), ANN = U(2), BOB = U(3), CY = U(4), DEE = U(5), TESTER = U(6), SEEDER = U(7);
const J = (n) => U(100 + n);
const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
  CREATE TABLE auth.users (id uuid PRIMARY KEY);
  CREATE SCHEMA net;
  CREATE TABLE net.calls (body jsonb);
  CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO net.calls VALUES (body) RETURNING 1::bigint $$;
  CREATE SCHEMA vault; CREATE TABLE vault.decrypted_secrets (name text, decrypted_secret text);
  INSERT INTO vault.decrypted_secrets VALUES ('supabase_url', 'https://x'), ('service_role_key', 'k');
  CREATE FUNCTION public.is_server_context() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
  CREATE FUNCTION public.application_email_should_wait(p_user_id uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
  CREATE TYPE public.job_category AS ENUM ('cleaning', 'handyman', 'yard_work', 'moving', 'other');
  CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, full_name text, email text, is_seed boolean NOT NULL DEFAULT false);
  CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY);
  -- prod's body, pg_get_functiondef 2026-10-30
  CREATE FUNCTION public.is_test_member(p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public' AS $$
    SELECT p_user_id IS NOT NULL AND (
      EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = p_user_id AND p.is_seed IS TRUE)
      OR EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p_user_id)
    );
  $$;
  CREATE TABLE public.user_blocks (blocker_id uuid, blocked_id uuid);
  CREATE TABLE public.notification_preferences (user_id uuid PRIMARY KEY, email_job_applications boolean);
  CREATE TABLE public.jobs (id uuid PRIMARY KEY, title text, customer_id uuid, helper_id uuid, offered_to_helper_id uuid,
    direct_offer_status text, status text NOT NULL DEFAULT 'open', category public.job_category, expires_at timestamptz,
    is_seed boolean NOT NULL DEFAULT false);
  CREATE TABLE public.applications (id serial PRIMARY KEY, job_id uuid NOT NULL, helper_id uuid NOT NULL, status text,
    closed_reason text, decline_reason text, created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.notifications (id serial PRIMARY KEY, user_id uuid NOT NULL, title text NOT NULL, message text NOT NULL,
    type text NOT NULL, link text, job_id uuid, read boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
  -- prod's body, pg_get_functiondef 2026-10-21
  CREATE FUNCTION public.are_users_blocked(_user_a uuid, _user_b uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public' AS $$
    SELECT CASE
      WHEN COALESCE(auth.uid() IN (_user_a, _user_b), false) OR public.is_server_context() OR pg_trigger_depth() > 0
      THEN EXISTS (SELECT 1 FROM public.user_blocks
                    WHERE (blocker_id = _user_a AND blocked_id = _user_b) OR (blocker_id = _user_b AND blocked_id = _user_a))
    END;
  $$;
  -- prod's body, pg_get_functiondef 2026-10-30 (the enum here has only the values this proof uses)
  CREATE FUNCTION public.job_category_group(p_category public.job_category) RETURNS text LANGUAGE sql STABLE
  SET search_path TO 'public', 'pg_temp' AS $$
    SELECT CASE
      WHEN p_category::text IN ('cleaning', 'handyman', 'assembly', 'painting', 'pressure_washing', 'declutter_help', 'storm_prep') THEN 'home'
      WHEN p_category::text IN ('yard_work') THEN 'yard'
      WHEN p_category::text IN ('moving', 'errands', 'delivery') THEN 'moving_errands'
      WHEN p_category::text IN ('other') THEN 'other'
    END
  $$;
  INSERT INTO auth.users VALUES ('${POSTER}'), ('${ANN}'), ('${BOB}'), ('${CY}'), ('${DEE}'), ('${TESTER}'), ('${SEEDER}');
  INSERT INTO public.test_accounts VALUES ('${TESTER}');
  INSERT INTO public.profiles VALUES ('${POSTER}', 'Paula Poster', 'p@x'), ('${ANN}', 'Ann A', 'a@x'),
    ('${BOB}', 'Bob B', 'b@x'), ('${CY}', 'Cy C', 'c@x'), ('${DEE}', 'Dee D', 'd@x'), ('${TESTER}', 'Tess T', 't@x');
  INSERT INTO public.profiles (user_id, full_name, email, is_seed) VALUES ('${SEEDER}', 'Sid S', 's@x', true);
`);
await db.exec(MDN);

for (let i = 0; i < 3; i++) await db.exec(SQL);
await db.exec(`CREATE TRIGGER on_application_change AFTER INSERT OR UPDATE ON public.applications FOR EACH ROW EXECUTE FUNCTION public.notify_on_application();`);

let fails = 0, n = 0;
const check = (name, ok, got) => { n++; if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  got ${JSON.stringify(got)}`}`); };
const notes = async (user) => (await db.query(`SELECT title, message, link, type, job_id FROM public.notifications WHERE user_id = $1 ORDER BY id`, [user])).rows;
const mails = async (user) => (await db.query(`SELECT body FROM net.calls WHERE body->>'user_id' = $1`, [user])).rows.map((r) => r.body);
const reset = async () => { await db.exec(`DELETE FROM public.notifications; DELETE FROM net.calls;`); };

// 1. The filled notice.
await db.exec(`
  INSERT INTO public.jobs (id, title, customer_id, category) VALUES ('${J(1)}', 'Deep clean a kitchen', '${POSTER}', 'cleaning');
  INSERT INTO public.applications (job_id, helper_id, status) VALUES ('${J(1)}', '${ANN}', 'pending'), ('${J(1)}', '${BOB}', 'pending');
`);
await reset();
// complete_job_accept: the job gets its Helpr, then the other pending applications close.
await db.exec(`
  UPDATE public.jobs SET helper_id = '${ANN}', status = 'accepted' WHERE id = '${J(1)}';
  UPDATE public.applications SET status = 'rejected' WHERE job_id = '${J(1)}' AND helper_id IS DISTINCT FROM '${ANN}' AND status = 'pending';
`);
const bob = await notes(BOB);
const filledMsg = 'Thanks for applying to "Deep clean a kitchen". The poster picked someone else this time. Tap to see similar open jobs.';
check("filled: the other applicant is told kindly", bob.length === 1 && bob[0].title === "This job was filled" && bob[0].message === filledMsg, bob);
check("filled: the link opens similar open jobs (Browse, the category group)", bob[0]?.link === "/jobs?tab=browse&cat=home", bob[0]);
const bobMail = await mails(BOB);
check("filled: the email carries the same words and link", bobMail.length === 1 && bobMail[0].title === "This job was filled" && bobMail[0].message === filledMsg && bobMail[0].link === "/jobs?tab=browse&cat=home", bobMail);
check("filled: the hired Helpr gets no filled notice", (await notes(ANN)).length === 0, await notes(ANN));

await db.exec(`
  INSERT INTO public.jobs (id, title, customer_id, category) VALUES ('${J(2)}', 'Odd job', '${POSTER}', NULL);
  INSERT INTO public.applications (job_id, helper_id, status) VALUES ('${J(2)}', '${ANN}', 'pending'), ('${J(2)}', '${BOB}', 'pending');
`);
await reset();
await db.exec(`
  UPDATE public.jobs SET helper_id = '${ANN}', status = 'accepted' WHERE id = '${J(2)}';
  UPDATE public.applications SET status = 'rejected' WHERE job_id = '${J(2)}' AND helper_id = '${BOB}';
`);
check("filled: no category -> plain Browse", (await notes(BOB))[0]?.link === "/jobs?tab=browse", await notes(BOB));

// 2. Unchanged branches.
await db.exec(`
  INSERT INTO public.jobs (id, title, customer_id, category) VALUES ('${J(3)}', 'Mow a lawn', '${POSTER}', 'yard_work');
  INSERT INTO public.applications (job_id, helper_id, status) VALUES ('${J(3)}', '${CY}', 'pending'), ('${J(3)}', '${DEE}', 'pending');
`);
await reset();
await db.exec(`UPDATE public.applications SET status = 'rejected' WHERE job_id = '${J(3)}' AND helper_id = '${CY}';`);
const cy = await notes(CY);
check("unfilled job, poster declines: still 'was not selected'", cy.length === 1 && cy[0].title === "Application update" && cy[0].message === 'Your application for "Mow a lawn" was not selected' && cy[0].link === `/jobs?job=${J(3)}`, cy);
await reset();
await db.exec(`
  UPDATE public.jobs SET helper_id = '${ANN}', status = 'accepted' WHERE id = '${J(3)}';
  UPDATE public.applications SET status = 'rejected', decline_reason = 'Went with a neighbor' WHERE job_id = '${J(3)}' AND helper_id = '${DEE}';
`);
const dee = await notes(DEE);
check("a decline note after the job filled keeps the poster's words", dee.length === 1 && dee[0].message === 'Your application for "Mow a lawn" was not selected: Went with a neighbor', dee);

await db.exec(`
  INSERT INTO public.jobs (id, title, customer_id, helper_id, status, category) VALUES ('${J(4)}', 'Haul boxes', '${POSTER}', '${CY}', 'accepted', 'moving');
  INSERT INTO public.applications (job_id, helper_id, status) VALUES ('${J(4)}', '${CY}', 'pending'), ('${J(4)}', '${DEE}', 'pending');
`);
await reset();
await db.exec(`UPDATE public.applications SET status = 'rejected', closed_reason = 'job_cancelled' WHERE job_id = '${J(4)}';`);
check("cancel: the offered Helpr is told it was cancelled", (await notes(CY))[0]?.message === '"Haul boxes" was cancelled, so your application is closed', await notes(CY));
check("cancel: an unhired applicant is not told", (await notes(DEE)).length === 0, await notes(DEE));

await db.exec(`
  INSERT INTO public.jobs (id, title, customer_id, helper_id, status, category) VALUES ('${J(5)}', 'Blocked', '${POSTER}', '${ANN}', 'accepted', 'cleaning');
  INSERT INTO public.applications (job_id, helper_id, status) VALUES ('${J(5)}', '${BOB}', 'pending');
`);
await reset();
await db.exec(`UPDATE public.applications SET status = 'rejected', closed_reason = 'party_blocked' WHERE job_id = '${J(5)}';`);
check("block: no notice", (await notes(BOB)).length === 0, await notes(BOB));

// 3. The 24-hour nudge, on the fixed clock. 2026-11-05 16:00Z = 10:00 AM Louisiana time (CST).
await installClock(db);
const sweep = newestFunction("sweep_unanswered_applications");
if (sweep.file !== FILE) throw new Error(`newest sweep_unanswered_applications is in ${sweep.file}, not ${FILE}`);
// The red check breaks the reloaded body the same way as the applied file.
const sweepStmt = process.env.LH_PROOF_REVERT
  ? sweep.stmt.replace("      HAVING min(a.created_at) <= v_now - interval '24 hours'\n         AND ", "      HAVING ").replace(SKIP, "")
  : sweep.stmt;
if (process.env.LH_PROOF_REVERT && sweepStmt === sweep.stmt) throw new Error("revert target (24-hour floor) not found in the reloaded sweep");
await db.exec(onFixedClock(sweepStmt));
const NOW = Date.parse("2026-11-05T16:00:00.000Z");
const ago = (ms) => new Date(NOW - ms).toISOString();
const H = 3600e3;
await db.exec(`DELETE FROM public.applications; DELETE FROM public.jobs;`);
const job = (k, title, extra = "") => `INSERT INTO public.jobs (id, title, customer_id, category${extra ? ", " + extra.split("=")[0] : ""}) VALUES ('${J(k)}', '${title}', '${POSTER}', 'cleaning'${extra ? ", " + extra.split("=").slice(1).join("=") : ""});`;
const app = (k, helper, when, status = "pending") => `INSERT INTO public.applications (job_id, helper_id, status, created_at) VALUES ('${J(k)}', '${helper}', '${status}', '${when}');`;
await db.exec(`
  ${job(10, "Exactly a day")} ${app(10, ANN, ago(24 * H))} ${app(10, BOB, ago(2 * H))}
  ${job(11, "Not a day yet")} ${app(11, ANN, ago(24 * H - 1))}
  ${job(12, "Too old")} ${app(12, ANN, ago(72 * H))}
  ${job(13, "Just under three days")} ${app(13, ANN, ago(72 * H - 1))}
  ${job(14, "Has a Helpr", `helper_id='${CY}'`)} ${app(14, ANN, ago(30 * H))}
  ${job(15, "Offer pending", `offered_to_helper_id='${CY}'`)} ${app(15, ANN, ago(30 * H))}
  ${job(16, "Expired", `expires_at='${ago(1)}'`)} ${app(16, ANN, ago(30 * H))}
  ${job(17, "Not open", `status='accepted'`)} ${app(17, ANN, ago(30 * H))}
  ${job(18, "Only declined", "")} ${app(18, ANN, ago(30 * H), "rejected")}
  ${job(20, "Seed job", "is_seed=true")} ${app(20, ANN, ago(30 * H))}
`);
await db.exec(`UPDATE public.jobs SET direct_offer_status = 'pending' WHERE id = '${J(15)}';
  INSERT INTO public.jobs (id, title, customer_id, category) VALUES ('${J(21)}', 'Test poster', '${TESTER}', 'cleaning'), ('${J(22)}', 'Seed poster', '${SEEDER}', 'cleaning');
  INSERT INTO public.applications (job_id, helper_id, status, created_at) VALUES ('${J(21)}', '${ANN}', 'pending', '${ago(30 * H)}'), ('${J(22)}', '${ANN}', 'pending', '${ago(30 * H)}');`);
await reset();

await setClock(db, "2026-11-05T13:59:59.999Z"); // 7:59:59 AM Louisiana time
const night = (await db.query(`SELECT public.sweep_unanswered_applications() AS n`)).rows[0].n;
const claimedAtNight = (await db.query(`SELECT count(*)::int AS c FROM public.application_nudge_sends`)).rows[0].c;
check("before 8 AM: nothing is sent and nothing is claimed", night === 0 && claimedAtNight === 0 && (await notes(POSTER)).length === 0, { night, claimedAtNight });

await setClock(db, new Date(NOW).toISOString());
const sent = (await db.query(`SELECT public.sweep_unanswered_applications() AS n`)).rows[0].n;
const p = await notes(POSTER);
const by = (k) => p.filter((r) => r.job_id === J(k));
check("10 AM: exactly two jobs are nudged (24 h edge and just under 72 h)", sent === 2 && p.length === 2, { sent, p });
check("24 h exactly: nudged, counting every pending applicant",
  by(10).length === 1 && by(10)[0].title === "Your applicants are waiting"
  && by(10)[0].message === '2 people applied to "Exactly a day" and are waiting to hear back. Hire someone, or decline the rest so they can move on.'
  && by(10)[0].type === "application" && by(10)[0].link === `/posts?job=${J(10)}`, by(10));
check("one applicant reads '1 person ... is waiting'", by(13)[0]?.message === '1 person applied to "Just under three days" and is waiting to hear back. Hire someone, or decline the rest so they can move on.', by(13));
for (const [k, why] of [[20, "a seed job (test stuff never sends notices)"], [11, "1 ms short of 24 h"], [12, "72 h old (the backlog edge)"], [14, "has a Helpr"], [15, "a direct offer is pending"], [16, "expired"], [17, "not open"], [18, "no pending application"]]) {
  check(`not nudged: ${why}`, by(k).length === 0, by(k));
}
const pm = await mails(POSTER);
const testNotes = (await db.query(`SELECT count(*)::int AS c FROM public.notifications WHERE user_id IN ('${TESTER}', '${SEEDER}') AND title = 'Your applicants are waiting'`)).rows[0].c;
const testClaims = (await db.query(`SELECT count(*)::int AS c FROM public.application_nudge_sends WHERE job_id IN ('${J(21)}', '${J(22)}')`)).rows[0].c;
check("not nudged: a poster in test_accounts, or a seed profile (no notice, no claim)", testNotes === 0 && testClaims === 0, { testNotes, testClaims });
check("the email goes as type application, to the applicant list", pm.length === 2 && pm.every((b) => b.type === "application" && b.title === "Your applicants are waiting") && pm.some((b) => b.link === `/posts?job=${J(10)}`), pm);

const again = (await db.query(`SELECT public.sweep_unanswered_applications() AS n`)).rows[0].n;
check("a second run sends nothing (once per job)", again === 0 && (await notes(POSTER)).length === 2, again);

await setClock(db, "2026-11-06T02:00:00.000Z"); // 8 PM Louisiana time
await db.exec(`${job(19, "Evening")} ${app(19, ANN, "2026-11-05T01:00:00.000Z")}`);
const eve = (await db.query(`SELECT public.sweep_unanswered_applications() AS n`)).rows[0].n;
check("8 PM: nothing is sent", eve === 0, eve);
await setClock(db, "2026-11-06T01:59:59.999Z"); // 7:59:59 PM
const late = (await db.query(`SELECT public.sweep_unanswered_applications() AS n`)).rows[0].n;
// Due by then: "Evening", and "Not a day yet" (now 34 h old).
const lateJobs = (await notes(POSTER)).filter((r) => r.title === "Your applicants are waiting").slice(2).map((r) => r.job_id).sort();
check("7:59:59 PM: still sends (the job that came due, and the one 1 ms short at 10 AM)", late === 2 && JSON.stringify(lateJobs) === JSON.stringify([J(11), J(19)].sort()), { late, lateJobs });

// 4. Grants.
const priv = (await db.query(`SELECT has_function_privilege('anon', 'public.sweep_unanswered_applications(timestamptz)', 'EXECUTE') AS a,
  has_function_privilege('authenticated', 'public.sweep_unanswered_applications(timestamptz)', 'EXECUTE') AS b,
  has_function_privilege('service_role', 'public.sweep_unanswered_applications(timestamptz)', 'EXECUTE') AS c`)).rows[0];
check("the sweep: service_role only", priv.a === false && priv.b === false && priv.c === true, priv);

console.log(`\n${n - fails}/${n} PASS${fails ? `, ${fails} FAILED` : ""}`);
process.exit(fails ? 1 : 0);
