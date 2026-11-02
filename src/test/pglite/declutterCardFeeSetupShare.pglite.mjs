#!/usr/bin/env node
/**
 * PGlite proof for 20261102061022_declutter_card_fee_setup_share (Q2404): a refund of a Declutter sale whose charge
 * also carried the one-time setup fee bills the seller (seller fault) or the buyer (keep_card_fee) only the SALE's
 * share of Stripe's fee, fee * total / (total + setup fee); the setup fee's share is the platform's. Q1928 gap 2: a
 * debt booked from an ESTIMATED fee (none passed) is marked fee_estimated; one from Stripe's real fee is not.
 *
 *   node src/test/pglite/declutterCardFeeSetupShare.pglite.mjs                    # applied 3x: all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/declutterCardFeeSetupShare.pglite.mjs # RED: the whole fee is billed
 *   MUTANT=<name> node src/test/pglite/declutterCardFeeSetupShare.pglite.mjs      # a planted defect: must FAIL
 *
 * Real: declutter_record_refund (its newest CREATE before this file on this branch, then this file's restate, which is
 * based on Shipping S6 2d's 20261102051521 from wip/b126-ship; the shipping columns/reader it reads are stubbed),
 * declutter_card_fee_estimate and declutter_card_fee_left (newest before this file). Stubbed, said so:
 * declutter_orders, declutter_refunds, declutter_seller_fee_debts, helpr_tasks reduced to the columns read;
 * declutter_notify, declutter_order_items_named and declutter_delivery_reserved_cents answer fixed values. Supabase's
 * default anon/authenticated EXECUTE grant on functions is emulated (ALTER DEFAULT PRIVILEGES), and the function
 * before this file is created under it, so the restate's REVOKE is what takes it away.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261102061022_declutter_card_fee_setup_share.sql";
const MUTANT = process.env.MUTANT ?? "";
const MUTANTS = {
  // No split: the whole fee again.
  noSplit: ["      v_fee := round(v_fee::numeric * v_order.total_cents / (v_order.total_cents + v_order.setup_fee_cents))::integer;\n", ""],
  // Split even when the charge never carried the fee (not_charged / a payment of the sale alone).
  alwaysSplit: ["            OR v_order.setup_fee_state IN ('claimed', 'refund_due', 'refunded')) THEN", "            OR true) THEN"],
  // The setup fee's share billed instead of the sale's.
  wrongShare: ["v_fee::numeric * v_order.total_cents / (v_order", "v_fee::numeric * v_order.setup_fee_cents / (v_order"],
  // Only refused payments are split; a later refund of a sale that stood keeps the whole fee.
  paymentOnly: ["            OR v_order.setup_fee_state IN ('claimed', 'refund_due', 'refunded')) THEN", ") THEN"],
  // The split reaches the platform's own refunds too (their recorded fee changes).
  everyPolicy: ["  IF v_policy IN ('full_seller_pays_fee', 'keep_card_fee') AND p_order_id IS NOT NULL THEN", "  IF p_order_id IS NOT NULL THEN"],
  // Q1928 gap 2: the estimate is not marked.
  notMarked: ["VALUES (v_seller, v_id, v_fee, v_fee, p_card_fee_cents IS NULL)", "VALUES (v_seller, v_id, v_fee, v_fee, false)"],
  // Every debt marked estimated.
  allMarked: ["VALUES (v_seller, v_id, v_fee, v_fee, p_card_fee_cents IS NULL)", "VALUES (v_seller, v_id, v_fee, v_fee, true)"],
  // 2d's shipping hunk lost (a verbatim restate from the older definition).
  lost2d: ["+ v_order.shipping_cents - public.declutter_shipping_reserved_cents(p_order_id) THEN", "THEN"],
  // Left open to members.
  openGrant: ["REVOKE ALL ON FUNCTION public.declutter_record_refund(uuid, text, text, integer, integer) FROM PUBLIC, anon, authenticated;", ""],
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
const U = (n) => `eeeeeeee-0000-0000-0000-${String(n).padStart(12, "0")}`;
const SELLER = U(1);

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY, seller_id uuid, items_cents int, premium_cents int, tax_cents int,
  delivery_cents int, total_cents int, setup_fee_cents int NOT NULL DEFAULT 0, setup_fee_state text, shipping_cents int NOT NULL DEFAULT 0);
CREATE TABLE public.declutter_refunds (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid, stripe_payment_intent_id text UNIQUE,
  reason text, fee_policy text, paid_cents int, card_fee_cents int, kept_cents int, refund_cents int);
CREATE TABLE public.declutter_seller_fee_debts (seller_id uuid, refund_id uuid UNIQUE, amount_cents int, remaining_cents int);
INSERT INTO public.declutter_seller_fee_debts VALUES ('eeeeeeee-0000-0000-0000-000000000999', NULL, 5, 5); -- an older row
CREATE TABLE public.helpr_tasks (id uuid PRIMARY KEY, helpr_id uuid, source_kind text, source_id uuid);
CREATE FUNCTION public.declutter_notify(p_user uuid, p_type text, p_title text, p_message text, p_link text, p_other uuid DEFAULT NULL)
RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;
CREATE FUNCTION public.declutter_order_items_named(p uuid) RETURNS text LANGUAGE sql AS $$ SELECT 'the lamp' $$;
CREATE FUNCTION public.declutter_delivery_reserved_cents(p uuid) RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
-- Shipping S6 2d (20261102051521, wip/b126-ship) is the restate this file is based on: its reader, stubbed.
CREATE FUNCTION public.declutter_shipping_reserved_cents(p uuid) RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
`);
await db.exec(definitionBefore("declutter_card_fee_estimate", THIS));
await db.exec(definitionBefore("declutter_card_fee_left", THIS));
await db.exec(definitionBefore("declutter_record_refund", THIS));

if (!skip) {
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

const q = async (s, p = []) => (await db.query(s, p)).rows;
const tryQ = async (s, p = []) => { try { return await q(s, p); } catch (e) { return { error: e.message }; } };
let n = 100;
/** A $40.00 sale (items 3500 + premium 300 + tax 200); setup fee and its state as given. */
const order = async (setup, state) => {
  const id = U(n++);
  await q(`INSERT INTO public.declutter_orders VALUES ($1, $2, 3500, 300, 200, 0, 4000, $3, $4)`, [id, SELLER, setup, state]);
  return id;
};
const refund = async (id, pi, reason, paid, fee) => {
  const r = await tryQ(`SELECT public.declutter_record_refund($1, $2, $3, $4, $5) AS id`, [id, pi, reason, paid, fee]);
  const row = (await q(`SELECT card_fee_cents, refund_cents FROM public.declutter_refunds WHERE stripe_payment_intent_id = $1`, [pi]))[0];
  const debt = (await q(`SELECT d.amount_cents FROM public.declutter_seller_fee_debts d JOIN public.declutter_refunds r ON r.id = d.refund_id
                          WHERE r.stripe_payment_intent_id = $1`, [pi]))[0]?.amount_cents ?? null;
  return { error: r.error, fee: row?.card_fee_cents ?? null, refund: row?.refund_cents ?? null, debt };
};

