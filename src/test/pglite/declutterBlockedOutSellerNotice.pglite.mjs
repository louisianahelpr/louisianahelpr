#!/usr/bin/env node
/**
 * Q1928 gap 4 (PGlite proof): a seller who BLOCKED the buyer and can also no longer sell (declutter_seller_out) is
 * billed the card fee of a payment that lands anyway (reason seller_backed_out; the seller's block decides, spec
 * owner answer 7) and must be TOLD: one "You owe from a refund" notice naming the item and the amount. Gap 4 was
 * "billed with no notice"; since D2-6 (20261029232103, audit 1b #6) declutter_record_refund tells the seller for
 * every debt it books. This file pins that, end to end through the webhook's declutter_mark_order_paid, for the
 * three paths a seller's block reaches: the open checkout (blocked and out; blocked only) and a checkout the sweep
 * closed as seller_blocked. It also measures how many owe notices a seller who is out (no block) gets.
 *
 *   node src/test/pglite/declutterBlockedOutSellerNotice.pglite.mjs                        # all PASS
 *   RECORD_BEFORE=20261029232103 node src/test/pglite/declutterBlockedOutSellerNotice.pglite.mjs  # RED: record_refund before D2-6
 *   MUTANT=<name> node src/test/pglite/declutterBlockedOutSellerNotice.pglite.mjs          # a planted defect: must FAIL
 *
 * Real (newest definition on this branch, any dollar-quote tag): declutter_mark_order_paid, declutter_record_refund,
 * declutter_seller_out_fee_notice (its in-place copy rewrite of 20261027172503 is not applied: only its count is read).
 * Stubbed, said so: the tables reduced to the columns read; declutter_seller_out reads a test table; declutter_notify
 * records calls; declutter_card_fee_estimate, declutter_order_items_named, declutter_refund_answer,
 * declutter_*_reserved_cents are small fixed stand-ins. pglite is not a dependency (CLAUDE.md): loaded from
 * ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const RECORD_BEFORE = process.env.RECORD_BEFORE ?? "99999999";
const MUTANT = process.env.MUTANT ?? "";
const MUTANTS = {
  // record_refund books the debt but tells no one (gap 4 as filed).
  silentDebt: ["        PERFORM public.declutter_notify(v_seller, 'declutter_refunds', 'You owe from a refund',", "        PERFORM public.declutter_notify(NULL, 'declutter_refunds', 'You owe from a refund',"],
  // A seller's block no longer bills the seller (the platform pays).
  blockFree: ["                     THEN 'seller_backed_out'\n", "                     THEN 'order_closed'\n"],
  // The notice drops the amount owed.
  noAmount: ["This refund on %s leaves you owing $%s. It comes out of your next Declutter sale''s payout.", "This refund on %s leaves you owing money%s. It comes out of your next Declutter sale''s payout."],
};
if (MUTANT && !MUTANTS[MUTANT]) throw new Error(`unknown MUTANT ${MUTANT}`);

/** The newest definition of public.<name> in any migration sorting before `before` (any dollar-quote tag). */
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
const plant = (sql) => {
  if (!MUTANT) return sql;
  const [find, repl] = MUTANTS[MUTANT];
  return sql.includes(find) ? sql.replace(find, repl) : sql;
};

let failures = 0;
const check = (ok, name, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  (${detail})` : ""}`); if (!ok) failures++; };
const U = (n) => `abababab-0000-0000-0000-${String(n).padStart(12, "0")}`;
const SELLER = U(1), BUYER = U(2), SELLER_B = U(3), BUYER_B = U(4), SELLER_C = U(5), BUYER_C = U(6), SELLER_D = U(7), BUYER_D = U(8);
const FEE = 163;

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.user_blocks (blocker_id uuid, blocked_id uuid);
CREATE TABLE public.out_sellers (id uuid PRIMARY KEY);
CREATE TABLE public.declutter_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), seller_id uuid, status text, updated_at timestamptz);
CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text, close_reason text, closed_at timestamptz,
  buyer_id uuid, seller_id uuid, items_cents integer, premium_cents integer DEFAULT 0, tax_cents integer DEFAULT 0,
  delivery_cents integer DEFAULT 0, shipping_cents integer DEFAULT 0, total_cents integer, setup_fee_cents integer NOT NULL DEFAULT 0,
  setup_fee_state text, stripe_payment_intent_id text, paid_at timestamptz, stripe_paid_at timestamptz, card_fee_cents integer);
