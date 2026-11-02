#!/usr/bin/env node
/**
 * PGlite proof for 20261102063343_declutter_seller_out_after_payment (Q1928 gap 3, lead 11-02): a paid sale closed as
 * buyer_no_show or admin_no_fault, or refunded after the handover as admin_no_fault, while the seller can no longer
 * sell, is recorded as seller_out: the buyer gets every cent (less a Helpr's delivery reserve) and the card fee is the
 * seller's debt. Also proves Q1935's card_fee_left hunk is back in both functions, and Shipping S6 2d/2g's shipping
 * hold is kept for a buyer-fault close.
 *
 *   node src/test/pglite/declutterSellerOutAfterPayment.pglite.mjs                    # applied 3x: all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/declutterSellerOutAfterPayment.pglite.mjs # RED: the old functions
 *   MUTANT=<name> node src/test/pglite/declutterSellerOutAfterPayment.pglite.mjs      # a planted defect: must FAIL
 *
 * Real: declutter_record_refund (newest before this file: 20261102061022), declutter_card_fee_estimate,
 * declutter_card_fee_left; with NEW_MIGRATION=skip, the two callers at their newest definitions on this branch
 * (20261102040952). The migration's own text is applied verbatim (3x). Stubbed, said so: the tables reduced to the
 * columns read; declutter_seller_out reads a test table; declutter_notify / declutter_give_strike / log_cron_defect
 * record calls; declutter_delivery_reserved_cents and declutter_shipping_reserved_cents read per-order test columns;
 * helpr_task_*, declutter_ship_refund_after_void, declutter_rebook_payout are no-ops; declutter_payout_unsent is true;
 * declutter_lock_order selects the row. Supabase's default anon/authenticated EXECUTE grant is emulated.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261102063343_declutter_seller_out_after_payment.sql";
const MUTANT = process.env.MUTANT ?? "";
const MUTANTS = {
  // close_paid_order never switches.
  closeNoSwitch: ["  IF p_reason IN ('buyer_no_show', 'admin_no_fault') AND public.declutter_seller_out(o.seller_id) THEN", "  IF false THEN"],
  // close_paid_order switches even when the seller can still sell.
  closeAlways: ["  IF p_reason IN ('buyer_no_show', 'admin_no_fault') AND public.declutter_seller_out(o.seller_id) THEN", "  IF p_reason IN ('buyer_no_show', 'admin_no_fault') THEN"],
  // The switch is computed but the refund is still recorded under the caller's reason.
  closeIgnored: ["declutter_record_refund(o.id, o.stripe_payment_intent_id, v_fee_reason, o.total_cents - v_reserved - v_ship,", "declutter_record_refund(o.id, o.stripe_payment_intent_id, p_reason, o.total_cents - v_reserved - v_ship,"],
  // refund_after_handover never switches.
  afterNoSwitch: ["  IF p_reason = 'admin_no_fault' AND public.declutter_seller_out(o.seller_id) THEN", "  IF false THEN"],
  // Q1935 lost again in close_paid_order (the whole fee).
  closeWholeFee: ["o.total_cents - v_reserved - v_ship,\n    public.declutter_card_fee_left(o.card_fee_cents, o.total_cents, v_reserved));", "o.total_cents - v_reserved - v_ship,\n    o.card_fee_cents);"],
  // Q1935 lost again in refund_after_handover.
  afterWholeFee: ["v_fee_reason, v_paid,\n      public.declutter_card_fee_left(o.card_fee_cents, o.total_cents, v_reserved));", "v_fee_reason, v_paid,\n      o.card_fee_cents);"],
  // 2d's shipping hold dropped from close_paid_order.
  closeNoShipHold: ["    v_ship := COALESCE(public.declutter_shipping_reserved_cents(o.id), 0);\n  END IF;\n  -- CHANGED (Q1935", "    v_ship := 0;\n  END IF;\n  -- CHANGED (Q1935"],
  // An out seller's buyer_no_show still holds the shipping back.
  holdOnSwitch: ["  IF v_fee_reason IN ('buyer_no_show', 'admin_buyer_fault', 'buyer_cancelled', 'buyer_restarted_checkout') THEN", "  IF p_reason IN ('buyer_no_show', 'admin_buyer_fault', 'buyer_cancelled', 'buyer_restarted_checkout') THEN"],
  // Left open to members.
  openGrant: ["REVOKE ALL ON FUNCTION public.declutter_close_paid_order(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;", ""],
};
const skip = process.env.NEW_MIGRATION === "skip";

function definitionBefore(name, before) {
  let last = null;
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql") && x < before).sort()) {
    const sql = readFileSync(MIG_DIR + f, "utf8");
    const head = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi");
    for (const m of sql.matchAll(head)) {
      const rest = sql.slice(m.index);
      const tag = /\bAS\s+(\$\w*\$)/i.exec(rest);
      const end = rest.indexOf(tag[1], tag.index + tag[0].length);
      last = rest.slice(0, end + tag[1].length) + ";";
    }
  }
  if (!last) throw new Error(`no definition of ${name} before ${before}`);
  return last;
}

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };
const U = (n) => `ffffffff-0000-0000-0000-${String(n).padStart(12, "0")}`;
const SELLER = U(1), OUT_SELLER = U(2), BUYER = U(3);

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY, seller_id uuid, buyer_id uuid, status text, paid_with text DEFAULT 'card',
  stripe_payment_intent_id text, items_cents int, premium_cents int, tax_cents int DEFAULT 0, delivery_cents int DEFAULT 0,
  shipping_cents int DEFAULT 0, total_cents int, card_fee_cents int, handover text DEFAULT 'pickup',
  setup_fee_cents int NOT NULL DEFAULT 0, setup_fee_state text, close_reason text, closed_at timestamptz,
  t_reserved int DEFAULT 0, t_ship_reserved int DEFAULT 0);
CREATE TABLE public.declutter_refunds (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid, stripe_payment_intent_id text UNIQUE,
  reason text, fee_policy text, paid_cents int, card_fee_cents int, kept_cents int, refund_cents int);
CREATE TABLE public.declutter_seller_fee_debts (seller_id uuid, refund_id uuid UNIQUE, amount_cents int, remaining_cents int,
  fee_estimated boolean NOT NULL DEFAULT false);
CREATE TABLE public.helpr_tasks (id uuid PRIMARY KEY, helpr_id uuid, source_kind text, source_id uuid, status text);
CREATE TABLE public.declutter_order_deliveries (order_id uuid, task_id uuid);
CREATE TABLE public.declutter_cart_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid, item_id uuid, status text, closed_at timestamptz);
CREATE TABLE public.declutter_items (id uuid PRIMARY KEY, status text, title text, updated_at timestamptz);
CREATE TABLE public.declutter_payouts (order_id uuid);
CREATE TABLE public.shipments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), declutter_order_id uuid, label_state text, label_mode text,
  accepted_at timestamptz, last_error text, next_attempt_at timestamptz);
CREATE TABLE public.t_out (seller_id uuid);
CREATE TABLE public.t_calls (kind text, who uuid, body text);
CREATE FUNCTION public.declutter_seller_out(p uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT EXISTS (SELECT 1 FROM public.t_out WHERE seller_id = p) $$;
CREATE FUNCTION public.declutter_notify(p_user uuid, p_type text, p_title text, p_message text, p_link text, p_other uuid DEFAULT NULL)
RETURNS void LANGUAGE sql AS $$ INSERT INTO public.t_calls VALUES ('notify', p_user, p_message) $$;
CREATE FUNCTION public.declutter_give_strike(p_user uuid, p_side text, p_reason text, p_item uuid, p_why text, p_line uuid)
RETURNS void LANGUAGE sql AS $$ INSERT INTO public.t_calls VALUES ('strike', p_user, p_reason) $$;
CREATE FUNCTION public.log_cron_defect(a text, b text, c text) RETURNS void LANGUAGE sql AS $$ INSERT INTO public.t_calls VALUES ('defect', NULL, c) $$;
CREATE FUNCTION public.declutter_order_items_named(p uuid) RETURNS text LANGUAGE sql AS $$ SELECT 'the lamp' $$;
CREATE FUNCTION public.declutter_delivery_reserved_cents(p uuid) RETURNS integer LANGUAGE sql AS $$ SELECT t_reserved FROM public.declutter_orders WHERE id = p $$;
CREATE FUNCTION public.declutter_shipping_reserved_cents(p uuid) RETURNS integer LANGUAGE sql AS $$ SELECT t_ship_reserved FROM public.declutter_orders WHERE id = p $$;
CREATE FUNCTION public.helpr_task_confirm(a uuid, b text, c text) RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;
CREATE FUNCTION public.helpr_task_close(a uuid, b text, c text) RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;
CREATE FUNCTION public.declutter_ship_refund_after_void(p uuid) RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
CREATE FUNCTION public.declutter_rebook_payout(p uuid, c integer) RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;
CREATE FUNCTION public.declutter_payout_unsent(p uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.declutter_lock_order(p uuid) RETURNS public.declutter_orders LANGUAGE sql AS $$ SELECT * FROM public.declutter_orders WHERE id = p $$;
CREATE FUNCTION public.declutter_refund_answer(p uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('refund_id', p) $$;
`);
for (const f of ["declutter_card_fee_estimate", "declutter_card_fee_left", "declutter_record_refund"]) await db.exec(definitionBefore(f, THIS));

if (skip) {
  for (const f of ["declutter_close_paid_order", "declutter_refund_after_handover"]) await db.exec(definitionBefore(f, THIS));
} else {
  let mig = readFileSync(MIG_DIR + THIS, "utf8");
  if (MUTANT) {
    const m = MUTANTS[MUTANT];
    if (!m || !mig.includes(m[0])) throw new Error(`mutant ${MUTANT} did not apply`);
    mig = mig.replace(m[0], m[1]);
  }
  for (let k = 1; k <= 3; k++) {
    try { await db.exec(mig); check(true, `the migration applies (run ${k})`); } catch (e) { check(false, `the migration applies (run ${k}): ${e.message}`); }
  }
}
await db.query(`INSERT INTO public.t_out VALUES ($1)`, [OUT_SELLER]);

const q = async (s, p = []) => (await db.query(s, p)).rows;
const tryQ = async (s, p = []) => { try { return await q(s, p); } catch (e) { return { error: e.message }; } };
let n = 100;
/** A $40.00 paid sale (items 3500 + premium 300 + tax 200), card fee $1.46, extra columns as given. */
const order = async (seller, { status = "paid", total = 4000, reserved = 0, ship = 0, shipReserved = 0, handover = "pickup" } = {}) => {
  const id = U(n++), item = U(n++);
  await q(`INSERT INTO public.declutter_orders (id, seller_id, buyer_id, status, stripe_payment_intent_id, items_cents, premium_cents, tax_cents,
             delivery_cents, shipping_cents, total_cents, card_fee_cents, handover, t_reserved, t_ship_reserved)
           VALUES ($1, $2, $3, $4, $5, 3500, 300, 200, $6, $7, $8, 146, $9, $10, $11)`,
    [id, seller, BUYER, status, `pi_${n}`, reserved, ship, total, handover, reserved, shipReserved]);
  await q(`INSERT INTO public.declutter_items VALUES ($1, $2, 'Lamp', now())`, [item, status === "paid" ? "sold" : "completed"]);
  await q(`INSERT INTO public.declutter_cart_items (order_id, item_id, status) VALUES ($1, $2, 'paid')`, [id, item]);
  return id;
};
const refundOf = async (id) => (await q(`SELECT reason, fee_policy, paid_cents, card_fee_cents, refund_cents FROM public.declutter_refunds WHERE order_id = $1`, [id]))[0] ?? {};
const debtOf = async (id) => (await q(`SELECT d.seller_id, d.amount_cents FROM public.declutter_seller_fee_debts d JOIN public.declutter_refunds r ON r.id = d.refund_id WHERE r.order_id = $1`, [id]))[0] ?? null;
const close = (id, reason) => tryQ(`SELECT public.declutter_close_paid_order($1, $2, $3, 'not_picked_up', 'why')`, [id, reason, reason === "buyer_no_show" ? "buyer" : null]);
const after = (id, reason) => tryQ(`SELECT public.declutter_refund_after_handover($1, $2, NULL)`, [id, reason]);