// Stripe kept $1.52 on a $42.00 charge ($40.00 sale + $2.00 setup fee). The sale's share: 152 * 4000 / 4200 = 144.76 -> 145.
const a = await refund(await order(200, null), "pi_a", "seller_out", 4200, 152);
check(!a.error && a.debt === 145, `[fix] seller_out on a refused $42.00 payment (sale + setup fee): the seller owes 145, not 152 (${a.debt}; ${a.error ?? "ok"})`);
const b = await refund(await order(200, "claimed"), "pi_b", "seller_backed_out", 4000, 152);
check(!b.error && b.debt === 145, `[fix] a later seller-fault refund of a sale that stood with the fee: debt 145 (${b.debt})`);
const c = await refund(await order(200, "claimed"), "pi_c", "buyer_cancelled", 4000, 152);
check(!c.error && c.refund === 4000 - 145, `[fix] keep_card_fee keeps only the sale's share: refund ${c.refund} (want ${4000 - 145})`);
const d = await refund(await order(200, "refunded"), "pi_d", "not_as_described", 4000, 152);
check(d.debt === 145, `[fix] the setup fee refunded separately does not change the charge it rode on: debt 145 (${d.debt})`);
// Q1935 composes: a delivery order's refund of what is left, $1.52 * (4000 - 1000) / 4000 = 114, then * 4000 / 4200 = 108.57 -> 109.
const left = (await q(`SELECT public.declutter_card_fee_left(152, 4000, 1000) AS v`))[0].v;
const e = await refund(await order(200, "claimed"), "pi_e", "seller_no_show", 3000, left);
check(left === 114 && e.debt === 109, `[fix] composed with declutter_card_fee_left: 152 -> ${left} -> debt ${e.debt} (want 109)`);
// A NULL fee is estimated on the paid amount, then split.
const est = (await q(`SELECT public.declutter_card_fee_estimate(4200) AS v`))[0].v;
const f = await refund(await order(200, null), "pi_f", "seller_out", 4200, null);
check(f.debt === Math.round((est * 4000) / 4200), `[fix] an unknown fee is estimated (${est}) and split: debt ${f.debt}`);

