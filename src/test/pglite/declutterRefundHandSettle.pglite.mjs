#!/usr/bin/env node
/**
 * PGlite proof for 20261017052700_declutter_refund_hand_settle (lh-money-escrow
 * should-fixes (a) and (b), docs/specs/declutter-auctions.md "Open after
 * slice 4"):
 *   (a) a Declutter refund that gives up (12 tries) raises a durable ops-ledger
 *       alert (an error_logs row, once per row per day) and tells the buyer
 *       once, in plain words, that the refund is being sent by hand;
 *   (b) a refund made by hand in the Stripe Dashboard is recorded against the
 *       order, idempotently, settles the refund row it covers, and moves no money.
 *
 *   node src/test/pglite/declutterRefundHandSettle.pglite.mjs                       # all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/declutterRefundHandSettle.pglite.mjs    # RED: the migration absent
 *
 * On top of slices 1-4 (scripts/declutter/slice3Harness.mjs); the migration is
 * applied 3 times (replay-safety). pglite is not a dependency (CLAUDE.md):
 * loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { setupStatements, liveItemSql, CARDS_SQL, USERS, FEE_F1_FILE, SLICE4_FILE } from "../../../scripts/declutter/slice3Harness.mjs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const { SELLER, BUYER, BUYER2, SELLER3 } = USERS;
const NEW_FILE = "20261017052700_declutter_refund_hand_settle.sql";
const skip = process.env.NEW_MIGRATION === "skip";

const db = new PGlite();
// Live columns the migration writes (error_logs: severity, message, tags, context; the ledger trigger is not part of this proof).
await db.exec(`CREATE TABLE public.error_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), severity text, message text,
  tags jsonb, context jsonb, url text, user_id uuid, created_at timestamptz NOT NULL DEFAULT now());`);
const extra = [{ file: FEE_F1_FILE, times: 1 }, { file: SLICE4_FILE, times: 1 }];
if (!skip) extra.push({ file: NEW_FILE, times: 3 });
for (const sql of setupStatements({ times: 1, times3b: 1, extra })) await db.exec(sql);
await db.exec(CARDS_SQL);

let pass = 0;
let fail = 0;
const ok = (cond, label) => { if (cond) pass++; else fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const svc = async (sql) => { try { return (await db.query(sql)).rows; } catch (e) { return { error: String(e.message ?? e), code: e.code }; } };
async function me(uid, sql) {
  try {
    await db.exec(`SET request.jwt.claim.sub = '${uid}'; SET ROLE authenticated;`);
    return (await db.query(sql)).rows;
  } catch (e) {
    return { error: String(e.message ?? e), code: e.code };
  } finally {
    await db.exec(`RESET ROLE; RESET request.jwt.claim.sub;`);
  }
}
const one = (r) => (Array.isArray(r) && r[0] ? Object.values(r[0])[0] : undefined);
const refused = (r, re) => !Array.isArray(r) && re.test(r.error);
const I = (n) => `66666666-0000-0000-0000-${String(n).padStart(12, "0")}`;

/** A paid order: one item at `price`, bought, checked out, paid on PaymentIntent pi_hs_<n>. */
async function paidOrder(n, buyer, seller, price) {
  await db.exec(liveItemSql({ id: I(n), seller, title: `Hand settle item ${n}`, price, floor: Math.min(price, 100) }));
  await me(buyer, `SELECT public.declutter_buy_now('${I(n)}', ${price})`);
  const o = (await me(buyer, `SELECT * FROM public.declutter_start_checkout('${seller}', 'pickup_home')`))[0];
  await svc(`SELECT public.declutter_mark_order_paid('${o?.order_id}', 'pi_hs_${n}', ${o?.total_cents}, now(), 150)`);
  return o ?? {};
}
/** A refund row for order `o` (seller backed out: full refund), with `attempts` tries used and the given status. */
async function refundRow(o, n, attempts, status, ref = null) {
  const id = one(await svc(`SELECT public.declutter_record_refund('${o.order_id}', 'pi_hs_${n}', 'seller_backed_out', ${o.total_cents}, 150)`));
  await svc(`UPDATE public.declutter_refunds SET attempts = ${attempts}, status = '${status}', stripe_refund_ref = ${ref ? `'${ref}'` : "NULL"} WHERE id = '${id}'`);
  return id;
}
const alerts = async (id) => one(await svc(`SELECT count(*)::int FROM public.error_logs
  WHERE tags ->> 'source' = 'declutter-refund-gave-up' AND tags ->> 'refund_id' = '${id}'`));
const notices = async (uid, title) => one(await svc(`SELECT count(*)::int FROM public.notifications WHERE user_id = '${uid}' AND title = '${title}'`));
const BY_HAND = "Your refund is being sent by hand";

