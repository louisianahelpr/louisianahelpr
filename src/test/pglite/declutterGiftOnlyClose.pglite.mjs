#!/usr/bin/env node
/**
 * Q?giftclose (PGlite proof for 20261118002340_declutter_gift_only_close_and_refund): a Declutter order the buyer's gift
 * card paid IN FULL (no payment intent, gift_cents > 0) can be cancelled and refunded, the gift goes back exactly once,
 * and a mixed card + gift order refunds each part to its source.
 *   (1) declutter_close_paid_order closes a gift-only order as the buyer's no-show (it raised order_not_paid): one refund
 *       row, no payment intent, all of it gift (the buyer's fee kept, as on a card order); the item is back on sale;
 *   (2) the cron's restore (restore_gift_card_for_declutter_order under the row's key, as declutter-money calls it) gives
 *       the gift back once; a retry answers already_restored and credits nothing;
 *   (3) DOUBLE CANCEL: a second close of the same order raises order_not_paid, writes no second row, sends no second
 *       notice; a second gift-only refund row for the order is refused by the unique index;
 *   (4) a seller no-show on a gift-only order gives every cent back to the gift balance, and the notice says so;
 *   (5) a mixed order (card 400 + gift 600): the gift goes back whole (600), the card the rest less the card fee;
 *   (6) an order with NO payment intent and NO gift is still refused (order_not_paid);
 *   (7) declutter_no_helpr_refusal lets a gift-only no-Helpr order be cancelled (it answered order_not_paid);
 *   (8) declutter_refund_after_handover: a gift-only agreed part refund is all gift (it broke the no-card CHECK); a
 *       second refund is refused (already_refunded, found by order); a mixed part splits proportionally; a gift-only full
 *       refund is all gift; the buyer notice names the gift balance;
 *   the file replays 3x.
 *   node src/test/pglite/declutterGiftOnlyClose.pglite.mjs                     # all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/declutterGiftOnlyClose.pglite.mjs  # RED
 * Real, run verbatim: declutter_refunds' CREATE TABLE (20261014224914), declutter_delivery_refunds' (20261017055505),
 * declutter_order_gift_net_cents + declutter_refund_gift_split + restore_gift_card_for_declutter_order (20261105030604),
 * the newest declutter_refunds_amount (20261026155251) and declutter_refunds_policy (20261103203204) CHECKs,
 * declutter_card_fee_left (20261102040952), declutter_card_fee_estimate (20261014224914), declutter_refund_answer
 * (20261015042253), the whole migrations 20261105042758 (declutter_record_refund, gift columns) and 20261105052751
 * (declutter_close_paid_order, declutter_refund_notice_names_gift), and with skip off this file's migration. Without
 * it, the NEWEST definitions before it: declutter_no_helpr_refusal (20261031133938) and declutter_refund_after_handover
 * (20261109224952). Stubs: the tables these read, declutter_notify (records the notice), declutter_give_strike,
 * declutter_seller_out (false), the reserved-cents readers (0), declutter_lock_order, declutter_payout_unsent (true),
 * declutter_rebook_payout, log_cron_defect.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261118002340_declutter_gift_only_close_and_refund.sql";
const skip = process.env.NEW_MIGRATION === "skip";
let failures = 0;
const check = (ok, name, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  (${detail})` : ""}`); if (!ok) failures++; };
const read = (f) => readFileSync(MIG_DIR + f, "utf8");
/** One function's CREATE ... <tag>; statement from a migration file (last match wins), any dollar tag. */
const fnFrom = (file, name) => {
  const src = read(file);
  const re = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\nAS (\\$\\w*\\$)[\\s\\S]*?\\n\\1\\s*;`, "g");
  const all = src.match(re);
  if (!all) throw new Error(`${name} not found in ${file}`);
  return all[all.length - 1];
};

const createRefunds = /CREATE TABLE IF NOT EXISTS public\.declutter_refunds \([\s\S]*?\n\);/.exec(read("20261014224914_declutter_slice3b_payments.sql"))[0];
const createDelivery = /CREATE TABLE IF NOT EXISTS public\.declutter_delivery_refunds \([\s\S]*?\n\);/.exec(read("20261017055505_declutter_helpr_delivery.sql"))[0];
/** The newest CHECK of a table constraint, verbatim (its ADD CONSTRAINT ... ; statement). */
const checkFrom = (file, name) => {
  const m = new RegExp(`ALTER TABLE public\\.declutter_refunds ADD CONSTRAINT ${name} CHECK \\([\\s\\S]*?\\);\\n`).exec(read(file));
  if (!m) throw new Error(`${name} not found in ${file}`);
  return `ALTER TABLE public.declutter_refunds DROP CONSTRAINT IF EXISTS ${name}; ${m[0]}`;
};
const db = new PGlite();
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY, buyer_id uuid, seller_id uuid, stripe_checkout_session_id text,
    stripe_payment_intent_id text, setup_fee_state text, setup_fee_cents integer NOT NULL DEFAULT 0,
    items_cents integer NOT NULL DEFAULT 0, premium_cents integer NOT NULL DEFAULT 0, tax_cents integer NOT NULL DEFAULT 0,
    total_cents integer NOT NULL DEFAULT 0, delivery_cents integer NOT NULL DEFAULT 0, shipping_cents integer NOT NULL DEFAULT 0,
    card_fee_cents integer, gift_cents integer NOT NULL DEFAULT 0, gift_card_id uuid, handover text, status text,
    close_reason text, closed_at timestamptz, paid_with text NOT NULL DEFAULT 'card');
  CREATE TABLE public.gift_cards (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), donor_id uuid, recipient_id uuid, recipient_email text,
    amount numeric NOT NULL, status text NOT NULL, payment_status text, category text, message text, occasion text, design_id text,
    parent_credit_id uuid, declutter_order_id uuid, restored_from_declutter_order_id uuid, restored_declutter_refund_key text,
    expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
  CREATE UNIQUE INDEX gift_cards_restored_declutter_refund_key_key ON public.gift_cards (restored_declutter_refund_key);
  CREATE TABLE public.declutter_items (id uuid PRIMARY KEY, title text, status text, updated_at timestamptz);
  CREATE TABLE public.declutter_cart_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid, order_id uuid, status text, closed_at timestamptz);
  CREATE TABLE public.helpr_tasks (id uuid PRIMARY KEY, status text, helpr_id uuid, source_kind text, source_id uuid);
  CREATE TABLE public.declutter_order_deliveries (order_id uuid, task_id uuid);
  CREATE TABLE public.declutter_problems (order_id uuid, status text);
  CREATE TABLE public.declutter_bookings (order_id uuid, slot_start timestamptz);
  CREATE TABLE public.declutter_handovers (order_id uuid, seller_confirmed_at timestamptz, picked_up_at timestamptz, confirmed_at timestamptz);
  CREATE TABLE public.shipments (id uuid, declutter_order_id uuid, label_state text, label_mode text, accepted_at timestamptz);
  CREATE TABLE public.notes (user_id uuid, title text, body text);
  CREATE TABLE public.strikes (user_id uuid, side text);
  CREATE TABLE public.declutter_seller_fee_debts (seller_id uuid, refund_id uuid UNIQUE, amount_cents integer, remaining_cents integer, fee_estimated boolean);
  CREATE TABLE public.declutter_payouts (id uuid PRIMARY KEY, order_id uuid, seller_id uuid, status text);
  CREATE TABLE public.payout_payee_waits (payout_kind text, payout_id uuid, category text);
  CREATE TABLE public.payout_holds (helper_id uuid);
  CREATE FUNCTION public.declutter_notify(p_user uuid, p_kind text, p_title text, p_body text, p_link text, p_from uuid)
    RETURNS void LANGUAGE sql AS $$ INSERT INTO public.notes VALUES (p_user, p_title, p_body) $$;
  CREATE FUNCTION public.declutter_give_strike(p_user uuid, p_side text, p_reason text, p_item uuid, p_why text, p_line uuid)
    RETURNS void LANGUAGE sql AS $$ INSERT INTO public.strikes VALUES (p_user, p_side) $$;
  CREATE FUNCTION public.declutter_seller_out(p uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
  CREATE FUNCTION public.declutter_delivery_reserved_cents(p uuid) RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
  CREATE FUNCTION public.declutter_shipping_reserved_cents(p uuid) RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
  CREATE FUNCTION public.declutter_lock_order(p uuid) RETURNS public.declutter_orders LANGUAGE sql AS $$ SELECT * FROM public.declutter_orders WHERE id = p FOR UPDATE $$;
  CREATE FUNCTION public.declutter_payout_unsent(p uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
  CREATE FUNCTION public.declutter_rebook_payout(p uuid, c integer) RETURNS void LANGUAGE sql AS $$ SELECT $$;
  CREATE FUNCTION public.log_cron_defect(a text, b text, c text) RETURNS void LANGUAGE sql AS $$ SELECT $$;
  ${createRefunds}
  ALTER TABLE public.declutter_refunds ADD COLUMN IF NOT EXISTS payment_livemode boolean, ADD COLUMN IF NOT EXISTS kept_cents integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now();
  ALTER TABLE public.declutter_refunds DROP CONSTRAINT IF EXISTS declutter_refunds_reason_check,
    DROP CONSTRAINT IF EXISTS declutter_refunds_fee_policy_check;
  ${checkFrom("20261026155251_declutter_refund_requests.sql", "declutter_refunds_amount")}
  ${checkFrom("20261103203204_shipping_lost_sweep.sql", "declutter_refunds_policy")}
  ${createDelivery}
  ALTER TABLE public.declutter_delivery_refunds DROP CONSTRAINT IF EXISTS declutter_delivery_refunds_reason_check;
  ${fnFrom("20261105030604_declutter_gift_cards.sql", "declutter_order_gift_net_cents")}
  ${fnFrom("20261105030604_declutter_gift_cards.sql", "declutter_refund_gift_split")}
  ${fnFrom("20261105030604_declutter_gift_cards.sql", "restore_gift_card_for_declutter_order")}
  ${fnFrom("20261102040952_declutter_card_fee_prorated.sql", "declutter_card_fee_left")}
  ${fnFrom("20261014224914_declutter_slice3b_payments.sql", "declutter_card_fee_estimate")}
  ${fnFrom("20261015042253_declutter_slice4_handover_payout.sql", "declutter_refund_answer")}
  ${fnFrom("20261031133938_declutter_no_helpr_buyer_refund.sql", "declutter_no_helpr_refusal")}
  ${fnFrom("20261109224952_notices_card_fee_and_our_team.sql", "declutter_refund_after_handover")}`);
