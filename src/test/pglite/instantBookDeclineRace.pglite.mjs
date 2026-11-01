#!/usr/bin/env node
/**
 * PGlite proof for 20261101071621_instant_book_decline_race.sql (CMP-4 money
 * review FAIL, lead 2026-11-01): the Helpr's decline and the sweep's capture
 * never both win; the generic decline and a poster's cancel during the window
 * say the right thing.
 *
 *   node src/test/pglite/instantBookDeclineRace.pglite.mjs                     # GREEN, applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/instantBookDeclineRace.pglite.mjs  # RED: slices 1-3 only
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/instantBookDeclineRace.pglite.mjs
 *
 * The world is instantBookBooking.pglite.mjs's (its SCHEMA, EXTRA and the
 * three earlier migrations, read from that file), plus job_card_holds with its
 * real columns (20261027185146) and the real direct_accept_block_reason. PGlite
 * is one connection, so each race ORDER is played in sequence: the capture's
 * claim is its committed write (job_card_holds.state 'capturing', exactly
 * what captureCardHold's claim UPDATE writes), and the decline's FOR UPDATE
 * on the hold row is what makes a concurrent pair fall into one of the two
 * orders. The capture side's give-back (captureCardHold offerTo) is proven in
 * src/test/instantBookSweep.test.ts.
 *
 *   R1  claim first: a decline after the capture claimed the hold is refused; the poster is told nothing false
 *   R2  decline first: the decline wins inside the window with the hold only authorized; the offer is gone (what the claim's re-read sees)
 *   R3  the window's end refuses a decline (now() >= instant_decline_until), and a captured hold refuses it
 *   R4  paid at post (escrow, no hold row): the Helpr can decline; with a hold row in escrow (a capture landed) they cannot
 *   R5  respond_to_direct_offer(false) on a booking is the instant decline: its words, no "Offer declined", no 'declined' status, refused past the window
 *   R6  a poster's cancel in the window: the window closes, the booked Helpr is told once, the sweep's due-query no longer matches
 *   R7  instant_book_end_if_unhireable: a Helpr who can't be hired now ends the booking with no capture, both told "not charged"; a hireable one is left alone
 *   R7b after a capture the pre-capture end never fires (no "not charged" over a charged card)
 *   R8  instant_book_captured_not_hired: ends the booking and answers true ONCE (one ops alert per job); the poster hears "being returned"
 *   R9  instant_book_payment_failed: the poster already told by the hold code ('failed') hears nothing more; an untold one hears once and is marked
 *   R10 the three new service functions are not callable by a member
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const SLICE1 = "20261101063725_instant_book_floors.sql";
const SLICE2 = "20261101065105_instant_book_booking.sql";
const THIS = "20261101071621_instant_book_decline_race.sql";
const SKIP = process.env.NEW_MIGRATION === "skip";

const bookingProof = readFileSync(new URL("./instantBookBooking.pglite.mjs", import.meta.url), "utf8");
const floorsProof = readFileSync(new URL("./instantBookFloors.pglite.mjs", import.meta.url), "utf8");
const JOB_COLUMNS = readFileSync(new URL("./cardHoldAtPost.pglite.mjs", import.meta.url), "utf8").match(/const JOB_COLUMNS = `([\s\S]*?)`;/)[1];
const SCHEMA = floorsProof.match(/const SCHEMA = `([\s\S]*?)`;/)[1].replace("${JOB_COLUMNS}", JOB_COLUMNS);
const EXTRA = bookingProof.match(/const EXTRA = `([\s\S]*?)`;/)[1];
const CARD_HOLD = readFileSync(`${DIR}20261027185146_card_hold_at_post.sql`, "utf8");
const LISTED = CARD_HOLD.match(/CREATE OR REPLACE FUNCTION public\.job_payment_is_listed[\s\S]*?\$fn\$;/)[0];
const NOTIFY_BEFORE = CARD_HOLD.match(/CREATE OR REPLACE FUNCTION public\.notify_helper_on_direct_offer\(\)[\s\S]*?\$function\$;/)[0];
const DIRECT_BLOCK = CARD_HOLD.match(/CREATE OR REPLACE FUNCTION public\.direct_accept_block_reason[\s\S]*?\$fn\$;/)[0];
const RESPOND_BEFORE = CARD_HOLD.match(/CREATE OR REPLACE FUNCTION public\.respond_to_direct_offer\(p_job_id uuid, p_accept boolean\)[\s\S]*?\$function\$;/)[0];
// job_card_holds with its real columns (20261027185146), the ones these functions read.
const HOLDS = `
CREATE TABLE public.job_card_holds (job_id uuid PRIMARY KEY REFERENCES public.jobs(id) ON DELETE CASCADE,
  stripe_mode text NOT NULL DEFAULT 'test', payment_intent_id text,
  state text NOT NULL CHECK (state IN ('authorized', 'scheduled', 'capturing', 'needs_action', 'failed', 'captured', 'released')),
  capturing_from text, amount_cents integer NOT NULL DEFAULT 6000, notified_state text, updated_at timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION public.seed_hidden_for(u uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
`;

const db = new PGlite();
await db.exec(SCHEMA);
await db.exec("SET check_function_bodies = off;");
await db.exec(LISTED);
await db.exec(NOTIFY_BEFORE);
await db.exec(EXTRA);
await db.exec(HOLDS);
await db.exec(DIRECT_BLOCK);
await db.exec(RESPOND_BEFORE);
await db.exec(`REVOKE ALL ON FUNCTION public.respond_to_direct_offer(uuid, boolean) FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.respond_to_direct_offer(uuid, boolean) TO authenticated;`);
for (const f of [SLICE1, SLICE2]) {
  const sql = readFileSync(DIR + f, "utf8");
  for (let i = 0; i < 3; i++) await db.exec(sql);
}
if (!SKIP) {
  const sql = readFileSync(process.env.MIGRATION_PATH ?? DIR + THIS, "utf8");
  for (let i = 0; i < 3; i++) await db.exec(sql);
}
await db.exec("SET check_function_bodies = on;");

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (ok) pass++; else fail++;
};
async function as(who, uid, sql) {
  try {
    await db.exec(`SET request.jwt.claim.sub = '${uid ?? ""}'; SET request.jwt.claim.role = '${who}'; SET ROLE ${who};`);
    return (await db.query(sql)).rows;
  } catch (e) {
    return { error: String(e.message ?? e) };
  } finally {
    await db.exec(`RESET ROLE; SET request.jwt.claim.sub = ''; SET request.jwt.claim.role = '';`);
  }
}
async function owner(sql) {
  try { return (await db.query(sql)).rows; } catch (e) { return { error: String(e.message ?? e) }; }
}
/** Several setup statements at once: a failure throws (a setup that silently did nothing proves nothing). */
const setup = (sql) => db.exec(sql);
const err = (r) => (r && !Array.isArray(r) ? r.error : "");
const ok = (r) => Array.isArray(r);

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const P = id(1), RP = id(3), A = id(11), B = id(12);
const H = [A, B];
await db.exec(`INSERT INTO auth.users (id) SELECT unnest(ARRAY['${P}'::uuid, '${RP}'::uuid, '${A}'::uuid, '${B}'::uuid]);
  INSERT INTO public.profiles (user_id, full_name) VALUES ('${P}', 'Pat Poster'), ('${RP}', 'Rae P'), ('${A}', 'Ana Able'), ('${B}', 'Ben Baker');
  INSERT INTO public._ready SELECT unnest(ARRAY['${A}'::uuid, '${B}'::uuid]);`);
