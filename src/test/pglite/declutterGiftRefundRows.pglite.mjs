#!/usr/bin/env node
/**
 * Q2106 S3b step 1 (PGlite proof for 20261105042758_declutter_gift_refund_rows): a refund row carries its gift share.
 *   (1) a card refund row is unchanged (gift_refund_cents defaults to 0);
 *   (2) a gift-only row with NO payment intent is allowed when all of it goes to the gift balance, once per order;
 *   (3) a row with no payment intent and any card part is refused; a gift share above the refund or below 0 is refused;
 *   (4) a mixed row (PI + gift share) is allowed; the file replays 3x.
 *   (5) step 3: declutter_refunds_due hands declutter-money the CARD part as refund_cents (refund - gift share, decided
 *       in SQL) and the gift share apart; a gift-only row is offered with no payment intent and a card part of 0.
 *   node src/test/pglite/declutterGiftRefundRows.pglite.mjs                     # all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/declutterGiftRefundRows.pglite.mjs  # RED (2), (4), (5)
 * Real: the table as created by 20261014224914 (its CREATE TABLE statement, run verbatim) and every later ALTER of
 * declutter_refunds is NOT replayed: the constraints this proof reads are only the original ones plus this file's.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const skip = process.env.NEW_MIGRATION === "skip";
let failures = 0;
const check = (ok, name, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  (${detail})` : ""}`); if (!ok) failures++; };

const base = readFileSync(MIG_DIR + "20261014224914_declutter_slice3b_payments.sql", "utf8");
const create = /CREATE TABLE IF NOT EXISTS public\.declutter_refunds \([\s\S]*?\n\);/.exec(base)[0];
const db = new PGlite();
await db.exec(`CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY, buyer_id uuid, seller_id uuid, stripe_checkout_session_id text);
  ${create}
  -- Stubs the queue (a LANGUAGE sql body, resolved at CREATE) reads; columns later migrations added.
  ALTER TABLE public.declutter_refunds ADD COLUMN IF NOT EXISTS payment_livemode boolean,
    ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now();
  CREATE TABLE public.declutter_payouts (id uuid PRIMARY KEY, order_id uuid, seller_id uuid, status text);
  CREATE TABLE public.payout_payee_waits (payout_kind text, payout_id uuid, category text);
  CREATE TABLE public.payout_holds (helper_id uuid);
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;`);
// Later migrations widened reason/fee_policy; the proof uses values the original allows.
if (!skip) {
  const mig = readFileSync(MIG_DIR + "20261105042758_declutter_gift_refund_rows.sql", "utf8");
  for (let i = 0; i < 3; i++) await db.exec(mig);
}
const O1 = "00000000-0000-4000-8000-000000000001";
const O2 = "00000000-0000-4000-8000-000000000002";
await db.exec(`INSERT INTO public.declutter_orders VALUES ('${O1}'), ('${O2}')`);
const ins = async (cols, vals) => {
  try { await db.query(`INSERT INTO public.declutter_refunds (order_id, reason, fee_policy, paid_cents, card_fee_cents, refund_cents${cols}) VALUES (${vals})`); return "ok"; }
  catch (e) { return String(e.message).slice(0, 120); }
};
check(await ins(", stripe_payment_intent_id", `'${O1}', 'order_closed', 'full_platform_absorbs', 1000, 59, 1000, 'pi_card1'`) === "ok", "(1) a card refund row as before");
const g = skip ? null : (await db.query(`SELECT gift_refund_cents FROM public.declutter_refunds WHERE stripe_payment_intent_id = 'pi_card1'`)).rows[0]?.gift_refund_cents;
check(g === 0, "(1) its gift share defaults to 0", String(g));
check(await ins(", gift_refund_cents", `'${O2}', 'order_closed', 'full_platform_absorbs', 1000, 0, 1000, 1000`) === "ok", "(2) a gift-only row with no payment intent");
check(await ins(", gift_refund_cents", `'${O2}', 'order_closed', 'full_platform_absorbs', 1000, 0, 1000, 1000`) !== "ok", "(2) a second one for the same order is refused");
check(await ins(", gift_refund_cents", `'${O1}', 'order_closed', 'full_platform_absorbs', 1000, 0, 1000, 400`) !== "ok", "(3) no payment intent with a card part is refused");
check(await ins("", `'${O1}', 'order_closed', 'full_platform_absorbs', 1000, 0, 1000`) !== "ok", "(3) no payment intent and no gift share is refused");
check(await ins(", stripe_payment_intent_id, gift_refund_cents", `'${O1}', 'order_closed', 'full_platform_absorbs', 1000, 30, 1000, 'pi_mix1', 1001`) !== "ok", "(3) a gift share above the refund is refused");
check(await ins(", stripe_payment_intent_id, gift_refund_cents", `'${O1}', 'order_closed', 'full_platform_absorbs', 1000, 30, 1000, 'pi_mix2', -1`) !== "ok", "(3) a negative gift share is refused");
check(await ins(", stripe_payment_intent_id, gift_refund_cents", `'${O1}', 'order_closed', 'full_platform_absorbs', 1000, 30, 1000, 'pi_mix3', 600`) === "ok", "(4) a mixed row (card 400 + gift 600)");
// (5) the queue. Every row due (created 3 minutes ago).
await db.exec(`UPDATE public.declutter_refunds SET created_at = now() - interval '3 minutes', next_attempt_at = now() - interval '1 minute'`);
let due = [];
try { due = (await db.query(`SELECT * FROM public.declutter_refunds_due(50)`)).rows; } catch (e) { due = String(e.message); }
const byPi = (pi) => Array.isArray(due) ? due.find((r) => r.payment_intent_id === pi) : undefined;
const giftOnly = Array.isArray(due) ? due.find((r) => r.payment_intent_id === null) : undefined;
check(byPi("pi_card1")?.refund_cents === 1000 && byPi("pi_card1")?.gift_refund_cents === 0, "(5) the card row: 1000 to the card, no gift share", JSON.stringify(byPi("pi_card1") ?? due));
check(byPi("pi_mix3")?.refund_cents === 400 && byPi("pi_mix3")?.gift_refund_cents === 600, "(5) the mixed row: 400 to the card (decided in SQL), 600 to the gift balance", JSON.stringify(byPi("pi_mix3") ?? due));
check(giftOnly?.refund_cents === 0 && giftOnly?.gift_refund_cents === 1000 && giftOnly?.order_id === O2, "(5) the gift-only row: no payment intent, 0 to the card, 1000 to the gift balance", JSON.stringify(giftOnly ?? due));
// The order can still be deleted (ON DELETE SET NULL): the gift-only row keeps its money record.
let del = "ok";
try { await db.exec(`DELETE FROM public.declutter_orders WHERE id = '${O2}'`); } catch (e) { del = String(e.message); }
check(skip || del === "ok", "(4) deleting an order with a gift-only refund still works", del);
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
