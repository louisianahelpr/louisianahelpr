#!/usr/bin/env node
/**
 * PGlite proof for 20261012184444_offer_free_to_refuse (Q1281, owner
 * 2026-10-05): declining an offer, or letting it run out, files NO strike.
 *
 *   node src/test/pglite/offerFreeToRefuse.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/offerFreeToRefuse.pglite.mjs # RED: the state on main
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR). The "before" bodies are cut from the newest
 * migrations that defined them on main, which is what prod runs (prosrc md5
 * equal, measured 2026-10-12): decline_job_offer from 20261003193541,
 * expire_unanswered_offers from 20261006022526. A strike is a row in
 * public.strikes (apply_job_denial_consequence is stubbed to write one), so
 * "was the Helpr struck" is a count.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (rel) => readFileSync(new URL(rel, import.meta.url).pathname, "utf8");
const MIGDIR = "../../../supabase/migrations/";
const NEW = read(`${MIGDIR}20261012184444_offer_free_to_refuse.sql`);
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
const OTHER = "5af6ce6d-0000-4000-8000-000000000001";
const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE TABLE public.jobs (
  id uuid PRIMARY KEY, customer_id uuid, helper_id uuid, status text, title text,
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
-- Same parameter names as prod, so the migration's word-only restatement of
-- the ladder replaces this stub in place (it is never called after the fix).
CREATE FUNCTION public.apply_job_denial_consequence(p_helper uuid, p_job uuid, p_description text) RETURNS jsonb LANGUAGE sql AS $$ INSERT INTO public.strikes VALUES (p_helper, p_job, p_description) RETURNING jsonb_build_object('action', 'warning') $$;
`);
await db.exec(cut("20261005184940_offer_deadline_before_start.sql", "job_offer_cutoff"));
await db.exec(cut("20261003193541_accept_completes_after_stripe_setup.sql", "decline_job_offer"));
await db.exec(cut("20261006022526_crew_unconfirmed_spot_never_blocks_completion.sql", "expire_unanswered_offers"));
if (!MODE) for (let i = 0; i < 3; i++) await db.exec(NEW);

const strikes = async (job) => Number((await db.query(`SELECT count(*)::int AS n FROM public.strikes WHERE job_id = '${job}'`)).rows[0].n);
const one = async (sql) => (await db.query(sql)).rows[0];

// A single offer three days out, answer-by already passed (or not).
async function offer(n, deadlineSql) {
  await db.exec(`
    INSERT INTO public.jobs (id, customer_id, helper_id, status, title, date_needed, start_time, response_deadline)
    VALUES ('${id(n)}', '${POSTER}', '${HELPER}', 'accepted', 'Job ${n}', (now() AT TIME ZONE 'America/Chicago')::date + 3, '09:00', ${deadlineSql});
    INSERT INTO public.applications (id, job_id, helper_id, status) VALUES ('${id(100 + n)}', '${id(n)}', '${HELPER}', 'accepted');`);
}

// 1. DECLINE: the Helpr's Stripe setup is done and nothing is pending, which
//    is exactly the case main still struck.
await offer(1, `now() + interval '20 hours'`);
let res;
try {
  await db.exec(`SET request.jwt.claim.sub = '${HELPER}';`);
  res = (await one(`SELECT public.decline_job_offer('${id(101)}') AS r`)).r;
} catch (e) {
  res = { error: e.message };
}
check("decline: no strike", (await strikes(id(1))) === 0, `${await strikes(id(1))} strike row(s)`);
check("decline: the RPC answers action none", res?.action === "none", JSON.stringify(res));
const j1 = await one(`SELECT status, helper_id, response_deadline FROM public.jobs WHERE id = '${id(1)}'`);
check("decline: the job reopens with nobody on it", j1.status === "open" && j1.helper_id === null && j1.response_deadline === null, JSON.stringify(j1));
check("decline: the application closes", (await one(`SELECT status FROM public.applications WHERE id = '${id(101)}'`)).status === "rejected");
check("decline: the poster is told", Number((await one(`SELECT count(*)::int n FROM public.notifications WHERE user_id = '${POSTER}' AND job_id IS NULL AND link = '/posts?job=${id(1)}'`)).n) === 1);

// 1b. The guards still hold: someone else cannot decline it, and a second
//     decline (offer already gone) is refused.
await offer(2, `now() + interval '20 hours'`);
let refused = "";
try {
  await db.exec(`SET request.jwt.claim.sub = '${OTHER}'; SELECT public.decline_job_offer('${id(102)}');`);
} catch (e) {
  refused = e.message;
}
check("decline: another user is refused not_authorized", /not_authorized/.test(refused), refused || "allowed");
refused = "";
try {
  await db.exec(`SET request.jwt.claim.sub = '${HELPER}'; SELECT public.decline_job_offer('${id(101)}');`);
} catch (e) {
  refused = e.message;
}
check("decline: a second decline is refused offer_not_active", /offer_not_active/.test(refused), refused || "allowed");

// 2. EXPIRY, single offer: answer-by passed a minute ago, well before start.
await offer(3, `now() - interval '1 minute'`);
await db.exec(`RESET request.jwt.claim.sub;`);
await db.exec(`SELECT public.expire_unanswered_offers();`);
check("expiry: no strike", (await strikes(id(3))) === 0, `${await strikes(id(3))} strike row(s)`);
const j3 = await one(`SELECT status, helper_id FROM public.jobs WHERE id = '${id(3)}'`);
check("expiry: the job reopens", j3.status === "open" && j3.helper_id === null, JSON.stringify(j3));
const a3 = await one(`SELECT status, closed_reason FROM public.applications WHERE id = '${id(103)}'`);
check("expiry: the application closes as offer_expired", a3.status === "rejected" && a3.closed_reason === "offer_expired", JSON.stringify(a3));
const n3 = await one(`SELECT message FROM public.notifications WHERE user_id = '${HELPER}' AND job_id = '${id(3)}'`);
check("expiry: the Helpr's notice says No strike", /No strike\.$/.test(n3?.message ?? ""), n3?.message);
check("expiry: the notice never says it counts as declining", !/counts the same as declining/.test(n3?.message ?? ""), n3?.message);
check("expiry: the error log is empty", Number((await one(`SELECT count(*)::int n FROM public.error_logs`)).n) === 0);

// 3. EXPIRY, crew spot: a member's own answer-by passed unconfirmed.
await db.exec(`
  INSERT INTO public.jobs (id, customer_id, status, title, date_needed, start_time, is_group_job, helpers_needed)
  VALUES ('${id(4)}', '${POSTER}', 'accepted', 'Crew 4', (now() AT TIME ZONE 'America/Chicago')::date + 3, '09:00', true, 2);
  INSERT INTO public.group_job_helpers (job_id, helper_id, response_deadline) VALUES ('${id(4)}', '${HELPER}', now() - interval '1 minute');
  INSERT INTO public.applications (id, job_id, helper_id, status) VALUES ('${id(104)}', '${id(4)}', '${HELPER}', 'accepted');`);
await db.exec(`SELECT public.expire_unanswered_offers();`);
check("crew expiry: no strike", (await strikes(id(4))) === 0, `${await strikes(id(4))} strike row(s)`);
check("crew expiry: the spot comes off the roster", Number((await one(`SELECT count(*)::int n FROM public.group_job_helpers WHERE job_id = '${id(4)}'`)).n) === 0);
const n4 = await one(`SELECT message FROM public.notifications WHERE user_id = '${HELPER}' AND job_id = '${id(4)}'`);
check("crew expiry: the member's notice says No strike", /No strike\.$/.test(n4?.message ?? ""), n4?.message);

// 4. A future answer-by is left alone.
await offer(5, `now() + interval '2 hours'`);
await db.exec(`SELECT public.expire_unanswered_offers();`);
check("an offer still inside its answer-by is untouched", (await one(`SELECT status FROM public.jobs WHERE id = '${id(5)}'`)).status === "accepted");

console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
