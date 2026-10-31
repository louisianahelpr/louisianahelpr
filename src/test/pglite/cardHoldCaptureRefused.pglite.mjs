#!/usr/bin/env node
/**
 * PGlite proof for 20261030232108_card_hold_capture_refused_offer_words:
 * an offer that runs out while the job's money is 'failed' (Stripe refused the
 * card hold's capture) tells both sides the truth and files no strike, and
 * get_my_job_card_hold answers the setup fee inside the hold.
 *
 *   node src/test/pglite/cardHoldCaptureRefused.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/cardHoldCaptureRefused.pglite.mjs # RED: the state on main
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 * "Before" bodies are cut from the newest migrations defining them on main, which
 * is what prod runs (expire_unanswered_offers md5(prosrc) equal, measured
 * 2026-10-30). A strike would be a row in public.strikes: the ladder is stubbed to
 * write one.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (rel) => readFileSync(new URL(rel, import.meta.url).pathname, "utf8");
const MIGDIR = "../../../supabase/migrations/";
const NEW = read(`${MIGDIR}${process.env.MIGRATION_FILE ?? "20261030232108_card_hold_capture_refused_offer_words.sql"}`);
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
const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
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
CREATE TABLE public.job_card_holds (job_id uuid PRIMARY KEY, state text, amount_cents integer, onboarding_fee_cents integer NOT NULL DEFAULT 0, place_at timestamptz, capture_before timestamptz);
CREATE FUNCTION public.require_feature(k text) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.helper_accept_block_reason(u uuid) RETURNS text LANGUAGE sql AS $$ SELECT NULL::text $$;
CREATE FUNCTION public.apply_job_denial_consequence(p_helper uuid, p_job uuid, p_description text) RETURNS jsonb LANGUAGE sql AS $$ INSERT INTO public.strikes VALUES (p_helper, p_job, p_description) RETURNING jsonb_build_object('action', 'warning') $$;
`);
await db.exec(cut("20261005184940_offer_deadline_before_start.sql", "job_offer_cutoff"));
await db.exec(cut("20261012184444_offer_free_to_refuse.sql", "expire_unanswered_offers"));
await db.exec(cut("20261027185146_card_hold_at_post.sql", "get_my_job_card_hold"));
if (!MODE) for (let i = 0; i < 3; i++) await db.exec(NEW);

const rows = async (sql) => (await db.query(sql)).rows;
const notice = async (job, user) => (await rows(`SELECT title, message FROM public.notifications WHERE job_id = '${job}' AND user_id = '${user}'`))[0] ?? {};

async function offer(n, payment) {
  await db.exec(`
    INSERT INTO public.jobs (id, customer_id, helper_id, status, title, payment_status, date_needed, start_time, response_deadline)
    VALUES ('${id(n)}', '${POSTER}', '${HELPER}', 'accepted', 'Job ${n}', '${payment}', (now() AT TIME ZONE 'America/Chicago')::date + 3, '09:00', now() - interval '1 minute');
    INSERT INTO public.applications (id, job_id, helper_id, status) VALUES ('${id(100 + n)}', '${id(n)}', '${HELPER}', 'accepted');`);
}
async function crewSpot(n, payment) {
  await db.exec(`
    INSERT INTO public.jobs (id, customer_id, status, title, payment_status, date_needed, start_time, is_group_job, helpers_needed)
    VALUES ('${id(n)}', '${POSTER}', 'open', 'Crew ${n}', '${payment}', (now() AT TIME ZONE 'America/Chicago')::date + 3, '09:00', true, 2);
    INSERT INTO public.group_job_helpers (job_id, helper_id, response_deadline) VALUES ('${id(n)}', '${HELPER}', now() - interval '1 minute');
    INSERT INTO public.applications (id, job_id, helper_id, status) VALUES ('${id(100 + n)}', '${id(n)}', '${HELPER}', 'accepted');`);
}

await offer(1, "failed");
await offer(2, "escrow");
await offer(3, "held");
await crewSpot(4, "failed");
await crewSpot(5, "escrow");
await db.exec(`SELECT public.expire_unanswered_offers();`);

// 1. A failed payment: the words are true.
const p1 = await notice(id(1), POSTER);
const h1 = await notice(id(1), HELPER);
check("failed payment: the poster hears their payment did not go through, not that the Helpr ignored them",
  /didn't go through/.test(p1.message ?? "") && !/didn't answer/.test(p1.message ?? "") && !/open to everyone/.test(p1.message ?? "") && /payment needed/.test(p1.title ?? ""), JSON.stringify(p1));
check("failed payment: the Helpr hears it waited on payment, with no strike", /waiting on payment/.test(h1.message ?? "") && /No strike/.test(h1.message ?? ""), JSON.stringify(h1));
const p4 = await notice(id(4), POSTER);
const h4 = await notice(id(4), HELPER);
check("failed payment, crew spot: the poster hears the same", /didn't go through/.test(p4.message ?? "") && !/didn't answer/.test(p4.message ?? "") && /payment needed/.test(p4.title ?? ""), JSON.stringify(p4));
check("failed payment, crew spot: the Helpr hears the same, with no strike", /waiting on payment/.test(h4.message ?? "") && /No strike/.test(h4.message ?? ""), JSON.stringify(h4));

// 2. A Helpr's record: no strike on any branch, the application closes as before.
const strikes = (await rows(`SELECT count(*)::int AS n FROM public.strikes`))[0].n;
check("no strike on any of the five expiries", strikes === 0, `${strikes} strike row(s)`);
const closed = await rows(`SELECT closed_reason FROM public.applications WHERE job_id IN ('${id(1)}','${id(4)}')`);
check("the application closes as offer_expired (what the Helpr's card reads)", closed.length === 2 && closed.every((r) => r.closed_reason === "offer_expired"), JSON.stringify(closed));
const j1 = (await rows(`SELECT status, helper_id, payment_status FROM public.jobs WHERE id = '${id(1)}'`))[0];
check("the job reopens with nobody on it and its money still 'failed' (off the list until paid)", j1.status === "open" && j1.helper_id === null && j1.payment_status === "failed", JSON.stringify(j1));

// 3. KEEP: every other money state reads exactly as before.
for (const [n, label] of [[2, "funded"], [3, "held"]]) {
  const p = await notice(id(n), POSTER);
  const h = await notice(id(n), HELPER);
  check(`${label} job: the poster's words unchanged`, p.title === "Offer expired — job reopened" && /Your Helpr didn't answer in time/.test(p.message ?? "") && /open to everyone/.test(p.message ?? ""), JSON.stringify(p));
  check(`${label} job: the Helpr's words unchanged`, /and it went back to everyone\. No strike\./.test(h.message ?? ""), JSON.stringify(h));
}
const p5 = await notice(id(5), POSTER);
check("funded crew spot: the poster's words unchanged", p5.title === "Offer expired — spot reopened" && /A Helpr you picked didn't answer in time/.test(p5.message ?? ""), JSON.stringify(p5));

// 4. get_my_job_card_hold: the fee inside the hold, only to the job's own poster.
await db.exec(`INSERT INTO public.job_card_holds (job_id, state, amount_cents, onboarding_fee_cents) VALUES ('${id(2)}', 'authorized', 4200, 200);`);
await db.exec(`SET request.jwt.claim.sub = '${POSTER}';`);
const mine = await rows(`SELECT * FROM public.get_my_job_card_hold('${id(2)}')`);
check("the poster's read names the fee inside the hold", mine[0]?.onboarding_fee_cents === 200 && mine[0]?.amount_cents === 4200, JSON.stringify(mine[0]));
await db.exec(`SET request.jwt.claim.sub = '${HELPER}';`);
const theirs = await rows(`SELECT * FROM public.get_my_job_card_hold('${id(2)}')`);
check("anyone else reads nothing", theirs.length === 0, `${theirs.length} row(s)`);

const acl = (await rows(`SELECT proname, proacl::text AS acl FROM pg_proc WHERE proname IN ('get_my_job_card_hold','expire_unanswered_offers') ORDER BY proname`));
const aclOf = (n) => acl.find((r) => r.proname === n)?.acl ?? "";
const grantees = (n) => aclOf(n).replace(/[{}"]/g, "").split(",").filter(Boolean).map((e) => e.split("=")[0]);
check("grants: expire_unanswered_offers is service_role only", grantees("expire_unanswered_offers").includes("service_role") && grantees("expire_unanswered_offers").every((g) => g === "service_role" || g === "postgres"), aclOf("expire_unanswered_offers"));
check("grants: get_my_job_card_hold is authenticated + service_role, never anon or PUBLIC",
  /authenticated=X/.test(aclOf("get_my_job_card_hold")) && /service_role=X/.test(aclOf("get_my_job_card_hold")) && !/anon=/.test(aclOf("get_my_job_card_hold")) && !/[{,]=X/.test(aclOf("get_my_job_card_hold")), aclOf("get_my_job_card_hold"));

console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