const day = "current_date + 2";
let n = 1000;
for (const h of H) for (let i = 0; i < 3; i++) {
  await owner(`INSERT INTO public.jobs (id, customer_id, helper_id, title, description, category, budget, status, payment_status)
    VALUES ('${id(n++)}', '${RP}', '${h}', 'old', 'd', 'yard_work', 50, 'completed', 'released')`);
  await owner(`INSERT INTO public.helper_availability (helper_id, day_of_week, is_available) VALUES ('${h}', extract(dow FROM ${day})::int, true)`);
}
for (const [h, c] of [[A, 5000], [B, 5000]]) await as("authenticated", h, `SELECT public.rpc_set_instant_book_floor('yard_work', ${c})`);

let jn = 200;
/** A fresh held (or paid-at-post) job, booked to `helper`. hold: a job_card_holds state, or null for none. */
async function bookedJob(helper, { pay = "held", hold = "authorized", title = "Mow the yard" } = {}) {
  const J = id(jn++);
  await owner(`INSERT INTO public.jobs (id, customer_id, title, description, category, date_needed, budget, payment_status)
    VALUES ('${J}', '${P}', '${title}', 'd', 'yard_work', ${day}, 60, '${pay}')`);
  if (hold) await owner(`INSERT INTO public.job_card_holds (job_id, state, payment_intent_id) VALUES ('${J}', '${hold}', 'pi_${jn}')`);
  const r = await as("authenticated", P, `SELECT public.rpc_instant_book('${J}', '${helper}') AS r`);
  if (!ok(r)) console.log("setup booking failed", err(r));
  return J;
}
const notes = async (uid, jid) => owner(`SELECT title, message FROM public.notifications WHERE user_id = '${uid}' AND job_id = '${jid}' ORDER BY created_at, title`);
const jobRow = async (jid) => (await owner(`SELECT status::text AS status, payment_status, offered_to_helper_id, direct_offer_status, instant_decline_until
  FROM public.jobs WHERE id = '${jid}'`))[0] ?? {};
