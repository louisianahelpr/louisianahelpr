#!/usr/bin/env node
/**
 * Q2106 S3b step 2 (PGlite proof for declutter_record_refund in 20261105042758_declutter_gift_refund_rows): a refund
 * of a gift-paid Declutter order records its gift share, and Stripe's card fee is on the CARD part only (lead 11-04).
 *   (1) card-only order: unchanged (fee estimated on the whole payment, gift share 0);
 *   (2) gift+card order, platform absorbs: gift share = the order's net gift, fee estimated on the card part only;
 *   (3) gift+card order, buyer keeps no fee (keep_card_fee): the kept fee comes out of the card part, the gift back whole;
 *   (4) gift-only order (no payment intent): recorded with no payment intent, fee 0, all of it to the gift; a replay
 *       returns the same row; a fee passed in is ignored (no card part);
 *   (5) a NULL payment intent on an order that has a card payment is refused (refund_payment_unknown);
 *   (6) a duplicate card payment on a gift order (not the order's own) is card only, gift share 0.
 *   node src/test/pglite/declutterGiftRecordRefund.pglite.mjs                    # all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/declutterGiftRecordRefund.pglite.mjs # RED (the previous definition)
 * Real: declutter_record_refund (newest definition in this file, or with skip the newest before it; any dollar-quote
 * tag), declutter_card_fee_estimate (20261014224914), this migration's table changes. Stubbed, said so: the tables
 * reduced to the columns read and the later reason/policy CHECKs dropped; declutter_order_gift_net_cents returns the
 * stub order's gift_cents; the reserved-cents helpers return 0; declutter_notify and declutter_order_items_named are
 * stand-ins. pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261105042758_declutter_gift_refund_rows.sql";
const skip = process.env.NEW_MIGRATION === "skip";

function definitionBefore(name, before, inclusive = false) {
  let last = null;
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql") && (inclusive ? x <= before : x < before)).sort()) {
    const sql = readFileSync(MIG_DIR + f, "utf8");
    const head = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi");
    for (const m of sql.matchAll(head)) {
      const rest = sql.slice(m.index);
      const tag = /\bAS\s+(\$\w*\$)/i.exec(rest);
      const end = rest.indexOf(tag[1], tag.index + tag[0].length);
      last = rest.slice(0, end + tag[1].length) + ";";
    }
  }
  if (!last) throw new Error(`no definition of ${name}`);
  return last;
}
let failures = 0;
const check = (ok, name, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  (${detail})` : ""}`); if (!ok) failures++; };

const base = readFileSync(MIG_DIR + "20261014224914_declutter_slice3b_payments.sql", "utf8");
const create = /CREATE TABLE IF NOT EXISTS public\.declutter_refunds \([\s\S]*?\n\);/.exec(base)[0];
const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY, seller_id uuid, buyer_id uuid, stripe_payment_intent_id text,
    stripe_checkout_session_id text,
    total_cents integer, setup_fee_cents integer DEFAULT 0, setup_fee_state text, items_cents integer, premium_cents integer,
    tax_cents integer DEFAULT 0, delivery_cents integer DEFAULT 0, shipping_cents integer DEFAULT 0, gift_cents integer DEFAULT 0);
  ${create}
  -- The columns and tables this file's two LANGUAGE sql functions read (declutter_refunds_due,
  -- declutter_order_refunds_recorded_cents): checked when they are created, so the stub has to carry them.
  ALTER TABLE public.declutter_refunds ADD COLUMN attempts integer NOT NULL DEFAULT 0,
    ADD COLUMN payment_livemode boolean, ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now();
  CREATE TABLE public.declutter_payouts (id uuid PRIMARY KEY, order_id uuid, seller_id uuid, status text);
  CREATE TABLE public.payout_payee_waits (payout_kind text, payout_id uuid, category text);
  CREATE TABLE public.payout_holds (helper_id uuid);
  CREATE TABLE public.declutter_delivery_refunds (order_id uuid, stripe_payment_intent_id text, status text, refund_cents integer);
  ALTER TABLE public.declutter_refunds ADD COLUMN kept_cents integer NOT NULL DEFAULT 0;
  ALTER TABLE public.declutter_refunds DROP CONSTRAINT declutter_refunds_reason_check;
  ALTER TABLE public.declutter_refunds DROP CONSTRAINT declutter_refunds_policy;
  ALTER TABLE public.declutter_refunds DROP CONSTRAINT declutter_refunds_fee_policy_check;
  ALTER TABLE public.declutter_refunds DROP CONSTRAINT declutter_refunds_amount;
  CREATE TABLE public.declutter_seller_fee_debts (seller_id uuid, refund_id uuid UNIQUE, amount_cents integer, remaining_cents integer, fee_estimated boolean);
  CREATE TABLE public.helpr_tasks (helpr_id uuid, source_kind text, source_id uuid);
  CREATE TABLE public.notices (u uuid, body text);
  CREATE FUNCTION public.declutter_notify(a uuid, b text, c text, d text, e text, f uuid) RETURNS void LANGUAGE sql AS $$ INSERT INTO public.notices VALUES (a, d) $$;
  CREATE FUNCTION public.declutter_order_items_named(o uuid) RETURNS text LANGUAGE sql AS $$ SELECT 'Lamp' $$;
  CREATE FUNCTION public.declutter_delivery_reserved_cents(o uuid) RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
  CREATE FUNCTION public.declutter_shipping_reserved_cents(o uuid) RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
  CREATE FUNCTION public.declutter_order_gift_net_cents(o uuid) RETURNS integer LANGUAGE sql AS $$ SELECT gift_cents FROM public.declutter_orders WHERE id = o $$;
  ${definitionBefore("declutter_card_fee_estimate", "20261014224915")}
`);
if (!skip) {
  const sql = readFileSync(MIG_DIR + THIS, "utf8");
  for (let i = 0; i < 3; i++) await db.exec(sql);
} else {
  // The table changes of this file, then the previous definition of the function.
  const sql = readFileSync(MIG_DIR + THIS, "utf8");
  await db.exec(sql.slice(0, sql.indexOf("CREATE OR REPLACE FUNCTION public.declutter_record_refund(")));
  await db.exec(definitionBefore("declutter_record_refund", THIS));
}
const S = "00000000-0000-4000-8000-00000000000a";
const O = (n) => `00000000-0000-4000-8000-00000000000${n}`;
await db.exec(`INSERT INTO public.declutter_orders (id, seller_id, stripe_payment_intent_id, total_cents, gift_cents) VALUES
  ('${O(1)}', '${S}', 'pi_card', 1000, 0), ('${O(2)}', '${S}', 'pi_mix', 1000, 600), ('${O(3)}', '${S}', 'pi_mix3', 1000, 600),
  ('${O(4)}', '${S}', NULL, 1000, 1000), ('${O(5)}', '${S}', 'pi_c5', 1000, 600)`);
const rec = async (o, pi, reason, paid, fee = null) => {
  try { return (await db.query(`SELECT public.declutter_record_refund($1, $2, $3, $4, $5) AS id`, [o, pi, reason, paid, fee])).rows[0].id; }
  catch (e) { return `ERR ${String(e.message).slice(0, 80)}`; }
};
const row = async (id) => String(id).startsWith("ERR") ? { err: id } : (await db.query(`SELECT stripe_payment_intent_id AS pi, card_fee_cents AS fee, refund_cents AS refund, gift_refund_cents AS gift FROM public.declutter_refunds WHERE id = $1`, [id])).rows[0] ?? {};
const est = (c) => Math.min(c, Math.round(c * 0.029) + 30);

let r = await row(await rec(O(1), "pi_card", "order_closed", 1000));
check(r.fee === est(1000) && r.refund === 1000 && (r.gift ?? 0) === 0, "(1) card-only: fee on the whole payment, no gift share", JSON.stringify(r));
r = await row(await rec(O(2), "pi_mix", "order_closed", 1000));
check(r.fee === est(400) && r.refund === 1000 && r.gift === 600, "(2) gift+card: gift share 600, fee on the 400 card part", JSON.stringify(r));
r = await row(await rec(O(3), "pi_mix3", "buyer_cancelled", 1000));
check(r.fee === est(400) && r.refund === 1000 - est(400) && r.gift === 600, "(3) kept fee comes out of the card part; the gift back whole", JSON.stringify(r));
const g1 = await rec(O(4), null, "order_closed", 1000, 59);
r = await row(g1);
check(r.pi === null && r.fee === 0 && r.refund === 1000 && r.gift === 1000, "(4) gift-only: no payment intent, fee 0, all to the gift", JSON.stringify(r) + " " + g1);
const g2 = await rec(O(4), null, "order_closed", 1000, 59);
check(!String(g1).startsWith("ERR") && g2 === g1, "(4) a replay returns the same row", `${g1} ${g2}`);
check(String(await rec(O(5), null, "order_closed", 1000)).includes("refund_payment_unknown"), "(5) no payment intent on an order paid by card is refused");
r = await row(await rec(O(5), "pi_dup", "duplicate_payment", 1000));
check(r.fee === est(1000) && (r.gift ?? 0) === 0, "(6) a duplicate card payment on a gift order is card only", JSON.stringify(r));
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
