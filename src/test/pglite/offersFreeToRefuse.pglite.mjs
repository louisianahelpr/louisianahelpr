#!/usr/bin/env node
/**
 * PGlite proof for 20261007125609_offers_are_free_to_refuse.sql (docs/OPEN.md Q1281; owner decision
 * 2026-10-05: NO strike for declining OR ignoring an offer; strikes only for
 * backing out after accepting).
 *
 *   node src/test/pglite/offersFreeToRefuse.pglite.mjs                      # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/offersFreeToRefuse.pglite.mjs   # RED: the definitions before it (= live)
 *
 * Fixture: the minimum decline_job_offer and expire_unanswered_offers read
 * (jobs, applications, a crew roster, notifications), auth.uid() from the JWT
 * claim; apply_job_denial_consequence records a row in strikes so a strike is
 * countable; helper_accept_block_reason answers NULL (the Helpr is fully set
 * up: the case that WAS struck). The before-definitions are the newest CREATE
 * in the migrations before this one, which is what prod runs.
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIGDIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261007125609_offers_are_free_to_refuse.sql";
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: the definitions before this migration (expect FAILs)`);

/** The newest CREATE of public.<name> in the migrations before THIS. */
function before(name) {
  let found = null;
  for (const f of readdirSync(MIGDIR).filter((x) => x.endsWith(".sql") && x < THIS).sort()) {
    const sql = readFileSync(MIGDIR + f, "utf8");
    const m = [...sql.matchAll(new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi"))].at(-1);
    if (!m) continue;
    const open = /\bAS\s+(\$\w*\$)/i.exec(sql.slice(m.index));
    const bodyStart = m.index + open.index + open[0].length;
    const close = sql.indexOf(open[1], bodyStart);
    found = sql.slice(m.index, sql.indexOf(";", close) + 1);
  }
  if (!found) throw new Error(`no migration before ${THIS} defines ${name}`);
  return found;
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
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS \$\$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid \$\$;
CREATE TABLE public.jobs (
  id uuid PRIMARY KEY, customer_id uuid, helper_id uuid, status text, title text,
  date_needed date, start_time time, response_deadline timestamptz, helper_confirmed_at timestamptz,
  is_seed boolean DEFAULT true, is_group_job boolean DEFAULT false, helpers_needed int DEFAULT 1
);
CREATE TABLE public.applications (id uuid PRIMARY KEY, job_id uuid, helper_id uuid, status text, offer_message text, closed_reason text);
CREATE TABLE public.profiles (user_id uuid, is_seed boolean DEFAULT true);
CREATE TABLE public.job_accept_pending (job_id uuid, helper_id uuid);
CREATE TABLE public.group_job_helpers (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, job_id uuid, helper_id uuid, slot_no int, share_cents int, helper_confirmed_at timestamptz, response_deadline timestamptz);
CREATE TABLE public.notifications (user_id uuid, title text, message text, type text, link text, job_id uuid);
CREATE TABLE public.error_logs (severity text, message text, tags jsonb, context jsonb);
CREATE TABLE public.strikes (helper_id uuid, job_id uuid, why text);
CREATE FUNCTION public.are_users_blocked(a uuid, b uuid) RETURNS boolean LANGUAGE sql AS \$\$ SELECT false \$\$;
CREATE FUNCTION public.helper_accept_block_reason(u uuid) RETURNS text LANGUAGE sql AS \$\$ SELECT NULL::text \$\$;
CREATE FUNCTION public.apply_job_denial_consequence(h uuid, j uuid, why text) RETURNS jsonb LANGUAGE sql AS \$\$ INSERT INTO public.strikes VALUES (h, j, why) RETURNING jsonb_build_object('action', 'warning') \$\$;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA auth TO authenticated;
`);
await db.exec(before("job_offer_cutoff"));
await db.exec(before("decline_job_offer"));
await db.exec(before("expire_unanswered_offers"));
if (!MODE) for (let i = 0; i < 3; i++) await db.exec(readFileSync(MIGDIR + THIS, "utf8"));

const struck = async (n) => Number((await db.query(`SELECT count(*)::int AS c FROM public.strikes WHERE job_id = '${id(n)}'`)).rows[0].c);

// D1: a fully set-up Helpr declines the offer they were picked for.
await db.exec(`
  INSERT INTO public.jobs (id, customer_id, helper_id, status, title, date_needed, start_time, response_deadline)
  VALUES ('${id(1)}', '${POSTER}', '${HELPER}', 'accepted', 'Fence', current_date + 5, '09:00', now() + interval '20 hours');
  INSERT INTO public.applications (id, job_id, helper_id, status) VALUES ('${id(101)}', '${id(1)}', '${HELPER}', 'accepted');`);
let res;
try {
  await db.exec(`SET request.jwt.claim.sub = '${HELPER}'`);
  res = (await db.query(`SELECT public.decline_job_offer('${id(101)}') AS r`)).rows[0].r;
} catch (e) { res = { error: e.message }; }
await db.exec("RESET request.jwt.claim.sub");
const j1 = (await db.query(`SELECT status, helper_id FROM public.jobs WHERE id = '${id(1)}'`)).rows[0];
check("D1 declining an offer is no strike", (await struck(1)) === 0, `${await struck(1)} strikes, result ${JSON.stringify(res)}`);
check("D1 the decline answers action 'none'", res?.action === "none", JSON.stringify(res));
check("D1 the job reopens and the poster is told (unchanged)", j1.status === "open" && j1.helper_id === null
  && Number((await db.query(`SELECT count(*)::int c FROM public.notifications WHERE user_id = '${POSTER}'`)).rows[0].c) === 1, JSON.stringify(j1));

// E1: an offer the Helpr ignores lapses (an ordinary window, days before the start).
await db.exec(`
  INSERT INTO public.jobs (id, customer_id, helper_id, status, title, date_needed, start_time, response_deadline)
  VALUES ('${id(2)}', '${POSTER}', '${HELPER}', 'accepted', 'Mow', current_date + 5, '09:00', now() - interval '2 minutes');
  INSERT INTO public.applications (id, job_id, helper_id, status) VALUES ('${id(102)}', '${id(2)}', '${HELPER}', 'accepted');
  SELECT public.expire_unanswered_offers();`);
const j2 = (await db.query(`SELECT status FROM public.jobs WHERE id = '${id(2)}'`)).rows[0];
check("E1 letting an offer lapse is no strike", (await struck(2)) === 0, `${await struck(2)} strikes`);
check("E1 the lapsed offer still expires and the job reopens (unchanged)", j2.status === "open", j2.status);

// E2: a crew spot's unanswered offer lapses.
await db.exec(`
  INSERT INTO public.jobs (id, customer_id, status, title, date_needed, start_time, is_group_job, helpers_needed)
  VALUES ('${id(3)}', '${POSTER}', 'accepted', 'Crew move', current_date + 5, '09:00', true, 2);
  INSERT INTO public.group_job_helpers (job_id, helper_id, slot_no, share_cents, response_deadline)
  VALUES ('${id(3)}', '${HELPER}', 1, 5000, now() - interval '2 minutes');
  INSERT INTO public.applications (id, job_id, helper_id, status) VALUES ('${id(103)}', '${id(3)}', '${HELPER}', 'accepted');`);
let crewErr = null;
try { await db.exec("SELECT public.expire_unanswered_offers()"); } catch (e) { crewErr = e.message; }
check("E2 an unanswered crew spot lapsing is no strike", crewErr === null && (await struck(3)) === 0, crewErr ?? `${await struck(3)} strikes`);
// Not vacuous (review): each sweep row runs inside EXCEPTION WHEN OTHERS, so an
// erroring row would also leave 0 strikes. Nothing was logged as an error, the
// crew slot was really released, and both sides were told.
const errs = Number((await db.query(`SELECT count(*)::int AS c FROM public.error_logs`)).rows[0].c);
check("no sweep row errored (error_logs empty)", errs === 0, `${errs} error row(s)`);
const slotLeft = Number((await db.query(`SELECT count(*)::int AS c FROM public.group_job_helpers WHERE job_id = '${id(3)}' AND helper_id = '${HELPER}'`)).rows[0].c);
check("E2 the lapsed crew spot was released", slotLeft === 0, `${slotLeft} slot row(s) left`);
const lapseNotes = (await db.query(`SELECT message FROM public.notifications WHERE user_id = '${HELPER}'`)).rows.map((r) => r.message);
check("the Helpr's lapse notices say no strike", lapseNotes.length >= 2 && lapseNotes.every((m) => /No strike/.test(m)), JSON.stringify(lapseNotes));

console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