// ---------------------------------------------------------------------------
// (a) Gave up: the 12th failed try raises the alert and tells the buyer.
const A = await paidOrder(1, BUYER, SELLER, 4000);
ok(typeof A.order_id === "string", "setup: order A paid");
const rA = await refundRow(A, 1, 10, "failed");
await svc(`SELECT public.declutter_refund_executed('${rA}', NULL, false)`);
ok(await alerts(rA) === 0, "the 11th failed try is not an alert yet (the queue still retries it)");
ok(await notices(BUYER, BY_HAND) === 0, "the 11th failed try does not tell the buyer anything new");
await svc(`SELECT public.declutter_refund_executed('${rA}', NULL, false)`);
ok(one(await svc(`SELECT attempts FROM public.declutter_refunds WHERE id = '${rA}'`)) === 12, "setup: 12 tries used");
ok(await alerts(rA) === 1, "the 12th failed try writes one gave-up alert row (error_logs -> ops ledger)");
const alertRow = (await svc(`SELECT severity, message, tags FROM public.error_logs WHERE tags ->> 'refund_id' = '${rA}'`))[0] ?? {};
ok(alertRow.severity === "error" && /^Declutter refund gave up after 12 tries: refund it by hand in Stripe — /.test(alertRow.message ?? ""),
  `the alert says what to do, and its ledger title (before ' — ') is the same for every gave-up refund: ${alertRow.message}`);
ok(alertRow.tags?.seed === undefined, "a real buyer's refund is not marked seed (it reaches the ledger, not only the digest)");
ok(await notices(BUYER, BY_HAND) === 1, "the buyer is told, once, that the refund is being sent by hand");
const msg = one(await svc(`SELECT message FROM public.notifications WHERE user_id = '${BUYER}' AND title = '${BY_HAND}'`)) ?? "";
ok(/our team is sending it by hand/.test(msg) && /You do not need to do anything/.test(msg) && /\$40\.00|\$4\d\.\d\d/.test(msg),
  `plain words with the amount: ${msg}`);
ok(one(await svc(`SELECT public.declutter_refund_gave_up_check()`)) === 1, "the sweep counts the one gave-up row");
ok(await alerts(rA) === 1, "a second check the same day writes no second alert row (one per row per day)");
ok(await notices(BUYER, BY_HAND) === 1, "a second check never tells the buyer twice");
await svc(`UPDATE public.error_logs SET created_at = now() - interval '1 day' WHERE tags ->> 'refund_id' = '${rA}'`);
await svc(`SELECT public.declutter_refund_gave_up_check()`);
ok(await alerts(rA) === 2, "the next day, a refund still not settled raises the alert again (the ledger item re-opens)");
ok(await notices(BUYER, BY_HAND) === 1, "...but the buyer is still told only once");
ok(one(await svc(`SELECT count(*)::int FROM public.declutter_refunds_due(50) WHERE refund_id = '${rA}'`)) === 0,
  "a gave-up row is still not offered to the money cron (the 12-try cap is unchanged)");

// Reversal path: Stripe moves the row's recorded refund to failed on its 12th try.
const B = await paidOrder(2, BUYER2, SELLER, 3000);
const rB = await refundRow(B, 2, 11, "succeeded", "re_hs_b");
ok(one(await svc(`SELECT public.declutter_refund_reversed('${rB}', 're_hs_b', 'failed: lost_or_stolen_card')`)) === "gave_up",
  "a reversal that uses the 12th try answers gave_up");
ok(await alerts(rB) === 1 && await notices(BUYER2, BY_HAND) === 1, "...and raises the alert and tells the buyer");

// A seed buyer's refund is marked seed (the digest, not the ledger).
const C = await paidOrder(3, BUYER, SELLER3, 2500);
const rC = await refundRow(C, 3, 12, "failed");
await svc(`UPDATE public.declutter_refunds SET is_seed = true WHERE id = '${rC}'`);
await svc(`SELECT public.declutter_refund_gave_up_check('${rC}')`);
ok(one(await svc(`SELECT tags ->> 'seed' FROM public.error_logs WHERE tags ->> 'refund_id' = '${rC}'`)) === "true",
  "a seed refund's alert is marked seed (error_log_is_seed sends it to the digest)");

// Q1159: anon and authenticated may INSERT error_logs, so a forged client row
// tagged with this source and refund id must not mute today's page.
const F = await paidOrder(9, BUYER2, SELLER3, 2200);
const rF = await refundRow(F, 9, 12, "failed");
await svc(`INSERT INTO public.error_logs (severity, message, tags) VALUES ('error', 'forged',
  jsonb_build_object('source', 'declutter-refund-gave-up', 'refund_id', '${rF}', 'origin', 'client'))`);
