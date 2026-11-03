#!/usr/bin/env node
/**
 * PGlite proof for 20261103023713_expired_offer_says_too_late_to_rehire (Q1889): an offer that runs out
 * once accept_application's cutoff has gone (job_offer_cutoff <= now() + 15 minutes) no longer tells the
 * poster "It's open to everyone again, so you can pick somebody else".
 *
 *   node src/test/pglite/expiredOfferTooLateToRehire.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/expiredOfferTooLateToRehire.pglite.mjs # RED: the state on main
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR). The "before" body is cut
 * from 20261030232108, whose md5(prosrc) 4060f00f6035bd97e7d199bc9fe487a3 equals prod (read 2026-11-02).
 * Checks: a past-dated job and a job starting in 10 minutes get the too-late words, and so do a past-dated
 * crew spot (with and without members left); a job three days out, a crew spot three days out and a failed
 * payment read exactly as before; the job still reopens; the Helpr's notice and
 * the offer_expired close are unchanged; no strike.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (rel) => readFileSync(new URL(rel, import.meta.url).pathname, "utf8");
const MIGDIR = "../../../supabase/migrations/";
const NEW = read(`${MIGDIR}20261103023713_expired_offer_says_too_late_to_rehire.sql`);
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the state on main (expect FAILs)`);

function cut(file, name) {
  const sql = read(MIGDIR + file);
  const m = [...sql.matchAll(new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi"))].at(-1);
  const open = /\bAS\s+(\$\w*\$)/i.exec(sql.slice(m.index));
  const bodyStart = m.index + open.index + open[0].length;
  const close = sql.indexOf(open[1], bodyStart);
  return sql.slice(m.index, sql.indexOf(";", close) + 1);
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const POSTER = "71c56dfb-b326-4010-b960-b18dd3966e7f";
const HELPER = "437de07d-1bd7-46c8-a451-6b46aa3bcad5";
const POSTER2 = "5a5a5a5a-0000-4000-8000-000000000002"; // a crew member who confirmed and stays
const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.jobs (
  id uuid PRIMARY KEY, customer_id uuid, helper_id uuid, status text, title text, payment_status text,
  date_needed date, start_time time, response_deadline timestamptz,
  helper_confirmed_at timestamptz, is_seed boolean DEFAULT true,
  is_group_job boolean DEFAULT false, helpers_needed int DEFAULT 1
);
CREATE TABLE public.applications (id uuid PRIMARY KEY, job_id uuid, helper_id uuid, status text, closed_reason text);
CREATE TABLE public.profiles (user_id uuid, is_seed boolean DEFAULT true);
CREATE TABLE public.job_accept_pending (job_id uuid, helper_id uuid);
CREATE TABLE public.group_job_helpers (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, job_id uuid, helper_id uuid, helper_confirmed_at timestamptz, response_deadline timestamptz);
CREATE TABLE public.notifications (user_id uuid, title text, message text, type text, link text, job_id uuid);
CREATE TABLE public.error_logs (severity text, message text, tags jsonb, context jsonb);
CREATE TABLE public.strikes (helper_id uuid, job_id uuid, why text);
CREATE FUNCTION public.helper_accept_block_reason(u uuid) RETURNS text LANGUAGE sql AS $$ SELECT NULL::text $$;
CREATE FUNCTION public.apply_job_denial_consequence(p_helper uuid, p_job uuid, p_description text) RETURNS jsonb LANGUAGE sql AS $$ INSERT INTO public.strikes VALUES (p_helper, p_job, p_description) RETURNING jsonb_build_object('action', 'warning') $$;
`);
await db.exec(cut("20261005184940_offer_deadline_before_start.sql", "job_offer_cutoff"));
await db.exec(cut("20261030232108_card_hold_capture_refused_offer_words.sql", "expire_unanswered_offers"));
if (!MODE) for (let i = 0; i < 3; i++) await db.exec(NEW);

const rows = async (sql) => (await db.query(sql)).rows;
const notice = async (job, user) => (await rows(`SELECT title, message FROM public.notifications WHERE job_id = '${job}' AND user_id = '${user}'`))[0] ?? {};
const CT = "(now() AT TIME ZONE 'America/Chicago')";

// date/start as SQL expressions, local (Chicago) time.
async function offer(n, payment, dateSql, startSql) {
  await db.exec(`
    INSERT INTO public.jobs (id, customer_id, helper_id, status, title, payment_status, date_needed, start_time, response_deadline)
    VALUES ('${id(n)}', '${POSTER}', '${HELPER}', 'accepted', 'Job ${n}', '${payment}', ${dateSql}, ${startSql}, now() - interval '1 minute');
    INSERT INTO public.applications (id, job_id, helper_id, status) VALUES ('${id(100 + n)}', '${id(n)}', '${HELPER}', 'accepted');`);
}
await offer(1, "escrow", `${CT}::date - 1`, `'09:00'`);                                   // past-dated
await offer(2, "escrow", `(${CT} + interval '10 minutes')::date`, `(${CT} + interval '10 minutes')::time`); // starts in 10 min
await offer(3, "escrow", `${CT}::date + 3`, `'09:00'`);                                   // three days out
await offer(4, "failed", `${CT}::date - 1`, `'09:00'`);                                   // past-dated, failed payment
await db.exec(`
  INSERT INTO public.jobs (id, customer_id, status, title, payment_status, date_needed, start_time, is_group_job, helpers_needed)
  VALUES ('${id(5)}', '${POSTER}', 'open', 'Crew 5', 'escrow', ${CT}::date - 1, '09:00', true, 2);
  INSERT INTO public.group_job_helpers (job_id, helper_id, response_deadline) VALUES ('${id(5)}', '${HELPER}', now() - interval '1 minute');
  INSERT INTO public.applications (id, job_id, helper_id, status) VALUES ('${id(105)}', '${id(5)}', '${HELPER}', 'accepted');
  -- Crew 6: three days out. Crew 7: past-dated, accepted, another member confirmed and staying.
  INSERT INTO public.jobs (id, customer_id, status, title, payment_status, date_needed, start_time, is_group_job, helpers_needed)
  VALUES ('${id(6)}', '${POSTER}', 'open', 'Crew 6', 'escrow', ${CT}::date + 3, '09:00', true, 2),
         ('${id(7)}', '${POSTER}', 'accepted', 'Crew 7', 'escrow', ${CT}::date - 1, '09:00', true, 2);
  INSERT INTO public.group_job_helpers (job_id, helper_id, response_deadline) VALUES ('${id(6)}', '${HELPER}', now() - interval '1 minute'),
         ('${id(7)}', '${HELPER}', now() - interval '1 minute');
  INSERT INTO public.group_job_helpers (job_id, helper_id, helper_confirmed_at) VALUES ('${id(7)}', '${POSTER2}', now() - interval '1 day');
  INSERT INTO public.applications (id, job_id, helper_id, status) VALUES ('${id(106)}', '${id(6)}', '${HELPER}', 'accepted'),
         ('${id(107)}', '${id(7)}', '${HELPER}', 'accepted');`);
await db.exec(`SELECT public.expire_unanswered_offers();`);

for (const [n, label] of [[1, "a past-dated job"], [2, "a job starting in 10 minutes"]]) {
  const p = await notice(id(n), POSTER);
  check(`${label}: the poster is not told they can pick somebody else`,
    !/pick somebody else/.test(p.message ?? "") && !/open to everyone/.test(p.message ?? "") && !/reopened/.test(p.title ?? ""), JSON.stringify(p));
  check(`${label}: the poster hears it is too late to hire someone else`,
    p.title === "Offer expired" && /didn't answer in time for "Job \d"/.test(p.message ?? "") && /too late to hire someone else/.test(p.message ?? ""), JSON.stringify(p));
}
const p3 = await notice(id(3), POSTER);
check("a job three days out reads exactly as before", p3.title === "Offer expired — job reopened"
  && p3.message === `Your Helpr didn't answer in time for "Job 3". It's open to everyone again, so you can pick somebody else.`, JSON.stringify(p3));
const p4 = await notice(id(4), POSTER);
check("a failed payment keeps its own words", p4.title === "Offer expired — payment needed" && /didn't go through/.test(p4.message ?? ""), JSON.stringify(p4));
const p5 = await notice(id(5), POSTER);
check("a past-dated crew spot: no re-pick promise, too late to fill it",
  p5.title === "Offer expired" && !/pick somebody else|open to everyone/.test(p5.message ?? "")
  && p5.message === `A Helpr you picked didn't answer in time for "Crew 5". It's now too late to fill that spot for that time.`, JSON.stringify(p5));
const p7 = await notice(id(7), POSTER);
check("a past-dated crew with members left: not told to hire from applicants, told the share is refunded",
  p7.title === "Offer expired" && !/hire someone from your applicants|pick somebody else/.test(p7.message ?? "")
  && /rest of your crew is still on/.test(p7.message ?? "") && /too late to fill that spot/.test(p7.message ?? "") && /refunded to you once the job is done/.test(p7.message ?? ""), JSON.stringify(p7));
const p6 = await notice(id(6), POSTER);
check("a crew spot three days out reads exactly as before", p6.title === "Offer expired — spot reopened"
  && p6.message === `A Helpr you picked didn't answer in time for "Crew 6". Their spot is open to everyone again, so you can pick somebody else.`, JSON.stringify(p6));
const h5 = await notice(id(5), HELPER);
check("the crew Helpr's notice is unchanged (no strike)", /you lost your spot/.test(h5.message ?? "") && /No strike/.test(h5.message ?? ""), JSON.stringify(h5));
const h1 = await notice(id(1), HELPER);
check("the Helpr's notice is unchanged (cap ended, no strike)", /when the job started/.test(h1.message ?? "") && /No strike/.test(h1.message ?? ""), JSON.stringify(h1));
const j = await rows(`SELECT id, status, helper_id FROM public.jobs WHERE id IN ('${id(1)}','${id(2)}','${id(3)}') ORDER BY id`);
check("the jobs still reopen with nobody on them (auto-expire-jobs decides any cancel)", j.length === 3 && j.every((r) => r.status === "open" && r.helper_id === null), JSON.stringify(j));
const closed = await rows(`SELECT closed_reason FROM public.applications WHERE job_id IN ('${id(1)}','${id(2)}','${id(3)}')`);
check("the applications close as offer_expired", closed.length === 3 && closed.every((r) => r.closed_reason === "offer_expired"), JSON.stringify(closed));
check("no strike", (await rows(`SELECT count(*)::int n FROM public.strikes`))[0].n === 0);
if (!MODE) {
  const acl = (await rows(`SELECT proacl::text a FROM pg_proc WHERE proname = 'expire_unanswered_offers'`))[0].a ?? "";
  check("grants: service_role only", /service_role=X/.test(acl) && !/(^|[{,])(=|anon=|authenticated=)/.test(acl), acl);
}
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