await db.exec(read("20261105042758_declutter_gift_refund_rows.sql"));
await db.exec(read("20261105052751_declutter_gift_delivery_refunds.sql"));
if (!skip) {
  const mig = read(THIS);
  for (let i = 0; i < 3; i++) await db.exec(mig);
}

const B = "00000000-0000-4000-8000-0000000000b0";
const S = "00000000-0000-4000-8000-0000000000c0";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const G1 = id(1), G2 = id(2), M1 = id(3), NONE = id(4), G3 = id(5), H1 = id(6), H2 = id(7), H3 = id(8);
// Each order: a redeemed gift card for it (what redeem_gift_card_for_declutter_order leaves), one cart line, one item.
const order = async (o, { pi = null, items = 900, premium = 100, gift = 1000, status = "paid", handover = "pickup_home", fee = null }) => {
  const g = gift > 0 ? (await db.query(`INSERT INTO public.gift_cards (donor_id, recipient_id, amount, status, payment_status, declutter_order_id)
      VALUES ('${S}', '${B}', ${gift / 100}, 'redeemed', 'paid', '${o}') RETURNING id`)).rows[0].id : null;
  await db.query(`INSERT INTO public.declutter_orders (id, buyer_id, seller_id, stripe_payment_intent_id, items_cents, premium_cents,
      total_cents, gift_cents, gift_card_id, handover, status, card_fee_cents)
    VALUES ($1, '${B}', '${S}', $2, ${items}, ${premium}, ${items + premium}, ${gift}, $3, '${handover}', '${status}', $4)`, [o, pi, g, fee]);
  await db.query(`INSERT INTO public.declutter_items VALUES ($1, 'Lamp', $2, now())`, [o, status === "handed_over" ? "completed" : "sold"]);
  await db.query(`INSERT INTO public.declutter_cart_items (item_id, order_id, status) VALUES ($1, $1, 'paid')`, [o]);
};
await order(G1, {});
await order(G2, {});
await order(M1, { pi: "pi_mix", gift: 600, fee: 40 });
await order(NONE, { gift: 0 });
await order(G3, {});
await db.exec(`INSERT INTO public.declutter_delivery_refunds (order_id, stripe_payment_intent_id, reason, refund_cents, gift_refund_cents)
  VALUES ('${G3}', NULL, 'no_helpr', 100, 100)`);