const notCharged = (rows) => ok(rows) && rows.some((x) => /not charged/.test(x.message));
// The sweep's pass-8 due query (card-hold-sweep/index.ts), as SQL.
const sweepDue = async (jid) => owner(`SELECT id FROM public.jobs WHERE id = '${jid}' AND direct_offer_status = 'pending' AND status = 'open'
  AND instant_decline_until IS NOT NULL AND (instant_decline_until <= now() + interval '3 hours' OR payment_status = 'failed')`);

// ─── R1 claim first ─────────────────────────────────────────────────────────
const J1 = await bookedJob(A);
await owner(`UPDATE public.job_card_holds SET state = 'capturing', capturing_from = 'authorized' WHERE job_id = '${J1}'`); // captureCardHold's claim
const d1 = await as("authenticated", A, `SELECT public.rpc_instant_book_decline('${J1}')`);
const r1 = await jobRow(J1);
check("R1 claim first: the decline is refused, the booking stands, and the poster is not told \"not charged\"",
  /decline_window_closed/.test(err(d1)) && r1.offered_to_helper_id === A && r1.direct_offer_status === "pending"
    && !notCharged(await notes(P, J1)),
  err(d1) || JSON.stringify(r1));

// ─── R2 decline first ───────────────────────────────────────────────────────
const J2 = await bookedJob(A);
const d2 = await as("authenticated", A, `SELECT public.rpc_instant_book_decline('${J2}') AS r`);
const r2 = await jobRow(J2);
check("R2 decline first: allowed inside the window on an authorized hold; the offer is gone, which the claim's re-read sees",
  ok(d2) && d2[0].r?.action === "declined" && r2.offered_to_helper_id === null && r2.direct_offer_status === null
    && r2.payment_status === "held" && notCharged(await notes(P, J2)),
  err(d2) || JSON.stringify(r2));

// ─── R3 the window's end, and a captured hold ───────────────────────────────
const J3 = await bookedJob(A);
await owner(`UPDATE public.jobs SET instant_decline_until = now() - interval '1 second' WHERE id = '${J3}'`);
const d3 = await as("authenticated", A, `SELECT public.rpc_instant_book_decline('${J3}')`);
const J3b = await bookedJob(B);
await setup(`UPDATE public.job_card_holds SET state = 'captured' WHERE job_id = '${J3b}'; UPDATE public.jobs SET payment_status = 'escrow' WHERE id = '${J3b}'`);
const d3b = await as("authenticated", B, `SELECT public.rpc_instant_book_decline('${J3b}')`);
check("R3 past the window a decline is refused; after a capture (hold 'captured', job in escrow) it is refused",
  /decline_window_closed/.test(err(d3)) && /decline_window_closed/.test(err(d3b))
    && (await jobRow(J3)).offered_to_helper_id === A && (await jobRow(J3b)).offered_to_helper_id === B,
  [err(d3), err(d3b)].join(" | "));

