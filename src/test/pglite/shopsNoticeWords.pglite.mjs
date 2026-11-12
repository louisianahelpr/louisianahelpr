#!/usr/bin/env node
/**
 * PGlite proof for 20261112081213_shops_notice_words_s011_s017.sql (Shops audit 11-12 S011, S017).
 *   S011: the shop's payout notice names the amount really sent (the one-time setup fee taken out of the first payout,
 *         as shop_payout_take_setup_fee does, never under $1) and says "Verify your ID" while the payout waits for it.
 *   S017: ready / handed over / problem / done notices say "done" for a service and "delivered" for a delivery.
 *
 *   node src/test/pglite/shopsNoticeWords.pglite.mjs                    # ALL PASS (migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/shopsNoticeWords.pglite.mjs # RED: the newest CREATEs before it
 *   MIGRATION_PATH=<planted copy> node ...                               # RED on a planted defect
 *
 * Stubbed, and said so: tables cut to the columns read; auth.uid() from a setting; is_caller_banned false;
 * contact_leak_reason NULL; declutter_consume_fee_debt from a setting; declutter_setup_fee_from_payout_cents and
 * payout_waits_on_identity from tables; declutter_notify records; storage.objects empty (in-person needs no photo).
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = process.env.MIGRATION_PATH ?? MIG_DIR + "20261112081213_shops_notice_words_s011_s017.sql";
const skip = process.env.NEW_MIGRATION === "skip";
let failures = 0;
const check = (ok, name, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  (${detail})` : ""}`); if (!ok) failures++; };
const U = (n) => `5a0b5a0c-0000-0000-0000-${String(n).padStart(12, "0")}`;
const BUYER = U(1), SELLER = U(2);
function fnFrom(file, name) {
  const t = readFileSync(MIG_DIR + file, "utf8");
  const s = t.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const tag = t.slice(s).match(/\nAS (\$[a-z_]*\$)/)[1];
  const open = t.indexOf(`\nAS ${tag}`, s) + 4 + tag.length;
  return t.slice(s, t.indexOf(`\n${tag}`, open) + 1 + tag.length) + ";";
}
const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth; CREATE SCHEMA storage;
CREATE TABLE storage.objects (bucket_id text, name text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS \$f\$ SELECT nullif(current_setting('test.uid', true), '')::uuid \$f\$;
CREATE TABLE public.shop_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), buyer_id uuid, seller_id uuid, status text NOT NULL,
  captured_at timestamptz, close_reason text, closed_at timestamptz, handed_over_at timestamptz, ready_date date,
  handover_mode text NOT NULL DEFAULT 'in_person', fulfillment text NOT NULL DEFAULT 'pickup', helpr_unfilled_at timestamptz,
  items_cents integer NOT NULL DEFAULT 5000, delivery_cents integer NOT NULL DEFAULT 0, is_digital boolean NOT NULL DEFAULT false);
CREATE TABLE public.shop_order_lines (order_id uuid, kind text, at_buyer boolean);
CREATE TABLE public.shop_handovers (order_id uuid PRIMARY KEY, ready_at timestamptz, ready_photo_path text, shop_confirmed_at timestamptz,
  confirmed_at timestamptz, confirmed_how text, problem_at timestamptz, problem_note text);
CREATE TABLE public.shop_payouts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid UNIQUE, items_cents integer, debt_cents integer,
  amount_cents integer, status text, next_attempt_at timestamptz);
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, stripe_account_id text, onboarding_fee_paid boolean DEFAULT false);
CREATE TABLE public.user_roles (user_id uuid, role text);
CREATE TABLE public.id_waits (user_id uuid);
CREATE TABLE public.notices (user_id uuid, title text, message text);
CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql AS 'SELECT false';
CREATE FUNCTION public.contact_leak_reason(text) RETURNS text LANGUAGE sql AS 'SELECT NULL::text';
CREATE FUNCTION public.shop_local_today() RETURNS date LANGUAGE sql AS \$f\$ SELECT (now() AT TIME ZONE 'America/Chicago')::date \$f\$;
CREATE FUNCTION public.declutter_consume_fee_debt(uuid, text, integer) RETURNS integer LANGUAGE sql AS
  \$f\$ SELECT least(\$3, coalesce(nullif(current_setting('test.debt', true), ''), '0')::integer) \$f\$;
CREATE FUNCTION public.declutter_setup_fee_from_payout_cents(uuid) RETURNS integer LANGUAGE sql AS 'SELECT 200';
CREATE FUNCTION public.payout_waits_on_identity(u uuid) RETURNS boolean LANGUAGE sql AS
  \$f\$ SELECT EXISTS (SELECT 1 FROM public.id_waits w WHERE w.user_id = u) \$f\$;
CREATE FUNCTION public.declutter_notify(u uuid, ty text, ti text, m text, l text, a uuid DEFAULT NULL) RETURNS void LANGUAGE sql AS
  \$f\$ INSERT INTO public.notices VALUES (u, ti, m) \$f\$;
INSERT INTO public.profiles (user_id, stripe_account_id) VALUES ('${BUYER}', NULL), ('${SELLER}', 'acct_1');
`);
if (skip) {
  await db.exec(fnFrom("20261105190034_shops_handover_notes.sql", "shops_mark_ready"));
  await db.exec(fnFrom("20261112075006_shops_audit_mediums.sql", "shops_mark_handed_over"));
  await db.exec(fnFrom("20261103173728_q2390_haul_price_withdraw_guarantee_raise_refund_admin_delivery_cart_shops_rent_not_found_is_404.sql", "shops_report_not_received"));
  await db.exec(fnFrom("20261109224952_notices_card_fee_and_our_team.sql", "shop_complete_handover"));
} else {
  const mig = readFileSync(THIS, "utf8");
  for (let k = 1; k <= 3; k++) await db.exec(mig);
}
const q = async (s) => (await db.query(s)).rows;
const order = async ({ f = "pickup", kind = "made", atBuyer = false, items = 5000 } = {}) => {
  const id = (await q(`INSERT INTO public.shop_orders (buyer_id, seller_id, status, captured_at, ready_date, fulfillment, items_cents)
    VALUES ('${BUYER}', '${SELLER}', 'accepted', now(), current_date - 1, '${f}', ${items}) RETURNING id`))[0].id;
  await db.exec(`INSERT INTO public.shop_order_lines VALUES ('${id}', '${kind}', ${atBuyer})`);
  return id;
};
const as = (u) => db.exec(`SELECT set_config('test.uid', '${u}', false)`);
const last = async (u) => (await q(`SELECT title, message FROM public.notices WHERE user_id = '${u}' ORDER BY ctid DESC LIMIT 1`))[0] ?? {};
const run = async (sql) => { try { await q(sql); return null; } catch (e) { return e.message; } };
try {
  // S017: shops_mark_ready
  const svc = await order({ kind: "service" });
  await as(SELLER); let e = await run(`SELECT public.shops_mark_ready('${svc}', NULL)`);
  let n = await last(BUYER);
  check(!e && /ready for your order/.test(n.message ?? "") && !/pick up at the shop/.test(n.message ?? ""), "S017: a service's ready notice does not say pick up at the shop", e ?? JSON.stringify(n));
  const del = await order({ f: "shop_delivers" });
  e = await run(`SELECT public.shops_mark_ready('${del}', NULL)`); n = await last(BUYER);
  check(!e && /the shop will deliver it/.test(n.message ?? ""), "S017: a shop delivery's ready notice says the shop delivers", e ?? JSON.stringify(n));
  // S017: shops_mark_handed_over
  e = await run(`SELECT public.shops_mark_handed_over('${svc}')`); n = await last(BUYER);
  check(!e && n.title === "The shop says the work is done" && /tap "It''s done"|tap "It's done"/.test(n.message ?? "") && !/handed over/.test(n.message ?? ""), "S017: a service marked done says done / It's done / Something's wrong", e ?? JSON.stringify(n));
  e = await run(`SELECT public.shops_mark_handed_over('${del}')`); n = await last(BUYER);
  check(!e && /as delivered/.test(n.message ?? ""), "S017: a shop delivery marked done says delivered", e ?? JSON.stringify(n));
  const pk = await order();
  e = await run(`SELECT public.shops_mark_handed_over('${pk}')`); n = await last(BUYER);
  check(!e && n.title === "The shop says you have your order" && /as handed over/.test(n.message ?? ""), "S017: a pickup keeps the handed-over words", e ?? JSON.stringify(n));
  // S017: shops_report_not_received
  const svc2 = await order({ kind: "made", atBuyer: true });
  await as(BUYER); e = await run(`SELECT public.shops_report_not_received('${svc2}', 'Not done')`); n = await last(SELLER);
  check(!e && n.title === "Problem reported" && /something is wrong/.test(n.message ?? ""), "S017: a problem on at-home work is not a pickup problem", e ?? JSON.stringify(n));
  const del2 = await order({ f: "shop_delivers" });
  e = await run(`SELECT public.shops_report_not_received('${del2}', 'Never came')`); n = await last(SELLER);
  check(!e && n.title === "Delivery problem reported", "S017: a problem on a delivery is a delivery problem", e ?? JSON.stringify(n));
  // S017: shop_complete_handover buyer words
  const svc3 = await order({ kind: "service" });
  e = await run(`SELECT public.shop_complete_handover('${svc3}', 'buyer')`); n = await last(BUYER);
  check(!e && /The work is done/.test(n.message ?? ""), "S017: a confirmed service says the work is done (not the pickup)", e ?? JSON.stringify(n));
  const hd = await order({ f: "helpr_delivers" });
  e = await run(`SELECT public.shop_complete_handover('${hd}', 'auto')`); n = await last(BUYER);
  check(!e && /24 hours after your Helpr delivered/.test(n.message ?? ""), "S017: a Helpr delivery's auto-confirm names the 24 hours after delivery", e ?? JSON.stringify(n));
  // S011: first payout, setup fee owed: $50.00 - $2.00 = $48.00
  const p1 = await order();
  e = await run(`SELECT public.shop_complete_handover('${p1}', 'buyer')`); n = await last(SELLER);
  check(!e && /^\$48\.00 is on its way/.test(n.message ?? "") && /setup fee was taken out/.test(n.message ?? ""), "S011: the first payout's notice takes the $2 setup fee out", e ?? JSON.stringify(n));
  // with card-fee debt too: $50 - $3 debt - $2 fee = $45
  await db.exec(`SELECT set_config('test.debt', '300', false)`);
  const p2 = await order();
  e = await run(`SELECT public.shop_complete_handover('${p2}', 'buyer')`); n = await last(SELLER);
  check(!e && /^\$45\.00 is on its way/.test(n.message ?? "") && /card cost you owed and the one-time/.test(n.message ?? ""), "S011: debt and setup fee both taken out", e ?? JSON.stringify(n));
  await db.exec(`SELECT set_config('test.debt', '0', false)`);
  // a payout that would fall under $1 after the fee: the fee is not taken (shop_payout_take_setup_fee skips it)
  const p3 = await order({ items: 250 });
  e = await run(`SELECT public.shop_complete_handover('${p3}', 'buyer')`); n = await last(SELLER);
  check(!e && /^\$2\.50 is on its way to your payout account\.$/.test(n.message ?? ""), "S011: no fee when the payout would fall under $1", e ?? JSON.stringify(n));
  // fee already paid: whole amount
  await db.exec(`UPDATE public.profiles SET onboarding_fee_paid = true WHERE user_id = '${SELLER}'`);
  const p4 = await order();
  e = await run(`SELECT public.shop_complete_handover('${p4}', 'buyer')`); n = await last(SELLER);
  check(!e && /^\$50\.00 is on its way to your payout account\.$/.test(n.message ?? ""), "S011: fee already paid: the whole amount", e ?? JSON.stringify(n));
  // ID wait: not "on its way"
  await db.exec(`INSERT INTO public.id_waits VALUES ('${SELLER}')`);
  const p5 = await order();
  e = await run(`SELECT public.shop_complete_handover('${p5}', 'buyer')`); n = await last(SELLER);
  check(!e && /^Verify your ID/.test(n.message ?? "") && !/on its way/.test(n.message ?? ""), "S011: a payout waiting for the ID check says verify your ID", e ?? JSON.stringify(n));
  const pay = await q(`SELECT amount_cents FROM public.shop_payouts WHERE order_id = '${p1}'`);
  check(pay[0]?.amount_cents === 5000, "S011: the payout row itself is unchanged (the fee is taken at send time)", JSON.stringify(pay));
} catch (err) { check(false, `threw: ${err.message}`); }
console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
