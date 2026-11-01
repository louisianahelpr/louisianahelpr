#!/usr/bin/env node
/**
 * PGlite proof for 20261101074901_instant_book_captured_refund.sql (CMP-4,
 * money re-review of 20261101071621:224-244, lead 2026-11-01): a booking the
 * hold was charged for whose hire was then refused is closed for review and
 * refunded through ONE claim, so nobody can be hired on that money and only
 * one refund can ever go out.
 *
 *   node src/test/pglite/instantBookCapturedRefund.pglite.mjs                     # GREEN, applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/instantBookCapturedRefund.pglite.mjs  # RED: the race fix only
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/instantBookCapturedRefund.pglite.mjs
 *
 * The world is instantBookDeclineRace.pglite.mjs's (read from that file), plus
 * job_refund_claims from its own migration (20261005064908) and the race fix.
 *
 *   C1 captured, not hired: true once; the job is closed (cancelled) with the refund claim taken (cancelling + holder 'instant_book_refund'); each side told once, the poster "refunding your payment in full"
 *   C2 no hire possible: the job is not listed, direct_accept_block_reason refuses, the Helpr's accept and a new booking are refused
 *   C3 no second refund path matches: void-cancelled-payments' select (cancelled + escrow), admin_refund_general's claim (from escrow), cancel_escrow's allowlist (open) and its re-entry (holder cancel_escrow) all miss this job
 *   C4 instant_book_refund_finished: true once, then false; the job reads refunded and the claim is gone
 *   C5 the webhook first ('refunded' already): finished still closes the claim once
 *   C6 not the hold's money (paid at post, no hold row): no review state, no claim, the old words
 *   C7 finished is not callable by a member; it refuses a job with another path's claim
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const SLICE1 = "20261101063725_instant_book_floors.sql";
const SLICE2 = "20261101065105_instant_book_booking.sql";
const RACE = "20261101071621_instant_book_decline_race.sql";
const THIS = "20261101074901_instant_book_captured_refund.sql";
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
// job_refund_claims exactly as 20261005064908 creates it (its email-gate call is not part of this world).
await db.exec(readFileSync(`${DIR}20261005064908_job_refund_claims.sql`, "utf8").replace("SELECT public.attach_unconfirmed_email_gate();", ""));
{
  const sql = readFileSync(DIR + RACE, "utf8");
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

/** A booking whose hold the 2-hour capture (or the Helpr's confirm) charged: exactly what captureCardHold writes. */
async function capturedBooking(helper) {
  const J = await bookedJob(helper);
  await setup(`UPDATE public.job_card_holds SET state = 'captured' WHERE job_id = '${J}';
    UPDATE public.jobs SET payment_status = 'escrow', stripe_payment_intent_id = (SELECT payment_intent_id FROM public.job_card_holds WHERE job_id = '${J}') WHERE id = '${J}'`);
  return J;
}
const claimOf = async (jid) => (await owner(`SELECT claimed_by FROM public.job_refund_claims WHERE job_id = '${jid}'`))[0]?.claimed_by ?? null;

// ─── C1 closed for review, the claim taken, once ────────────────────────────
const C1 = await capturedBooking(B);
const c1a = await as("service_role", null, `SELECT public.instant_book_captured_not_hired('${C1}', '${B}') AS r`);
const c1b = await as("service_role", null, `SELECT public.instant_book_captured_not_hired('${C1}', '${B}') AS r`);
const r1 = await jobRow(C1);
const p1 = await notes(P, C1);
const h1 = await notes(B, C1);
check("C1 captured, not hired: true once; job cancelled + 'cancelling' + holder 'instant_book_refund'; poster told once \"refunding your payment in full\", Helpr once",
  ok(c1a) && c1a[0].r === true && ok(c1b) && c1b[0].r === false
    && r1.status === "cancelled" && r1.payment_status === "cancelling" && r1.offered_to_helper_id === null
    && (await claimOf(C1)) === "instant_book_refund"
    && ok(p1) && p1.filter((x) => x.title === "Your payment is being refunded" && /refunding your payment in full/.test(x.message)).length === 1
    && p1.filter((x) => x.title !== "Booked").length === 1 && !notCharged(p1)
    && ok(h1) && h1.filter((x) => x.title === "Your booking ended").length === 1 && !h1.some((x) => x.title === "Booking cancelled"),
  err(c1a) || JSON.stringify({ c1b, r1, p1, h1 }));

// ─── C2 nobody can be hired on it ───────────────────────────────────────────
const listed = await owner(`SELECT public.job_payment_is_listed(payment_status) AS l FROM public.jobs WHERE id = '${C1}'`);
const blockB = await owner(`SELECT public.direct_accept_block_reason('${C1}', '${B}') AS r`);
const blockA = await owner(`SELECT public.direct_accept_block_reason('${C1}', '${A}') AS r`);
const acc = await as("authenticated", B, `SELECT public.respond_to_direct_offer('${C1}', true)`);
const rebook = await as("authenticated", P, `SELECT public.rpc_instant_book('${C1}', '${A}')`);
check("C2 no hire possible: not listed, direct_accept_block_reason refuses both Helprs, the accept and a new booking are refused",
  ok(listed) && listed[0].l === false && ok(blockB) && blockB[0].r != null && ok(blockA) && blockA[0].r != null
    && !!err(acc) && !!err(rebook) && (await jobRow(C1)).status === "cancelled",
  JSON.stringify({ listed, blockB, blockA, acc: err(acc), rebook: err(rebook) }));