// [fix] close_paid_order: buyer_no_show with an out seller -> seller_out, every cent back, the seller owes the fee.
const a = await order(OUT_SELLER);
const ar = await close(a, "buyer_no_show");
const aref = await refundOf(a), adebt = await debtOf(a);
check(!ar.error && aref.reason === "seller_out" && aref.refund_cents === 4000 && adebt?.seller_id === OUT_SELLER && adebt?.amount_cents === 146,
  `[fix] buyer_no_show, seller out: ${JSON.stringify(aref)} debt ${JSON.stringify(adebt)} (${ar.error ?? "ok"})`);
const strikes = await q(`SELECT count(*)::int c FROM public.t_calls WHERE kind = 'strike' AND who = $1`, [BUYER]);
check(strikes[0].c === 1, `the buyer's strike is unchanged (${strikes[0].c})`);
const anote = await q(`SELECT body FROM public.t_calls WHERE kind = 'notify' AND who = $1 ORDER BY ctid DESC LIMIT 1`, [BUYER]);
check(/\$40\.00 is coming back/.test(anote[0]?.body ?? ""), `[fix] the buyer is told every cent comes back: ${anote[0]?.body}`);
// [fix] admin_no_fault close with an out seller.
const b = await order(OUT_SELLER);
await close(b, "admin_no_fault");
const bref = await refundOf(b);
check(bref.reason === "seller_out" && bref.refund_cents === 4000 && (await debtOf(b))?.amount_cents === 146, `[fix] admin_no_fault close, seller out: ${JSON.stringify(bref)}`);
// Unchanged: a seller who can still sell.
const c = await order(SELLER);
await close(c, "buyer_no_show");
const cref = await refundOf(c);
check(cref.reason === "buyer_no_show" && cref.refund_cents === 4000 - 300 && (await debtOf(c)) === null, `buyer_no_show, seller can sell: keep_buyer_fee (${JSON.stringify(cref)})`);
const d = await order(SELLER);
await close(d, "admin_no_fault");
const dref = await refundOf(d);
check(dref.reason === "admin_no_fault" && dref.refund_cents === 4000 - 146, `admin_no_fault, seller can sell: keep_card_fee (${JSON.stringify(dref)})`);
// Unchanged: an out seller's admin_buyer_fault stays the buyer's (only the two named reasons switch).
const e = await order(OUT_SELLER);
await close(e, "admin_buyer_fault");
check((await refundOf(e)).reason === "admin_buyer_fault", `admin_buyer_fault is not switched (${(await refundOf(e)).reason})`);