await order(H1, { status: "handed_over", premium: 0 });
await order(H2, { pi: "pi_h2", status: "handed_over", premium: 0, gift: 500, fee: 30 });
await order(H3, { status: "handed_over", premium: 0 });

const call = async (sql, params = []) => { try { return (await db.query(sql, params)).rows[0]; } catch (e) { return { error: String(e.message).slice(0, 160) }; } };
const refunds = async (o) => (await db.query(`SELECT * FROM public.declutter_refunds WHERE order_id = $1`, [o])).rows;
const close = (o, reason, side = null) => call(`SELECT public.declutter_close_paid_order($1, $2, $3, 'x', 'why') AS r`, [o, reason, side]);
const restore = (o, refundId, cents) => call(`SELECT public.restore_gift_card_for_declutter_order($1, $2, $3) AS r`, [o, `declutter_refund:${refundId}`, cents]);
const restoredCents = async (o) => (await db.query(`SELECT COALESCE(sum(round(amount * 100)), 0)::int AS c FROM public.gift_cards
  WHERE restored_from_declutter_order_id = $1 AND recipient_id = '${B}' AND status = 'sent'`, [o])).rows[0].c;
const notesTo = async (u, title) => (await db.query(`SELECT body FROM public.notes WHERE user_id = $1 AND title = $2`, [u, title])).rows.map((r) => r.body);