// ─── R4 paid at post ────────────────────────────────────────────────────────
const J4 = await bookedJob(A, { pay: "escrow", hold: null });
const d4 = await as("authenticated", A, `SELECT public.rpc_instant_book_decline('${J4}') AS r`);
const p4 = await notes(P, J4);
check("R4 paid at post (escrow, no hold row): the Helpr can decline, and the poster hears the payment stays with the job",
  ok(d4) && d4[0].r?.action === "declined" && (await jobRow(J4)).payment_status === "escrow"
    && ok(p4) && p4.some((x) => /Your payment stays with the job/.test(x.message)) && !notCharged(p4),
  err(d4) || JSON.stringify(p4));

// ─── R5 the generic decline of a booking ────────────────────────────────────
const J5 = await bookedJob(B);
const d5 = await as("authenticated", B, `SELECT public.respond_to_direct_offer('${J5}', false) AS r`);
const r5 = await jobRow(J5);
const p5 = await notes(P, J5);
const J5b = await bookedJob(A);
await owner(`UPDATE public.jobs SET instant_decline_until = now() - interval '1 second' WHERE id = '${J5b}'`);
const d5b = await as("authenticated", A, `SELECT public.respond_to_direct_offer('${J5b}', false)`);
const reB = await as("authenticated", P, `SELECT public.rpc_instant_book('${J5}', '${B}')`);
check("R5 respond_to_direct_offer(false) on a booking is the instant decline (its words, no \"Offer declined\", no 'declined'); refused past the window",
  ok(d5) && d5[0].r?.action === "declined" && r5.direct_offer_status === null && r5.offered_to_helper_id === null
    && ok(p5) && p5.some((x) => x.message === "Ben can't make it. Your card was not charged. Your job is open again for other Helprs.")
    && !p5.some((x) => x.title === "Offer declined")
    && /decline_window_closed/.test(err(d5b)) && (await jobRow(J5b)).direct_offer_status === "pending"
    && /instant_book_unavailable/.test(err(reB)),
  err(d5) || JSON.stringify({ r5, p5 }) + " " + err(d5b) + " " + err(reB));

// ─── R6 a poster's cancel during the window ─────────────────────────────────
const J6 = await bookedJob(A);
// cancel_escrow's held branch and poster_cancel_job both write status 'cancelled' on the open job.
await owner(`UPDATE public.jobs SET status = 'cancelled', cancelled_by = '${P}', cancelled_at = now() WHERE id = '${J6}'`);
const r6 = await jobRow(J6);
const a6 = await notes(A, J6);
const due6 = await sweepDue(J6);
const mine6 = await as("authenticated", A, `SELECT job_id FROM public.rpc_my_instant_bookings() WHERE job_id = '${J6}'`);
const d6 = await as("authenticated", A, `SELECT public.rpc_instant_book_decline('${J6}')`);
check("R6 a cancel in the window: the window closes, the booked Helpr is told once, the sweep no longer matches it, no decline after",
  r6.instant_decline_until === null && ok(a6) && a6.filter((x) => x.title === "Booking cancelled").length === 1
    && ok(due6) && due6.length === 0 && ok(mine6) && mine6.length === 0 && /booking_not_pending/.test(err(d6)),
  JSON.stringify({ r6, a6, due6 }) + " " + err(d6));

// ─── R7 the hire's checks before any capture ────────────────────────────────
const J7 = await bookedJob(B);
await owner(`DELETE FROM public._ready WHERE user_id = '${B}'`); // payout setup / ID no longer ready
const e7 = await as("service_role", null, `SELECT public.instant_book_end_if_unhireable('${J7}') AS r`);
await owner(`INSERT INTO public._ready VALUES ('${B}')`);
const r7 = await jobRow(J7);
const p7 = await notes(P, J7);
const b7 = await notes(B, J7);
const J7b = await bookedJob(A);
const e7b = await as("service_role", null, `SELECT public.instant_book_end_if_unhireable('${J7b}') AS r`);
check("R7 an unhireable Helpr's booking ends before any capture, both told (poster: not charged); a hireable one is left alone",
  ok(e7) && e7[0].r === true && r7.offered_to_helper_id === null && r7.payment_status === "held"
    && notCharged(p7) && ok(b7) && b7.some((x) => x.title === "Your booking ended") && !/payout|ID/.test(JSON.stringify(p7))
    && ok(e7b) && e7b[0].r === false && (await jobRow(J7b)).offered_to_helper_id === A,
  err(e7) || JSON.stringify({ r7, p7, b7, e7b }));

