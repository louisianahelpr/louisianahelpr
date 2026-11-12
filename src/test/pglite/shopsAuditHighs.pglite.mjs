#!/usr/bin/env node
/**
 * PGlite proof for 20261112073633_shops_audit_highs.sql (Shops audit 11-12, launch-blocking Highs S002-S006).
 *
 *   node src/test/pglite/shopsAuditHighs.pglite.mjs                    # ALL PASS (migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/shopsAuditHighs.pglite.mjs # RED: the old bodies, read from their newest CREATEs
 *   MUTANT=<name> node ...                                              # each must FAIL (see MUTANTS)
 *
 * Real: the five restated functions and the email trigger, applied verbatim (3x). With NEW_MIGRATION=skip the old
 * bodies are read verbatim from the files the migration names. Stubbed, and said so: auth.uid() from a setting;
 * is_caller_banned false; shop_lock_open_charged_order returns the row; shop_owe_shop 100; shop_give_strike and
 * shop_complete_handover record their call; shop_owner_sell_block_reason reads a table; shop_cottage_sales_cents reads
 * a setting; declutter_notify, shop_day_count, shop_preorder_units no-ops; email_shop_order_notice records the row.
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261112073633_shops_audit_highs.sql";
const skip = process.env.NEW_MIGRATION === "skip";

const MUTANTS = {
  noShowHelpr: ["  IF o.fulfillment = 'helpr_delivers' AND o.helpr_unfilled_at IS NULL THEN\n    RAISE EXCEPTION 'helpr_delivery_no_show'", "  IF false THEN\n    RAISE EXCEPTION 'helpr_delivery_no_show'"],
  noShowFallbackRefused: ["  IF o.fulfillment = 'helpr_delivers' AND o.helpr_unfilled_at IS NULL THEN", "  IF o.fulfillment = 'helpr_delivers' THEN"],
  confirmEarly: ["     AND public.shop_local_today() < o.ready_date\n", "     AND false\n"],
  confirmIgnoresReady: ["(h.ready_at IS NOT NULL OR h.shop_confirmed_at IS NOT NULL)", "(h.shop_confirmed_at IS NOT NULL)"],
  preHidden: ["    IF EXISTS (SELECT 1 FROM public.shops s WHERE s.id = o.shop_id AND s.hidden_at IS NOT NULL)\n       OR public.shop_owner_sell_block_reason", "    IF public.shop_owner_sell_block_reason"],
  preSellBlock: ["       OR public.shop_owner_sell_block_reason(o.seller_id) IS NOT NULL\n", ""],
  preBan: ["                     AND pr.ban_status IN ('banned', 'temp_banned', 'permanently_banned')\n                     AND (pr.ban_status <> 'temp_banned' OR pr.auto_suspended_until IS NULL OR pr.auto_suspended_until > now()))\n       OR (v_pre_home_food", "                     AND false)\n       OR (v_pre_home_food"],
  preCapReachedOnly: ["                + v_pre_home_food > (SELECT c.cap_cents", "                > (SELECT c.cap_cents"],
  emailTitlesOnly: ["     OR (NEW.link LIKE '/shops/orders%'\n         AND (NEW.message ILIKE '%refund%' OR NEW.message ILIKE '%back to your card%' OR NEW.message ILIKE '%coming back%'))))", "))"],
  sideKept: ["          'Nobody has confirmed this handover for 60 days. The money stays held until our team decides. To tell our team your side, contact Louisiana Helpr support.',\n          '/shops/orders', r.seller_id);", "          'Nobody has confirmed this handover for 60 days. The money stays held until our team decides. You can add your side on the order.',\n          '/shops/orders', r.seller_id);"],
};

let failures = 0;
const check = (ok, name, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  (${detail})` : ""}`); if (!ok) failures++; };
const U = (n) => `5d0b5d0c-0000-0000-0000-${String(n).padStart(12, "0")}`;
const BUYER = U(1), SELLER = U(2), SHOP = U(3), BANNED = U(4), ITEM = U(5);

/** A function's CREATE ... $tag$; from a migration file (the LAST one in that file). */
function fnFrom(file, name) {
  const t = readFileSync(MIG_DIR + file, "utf8");
  const s = t.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if (s < 0) throw new Error(`${name} not in ${file}`);
  const tag = t.slice(s).match(/\nAS (\$[a-z_]*\$)/)[1];
  const open = t.indexOf(`\nAS ${tag}`, s) + 4 + tag.length;
  const end = t.indexOf(`\n${tag}`, open) + 1 + tag.length;
  return t.slice(s, end) + ";";
}

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT nullif(current_setting('test.uid', true), '')::uuid $f$;
CREATE TABLE public.shops (id uuid PRIMARY KEY, owner_id uuid, name text, daily_order_cap smallint, hidden_at timestamptz);
CREATE TABLE public.shop_items (id uuid PRIMARY KEY, title text, preorder_ready_by date, preorder_goal_missed_at timestamptz,
  preorder_goal_by date, preorder_cap integer);
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, onboarding_fee_paid boolean, onboarding_fee_charged_at timestamptz,
  ban_status text, auto_suspended_until timestamptz);
