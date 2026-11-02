#!/usr/bin/env node
/**
 * PGlite proof for 20261102103429_poster_withdraws_an_offer.sql (Q2604): the poster's Withdraw offer.
 *
 *   npx tsx src/test/pglite/posterWithdrawsAnOffer.pglite.mjs                      # GREEN, migration applied 3x
 *   NEW_MIGRATION=skip npx tsx src/test/pglite/posterWithdrawsAnOffer.pglite.mjs   # RED: no such function
 *   PLANT=<name> npx tsx src/test/pglite/posterWithdrawsAnOffer.pglite.mjs         # a planted defect: its checks FAIL
 *
 * The world: jobs / applications / notifications / job_card_holds / job_accept_pending with the columns these
 * functions read, the REAL newest job_payment_is_listed, clear_job_accept_pending (on its real trigger) and
 * record_backout_notice (on its real trigger; its email sender stubbed). Supabase's default grant (EXECUTE on every
 * new function to anon and authenticated) is emulated with ALTER DEFAULT PRIVILEGES, so the grants checked are what
 * the migration's own REVOKE/GRANT leave. PGlite is one connection, so each race ORDER with a capture is played in
 * sequence: the capture's claim is its committed write (job_card_holds.state 'capturing', what captureCardHold's
 * claim UPDATE writes); the withdraw's FOR UPDATE on the hold row is what puts a concurrent pair into one of the two
 * orders. The capture side's give-back after a withdraw (captureCardHold hireOf) is src/test/posterWithdrawOffer.test.ts.
 *
 * Plants (each must turn at least one check red):
 *   no_owner_check   any member may withdraw any job's offer
 *   anon_grant       the REVOKE ... FROM PUBLIC, anon line is dropped (Supabase's default anon EXECUTE stays)
 *   no_claim_check   a hold being captured ('capturing') no longer refuses the withdraw
 *   no_grace_check   a hold captured moments ago (the capture-then-hire gap) no longer refuses it
 *   marks_declined   a direct offer is marked 'declined' instead of cleared (the poster is told about their own act)
 *   wrong_reason     the application closes as offer_expired (the Helpr reads "didn't answer in time")
 *   moves_money      the withdraw also writes the job's payment_status
 *
 * Q2641 (20261102110120): the trigger clear_job_accept_pending itself removes a Hire's pending accept when the job
 * reopens (the expiry's own UPDATE). CLEAR_TRIGGER=before loads the body before that migration: its Q2641 check FAILS.
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import { newestFunction } from "./lib/fixedClock.mjs";
import { effectiveDefs } from "../helpers/effectiveFunctionDefs.ts";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261102103429_poster_withdraws_an_offer.sql";
const SKIP = process.env.NEW_MIGRATION === "skip";
const PLANT = process.env.PLANT ?? "";

let migration = readFileSync(DIR + THIS, "utf8");
function plant(from, to) {
  if (!migration.includes(from)) throw new Error(`PLANT=${PLANT}: "${from.slice(0, 60)}" not found in ${THIS}`);
  migration = migration.split(from).join(to);
}
if (PLANT === "no_owner_check") plant("IF NOT FOUND OR v_job.customer_id IS DISTINCT FROM v_uid THEN", "IF NOT FOUND THEN");
else if (PLANT === "anon_grant") migration = migration.replace(/^REVOKE ALL ON FUNCTION public\.rpc_poster_withdraw_offer.*$/m, "");
else if (PLANT === "no_claim_check") plant("v_hold.state = 'capturing'", "false");
else if (PLANT === "no_grace_check") plant("(v_hold.state = 'captured' AND v_hold.updated_at > now() - interval '30 minutes')", "false");
else if (PLANT === "marks_declined") plant("direct_offer_status = NULL,", "direct_offer_status = 'declined',");
else if (PLANT === "wrong_reason") plant("SET status = 'rejected', closed_reason = 'offer_withdrawn'", "SET status = 'rejected', closed_reason = 'offer_expired'");
else if (PLANT === "moves_money") plant("response_deadline = NULL\n     WHERE id = p_job_id;", "response_deadline = NULL,\n           payment_status = 'refunded'\n     WHERE id = p_job_id;");
else if (PLANT) throw new Error(`unknown PLANT=${PLANT}`);
if (SKIP) console.log("NEW_MIGRATION=skip (RED expected)");
if (PLANT) console.log(`PLANT=${PLANT} (expect FAILs)`);

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const POSTER = U(1), HELPR = U(2), OTHER = U(3), STRANGER = U(4);

const db = new PGlite();
const q = async (sql, p) => (await db.query(sql, p)).rows;
await db.exec(`
SET TIME ZONE 'UTC';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
CREATE TYPE public.job_status AS ENUM ('open','pending_approval','accepted','in_progress','revision_requested','completed','cancelled','disputed');
CREATE TABLE public.jobs (id uuid PRIMARY KEY, customer_id uuid, helper_id uuid, title text DEFAULT 'Rake the yard',
  status public.job_status DEFAULT 'open', payment_status text DEFAULT 'held', is_group_job boolean DEFAULT false, parent_job_id uuid,
  helper_confirmed_at timestamptz, response_deadline timestamptz, cancelled_by uuid,
  offered_to_helper_id uuid, direct_offer_status text, direct_offer_expires_at timestamptz, instant_decline_until timestamptz,
  date_needed date, start_time time, estimated_hours numeric, is_flexible_schedule boolean, location text, parish text, zip_code text,
  description text, category text, special_requirements text, photos text[], scope_video_url text, require_photo_proof boolean,
  budget numeric, pricing_mode text, is_urgent boolean, urgent_fee numeric, is_recurring boolean, recurrence_interval text,
  recurrence_days int[], recurrence_weeks int, recurrence_end_date date, series_split_ok boolean, materials_note text);
CREATE TABLE public.applications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid, status text, closed_reason text,
  CONSTRAINT applications_closed_reason_check
    CHECK (closed_reason IS NULL OR closed_reason IN ('job_cancelled', 'party_blocked', 'offer_expired', 'not_confirmed', 'no_show', 'helper_cancelled')));
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, title text NOT NULL, message text NOT NULL,
  type text, link text, job_id uuid, created_at timestamptz DEFAULT clock_timestamp());
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, full_name text);
CREATE TABLE public.job_card_holds (job_id uuid PRIMARY KEY, state text NOT NULL
  CHECK (state IN ('authorized', 'scheduled', 'capturing', 'needs_action', 'failed', 'captured', 'released')),
  amount_cents integer NOT NULL DEFAULT 6000, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.job_accept_pending (job_id uuid PRIMARY KEY, helper_id uuid NOT NULL, requested_at timestamptz DEFAULT now());
CREATE TABLE public.backout_notices (job_id uuid, user_id uuid, actor_name text, backout_kind text);
CREATE FUNCTION public.member_display_name(text, text) RETURNS text LANGUAGE sql AS $f$ SELECT COALESCE($1, $2) $f$;
CREATE FUNCTION public.backout_notice_text(p_kind text, p_actor text, p_title text, OUT title text, OUT message text)
  LANGUAGE sql AS $f$ SELECT p_kind, coalesce(p_actor, '') || ' ' || coalesce(p_title, '') $f$;
CREATE FUNCTION public.send_backout_email(uuid, uuid, text, text, text) RETURNS void LANGUAGE sql AS $f$ SELECT $f$;
INSERT INTO public.profiles VALUES ('${POSTER}', 'Dana Poster'), ('${HELPR}', 'Eli Helpr'), ('${OTHER}', 'Rae Other');
`);
// The real newest bodies the withdraw runs through.
for (const name of ["job_payment_is_listed", "clear_job_accept_pending", "record_backout_notice"]) await db.exec(newestFunction(name).stmt);
if (process.env.CLEAR_TRIGGER === "before") {
  const d = effectiveDefs(DIR, { before: "20261102110120_hire_offer_pending_accept_cleared_on_reopen.sql" }).get("clear_job_accept_pending");
  await db.exec(d.stmt.trimEnd().endsWith(";") ? d.stmt : `${d.stmt};`);
  console.log("CLEAR_TRIGGER=before (the Q2641 check expected to FAIL)");
}
await db.exec(`
CREATE TRIGGER trg_jobs_clear_accept_pending AFTER UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.clear_job_accept_pending();
CREATE TRIGGER trg_jobs_record_backout_notice AFTER UPDATE OF status, helper_id, direct_offer_status ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.record_backout_notice();`);
if (!SKIP) for (let i = 0; i < 3; i++) await db.exec(migration); // replay-safe: applies 3x

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (ok) pass++; else fail++;
};
/** Call the RPC as a role and member; returns rows or { error }. */
async function withdraw(role, uid, jobId) {
  try {
    await db.exec(`SELECT set_config('request.jwt.claim.sub', '${uid ?? ""}', false); SET ROLE ${role};`);
    return (await db.query(`SELECT public.rpc_poster_withdraw_offer($1) AS r`, [jobId])).rows[0].r;
  } catch (e) {
    return { error: String(e.message ?? e) };
  } finally {
    await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);`);
  }
}
const err = (r) => (r && r.error) || "";
let jn = 100;
async function offerJob({ pay = "held", hold = "authorized", holdAge = "2 hours", helper = HELPR } = {}) {
  const J = U(jn++);
  await q(`INSERT INTO public.jobs (id, customer_id, helper_id, status, payment_status, response_deadline)
           VALUES ($1, $2, $3, 'accepted', $4, now() + interval '20 hours')`, [J, POSTER, helper, pay]);
  await q(`INSERT INTO public.applications (job_id, helper_id, status) VALUES ($1, $2, 'accepted'), ($1, $3, 'pending')`, [J, helper, OTHER]);
  if (hold) await q(`INSERT INTO public.job_card_holds (job_id, state, updated_at) VALUES ($1, $2, now() - $3::interval)`, [J, hold, holdAge]);
  return J;
}
async function directJob({ pay = "held", hold = "authorized", instant = false } = {}) {
  const J = U(jn++);
  await q(`INSERT INTO public.jobs (id, customer_id, status, payment_status, offered_to_helper_id, direct_offer_status, direct_offer_expires_at, instant_decline_until)
           VALUES ($1, $2, 'open', $3, $4, 'pending', now() + interval '20 hours', ${instant ? "now() + interval '2 hours'" : "NULL"})`, [J, POSTER, pay, HELPR]);
  if (hold) await q(`INSERT INTO public.job_card_holds (job_id, state) VALUES ($1, $2)`, [J, hold]);
  return J;
}
const job = async (J) => (await q(`SELECT status::text AS status, helper_id, response_deadline, payment_status, offered_to_helper_id,
  direct_offer_status, direct_offer_expires_at, instant_decline_until FROM public.jobs WHERE id = $1`, [J]))[0];
const hold = async (J) => (await q(`SELECT state FROM public.job_card_holds WHERE job_id = $1`, [J]))[0]?.state ?? null;
const notes = async (J, uid) => q(`SELECT title, message FROM public.notifications WHERE job_id = $1 AND user_id = $2`, [J, uid]);
const backouts = async (J) => q(`SELECT user_id, backout_kind FROM public.backout_notices WHERE job_id = $1`, [J]);

// ── W1 a Hire's offer: the poster withdraws it ──
{
  const J = await offerJob();
  await q(`INSERT INTO public.job_accept_pending (job_id, helper_id) VALUES ($1, $2)`, [J, HELPR]);
  const r = await withdraw("authenticated", POSTER, J);
  check("W1 the poster withdraws their Hire's offer", !err(r) && r.kind === "offer", JSON.stringify(r));
  const j = await job(J);
  check("W1 the job reopens as the expiry reopens it (open, nobody named, no answer-by)",
    j?.status === "open" && j.helper_id === null && j.response_deadline === null, JSON.stringify(j));
  const apps = await q(`SELECT helper_id, status, closed_reason FROM public.applications WHERE job_id = $1 ORDER BY helper_id`, [J]);
  const mine = apps.find((a) => a.helper_id === HELPR), other = apps.find((a) => a.helper_id === OTHER);
  check("W1 the Helpr's application closes as offer_withdrawn", mine?.status === "rejected" && mine.closed_reason === "offer_withdrawn", JSON.stringify(mine));
  check("W1 the other applicant is untouched (still pending)", other?.status === "pending" && other.closed_reason === null, JSON.stringify(other));
  check("W1 THE MONEY: the job stays held and the hold stays authorized (nothing released, nothing captured)",
    j?.payment_status === "held" && (await hold(J)) === "authorized", `${j?.payment_status} / ${await hold(J)}`);
  const told = await notes(J, HELPR);
  check("W1 the Helpr is told once, by the poster's first name, no strike",
    told.length === 1 && /Dana withdrew the offer/.test(told[0].message) && /no strike/.test(told[0].message), JSON.stringify(told));
  check("W1 the poster gets no backout notice about their own act", (await backouts(J)).length === 0 && (await notes(J, POSTER)).length === 0);
  check("W1 the pending accept ended with the offer", (await q(`SELECT 1 FROM public.job_accept_pending WHERE job_id = $1`, [J])).length === 0);
  const again = await withdraw("authenticated", POSTER, J);
  check("W1 a second withdraw is refused (offer_not_active)", /offer_not_active/.test(err(again)), err(again));
}

// ── W2 who may call it ──
{
  const J = await offerJob();
  const s = await withdraw("authenticated", STRANGER, J);
  check("W2 another member is refused (not_your_job)", /not_your_job/.test(err(s)), err(s));
  const h = await withdraw("authenticated", HELPR, J);
  check("W2 the offered Helpr cannot withdraw it either", /not_your_job/.test(err(h)), err(h));
  const a = await withdraw("anon", null, J);
  check("W2 anon cannot execute it (the default grant is revoked)", /permission denied/.test(err(a)), err(a));
  const missing = await withdraw("authenticated", POSTER, U(9999));
  check("W2 an unknown job reads exactly like someone else's", /not_your_job/.test(err(missing)), err(missing));
  const j = await job(J);
  check("W2 after the refusals the offer is still out", j?.status === "accepted" && j.helper_id === HELPR, JSON.stringify(j));
  const acl = (await q(`SELECT proacl::text AS acl FROM pg_proc WHERE proname = 'rpc_poster_withdraw_offer'`))[0]?.acl ?? "";
  check("W2 proacl: authenticated may execute, anon and PUBLIC may not",
    /authenticated=X/.test(acl) && !/anon=/.test(acl) && !/(^|[{,])=X/.test(acl), acl);
}

// ── W3 the capture race: a claim committed first refuses the withdraw ──
{
  const J = await offerJob({ hold: "capturing" });
  const r = await withdraw("authenticated", POSTER, J);
  check("W3 a hold being captured (the Helpr's Accept in flight) refuses the withdraw", /offer_being_accepted/.test(err(r)), err(r));
  const j = await job(J);
  check("W3 nothing changed: the offer is still out, the claim untouched",
    j?.status === "accepted" && j.helper_id === HELPR && (await hold(J)) === "capturing", JSON.stringify(j));
  check("W3 nobody is told anything false", (await notes(J, HELPR)).length === 0);
}
{
  const J = await offerJob({ pay: "escrow", hold: "captured", holdAge: "1 minute" });
  const r = await withdraw("authenticated", POSTER, J);
  check("W3 a hold captured a minute ago (the capture-then-hire gap) refuses the withdraw", /offer_being_accepted/.test(err(r)), err(r));
  check("W3 ... and the offer is still out", (await job(J))?.helper_id === HELPR);
}
{
  const J = await offerJob({ pay: "escrow", hold: "captured", holdAge: "3 hours" });
  const r = await withdraw("authenticated", POSTER, J);
  check("W3 a hold captured hours ago (an earlier hire that never completed) does not block a later offer's withdraw",
    !err(r) && (await job(J))?.payment_status === "escrow" && (await hold(J)) === "captured", err(r));
}
{
  const J = await offerJob({ pay: "escrow", hold: null });
  const r = await withdraw("authenticated", POSTER, J);
  check("W3 paid at post (escrow, no hold row): the withdraw goes through and the money stays with the job",
    !err(r) && (await job(J))?.payment_status === "escrow" && (await job(J))?.status === "open", err(r));
}

// ── W4 a direct offer and an instant booking ──
{
  const J = await directJob();
  await q(`INSERT INTO public.job_accept_pending (job_id, helper_id) VALUES ($1, $2)`, [J, HELPR]);
  const r = await withdraw("authenticated", POSTER, J);
  check("W4 the poster withdraws a direct offer", !err(r) && r.kind === "direct" && r.open_to_everyone === true, JSON.stringify(r));
  const j = await job(J);
  check("W4 the offer is cleared (no target, no status, no clock) and the job stays open",
    j?.status === "open" && j.offered_to_helper_id === null && j.direct_offer_status === null && j.direct_offer_expires_at === null, JSON.stringify(j));
  check("W4 the poster gets no 'declined your offer' notice about their own act", (await backouts(J)).length === 0, JSON.stringify(await backouts(J)));
  check("W4 THE MONEY: still held, hold still authorized", j?.payment_status === "held" && (await hold(J)) === "authorized");
  check("W4 the Helpr's pending accept is gone", (await q(`SELECT 1 FROM public.job_accept_pending WHERE job_id = $1`, [J])).length === 0);
  check("W4 the Helpr is told", (await notes(J, HELPR)).length === 1);
}
{
  const J = await directJob({ instant: true });
  const r = await withdraw("authenticated", POSTER, J);
  const j = await job(J);
  check("W4 an instant booking in its window: withdrawn, and card-hold-sweep's due query no longer matches it",
    !err(r) && j?.instant_decline_until === null && j.direct_offer_status === null, JSON.stringify(j));
}
{
  const J = await directJob({ instant: true, hold: "capturing" });
  const r = await withdraw("authenticated", POSTER, J);
  check("W4 an instant booking being captured refuses the withdraw", /offer_being_accepted/.test(err(r)), err(r));
}
{
  const J = await directJob({ pay: "unpaid", hold: null });
  const r = await withdraw("authenticated", POSTER, J);
  check("W4 an unfunded direct offer (never shown) is withdrawn and the Helpr is not told",
    !err(r) && r.open_to_everyone === false && (await notes(J, HELPR)).length === 0, JSON.stringify(r));
}

// ── Q2641 the trigger alone: the expiry's reopen removes a Hire's pending accept ──
{
  const J = await offerJob();
  await q(`INSERT INTO public.job_accept_pending (job_id, helper_id) VALUES ($1, $2)`, [J, HELPR]);
  await q(`UPDATE public.jobs SET status = 'open', helper_id = NULL, response_deadline = NULL WHERE id = $1`, [J]);
  check("Q2641 a Hire's offer reopened (expire_unanswered_offers' UPDATE): the trigger removes its pending accept",
    (await q(`SELECT 1 FROM public.job_accept_pending WHERE job_id = $1`, [J])).length === 0);
  const D = await directJob();
  await q(`INSERT INTO public.job_accept_pending (job_id, helper_id) VALUES ($1, $2)`, [D, HELPR]);
  await q(`UPDATE public.jobs SET title = title WHERE id = $1`, [D]);
  check("Q2641 control: a live direct offer keeps its pending accept", (await q(`SELECT 1 FROM public.job_accept_pending WHERE job_id = $1`, [D])).length === 1);
  const K = await offerJob();
  await q(`INSERT INTO public.job_accept_pending (job_id, helper_id) VALUES ($1, $2)`, [K, HELPR]);
  await q(`UPDATE public.jobs SET response_deadline = now() + interval '30 hours' WHERE id = $1`, [K]);
  check("Q2641 control: a live Hire's offer keeps its pending accept", (await q(`SELECT 1 FROM public.job_accept_pending WHERE job_id = $1`, [K])).length === 1);
}

// ── W5 nothing else is an "offer" ──
{
  const J = U(jn++);
  await q(`INSERT INTO public.jobs (id, customer_id, helper_id, status, helper_confirmed_at, payment_status) VALUES ($1, $2, $3, 'accepted', now(), 'escrow')`, [J, POSTER, HELPR]);
  const r = await withdraw("authenticated", POSTER, J);
  check("W5 a confirmed hire is not an offer (offer_not_active; cancelling is a different path)", /offer_not_active/.test(err(r)), err(r));
  const C = U(jn++);
  await q(`INSERT INTO public.jobs (id, customer_id, helper_id, status, is_group_job) VALUES ($1, $2, $3, 'accepted', true)`, [C, POSTER, HELPR]);
  const c = await withdraw("authenticated", POSTER, C);
  check("W5 a crew is refused (group_job_not_supported)", /group_job_not_supported/.test(err(c)), err(c));
  const O = U(jn++);
  await q(`INSERT INTO public.jobs (id, customer_id, status) VALUES ($1, $2, 'open')`, [O, POSTER]);
  const o = await withdraw("authenticated", POSTER, O);
  check("W5 an open job with no offer is refused", /offer_not_active/.test(err(o)), err(o));
}

console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