// ─── C3 no other refund path can take this money ───────────────────────────
// void-cancelled-payments Part A: status 'cancelled' AND payment_status 'escrow'.
const voidSel = await owner(`SELECT id FROM public.jobs WHERE id = '${C1}' AND status = 'cancelled' AND payment_status = 'escrow'`);
// admin_refund_general / cancel_escrow's first claim: from 'escrow' only.
const adminClaim = await owner(`UPDATE public.jobs SET payment_status = 'cancelling' WHERE id = '${C1}' AND payment_status = 'escrow' RETURNING id`);
// cancel_escrow's allowlist: open, nobody hired; its re-entry: holder cancel_escrow.
const cancelAllow = await owner(`SELECT id FROM public.jobs WHERE id = '${C1}' AND status = 'open' AND helper_id IS NULL`);
const reentry = await owner(`SELECT job_id FROM public.job_refund_claims WHERE job_id = '${C1}' AND claimed_by = 'cancel_escrow'`);
check("C3 no second refund path matches: void-cancelled select, the escrow claim, cancel_escrow's open allowlist and its re-entry all miss",
  ok(voidSel) && voidSel.length === 0 && ok(adminClaim) && adminClaim.length === 0 && ok(cancelAllow) && cancelAllow.length === 0
    && ok(reentry) && reentry.length === 0,
  JSON.stringify({ voidSel, adminClaim, cancelAllow, reentry }));

// ─── C4 the refund went out: closed once ───────────────────────────────────
const f1 = await as("service_role", null, `SELECT public.instant_book_refund_finished('${C1}') AS r`);
const f2 = await as("service_role", null, `SELECT public.instant_book_refund_finished('${C1}') AS r`);
const r4 = await jobRow(C1);
check("C4 instant_book_refund_finished: true once then false; the job reads refunded, the claim is gone",
  ok(f1) && f1[0].r === true && ok(f2) && f2[0].r === false && r4.payment_status === "refunded" && r4.status === "cancelled"
    && (await claimOf(C1)) === null,
  err(f1) || JSON.stringify({ f2, r4 }));

// ─── C5 the webhook wrote 'refunded' first ─────────────────────────────────
const C5 = await capturedBooking(A);
await as("service_role", null, `SELECT public.instant_book_captured_not_hired('${C5}', '${A}')`);
await setup(`UPDATE public.jobs SET payment_status = 'refunded' WHERE id = '${C5}' AND payment_status = 'cancelling'`); // chargeRefunded's flip
const f5 = await as("service_role", null, `SELECT public.instant_book_refund_finished('${C5}') AS r`);
const f5b = await as("service_role", null, `SELECT public.instant_book_refund_finished('${C5}') AS r`);
check("C5 webhook first: finished still closes the claim once and leaves 'refunded'",
  ok(f5) && f5[0].r === true && ok(f5b) && f5b[0].r === false && (await jobRow(C5)).payment_status === "refunded" && (await claimOf(C5)) === null,
  err(f5) || JSON.stringify(f5b));

// ─── C6 not the hold's money ───────────────────────────────────────────────
const C6 = await bookedJob(A, { pay: "escrow", hold: null });
await setup(`UPDATE public.jobs SET stripe_payment_intent_id = 'pi_paid_at_post' WHERE id = '${C6}'`);
const c6 = await as("service_role", null, `SELECT public.instant_book_captured_not_hired('${C6}', '${A}') AS r`);
const r6 = await jobRow(C6);
const p6 = await notes(P, C6);
check("C6 paid at post (no hold row): no review state, no claim; the old \"being returned\" words",
  ok(c6) && c6[0].r === true && r6.status === "open" && r6.payment_status === "escrow" && (await claimOf(C6)) === null
    && ok(p6) && p6.some((x) => x.title === "Your payment is being returned") && !p6.some((x) => /in full/.test(x.message)),
  err(c6) || JSON.stringify({ r6, p6 }));

// ─── C7 server-only, and only its own claim ────────────────────────────────
const m7 = await as("authenticated", P, `SELECT public.instant_book_refund_finished('${C1}')`);
const C7 = await capturedBooking(B);
await setup(`UPDATE public.jobs SET payment_status = 'cancelling' WHERE id = '${C7}';
  INSERT INTO public.job_refund_claims (job_id, claimed_by) VALUES ('${C7}', 'cancel_escrow')`);
const f7 = await as("service_role", null, `SELECT public.instant_book_refund_finished('${C7}') AS r`);
check("C7 a member is refused; a job under cancel_escrow's claim is left alone",
  /permission denied/.test(err(m7)) && ok(f7) && f7[0].r === false && (await claimOf(C7)) === "cancel_escrow"
    && (await jobRow(C7)).payment_status === "cancelling",
  [err(m7), JSON.stringify(f7)].join(" | "));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