CREATE TABLE public.shop_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid, buyer_id uuid, seller_id uuid,
  status text NOT NULL, items_cents integer NOT NULL DEFAULT 0, premium_cents integer NOT NULL DEFAULT 0, tax_cents integer NOT NULL DEFAULT 0,
  delivery_cents integer NOT NULL DEFAULT 0, total_cents integer NOT NULL DEFAULT 0, gift_cents integer NOT NULL DEFAULT 0,
  stripe_payment_intent_id text, stripe_checkout_session_id text, captured_at timestamptz,
  setup_fee_cents integer NOT NULL DEFAULT 0, setup_fee_state text,
  payment_livemode boolean, close_reason text, closed_at timestamptz, held_at timestamptz, accept_by timestamptz,
  accepted_at timestamptz, preorder_item_id uuid, ready_date date, handover_mode text NOT NULL DEFAULT 'in_person',
  fulfillment text NOT NULL DEFAULT 'pickup', helpr_unfilled_at timestamptz, is_seed boolean NOT NULL DEFAULT false);
CREATE TABLE public.shop_order_lines (order_id uuid, quantity integer NOT NULL DEFAULT 1, kind text NOT NULL DEFAULT 'made',
  line_cents integer NOT NULL DEFAULT 0);
CREATE TABLE public.shop_handovers (order_id uuid PRIMARY KEY, ready_at timestamptz, shop_confirmed_at timestamptz);
CREATE TABLE public.shop_cottage_settings (id boolean PRIMARY KEY DEFAULT true, cap_cents bigint);
INSERT INTO public.shop_cottage_settings VALUES (true, 10000000);
CREATE TABLE public.sell_blocks (user_id uuid, reason text);
CREATE TABLE public.calls (what text, order_id uuid);
CREATE TABLE public.emails (title text);
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, title text, message text, type text, link text);
CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql AS 'SELECT false';
CREATE FUNCTION public.shop_lock_open_charged_order(p uuid, b boolean) RETURNS public.shop_orders LANGUAGE sql AS
  $f$ SELECT * FROM public.shop_orders WHERE id = p $f$;
CREATE FUNCTION public.shop_owe_shop(uuid) RETURNS integer LANGUAGE sql AS 'SELECT 100';
CREATE FUNCTION public.shop_give_strike(p uuid, s text, r text, o uuid) RETURNS void LANGUAGE sql AS
  $f$ INSERT INTO public.calls VALUES ('strike', o) $f$;
CREATE FUNCTION public.shop_complete_handover(p uuid, by text) RETURNS jsonb LANGUAGE sql AS
  $f$ INSERT INTO public.calls VALUES ('complete', p); SELECT jsonb_build_object('result', 'handed_over') $f$;
CREATE FUNCTION public.shop_owner_sell_block_reason(p uuid) RETURNS text LANGUAGE sql AS
  $f$ SELECT reason FROM public.sell_blocks WHERE user_id = p LIMIT 1 $f$;