await svc(`SELECT public.declutter_refund_gave_up_check('${rF}')`);
ok(one(await svc(`SELECT count(*)::int FROM public.error_logs WHERE tags ->> 'refund_id' = '${rF}'
  AND coalesce(tags ->> 'origin', '') <> 'client'`)) === 1,
  "a forged client row with the same source and refund id does not mute the gave-up alert");

// ---------------------------------------------------------------------------
// (b) A refund made by hand in the Stripe Dashboard.
const owed = one(await svc(`SELECT refund_cents FROM public.declutter_refunds WHERE id = '${rA}'`));
ok(one(await svc(`SELECT public.declutter_record_hand_refund('pi_hs_1', 're_hand_part', 100, true)`)) === "recorded_short",
  "a hand refund for LESS than the row owes is recorded (recorded_short), never settles the row");
ok(one(await svc(`SELECT status FROM public.declutter_refunds WHERE id = '${rA}'`)) === "failed", "...the row stays failed");
ok(one(await svc(`SELECT public.declutter_record_hand_refund('pi_hs_1', 're_hand_a', ${owed - 100}, true)`)) === "settled",
  "a second partial hand refund that, with the first, covers what the row owes settles it (live hand refunds are summed)");
const settled = (await svc(`SELECT status, stripe_refund_ref, attempts FROM public.declutter_refunds WHERE id = '${rA}'`))[0] ?? {};
ok(settled.status === "succeeded" && settled.stripe_refund_ref === "re_hand_a", `...the row is succeeded, keyed on the hand refund: ${JSON.stringify(settled)}`);
ok(one(await svc(`SELECT count(*)::int FROM public.declutter_hand_refunds WHERE refund_row_id = '${rA}'`)) === 2,
  "both hand refunds are in the books, each once");
ok(await notices(BUYER, "Refund on its way") >= 1, "the buyer is told the refund is on its way");
ok(one(await svc(`SELECT public.declutter_record_hand_refund('pi_hs_1', 're_hand_a', ${owed - 100}, true)`)) === "already",
  "a redelivered event is 'already' (idempotent per Stripe refund id)");
ok(one(await svc(`SELECT count(*)::int FROM public.declutter_hand_refunds WHERE stripe_refund_id = 're_hand_a'`)) === 1, "...and adds no row");
ok(one(await svc(`SELECT public.declutter_refund_gave_up_check('${rA}')`)) === 0, "a settled row is no longer a gave-up alert (the ledger item can close)");
ok(one(await svc(`SELECT public.declutter_record_hand_refund('pi_hs_1', 're_hand_b', ${owed}, true)`)) === "recorded_row_already_settled",
  "a hand refund on a row already settled says so (the buyer may have been refunded twice), and settles nothing");

// Stripe fails a hand refund after we recorded it (charge.refund.updated): the row it settled reopens.
ok(one(await svc(`SELECT public.declutter_hand_refund_failed('re_hand_b', 'failed')`)) === "recorded_failed"
  && one(await svc(`SELECT status FROM public.declutter_refunds WHERE id = '${rA}'`)) === "succeeded",
  "the extra hand refund failing changes nothing: the other two still cover the row");
const byHandBefore = await notices(BUYER, BY_HAND);
ok(one(await svc(`SELECT public.declutter_hand_refund_failed('re_hand_a', 'failed: lost_or_stolen_card')`)) === "reopened",
  "a hand refund Stripe failed reopens the row it settled");
const reo = (await svc(`SELECT status, attempts, gave_up_notified_at FROM public.declutter_refunds WHERE id = '${rA}'`))[0] ?? {};
ok(reo.status === "failed" && reo.attempts === 12, `...back to failed, tries unchanged (still past the cap): ${JSON.stringify(reo)}`);
ok(await notices(BUYER, BY_HAND) === byHandBefore + 1, "...and the buyer is told again that it is being sent by hand (the gave-up notice re-armed)");
ok(one(await svc(`SELECT count(*)::int FROM public.error_logs WHERE tags ->> 'refund_id' = '${rA}' AND created_at > date_trunc('day', now())`)) === 1,
  "...and the gave-up alert is raised again today");
ok(one(await svc(`SELECT public.declutter_hand_refund_failed('re_hand_a', 'failed')`)) === "already", "a redelivered failure is 'already'");
ok(one(await svc(`SELECT public.declutter_hand_refund_failed('re_hand_part', 'failed')`)) === "recorded_failed",
  "a failed hand refund that settled nothing is recorded as failed, nothing else changes");