// (1) gift-only buyer no-show.
const c1 = await close(G1, "buyer_no_show", "buyer");
const r1 = await refunds(G1);
check(!c1?.error && c1?.r?.result === "refund", "(1) a gift-only order closes as the buyer's no-show (no order_not_paid)", JSON.stringify(c1));
check(r1.length === 1 && r1[0].stripe_payment_intent_id === null && r1[0].refund_cents === 900 && r1[0].gift_refund_cents === 900
  && r1[0].kept_cents === 100 && r1[0].card_fee_cents === 0,
  "(1) one refund row: no payment intent, 900 all gift, the buyer's 100 fee kept, no card fee", JSON.stringify(r1));
const o1 = (await db.query(`SELECT status FROM public.declutter_orders WHERE id = $1`, [G1])).rows[0];
const i1 = (await db.query(`SELECT status FROM public.declutter_items WHERE id = $1`, [G1])).rows[0];
check(o1?.status === "refunded" && i1?.status === "live", "(1) the order is refunded and the item is back on sale", JSON.stringify({ o1, i1 }));

// (2) the cron's restore, then a retry.
const due = (await db.query(`SELECT * FROM public.declutter_refunds_due(50)`)).rows;
// A row is due 2 minutes after it is written; read the row itself for the split the cron would get.
const d1 = r1[0] ? { refund_cents: r1[0].refund_cents - r1[0].gift_refund_cents, gift: r1[0].gift_refund_cents } : null;
check(d1?.refund_cents === 0 && d1?.gift === 900 && Array.isArray(due), "(2) the queue would send 0 to the card and 900 to the gift balance", JSON.stringify(d1));
const rs1 = r1[0] ? await restore(G1, r1[0].id, 900) : null;
const rs2 = r1[0] ? await restore(G1, r1[0].id, 900) : null;
check(rs1?.r?.outcome === "restored" && rs1?.r?.restore_cents === 900, "(2) the gift share is restored (900)", JSON.stringify(rs1));
check(rs2?.r?.outcome === "already_restored", "(2) a retry of the same row answers already_restored", JSON.stringify(rs2));
check(await restoredCents(G1) === 900, "(2) the buyer got exactly 900 back on the gift balance, once", String(await restoredCents(G1)));

// (3) double cancel.
const c3 = await close(G1, "buyer_no_show", "buyer");
check(/order_not_paid/.test(c3?.error ?? ""), "(3) a second close of the same order raises order_not_paid", JSON.stringify(c3));
check((await refunds(G1)).length === 1, "(3) still exactly one refund row after the second close");
check((await notesTo(B, "Refund on its way")).length === 1, "(3) the buyer was told once");
const dup = await call(`INSERT INTO public.declutter_refunds (order_id, stripe_payment_intent_id, reason, fee_policy, paid_cents, card_fee_cents, refund_cents, gift_refund_cents)
  VALUES ($1, NULL, 'buyer_no_show', 'keep_buyer_fee', 900, 0, 900, 900) RETURNING id`, [G1]);
check(!!dup?.error, "(3) a second gift-only refund row for the order is refused", JSON.stringify(dup));
const again = await call(`SELECT public.declutter_record_refund($1, NULL, 'buyer_no_show', 1000, NULL) AS id`, [G1]);
check(!!again?.id && again.id === r1[0]?.id, "(3) declutter_record_refund answers the existing row, never a second", JSON.stringify(again));
check(await restoredCents(G1) === 900, "(3) the gift balance is unchanged by the second close (900, not 1800)");