// 2d's hunks survive: a buyer-fault refund of a shipped order's whole paid amount, shipping included, keeps the buyer fee.
await q(`INSERT INTO public.declutter_orders VALUES ($1, $2, 3500, 300, 200, 0, 4800, 0, NULL, 800)`, [U(90), SELLER]);
const ship = await refund(U(90), "pi_ship", "buyer_no_show", 4800, 152);
check(!ship.error && ship.refund === 4800 - 300, `2d kept: keep_buyer_fee on a shipped order counts shipping (refund ${ship.refund}; ${ship.error ?? "ok"})`);

// Unchanged: a charge that never carried the setup fee keeps the whole fee.
const g = await refund(await order(200, "not_charged"), "pi_g", "seller_backed_out", 4000, 146);
check(g.debt === 146, `not_charged (the page charged the sale alone): the whole 146 (${g.debt})`);
const h = await refund(await order(200, null), "pi_h", "seller_out", 4000, 146);
check(h.debt === 146, `a refused payment of the sale alone (no state yet): the whole 146 (${h.debt})`);
const i = await refund(await order(0, null), "pi_i", "seller_backed_out", 4000, 146);
check(i.debt === 146, `no setup fee on the order: the whole 146 (${i.debt})`);
const j = await refund(await order(200, null), "pi_j", "order_closed", 4200, 152);
check(j.fee === 152 && j.refund === 4200, `the platform's own refund records the whole fee and refunds everything (${j.fee}, ${j.refund})`);
const k = await refund(null, "pi_k", "order_missing", 4200, 152);
check(!k.error && k.fee === 152, `an order that is missing records as before (${k.fee}; ${k.error ?? "ok"})`);
// Replays answer the same row.
const a2 = await refund(await order(200, null), "pi_a", "seller_out", 4200, 152);
check(a2.debt === 145 && (await q(`SELECT count(*)::int c FROM public.declutter_refunds WHERE stripe_payment_intent_id = 'pi_a'`))[0].c === 1, `a replay books nothing new`);

// Q1928 gap 2: the debt from an estimate is marked, one from Stripe's fee is not, an older row reads false.
const mark = async (pi) => (await tryQ(`SELECT d.fee_estimated FROM public.declutter_seller_fee_debts d JOIN public.declutter_refunds r ON r.id = d.refund_id
                                          WHERE r.stripe_payment_intent_id = $1`, [pi]));
const fm = await mark("pi_f");
check(Array.isArray(fm) && fm[0]?.fee_estimated === true, `[fix] a debt from an estimated fee is marked (${JSON.stringify(fm)})`);
const bm = await mark("pi_b");
check(Array.isArray(bm) && bm[0]?.fee_estimated === false, `[fix] a debt from Stripe's fee is not (${JSON.stringify(bm)})`);
const old = await tryQ(`SELECT fee_estimated FROM public.declutter_seller_fee_debts WHERE refund_id IS NULL`);
check(Array.isArray(old) && old[0]?.fee_estimated === false, `[fix] an existing row reads false (${JSON.stringify(old)})`);

const acl = (await q(`SELECT has_function_privilege('anon', 'public.declutter_record_refund(uuid, text, text, integer, integer)', 'EXECUTE') a,
  has_function_privilege('authenticated', 'public.declutter_record_refund(uuid, text, text, integer, integer)', 'EXECUTE') u,
  has_function_privilege('service_role', 'public.declutter_record_refund(uuid, text, text, integer, integer)', 'EXECUTE') s`))[0];
check(!acl.a && !acl.u && acl.s, `grants: anon ${acl.a} authenticated ${acl.u} service_role ${acl.s}`);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