ok(one(await svc(`SELECT public.declutter_hand_refund_failed('re_unknown', 'failed')`)) === "not_declutter", "an unknown refund is not_declutter");
// Two partial hand refunds settle a row, then the FIRST (not the one the row names) fails: the row reopens.
const G = await paidOrder(6, BUYER2, SELLER, 2600);
const rG = await refundRow(G, 6, 12, "failed");
const owedG = one(await svc(`SELECT refund_cents FROM public.declutter_refunds WHERE id = '${rG}'`));
await svc(`SELECT public.declutter_record_hand_refund('pi_hs_6', 're_g1', 1000, true)`);
ok(one(await svc(`SELECT public.declutter_record_hand_refund('pi_hs_6', 're_g2', ${owedG - 1000}, true)`)) === "settled", "setup: two partials settle row G");
ok(one(await svc(`SELECT public.declutter_hand_refund_failed('re_g1', 'failed')`)) === "reopened"
  && one(await svc(`SELECT status FROM public.declutter_refunds WHERE id = '${rG}'`)) === "failed",
  "the EARLIER partial failing leaves the live hand refunds short: the row reopens");
// An overpaid row stays settled when one hand refund fails but the rest still cover it.
const H = await paidOrder(7, BUYER2, SELLER, 2600);
const rH = await refundRow(H, 7, 12, "failed");
const owedH = one(await svc(`SELECT refund_cents FROM public.declutter_refunds WHERE id = '${rH}'`));
await svc(`SELECT public.declutter_record_hand_refund('pi_hs_7', 're_h1', ${owedH}, true)`);
await svc(`SELECT public.declutter_record_hand_refund('pi_hs_7', 're_h2', 100, true)`);
ok(one(await svc(`SELECT public.declutter_hand_refund_failed('re_h2', 'failed')`)) === "recorded_failed"
  && one(await svc(`SELECT status FROM public.declutter_refunds WHERE id = '${rH}'`)) === "succeeded",
  "a failed extra hand refund on a row the others still cover leaves it settled");

// A row still under the cap: reopened, retried by the cron, and the buyer told it did not go through.
const E = await paidOrder(5, BUYER2, SELLER, 2200);
const rE = await refundRow(E, 5, 3, "failed");
const owedE = one(await svc(`SELECT refund_cents FROM public.declutter_refunds WHERE id = '${rE}'`));
ok(one(await svc(`SELECT public.declutter_record_hand_refund('pi_hs_5', 're_hand_e', ${owedE}, true)`)) === "settled", "setup: a row under the cap settled by hand");
ok(one(await svc(`SELECT public.declutter_hand_refund_failed('re_hand_e', 'canceled')`)) === "reopened"
  && await notices(BUYER2, "Your refund did not go through") === 1
  && one(await svc(`SELECT count(*)::int FROM public.declutter_refunds_due(50) WHERE refund_id = '${rE}'`)) === 1,
  "a failed hand refund on a row under the cap: the cron is offered it again and the buyer is told plainly");

const D = await paidOrder(4, BUYER2, SELLER, 2000);
ok(one(await svc(`SELECT public.declutter_record_hand_refund('pi_hs_4', 're_hand_d', 500, false)`)) === "recorded_no_row",
  "a hand refund on a paid order with no refund row is recorded against the order");
ok(one(await svc(`SELECT order_id FROM public.declutter_hand_refunds WHERE stripe_refund_id = 're_hand_d'`)) === D.order_id
  && one(await svc(`SELECT livemode FROM public.declutter_hand_refunds WHERE stripe_refund_id = 're_hand_d'`)) === false,
  "...against that order, in its mode");
ok(one(await svc(`SELECT status FROM public.declutter_orders WHERE id = '${D.order_id}'`)) === "paid",
  "...and changes no order or money state (the payout cron refuses a refunded charge on its own)");
ok(one(await svc(`SELECT public.declutter_record_hand_refund('pi_not_ours', 're_hand_x', 500, true)`)) === "not_declutter"
  && one(await svc(`SELECT count(*)::int FROM public.declutter_hand_refunds WHERE stripe_refund_id = 're_hand_x'`)) === 0,
  "a payment no Declutter order or refund knows is not_declutter and records nothing");
ok(refused(await svc(`SELECT public.declutter_record_hand_refund('pi_hs_4', 're_bad', 0, true)`), /invalid_hand_refund/),
  "a zero amount is refused");

// Service only.
for (const [label, sql] of [
  ["declutter_record_hand_refund", `SELECT public.declutter_record_hand_refund('pi_hs_4', 're_m', 100, true)`],
  ["declutter_refund_gave_up_check", `SELECT public.declutter_refund_gave_up_check()`],
  ["declutter_hand_refund_failed", `SELECT public.declutter_hand_refund_failed('re_hand_d', 'x')`],
  ["declutter_hand_refunds (read)", `SELECT * FROM public.declutter_hand_refunds`],
]) {
  ok(refused(await me(BUYER, sql), /permission denied/), `a member cannot use ${label}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