CREATE FUNCTION public.shop_cottage_sales_cents(p uuid) RETURNS bigint LANGUAGE sql AS
  $f$ SELECT coalesce(nullif(current_setting('test.sales', true), ''), '0')::bigint $f$;
CREATE FUNCTION public.declutter_notify(uuid, text, text, text, text, uuid DEFAULT NULL) RETURNS void LANGUAGE sql AS 'SELECT NULL::void';
CREATE FUNCTION public.shop_day_count(uuid, date, text[]) RETURNS integer LANGUAGE sql AS 'SELECT 0';
CREATE FUNCTION public.shop_preorder_units(uuid, boolean) RETURNS integer LANGUAGE sql AS 'SELECT 0';
CREATE FUNCTION public.shop_local_today() RETURNS date LANGUAGE sql AS $f$ SELECT (now() AT TIME ZONE 'America/Chicago')::date $f$;
CREATE FUNCTION public.are_users_blocked(uuid, uuid) RETURNS boolean LANGUAGE sql AS 'SELECT false';
CREATE FUNCTION public.is_test_subject(uuid) RETURNS boolean LANGUAGE sql AS 'SELECT false';
CREATE FUNCTION public.send_notice_email(uuid, text, text, text, text, uuid) RETURNS void LANGUAGE sql AS 'SELECT NULL::void';
CREATE FUNCTION public.email_shop_order_notice() RETURNS trigger LANGUAGE plpgsql AS
  $f$ BEGIN INSERT INTO public.emails VALUES (NEW.title); RETURN NULL; END $f$;
