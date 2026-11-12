#!/usr/bin/env node
/**
 * PGlite proof for 20261112095500_shops_card_fee_without_setup_fee.sql (S053): the card fee recorded at capture is the
 * SALE's share of Stripe's fee when the charge also carried the buyer's one-time setup fee (fee x total / (total +
 * setup fee), rounded), unchanged without a setup fee, capped at the sale. Base: the real declutter_card_fee_estimate
 * (20261014224914); stubs: shop_orders / shop_order_lines / shop_cottage_sales (the columns used), declutter_notify,
 * shop_delivery_open_task.
 *
 *   node src/test/pglite/shopsCardFeeShare.pglite.mjs                    # ALL OK (migration applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/shopsCardFeeShare.pglite.mjs # red (20261108185110's body)
 *   MIGRATION_PATH=<planted copy> node ...                               # red on a planted defect
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW_FILE = "20261112095500_shops_card_fee_without_setup_fee.sql";
const SQL = readFileSync(process.env.MIGRATION_PATH ?? `${DIR}${NEW_FILE}`, "utf8");
const skip = process.env.NEW_MIGRATION === "skip";

let failed = 0;
const ok = (name, cond, detail = "") => {
  if (cond) console.log(`OK   ${name}`);
  else { failed++; console.log(`FAIL ${name} ${detail}`); }
};
function stmt(sql, start, label) {
  const m = start.exec(sql);
  if (!m) throw new Error(`${label}: not found`);
  const tag = /\bAS (\$\w*\$)/.exec(sql.slice(m.index));
  const open = m.index + tag.index + tag[0].length;
  const end = sql.indexOf(tag[1], open);
  return `${sql.slice(m.index, end + tag[1].length)};`;
}

const U = (n) => `00000000-0000-4000-8000-0000000003${String(n).padStart(2, "0")}`;
const BUYER = U(1), SELLER = U(2);
const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE public.shop_orders (id uuid PRIMARY KEY, buyer_id uuid, seller_id uuid, status text, captured_at timestamptz,
    capture_last_error text, card_fee_cents integer, total_cents integer, setup_fee_state text, setup_fee_cents integer,
    is_digital boolean DEFAULT false, payment_plan text NOT NULL DEFAULT 'full_hold', balance_cents integer, ready_date date DEFAULT current_date, fulfillment text DEFAULT 'pickup', is_seed boolean DEFAULT false);
  CREATE TABLE public.shop_order_lines (order_id uuid, kind text, line_cents integer);
  CREATE TABLE public.shop_cottage_sales (owner_id uuid, source_ref uuid UNIQUE, amount_cents integer, is_seed boolean);
  CREATE TABLE public.notes (who uuid, title text, body text);
  CREATE FUNCTION public.declutter_notify(p_to uuid, p_type text, p_title text, p_body text, p_link text, p_other uuid)
    RETURNS void LANGUAGE sql AS $$ INSERT INTO public.notes VALUES (p_to, p_title, p_body) $$;
  CREATE FUNCTION public.shop_delivery_open_task(p uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
`);
await db.exec(stmt(readFileSync(`${DIR}20261014224914_declutter_slice3b_payments.sql`, "utf8"), /CREATE OR REPLACE FUNCTION public\.declutter_card_fee_estimate\(/, "estimate"));

if (skip) {
  await db.exec(stmt(readFileSync(`${DIR}20261108185110_shops_digital_checkout.sql`, "utf8"), /CREATE OR REPLACE FUNCTION public\.shop_order_captured\(/, "old"));
} else {
  for (let i = 0; i < 3; i++) {
    let err = null;
    try { await db.exec(SQL); } catch (e) { err = e.message; }
    ok(`migration applies (run ${i + 1})`, !err, err ?? "");
  }
}

let n = 10;
async function capture({ total, feeState = "none", setupFee = 200, stripeFee, digital = false, balance = null }) {
  const id = U(n++);
  await db.query(`INSERT INTO public.shop_orders (id, buyer_id, seller_id, status, total_cents, setup_fee_state, setup_fee_cents, is_digital, payment_plan, balance_cents)
                  VALUES ($1, $2, $3, 'accepted', $4, $5, $6, $7, $8, $9)`,
                 [id, BUYER, SELLER, total, feeState, setupFee, digital, balance === null ? "full_hold" : "deposit_50", balance]);
  await db.query(`SELECT public.shop_order_captured($1, $2)`, [id, stripeFee ?? null]);
  return (await db.query(`SELECT card_fee_cents AS f FROM public.shop_orders WHERE id = $1`, [id])).rows[0].f;
}

// No setup fee on the charge: exactly what Stripe kept (or the estimate on the sale).
ok("no setup fee: Stripe's fee recorded as is", (await capture({ total: 3000, stripeFee: 117 })) === 117);
ok("no setup fee, no Stripe fee read: estimate of the sale", (await capture({ total: 3000 })) === 117);
ok("an unclaimed setup fee is not in the charge", (await capture({ total: 3000, feeState: "waived", stripeFee: 117 })) === 117);
// The order carried the $2 setup fee: only the sale's share.
let f = await capture({ total: 3000, feeState: "claimed", stripeFee: 123 });
ok("setup fee claimed: the sale's share of Stripe's fee (123 x 3000/3200 = 115.3 -> 115)", f === 115, `got ${f}`);
f = await capture({ total: 3000, feeState: "claimed" });
ok("setup fee claimed, no fee read: share of the estimate on sale + fee (123 -> 115)", f === 115, `got ${f}`);
f = await capture({ total: 500, feeState: "claimed", stripeFee: 50 });
ok("small sale: 50 x 500/700 = 35.7 -> 36", f === 36, `got ${f}`);
f = await capture({ total: 100, feeState: "claimed", stripeFee: 5000 });
ok("never more than the sale", f === 100, `got ${f}`);
f = await capture({ total: 2000, feeState: "claimed", stripeFee: 0 });
ok("a zero fee stays zero", f === 0, `got ${f}`);
f = await capture({ total: 2500, feeState: "claimed", stripeFee: 105, digital: true });
ok("a download order records the share too (105 x 2500/2700 = 97.2 -> 97)", f === 97, `got ${f}`);
// A deposit order's capture is the deposit (total - balance + setup fee): the share is of THAT charge.
f = await capture({ total: 10000, feeState: "claimed", stripeFee: 181, balance: 5000 });
ok("deposit order: 181 x 5000/5200 = 174.0 -> 174", f === 174, `got ${f}`);
f = await capture({ total: 10000, feeState: "claimed", balance: 5000 });
ok("deposit order, no fee read: estimate on the deposit charge (181) -> 174", f === 174, `got ${f}`);
f = await capture({ total: 10000, stripeFee: 175, balance: 5000 });
ok("deposit order without a setup fee: the fee as read, at most the deposit part", f === 175, `got ${f}`);
// The charge words still name what the card paid (sale + setup fee): unchanged.
const note = (await db.query(`SELECT body FROM public.notes WHERE who = $1 AND title = 'Order accepted' AND body LIKE '%$32.00%' LIMIT 1`, [BUYER])).rows[0]?.body ?? "";
ok("the buyer's charge notice still names the full charge", /charged \$32\.00, including the one-time \$2\.00 account setup fee/.test(note), note);
const g = (await db.query(`SELECT has_function_privilege('authenticated', 'public.shop_order_captured(uuid, integer)', 'EXECUTE') AS v`)).rows[0].v;
ok("members still cannot run shop_order_captured", g === false);

console.log(failed ? `\n${failed} FAIL` : "\nALL OK");
process.exit(failed ? 1 : 0);
