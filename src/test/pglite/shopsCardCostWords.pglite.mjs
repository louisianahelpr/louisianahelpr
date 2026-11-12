#!/usr/bin/env node
/**
 * PGlite proof for 20261112200351_shops_card_cost_words.sql (S010 leftover, F089): the shop's notices after a
 * no-ready-photo refund and after its own cancel say "card processing cost" with no number; the refund, strike and
 * buyer notice are unchanged.
 *
 *   node src/test/pglite/shopsCardCostWords.pglite.mjs                    # ALL PASS (migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/shopsCardCostWords.pglite.mjs # RED: the newest CREATEs before it
 *   MIGRATION_PATH=<planted copy> node ...                                # RED on a planted defect
 *
 * Stubbed, and said so: tables cut to the columns read; auth.uid() from a setting; is_caller_banned false;
 * contact_leak_reason NULL; shop_lock_open_charged_order returns the row; shop_write_refund inserts a fixed row
 * (refund 3000, card fee 117); shop_return_stock / shop_give_strike / log_cron_defect record; is_test_subject false.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = process.env.MIGRATION_PATH ?? MIG_DIR + "20261112200351_shops_card_cost_words.sql";
const skip = process.env.NEW_MIGRATION === "skip";
let failures = 0;
const check = (ok, name, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  (${detail})` : ""}`); if (!ok) failures++; };
const U = (n) => `5a0b5a10-0000-0000-0000-${String(n).padStart(12, "0")}`;
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
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT nullif(current_setting('test.uid', true), '')::uuid $f$;
CREATE TABLE public.shop_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), buyer_id uuid, seller_id uuid, status text, captured_at timestamptz,
  handover_mode text DEFAULT 'porch', preorder_item_id uuid, ready_date date, close_reason text, decline_reason text, closed_at timestamptz,
  is_seed boolean NOT NULL DEFAULT false);
CREATE TABLE public.shop_handovers (order_id uuid PRIMARY KEY, ready_photo_path text, problem_at timestamptz);
CREATE TABLE public.shop_refunds (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid, reason text, refund_cents integer, card_fee_cents integer);
CREATE TABLE public.user_roles (user_id uuid, role text);
CREATE TABLE public.notices (user_id uuid, title text, message text);
CREATE TABLE public.events (what text, ref uuid);
CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql AS 'SELECT false';
CREATE FUNCTION public.contact_leak_reason(text) RETURNS text LANGUAGE sql AS 'SELECT NULL::text';
CREATE FUNCTION public.is_test_subject(uuid) RETURNS boolean LANGUAGE sql AS 'SELECT false';
CREATE FUNCTION public.shop_lock_open_charged_order(p uuid, b boolean) RETURNS public.shop_orders LANGUAGE sql AS
  $f$ SELECT * FROM public.shop_orders WHERE id = p $f$;
CREATE FUNCTION public.shop_write_refund(p uuid, reason text, note text) RETURNS public.shop_refunds LANGUAGE sql AS
  $f$ INSERT INTO public.shop_refunds (order_id, reason, refund_cents, card_fee_cents) VALUES (p, reason, 3000, 117) RETURNING * $f$;
CREATE FUNCTION public.shop_return_stock(p uuid) RETURNS void LANGUAGE sql AS $f$ INSERT INTO public.events VALUES ('stock', p) $f$;
CREATE FUNCTION public.shop_give_strike(u uuid, s text, k text, p uuid) RETURNS void LANGUAGE sql AS $f$ INSERT INTO public.events VALUES ('strike:' || k, p) $f$;
CREATE FUNCTION public.log_cron_defect(a text, b text, c text) RETURNS void LANGUAGE sql AS $f$ INSERT INTO public.events VALUES ('defect:' || c, NULL) $f$;
CREATE FUNCTION public.declutter_notify(u uuid, ty text, ti text, m text, l text, a uuid DEFAULT NULL) RETURNS void LANGUAGE sql AS
  $f$ INSERT INTO public.notices VALUES (u, ti, m) $f$;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
`);
if (skip) {
  await db.exec(fnFrom("20261108184654_shops_preorders.sql", "shop_refund_sweep"));
  await db.exec(fnFrom("20261103162420_q2390_handover_paid_refund_shop_cancel_photo_no_show_decline_not_found_is_404.sql", "shops_shop_cancel_order"));
  await db.exec(`GRANT EXECUTE ON FUNCTION public.shops_shop_cancel_order(uuid, text) TO authenticated;`);
} else {
  const mig = readFileSync(THIS, "utf8");
  for (let k = 1; k <= 3; k++) {
    let err = null;
    try { await db.exec(mig); } catch (e) { err = e.message; }
    check(!err, `migration applies (run ${k})`, err ?? "");
  }
}
const q = async (s, p = []) => (await db.query(s, p)).rows;
const FEE_WORDS = /card fee|\$1\.17|\$\d/;

// 1. The no-ready-photo sweep.
const late = (await q(`INSERT INTO public.shop_orders (buyer_id, seller_id, status, captured_at, ready_date) VALUES ($1, $2, 'accepted', now(), current_date - 10) RETURNING id`, [BUYER, SELLER]))[0].id;
await q(`INSERT INTO public.shop_handovers (order_id) VALUES ($1)`, [late]);
const res = (await q(`SELECT public.shop_refund_sweep() AS r`))[0].r;
check(res?.no_ready_photo_refunded === 1, "the sweep still refunds the order", JSON.stringify(res) + JSON.stringify(await q(`SELECT * FROM public.events`)));
let shopNote = (await q(`SELECT message FROM public.notices WHERE user_id = $1 AND title = 'Order refunded'`, [SELLER]))[0]?.message ?? "";
const day = (await q(`SELECT to_char(current_date - 10, 'FMMonth FMDD') AS d`))[0].d;
check(shopNote === `You never posted the ready photo for the order for ${day}, so the buyer was refunded in full. The card processing cost comes out of your next payout, and it counts as a Shops strike.`,
  "the shop's sweep notice says 'card processing cost', no number", shopNote);
check(!FEE_WORDS.test(shopNote), "no 'card fee' and no dollar figure in it");
const buyerNote = (await q(`SELECT message FROM public.notices WHERE user_id = $1 AND title = 'Order refunded'`, [BUYER]))[0]?.message ?? "";
check(buyerNote === `The shop never marked your order for ${day} ready, so all $30.00 is on its way back to your card.`, "the buyer's notice is unchanged", buyerNote);
check((await q(`SELECT count(*)::int AS c FROM public.events WHERE what = 'strike:no_ready_photo'`))[0].c === 1, "the strike is unchanged");

// 2. The shop's own cancel.
const acc = (await q(`INSERT INTO public.shop_orders (buyer_id, seller_id, status, captured_at, ready_date, handover_mode) VALUES ($1, $2, 'accepted', now(), current_date + 3, 'in_person') RETURNING id`, [BUYER, SELLER]))[0].id;
await db.exec(`SET test.uid = '${SELLER}'; SET ROLE authenticated;`);
let out, err = null;
try { out = (await db.query(`SELECT public.shops_shop_cancel_order($1, NULL) AS r`, [acc])).rows[0].r; } catch (e) { err = e.message; }
await db.exec(`RESET ROLE; SET test.uid = '';`);
check(!err && out?.result === "cancelled" && out?.refund_cents === 3000, "the shop's cancel still refunds and answers the same", err ?? JSON.stringify(out));
shopNote = (await q(`SELECT message FROM public.notices WHERE user_id = $1 AND title = 'Order cancelled'`, [SELLER]))[0]?.message ?? "";
check(shopNote === "You cancelled an accepted order. The buyer gets everything back, the card processing cost comes out of your next payout, and it counts as a Shops strike.",
  "the shop's cancel notice says 'card processing cost', no number", shopNote);
check(!FEE_WORDS.test(shopNote), "no 'card fee' and no dollar figure in it");
check((await q(`SELECT count(*)::int AS c FROM public.events WHERE what = 'strike:shop_cancelled'`))[0].c === 1, "the cancel strike is unchanged");
const g = (await q(`SELECT has_function_privilege('anon', 'public.shops_shop_cancel_order(uuid, text)', 'EXECUTE') AS a,
                           has_function_privilege('authenticated', 'public.shop_refund_sweep()', 'EXECUTE') AS s`))[0];
check(g.a === false && g.s === false, "grants unchanged (anon cannot cancel; members cannot run the sweep)");

console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