INSERT INTO public.shops (id, owner_id, name) VALUES ('${SHOP}', '${SELLER}', 'Proof Shop');
INSERT INTO public.profiles (user_id) VALUES ('${BUYER}'), ('${SELLER}');
INSERT INTO public.profiles (user_id, ban_status) VALUES ('${BANNED}', 'banned');
INSERT INTO public.shop_items (id, title) VALUES ('${ITEM}', 'Pie');
`);

if (skip) {
  await db.exec(fnFrom("20261106180902_shops_delivery.sql", "shops_report_no_show"));
  await db.exec(fnFrom("20261103083559_shops_declutter_owner_actions_not_found_is_404.sql", "shops_confirm_pickup"));
  await db.exec(fnFrom("20261111025213_shops_gift_hold_steps.sql", "shop_mark_order_held"));
  await db.exec(fnFrom("20261109224952_notices_card_fee_and_our_team.sql", "shop_handover_sweep"));
  await db.exec(fnFrom("20261108185110_shops_digital_checkout.sql", "shops_report_digital_problem"));
  const t = readFileSync(MIG_DIR + "20261108201655_shops_order_emails.sql", "utf8");
  const a = t.indexOf("DROP TRIGGER IF EXISTS trg_email_shop_order_notice");
  await db.exec(t.slice(a, t.indexOf("EXECUTE FUNCTION public.email_shop_order_notice();", a) + 50));
} else {
  let mig = readFileSync(MIG_DIR + THIS, "utf8");
  const M = process.env.MUTANT ?? "";
  if (M) {
    const m = MUTANTS[M];
    if (!m || mig.split(m[0]).length < 2) throw new Error(`mutant ${M} did not apply`);
    mig = mig.replace(m[0], m[1]);
  }
  for (let k = 1; k <= 3; k++) await db.exec(mig);
}

const q = async (s, p = []) => (await db.query(s, p)).rows;
const as = async (uid, sql) => {
  try {
    await db.exec(`SELECT set_config('test.uid', '${uid}', false)`);
    return { rows: await q(sql) };
  } catch (e) {
    return { error: e.message };
  }
};
const calls = async (what, id) => (await q(`SELECT count(*)::int AS n FROM public.calls WHERE what = $1 AND order_id = $2`, [what, id]))[0].n;
const order = async (over = {}) => {
  const cols = { shop_id: SHOP, buyer_id: BUYER, seller_id: SELLER, status: "accepted", captured_at: "now()", ready_date: "current_date", ...over };
  const keys = Object.keys(cols);
  const vals = keys.map((k) => (cols[k] === null ? "NULL" : /^(now\(\)|current_date.*)$/.test(String(cols[k])) ? cols[k] : `'${cols[k]}'`));
  return (await q(`INSERT INTO public.shop_orders (${keys.join(",")}) VALUES (${vals.join(",")}) RETURNING id`))[0].id;
};
const ready = async (id) => db.exec(`INSERT INTO public.shop_handovers (order_id, ready_at) VALUES ('${id}', now())`);

try {
  // ---- S004: no-show on a Helpr-delivered order ----
  const past = "current_date - 2";
  const hd = await order({ fulfillment: "helpr_delivers", ready_date: past });
  await ready(hd);
  const r1 = await as(SELLER, `SELECT public.shops_report_no_show('${hd}')`);
  check(/helpr_delivery_no_show/.test(r1.error ?? ""), "S004: a Helpr-delivered order cannot be reported as the buyer's no-show", r1.error);
  check((await calls("strike", hd)) === 0, "S004: and the buyer gets no strike");
  const fb = await order({ fulfillment: "helpr_delivers", ready_date: past, helpr_unfilled_at: "2026-11-01" });
  await ready(fb);
  const r2 = await as(SELLER, `SELECT public.shops_report_no_show('${fb}')`);
  check(!r2.error && (await calls("strike", fb)) === 1, "S004: one that fell back to pickup (no Helpr took it) still can be", r2.error);
  const pk = await order({ ready_date: past });
  await ready(pk);
  const r3 = await as(SELLER, `SELECT public.shops_report_no_show('${pk}')`);
  check(!r3.error && (await calls("strike", pk)) === 1, "S004: a pickup order's no-show is unchanged", r3.error);

  // ---- S002: "I got it" before ready ----
  const fut = await order({ ready_date: "current_date + 5" });
  const c1 = await as(BUYER, `SELECT public.shops_confirm_pickup('${fut}')`);
  check(/not_ready_yet/.test(c1.error ?? "") && (await calls("complete", fut)) === 0,
    "S002: \"I got it\" 5 days before the ready date, with no ready mark, is refused (not_ready_yet) and nobody is paid", c1.error);
  await ready(fut);
  const c2 = await as(BUYER, `SELECT public.shops_confirm_pickup('${fut}')`);
  check(!c2.error && (await calls("complete", fut)) === 1, "S002: once the shop marked it ready, the buyer can confirm early", c2.error);
  const handed = await order({ ready_date: "current_date + 5" });
  await db.exec(`INSERT INTO public.shop_handovers (order_id, shop_confirmed_at) VALUES ('${handed}', now())`);
  const c3 = await as(BUYER, `SELECT public.shops_confirm_pickup('${handed}')`);
  check(!c3.error && (await calls("complete", handed)) === 1, "S002: once the shop marked it handed over, the buyer can confirm", c3.error);
  const today = await order({ ready_date: "current_date" });
  const c4 = await as(BUYER, `SELECT public.shops_confirm_pickup('${today}')`);
  check(!c4.error && (await calls("complete", today)) === 1, "S002: on the ready day the buyer can confirm with no mark", c4.error);

  // ---- S003: preorder hold runs the accept checks ----
  let sess = 0;
  const preorder = async (over = {}, homeFood = 0) => {
    const s = `cs_pre_${++sess}`;
    const id = await order({ status: "awaiting_hold", captured_at: null, items_cents: 2000, stripe_checkout_session_id: s,
      preorder_item_id: ITEM, ready_date: "current_date + 10", ...over });
    await db.exec(`UPDATE public.shop_items SET preorder_ready_by = current_date + 10 WHERE id = '${ITEM}'`);
    await db.exec(`INSERT INTO public.shop_order_lines (order_id, quantity, kind, line_cents) VALUES ('${id}', 1, '${homeFood ? "home_food" : "made"}', ${homeFood || 2000})`);
    const res = await q(`SELECT public.shop_mark_order_held('${s}', 'pi_${sess}', 2000, 0, false) AS r`);
    return { id, r: res[0].r, row: (await q(`SELECT status, close_reason FROM public.shop_orders WHERE id = $1`, [id]))[0] };
  };
  const ok1 = await preorder();
  check(ok1.r.result === "held" && ok1.row.status === "accepted", "S003: a preorder that passes every check is accepted at the hold", JSON.stringify(ok1.r));
  await db.exec(`UPDATE public.shops SET hidden_at = now() WHERE id = '${SHOP}'`);
  const h1 = await preorder();
  check(h1.r.result === "cancel_hold" && h1.row.status === "expired", "S003: a hidden shop's preorder hold goes back (no charge)", JSON.stringify(h1.r));
  await db.exec(`UPDATE public.shops SET hidden_at = NULL WHERE id = '${SHOP}'`);
  await db.exec(`INSERT INTO public.sell_blocks VALUES ('${SELLER}', 'payout_not_ready')`);
  const b1 = await preorder();
  check(b1.r.result === "cancel_hold" && b1.row.status === "expired", "S003: an owner who can't sell (sell block) gets no preorder charge", JSON.stringify(b1.r));
  await db.exec(`DELETE FROM public.sell_blocks`);
  const ban = await preorder({ buyer_id: BANNED });
  check(ban.r.result === "cancel_hold" && ban.row.status === "expired", "S003: a banned buyer's preorder hold goes back", JSON.stringify(ban.r));
  // Cap $100,000; sales so far $99,990; this preorder's home-food line $20 would go over.
  await db.exec(`SELECT set_config('test.sales', '9999000', false)`);
  const cap = await preorder({}, 2000);
  check(cap.r.result === "cancel_hold" && cap.row.status === "expired", "S003: a home-food preorder that would pass the yearly limit is refused (not only 'already reached')", JSON.stringify(cap.r));
  await db.exec(`SELECT set_config('test.sales', '9990000', false)`);
  const fits = await preorder({}, 2000);
  check(fits.r.result === "held" && fits.row.status === "accepted", "S003: one that fits under the limit goes through", JSON.stringify(fits.r));
  await db.exec(`SELECT set_config('test.sales', '0', false)`);

  // ---- S005: refund notices email the buyer ----
  const note = async (title, message, link = "/shops/orders") =>
    db.exec(`INSERT INTO public.notifications (user_id, title, message, type, link) VALUES ('${BUYER}', '${title.replace(/'/g, "''")}', '${message.replace(/'/g, "''")}', 'shops_orders', '${link}')`);
  await note("Order cancelled", "$12.00 is on its way back to your card, less the card cost.");
  await note("Preorder refunded", "The preorder did not reach its goal, so all $20.00 is on its way back to your card.");
  await note("Delivery money coming back", "The $8.00 delivery is coming back to your card.");
  await note("No Helpr took your delivery", "No Helpr took the delivery of your order. The $8.00 you paid for delivery is coming back to your card.");
  await note("Order accepted", "The shop accepted your order.");
  await note("Order sent", "Your card is held, not charged.");
  await note("Order cancelled", "The buyer cancelled the order. Do not make it.", "/shops/dashboard");
  const sent = (await q(`SELECT title FROM public.emails`)).map((r) => r.title);
  for (const t of ["Order cancelled", "Preorder refunded", "Delivery money coming back", "No Helpr took your delivery"]) {
    check(sent.includes(t), `S005: the buyer's "${t}" refund notice is emailed`, JSON.stringify(sent));
  }
  check(sent.includes("Order accepted"), "S005: the existing title list still emails (Order accepted)");
  check(!sent.includes("Order sent") && sent.filter((t) => t === "Order cancelled").length === 1,
    "S005: a notice that moves no money back (Order sent, the shop's cancel notice) is not emailed", JSON.stringify(sent));

  // ---- S006: no notice promises "add your side" ----
  for (const f of ["shop_handover_sweep", "shops_report_digital_problem"]) {
    const def = (await q(`SELECT pg_get_functiondef('public.${f}'::regproc) AS d`))[0].d;
    check(!/add your side/i.test(def) && /contact Louisiana Helpr support/.test(def), `S006: ${f} no longer promises "add your side on the order"`);
  }
} catch (e) {
  check(false, `threw: ${e.message}`);
}

console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