// [fix] Q1935 restored: a $60.00 delivery order with $15.00 reserved, card fee $1.46 -> 146 * 4500 / 6000 = 110 (109.5).
const f = await order(OUT_SELLER, { total: 6000, reserved: 1500 });
await close(f, "buyer_no_show");
check((await debtOf(f))?.amount_cents === 110 && (await refundOf(f)).paid_cents === 4500, `[fix] close: the debt is the prorated fee (${(await debtOf(f))?.amount_cents}, want 110)`);
// 2d kept: a buyer-fault close of a shipped order holds its bought label's shipping back.
const g = await order(SELLER, { total: 4800, ship: 800, shipReserved: 800, handover: "ship" });
await q(`INSERT INTO public.shipments (declutter_order_id, label_state, label_mode) VALUES ($1, 'bought', 'test')`, [g]);
const gr = await close(g, "buyer_no_show");
check(!gr.error && (await refundOf(g)).paid_cents === 4000, `2d kept: shipping held back on a buyer-fault close (paid ${(await refundOf(g)).paid_cents}; ${gr.error ?? "ok"})`);
// [fix] an out seller's buyer_no_show on a shipped order refunds the shipping too, at once.
const h = await order(OUT_SELLER, { total: 4800, ship: 800, shipReserved: 800, handover: "ship" });
await q(`INSERT INTO public.shipments (declutter_order_id, label_state, label_mode) VALUES ($1, 'bought', 'test')`, [h]);
await close(h, "buyer_no_show");
check((await refundOf(h)).refund_cents === 4800, `[fix] seller out: the shipping comes back now (${(await refundOf(h)).refund_cents})`);