CREATE TABLE public.declutter_cart_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid, order_id uuid,
  status text DEFAULT 'in_cart', checkout_by timestamptz, closed_at timestamptz);
CREATE TABLE public.declutter_strikes (cart_line_id uuid, reason text, removed_at timestamptz);
CREATE TABLE public.declutter_refunds (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid, stripe_payment_intent_id text UNIQUE,
  reason text, fee_policy text, paid_cents integer, card_fee_cents integer, kept_cents integer, refund_cents integer);
CREATE TABLE public.declutter_seller_fee_debts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), seller_id uuid, refund_id uuid UNIQUE,
  amount_cents integer, remaining_cents integer, fee_estimated boolean NOT NULL DEFAULT false);
CREATE TABLE public.helpr_tasks (helpr_id uuid, source_kind text, source_id uuid);
CREATE TABLE public.notices (user_id uuid, kind text, title text, message text);
CREATE FUNCTION public.declutter_seller_out(a uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT EXISTS (SELECT 1 FROM public.out_sellers WHERE id = a) $$;
CREATE FUNCTION public.declutter_notify(p_user uuid, p_kind text, p_title text, p_message text, p_link text, p_other uuid DEFAULT NULL)
  RETURNS void LANGUAGE sql AS $$ INSERT INTO public.notices SELECT p_user, p_kind, p_title, p_message WHERE p_user IS NOT NULL $$;
CREATE FUNCTION public.declutter_card_fee_estimate(p integer) RETURNS integer LANGUAGE sql AS $$ SELECT 999 $$;
CREATE FUNCTION public.declutter_order_items_named(p uuid) RETURNS text LANGUAGE sql AS $$ SELECT 'Oak chair' $$;
CREATE FUNCTION public.declutter_delivery_reserved_cents(p uuid) RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
CREATE FUNCTION public.declutter_shipping_reserved_cents(p uuid) RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
CREATE FUNCTION public.declutter_price_text(p integer) RETURNS text LANGUAGE sql AS $$ SELECT '$' || (p / 100)::text $$;
CREATE FUNCTION public.declutter_paid_next_step(p uuid) RETURNS text LANGUAGE sql AS $$ SELECT '' $$;
CREATE FUNCTION public.declutter_claim_setup_fee(p uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.declutter_refund_answer(p uuid) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('result', 'refunded', 'reason', r.reason, 'fee_policy', r.fee_policy, 'refund_cents', r.refund_cents)
    FROM public.declutter_refunds r WHERE r.id = p $$;
`);
for (const fn of ["declutter_record_refund"]) await db.exec(plant(definitionBefore(fn, RECORD_BEFORE)));
for (const fn of ["declutter_seller_out_fee_notice", "declutter_mark_order_paid"]) await db.exec(plant(definitionBefore(fn, "99999999")));

const q = async (s, p = []) => (await db.query(s, p)).rows;
/** One reserved item at 4000 from `seller`, checked out by `buyer` (awaiting payment, or as `status`/`reason`). */
async function checkout(seller, buyer, status = "awaiting_payment", reason = null) {
  const item = (await q(`INSERT INTO public.declutter_items (seller_id, status) VALUES ($1, 'reserved') RETURNING id`, [seller]))[0].id;
  const order = (await q(`INSERT INTO public.declutter_orders (status, close_reason, buyer_id, seller_id, items_cents, total_cents)
    VALUES ($1, $2, $3, $4, 4000, 4000) RETURNING id`, [status, reason, buyer, seller]))[0].id;
  await q(`INSERT INTO public.declutter_cart_items (item_id, order_id, checkout_by) VALUES ($1, $2, now() + interval '20 minutes')`, [item, order]);
  return order;
}
const pay = async (order, pi) => {
  try { return (await q(`SELECT public.declutter_mark_order_paid($1, $2, 4000, now(), ${FEE}) AS r`, [order, pi]))[0].r; }
  catch (e) { return { error: e.message }; }
};
const debt = async (pi) => (await q(`SELECT d.seller_id, d.amount_cents FROM public.declutter_seller_fee_debts d
  JOIN public.declutter_refunds r ON r.id = d.refund_id WHERE r.stripe_payment_intent_id = $1`, [pi]))[0];
const owes = async (uid) => q(`SELECT title, message FROM public.notices WHERE user_id = $1 AND (message LIKE '%owing%' OR title IN ('You owe from a refund', 'Card fee owed', 'Amount owed'))`, [uid]);

// (a) Open checkout: the seller blocked the buyer AND is out. The seller's block decides (seller_backed_out).
await q(`INSERT INTO public.out_sellers VALUES ($1)`, [SELLER]);
await q(`INSERT INTO public.user_blocks VALUES ($1, $2)`, [SELLER, BUYER]);
const a = await checkout(SELLER, BUYER);
const aRes = await pay(a, "pi_gap4_a");
check(aRes?.reason === "seller_backed_out" && aRes?.fee_policy === "full_seller_pays_fee" && aRes?.refund_cents === 4000,
  "(a) seller blocked the buyer and is out: every cent back, seller_backed_out, the seller pays the fee", JSON.stringify(aRes));
const aDebt = await debt("pi_gap4_a");
check(aDebt?.seller_id === SELLER && aDebt?.amount_cents === FEE, "(a) the fee is booked to the seller as a debt", JSON.stringify(aDebt));
const aNotes = await owes(SELLER);
check(aNotes.length === 1, "(a) the seller is told exactly once", JSON.stringify(aNotes));
check(aNotes[0]?.message?.includes("Oak chair") && aNotes[0]?.message?.includes("$1.63"),
  "(a) the notice names the item and the amount owed", JSON.stringify(aNotes));
check(!/fee/i.test(`${aNotes[0]?.title ?? ""} ${aNotes[0]?.message ?? ""}`), "(a) in words, no fee name (owner: members see no fee words)", JSON.stringify(aNotes));
await pay(a, "pi_gap4_a");
check((await owes(SELLER)).length === 1, "(a) a replayed webhook tells the seller no second time");

// (b) Open checkout: the seller blocked the buyer, still able to sell.
await q(`INSERT INTO public.user_blocks VALUES ($1, $2)`, [SELLER_B, BUYER_B]);
const b = await checkout(SELLER_B, BUYER_B);
const bRes = await pay(b, "pi_gap4_b");
check(bRes?.reason === "seller_backed_out", "(b) seller blocked the buyer: seller_backed_out", JSON.stringify(bRes));
check((await debt("pi_gap4_b"))?.amount_cents === FEE && (await owes(SELLER_B)).length === 1, "(b) debt booked and the seller told once");

// (c) The sweep closed the checkout as seller_blocked, the seller is out, and the buyer paid anyway.
await q(`INSERT INTO public.out_sellers VALUES ($1)`, [SELLER_C]);
await q(`INSERT INTO public.user_blocks VALUES ($1, $2)`, [SELLER_C, BUYER_C]);
const c = await checkout(SELLER_C, BUYER_C, "expired", "seller_blocked");
const cRes = await pay(c, "pi_gap4_c");
check(cRes?.reason === "seller_backed_out" && cRes?.refund_cents === 4000, "(c) a closed seller_blocked checkout paid anyway: seller_backed_out, every cent back", JSON.stringify(cRes));
check((await debt("pi_gap4_c"))?.amount_cents === FEE && (await owes(SELLER_C)).length === 1, "(c) debt booked and the seller told once");

// (d) Measured, not asserted: a seller who is out with no block (seller_out) is told by record_refund AND by
// declutter_seller_out_fee_notice.
await q(`INSERT INTO public.out_sellers VALUES ($1)`, [SELLER_D]);
const d = await checkout(SELLER_D, BUYER_D);
const dRes = await pay(d, "pi_gap4_d");
const dNotes = await owes(SELLER_D);
console.log(`INFO  (d) seller out, no block: reason ${dRes?.reason}; owe notices to the seller: ${dNotes.length} (${dNotes.map((n) => n.title).join(" | ")})`);

console.log(failures ? `\n${failures} FAILED` : "\nall PASS");
process.exit(failures ? 1 : 0);