const J7c = await bookedJob(A);
await setup(`UPDATE public.jobs SET payment_status = 'escrow' WHERE id = '${J7c}'; UPDATE public.job_card_holds SET state = 'captured' WHERE job_id = '${J7c}';
  DELETE FROM public._ready WHERE user_id = '${A}'`);
const e7c = await as("service_role", null, `SELECT public.instant_book_end_if_unhireable('${J7c}') AS r`);
await setup(`INSERT INTO public._ready VALUES ('${A}')`);
check("R7b after a capture (hold 'captured') the pre-capture end never fires: no \"not charged\" over a charged card",
  ok(e7c) && e7c[0].r === false && (await jobRow(J7c)).offered_to_helper_id === A && !notCharged(await notes(P, J7c)),
  err(e7c) || JSON.stringify(e7c));

// ─── R8 charged, and the hire refused in the moment between ─────────────────
const J8 = await bookedJob(B);
await setup(`UPDATE public.jobs SET payment_status = 'escrow' WHERE id = '${J8}'; UPDATE public.job_card_holds SET state = 'captured' WHERE job_id = '${J8}'`);
const c1 = await as("service_role", null, `SELECT public.instant_book_captured_not_hired('${J8}', '${B}') AS r`);
const c2 = await as("service_role", null, `SELECT public.instant_book_captured_not_hired('${J8}', '${B}') AS r`);
const p8 = await notes(P, J8);
const r8 = await jobRow(J8);
check("R8 captured, not hired: the booking ends, true once then false (one ops alert per job); the poster hears \"being returned\" once and never \"not charged\"",
  ok(c1) && c1[0].r === true && ok(c2) && c2[0].r === false && r8.offered_to_helper_id === null
    && ok(p8) && p8.filter((x) => x.title === "Your payment is being returned" && /within a day/.test(x.message)).length === 1 && !notCharged(p8),
  err(c1) || JSON.stringify({ c2, p8, r8 }));

// ─── R9 one failure notice, not two ─────────────────────────────────────────
const J9 = await bookedJob(A);
await setup(`UPDATE public.jobs SET payment_status = 'failed' WHERE id = '${J9}';
  UPDATE public.job_card_holds SET state = 'failed', notified_state = 'failed' WHERE job_id = '${J9}'`); // failHold told the poster
const f9 = await as("service_role", null, `SELECT public.instant_book_payment_failed('${J9}') AS r`);
const p9 = await notes(P, J9);
const J9b = await bookedJob(B);
await setup(`UPDATE public.jobs SET payment_status = 'failed' WHERE id = '${J9b}'; UPDATE public.job_card_holds SET state = 'failed' WHERE job_id = '${J9b}'`);
const f9b = await as("service_role", null, `SELECT public.instant_book_payment_failed('${J9b}') AS r`);
const p9b = await notes(P, J9b);
const mark9b = await owner(`SELECT notified_state FROM public.job_card_holds WHERE job_id = '${J9b}'`);
check("R9 a poster the hold code already told hears nothing more; an untold one hears once and the hold is marked told",
  ok(f9) && f9[0].r === true && ok(p9) && !p9.some((x) => x.title === "Your booking didn't go through")
    && ok(f9b) && f9b[0].r === true && ok(p9b) && p9b.filter((x) => x.title === "Your booking didn't go through").length === 1
    && ok(mark9b) && mark9b[0].notified_state === "failed",
  err(f9) || JSON.stringify({ p9, p9b, mark9b }));

// ─── R10 server-only ────────────────────────────────────────────────────────
const m1 = await as("authenticated", P, `SELECT public.instant_book_end_if_unhireable('${J7b}')`);
const m2 = await as("authenticated", P, `SELECT public.instant_book_captured_not_hired('${J7b}', '${A}')`);
const m3 = await as("authenticated", P, `SELECT public.instant_book_payment_failed('${J7b}')`);
check("R10 the three service functions refuse a member",
  [m1, m2, m3].every((r) => /permission denied/.test(err(r))), [err(m1), err(m2), err(m3)].join(" | "));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