// [fix] refund_after_handover: admin_no_fault with an out seller.
const i = await order(OUT_SELLER, { status: "handed_over" });
const ir = await after(i, "admin_no_fault");
const iref = await refundOf(i);
check(!ir.error && iref.reason === "seller_out" && iref.refund_cents === 4000 && (await debtOf(i))?.amount_cents === 146,
  `[fix] after handover, admin_no_fault, seller out: ${JSON.stringify(iref)} (${ir.error ?? "ok"})`);
const inote = await q(`SELECT body FROM public.t_calls WHERE kind = 'notify' AND who = $1 AND body LIKE '%for "Lamp"%' ORDER BY ctid DESC LIMIT 1`, [BUYER]);
check(/^\$40\.00 is coming back to your card for "Lamp"\./.test(inote[0]?.body ?? "") && !/card network kept/.test(inote[0]?.body ?? ""),
  `[fix] the buyer's notice: every cent, no card-fee sentence: ${inote[0]?.body}`);
const j = await order(SELLER, { status: "handed_over" });
await after(j, "admin_no_fault");
check((await refundOf(j)).reason === "admin_no_fault" && (await refundOf(j)).refund_cents === 4000 - 146, `after handover, seller can sell: keep_card_fee (${JSON.stringify(await refundOf(j))})`);
// [fix] Q1935 restored after the handover: 146 * 4500 / 6000 = 110.
const k = await order(OUT_SELLER, { status: "handed_over", total: 6000, reserved: 1500 });
await after(k, "admin_no_fault");
check((await debtOf(k))?.amount_cents === 110, `[fix] after handover: the debt is the prorated fee (${(await debtOf(k))?.amount_cents}, want 110)`);

for (const sig of ["public.declutter_close_paid_order(uuid, text, text, text, text)", "public.declutter_refund_after_handover(uuid, text, integer)"]) {
  const acl = (await q(`SELECT has_function_privilege('anon', '${sig}', 'EXECUTE') a, has_function_privilege('authenticated', '${sig}', 'EXECUTE') u,
    has_function_privilege('service_role', '${sig}', 'EXECUTE') s`))[0];
  check(!acl.a && !acl.u && acl.s, `grants ${sig}: anon ${acl.a} authenticated ${acl.u} service_role ${acl.s}`);
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