// (4) gift-only seller no-show: every cent to the gift balance.
const c4 = await close(G2, "seller_no_show", "seller");
const r4 = await refunds(G2);
check(!c4?.error && r4.length === 1 && r4[0].refund_cents === 1000 && r4[0].gift_refund_cents === 1000 && r4[0].stripe_payment_intent_id === null,
  "(4) a seller no-show on a gift-only order: all 1000 back to the gift balance", JSON.stringify(c4?.error ? c4 : r4));
check((await notesTo(B, "Refund on its way")).some((b) => /It all goes back to your gift balance \(\$10\.00\)/.test(b)),
  "(4) the buyer notice says it all goes back to the gift balance", JSON.stringify(await notesTo(B, "Refund on its way")));
check((await db.query(`SELECT count(*)::int AS n FROM public.declutter_seller_fee_debts`)).rows[0].n === 0, "(4) no card fee debt on a gift-only refund");

// (5) mixed: card 400 + gift 600, nobody's fault (the card fee is kept from the CARD part).
const c5 = await close(M1, "admin_no_fault");
const r5 = await refunds(M1);
check(!c5?.error && r5.length === 1 && r5[0].stripe_payment_intent_id === "pi_mix" && r5[0].refund_cents === 960 && r5[0].gift_refund_cents === 600,
  "(5) mixed: 960 back = 600 to the gift balance + 360 to the card (400 less the 40 card fee)", JSON.stringify(c5?.error ? c5 : r5));

// (6) neither a payment intent nor a gift: still refused.
const c6 = await close(NONE, "buyer_no_show", "buyer");
check(/order_not_paid/.test(c6?.error ?? "") && (await refunds(NONE)).length === 0, "(6) no payment intent and no gift is still order_not_paid", JSON.stringify(c6));

// (7) no-Helpr cancel refusal.
const c7 = await call(`SELECT public.declutter_no_helpr_refusal($1) AS why`, [G3]);
check(c7 && !c7.error && c7.why === null, "(7) a gift-only no-Helpr order can be cancelled by its buyer (no refusal)", JSON.stringify(c7));
const c7b = await call(`SELECT public.declutter_no_helpr_refusal($1) AS why`, [NONE]);
check(c7b?.why === "order_not_paid", "(7) an order with neither is still refused", JSON.stringify(c7b));

// (8) refunds after the handover.
const after = (o, reason, part = null) => call(`SELECT public.declutter_refund_after_handover($1, $2, $3) AS r`, [o, reason, part]);
const c8 = await after(H1, "refund_request_part", 300);
const r8 = await refunds(H1);
check(!c8?.error && r8.length === 1 && r8[0].refund_cents === 300 && r8[0].gift_refund_cents === 300 && r8[0].stripe_payment_intent_id === null,
  "(8) a gift-only agreed part refund: 300 all to the gift balance", JSON.stringify(c8?.error ? c8 : r8));
const c8b = await after(H1, "refund_request_full");
check(/already_refunded/.test(c8b?.error ?? "") && (await refunds(H1)).length === 1, "(8) a second refund of the gift-only order is refused (already_refunded)", JSON.stringify(c8b));
const c8c = await after(H2, "refund_request_part", 300);
const r8c = await refunds(H2);
check(!c8c?.error && r8c.length === 1 && r8c[0].refund_cents === 300 && r8c[0].gift_refund_cents === 166,
  "(8) a mixed agreed part splits by the gift share (500 of 900): 300 = 166 gift + 134 card", JSON.stringify(c8c?.error ? c8c : r8c));
const c8d = await after(H3, "refund_request_full");
const r8d = await refunds(H3);
check(!c8d?.error && r8d.length === 1 && r8d[0].refund_cents === 900 && r8d[0].gift_refund_cents === 900,
  "(8) a gift-only full refund: 900 all to the gift balance", JSON.stringify(c8d?.error ? c8d : r8d));
check((await notesTo(B, "Refund on its way")).some((b) => /\$3\.00 is coming back to you for "Lamp"\. Keep the item\. It all goes back to your gift balance \(\$3\.00\)\./.test(b)),
  "(8) the part refund notice names the gift balance", JSON.stringify(await notesTo(B, "Refund on its way")));
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
