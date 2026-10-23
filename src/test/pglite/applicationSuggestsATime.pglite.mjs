#!/usr/bin/env node
/**
 * PGlite proof for 20261023134752_application_suggests_a_time.sql (owner, 2026-10-23: applying asks "does
 * this day/time work?", a Helpr may suggest another, hiring them agrees to it).
 *
 *   node src/test/pglite/applicationSuggestsATime.pglite.mjs
 *
 * The 2-argument apply_to_job and accept_application are stand-ins with prod's effect on the rows (insert a
 * pending application; mark it accepted and the job accepted): the new overload and hire RPC only call them.
 * Checks, migration applied 3x:
 *  - an apply with a suggestion stores it on the new row; an apply without one stores nothing;
 *  - refused: a crew job, a series visit, a quote job (suggestion_not_allowed); a past day or >90 days out
 *    (suggestion_date_invalid); a time with no day; the job's own day and time (suggestion_same_as_job);
 *  - a refused suggestion writes no application (same transaction);
 *  - accept_application_at_suggested_time moves the job to the suggested day (and time; a day-only
 *    suggestion keeps the job's time) and hires; only the job's poster may call it;
 *  - the plain accept_application on a suggester is refused (suggested_time_not_agreed) and the job's date
 *    is unchanged; a non-suggester hires as before;
 *  - no EXECUTE for anon on the new functions.
 * Red check: LH_PROOF_REVERT=1 drops the hire trigger and the proof fails.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
let SQL = readFileSync(new URL("../../../supabase/migrations/20261023134752_application_suggests_a_time.sql", import.meta.url).pathname, "utf8");
if (process.env.LH_PROOF_REVERT) {
  const t = /CREATE TRIGGER trg_applications_hire_agrees_to_suggestion[\s\S]*?;\n/;
  if (!t.test(SQL)) throw new Error("revert target not found");
  SQL = SQL.replace(t, "");
}

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const POSTER = U(1), HELPR = U(2), OTHER = U(3), H2 = U(4);
const J = (n) => U(100 + n);
const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE TABLE auth.who (uid uuid);
  INSERT INTO auth.who VALUES (NULL);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT uid FROM auth.who $$;
  CREATE TABLE public.jobs (id uuid PRIMARY KEY, customer_id uuid, status text, date_needed date, start_time time,
    is_group_job boolean DEFAULT false, parent_job_id uuid, is_recurring boolean DEFAULT false, recurrence_days int[], pricing_mode text DEFAULT 'set_price', helper_id uuid);
  CREATE TABLE public.applications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid, message text, status text);
  -- Stand-ins with prod's effect on the rows.
  CREATE FUNCTION public.apply_to_job(p_job_id uuid, p_message text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
  DECLARE v uuid; BEGIN
    INSERT INTO public.applications (job_id, helper_id, message, status) VALUES (p_job_id, auth.uid(), p_message, 'pending') RETURNING id INTO v;
    RETURN v; END $$;
  CREATE FUNCTION public.accept_application(p_application_id uuid, p_deadline timestamptz, p_offer_message text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
  DECLARE v_job uuid; v_helper uuid; BEGIN
    SELECT job_id, helper_id INTO v_job, v_helper FROM public.applications WHERE id = p_application_id;
    IF (SELECT customer_id FROM public.jobs WHERE id = v_job) IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'not_authorized'; END IF;
    UPDATE public.applications SET status = 'accepted' WHERE id = p_application_id;
    UPDATE public.jobs SET status = 'accepted', helper_id = v_helper WHERE id = v_job; END $$;
`);
const today = (await db.query(`SELECT (now() AT TIME ZONE 'America/Chicago')::date AS d`)).rows[0].d;
const day = (n) => { const d = new Date(today); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
await db.exec(`
  INSERT INTO public.jobs (id, customer_id, status, date_needed, start_time, is_group_job, parent_job_id, is_recurring, pricing_mode) VALUES
    ('${J(1)}', '${POSTER}', 'open', '${day(5)}', '12:00', false, NULL, false, 'set_price'),
    ('${J(2)}', '${POSTER}', 'open', '${day(5)}', '12:00', true,  NULL, false, 'set_price'),
    ('${J(3)}', '${POSTER}', 'open', '${day(5)}', '12:00', false, '${J(1)}', false, 'set_price'),
    ('${J(4)}', '${POSTER}', 'open', '${day(5)}', '12:00', false, NULL, false, 'quotes'),
    ('${J(5)}', '${POSTER}', 'open', '${day(5)}', '12:00', false, NULL, false, 'set_price'),
    ('${J(6)}', '${POSTER}', 'open', '${day(5)}', '09:00', false, NULL, false, 'set_price');
`);
for (let i = 0; i < 3; i++) await db.exec(SQL);

let fails = 0, n = 0;
const check = (name, ok, got) => { n++; if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  got ${JSON.stringify(got)}`}`); };
const as = (uid) => db.exec(`UPDATE auth.who SET uid = ${uid ? `'${uid}'` : "NULL"};`);
const err = async (sql) => { try { await db.exec(sql); return null; } catch (e) { return e.message; } };
const apps = async (job) => (await db.query(`SELECT helper_id, status, suggested_date::text AS d, suggested_start_time::text AS t FROM public.applications WHERE job_id = '${job}' ORDER BY helper_id`)).rows;
const jobOf = async (job) => (await db.query(`SELECT status, date_needed::text AS d, start_time::text AS t, helper_id FROM public.jobs WHERE id = '${job}'`)).rows[0];

// 1. Apply.
await as(HELPR);
await db.exec(`SELECT public.apply_to_job_with_time('${J(1)}', 'hi', '${day(6)}', '14:00');`);
let a = (await apps(J(1)))[0];
check("a suggestion is stored on the new row", a.d === day(6) && a.t === "14:00:00" && a.status === "pending", a);
await as(OTHER);
await db.exec(`SELECT public.apply_to_job_with_time('${J(1)}', 'ok', NULL, NULL);`);
a = (await apps(J(1))).find((r) => r.helper_id === OTHER);
check("an apply without one stores nothing", a.d === null && a.t === null, a);

check("crew job: suggestion_not_allowed", /suggestion_not_allowed/.test(await err(`SELECT public.apply_to_job_with_time('${J(2)}', NULL, '${day(6)}', NULL);`) ?? ""));
check("series visit: suggestion_not_allowed", /suggestion_not_allowed/.test(await err(`SELECT public.apply_to_job_with_time('${J(3)}', NULL, '${day(6)}', NULL);`) ?? ""));
check("quote job: suggestion_not_allowed", /suggestion_not_allowed/.test(await err(`SELECT public.apply_to_job_with_time('${J(4)}', NULL, '${day(6)}', NULL);`) ?? ""));
check("a past day: suggestion_date_invalid", /suggestion_date_invalid/.test(await err(`SELECT public.apply_to_job_with_time('${J(5)}', NULL, '${day(-1)}', NULL);`) ?? ""));
check("91 days out: suggestion_date_invalid", /suggestion_date_invalid/.test(await err(`SELECT public.apply_to_job_with_time('${J(5)}', NULL, '${day(91)}', NULL);`) ?? ""));
check("a time with no day: suggestion_date_invalid", /suggestion_date_invalid/.test(await err(`SELECT public.apply_to_job_with_time('${J(5)}', NULL, NULL, '10:00');`) ?? ""));
check("the job's own day and time: suggestion_same_as_job", /suggestion_same_as_job/.test(await err(`SELECT public.apply_to_job_with_time('${J(5)}', NULL, '${day(5)}', '12:00');`) ?? ""));
check("the job's own day, no time: suggestion_same_as_job", /suggestion_same_as_job/.test(await err(`SELECT public.apply_to_job_with_time('${J(5)}', NULL, '${day(5)}', NULL);`) ?? ""));
check("a refused suggestion writes no application", (await apps(J(5))).length === 0, await apps(J(5)));

// 2. Hire.
await as(POSTER);
const sugg = (await db.query(`SELECT id FROM public.applications WHERE job_id = '${J(1)}' AND helper_id = '${HELPR}'`)).rows[0].id;
const plain = (await db.query(`SELECT id FROM public.applications WHERE job_id = '${J(1)}' AND helper_id = '${OTHER}'`)).rows[0].id;
const e1 = await err(`SELECT public.accept_application('${sugg}', now() + interval '1 day');`);
check("plain hire of a suggester is refused: suggested_time_not_agreed", /suggested_time_not_agreed/.test(e1 ?? ""), e1);
check("...and the job's date is unchanged", (await jobOf(J(1))).d === day(5), await jobOf(J(1)));

await as(OTHER);
check("only the poster may hire at the suggested time", /not_authorized/.test(await err(`SELECT public.accept_application_at_suggested_time('${sugg}', now() + interval '1 day');`) ?? ""));
await as(POSTER);
await db.exec(`SELECT public.accept_application_at_suggested_time('${sugg}', now() + interval '1 day');`);
let j = await jobOf(J(1));
check("hiring agrees: the job moves to the suggested day and time and is hired", j.d === day(6) && j.t === "14:00:00" && j.status === "accepted" && j.helper_id === HELPR, j);

// A day-only suggestion keeps the job's time; a non-suggester hires as before.
await as(H2);
await db.exec(`SELECT public.apply_to_job_with_time('${J(6)}', NULL, '${day(7)}', NULL);`);
await as(HELPR);
await db.exec(`SELECT public.apply_to_job_with_time('${J(5)}', NULL, NULL, NULL);`);
await as(POSTER);
const dayOnly = (await db.query(`SELECT id FROM public.applications WHERE job_id = '${J(6)}'`)).rows[0].id;
await db.exec(`SELECT public.accept_application_at_suggested_time('${dayOnly}', now() + interval '1 day');`);
j = await jobOf(J(6));
check("a day-only suggestion keeps the job's start time", j.d === day(7) && j.t === "09:00:00", j);
const nonSugg = (await db.query(`SELECT id FROM public.applications WHERE job_id = '${J(5)}'`)).rows[0].id;
const e2 = await err(`SELECT public.accept_application('${nonSugg}', now() + interval '1 day');`);
check("a non-suggester hires with the plain accept as before", e2 === null && (await jobOf(J(5))).status === "accepted", e2);

// A job turned into a crew job after the suggestion is refused at hire; so is a suggestion now < 2 hours away.
await db.exec(`INSERT INTO public.jobs (id, customer_id, status, date_needed, start_time) VALUES ('${J(7)}', '${POSTER}', 'open', '${day(5)}', '12:00'), ('${J(8)}', '${POSTER}', 'open', '${day(5)}', '12:00');`);
await as(HELPR);
await db.exec(`SELECT public.apply_to_job_with_time('${J(7)}', NULL, '${day(6)}', '10:00');`);
await db.exec(`SELECT public.apply_to_job_with_time('${J(8)}', NULL, '${day(0)}', NULL);`);
await as(POSTER);
await db.exec(`UPDATE public.jobs SET is_group_job = true WHERE id = '${J(7)}';`);
const conv = (await db.query(`SELECT id FROM public.applications WHERE job_id = '${J(7)}'`)).rows[0].id;
const e3 = await err(`SELECT public.accept_application_at_suggested_time('${conv}', now() + interval '1 day');`);
check("a job turned into a crew job after the suggestion: suggestion_not_allowed at hire, date unchanged", /suggestion_not_allowed/.test(e3 ?? "") && (await jobOf(J(7))).d === day(5), e3);
// The day-0 suggestion keeps the job's 12:00 start; make it 1 hour from now in Chicago.
await db.exec(`UPDATE public.applications SET suggested_start_time = ((now() AT TIME ZONE 'America/Chicago') + interval '1 hour')::time, suggested_date = (now() AT TIME ZONE 'America/Chicago')::date WHERE job_id = '${J(8)}';`);
const soon = (await db.query(`SELECT id FROM public.applications WHERE job_id = '${J(8)}'`)).rows[0].id;
const e4 = await err(`SELECT public.accept_application_at_suggested_time('${soon}', now() + interval '1 day');`);
check("a suggested start under 2 hours away: suggestion_too_soon at hire", /suggestion_too_soon/.test(e4 ?? ""), e4);

const acl = (await db.query(`SELECT string_agg(proname || ':' || coalesce(proacl::text, 'NULL'), ' ') AS a FROM pg_proc WHERE proname IN ('accept_application_at_suggested_time', 'applications_hire_agrees_to_suggestion') OR proname = 'apply_to_job_with_time'`)).rows[0].a;
check("no EXECUTE for anon (and the trigger function for no member)", !/NULL/.test(acl) && !/anon=X/.test(acl) && !/applications_hire_agrees_to_suggestion:[^ ]*authenticated=X/.test(acl), acl);

console.log(`\n${n - fails}/${n} passed`);
process.exit(fails ? 1 : 0);
