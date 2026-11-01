#!/usr/bin/env node
/**
 * BUY-1 (owner 10-31, via the lead): Buy now holds 30 minutes, an accepted offer 24 hours, a free claim keeps 48 hours;
 * unpaid at the end the item goes back on sale and the offers THAT hold voided reopen (their buyers told); the payment
 * race: starting checkout stretches the hold to the Stripe page's end, and a payment that lands on a released hold is
 * refunded in full.
 *
 * Runs NEW_FILE VERBATIM (3x) on a prod-shaped fixture of the tables declutter_take_item, declutter_deadline_sweep,
 * declutter_attach_checkout_session and declutter_mark_order_paid read.
 *
 *   node src/test/pglite/declutterBuyNow30Minutes.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/declutterBuyNow30Minutes.pglite.mjs   # RED: the previous definitions
 *   MIGRATION_PATH=<planted copy> node ...                                          # RED on a planted defect
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW_FILE = readdirSync(MIG_DIR).find((f) => f.endsWith("_declutter_buy_now_30_minutes.sql"));
if (!NEW_FILE) throw new Error("the BUY-1 migration is missing");
const RED = process.env.NEW_MIGRATION === "skip";
if (RED) console.log("NEW_MIGRATION=skip: running the PREVIOUS definitions (expect FAILs)");

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

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const SELLER = "99999999-0000-0000-0000-000000000000";
const BUYER = "99999999-0000-0000-0000-000000000001";
const OFFERER = "99999999-0000-0000-0000-000000000002";
const OFFERER2 = "99999999-0000-0000-0000-000000000003";

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
CREATE TABLE public.user_blocks (blocker_id uuid, blocked_id uuid);
CREATE TABLE public.declutter_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), seller_id uuid, title text, status text,
  updated_at timestamptz, is_seed boolean DEFAULT false, porch_ok boolean DEFAULT true, handovers text[]);
CREATE FUNCTION public.declutter_price_text(p integer) RETURNS text LANGUAGE sql AS $$ SELECT '$' || (p / 100)::text $$;
CREATE FUNCTION public.seed_hidden_for(u uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE TABLE public.declutter_offers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), buyer_id uuid, seller_id uuid, item_id uuid,
  awaiting text, status text, respond_by timestamptz, closed_at timestamptz, updated_at timestamptz);
CREATE TABLE public.declutter_offer_events (offer_id uuid, actor_side text,
  action text NOT NULL CHECK (action IN ('offer', 'counter', 'accept', 'decline', 'withdraw', 'expire', 'void')));
CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text, close_reason text, closed_at timestamptz,
  handover text, premium_cents integer, total_cents integer, delivery_cents integer, buyer_id uuid, seller_id uuid,
  items_cents integer, setup_fee_cents integer DEFAULT 0, setup_fee_state text, stripe_payment_intent_id text,
  stripe_checkout_session_id text, paid_at timestamptz, stripe_paid_at timestamptz, card_fee_cents integer);
CREATE TABLE public.declutter_order_deliveries (order_id uuid, task_id uuid);
CREATE TABLE public.declutter_cart_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid, buyer_id uuid, seller_id uuid,
  price_cents integer, source text CHECK (source IN ('offer', 'buy')), offer_id uuid, order_id uuid, status text DEFAULT 'in_cart',
  checkout_by timestamptz, reminded_24h_at timestamptz, reminded_2h_at timestamptz, is_seed boolean DEFAULT false,
  created_at timestamptz DEFAULT now(), closed_at timestamptz, list_price_cents integer);
CREATE TABLE public.declutter_handover_talks (buyer_id uuid, seller_id uuid, opened_at timestamptz, expires_at timestamptz, closed_at timestamptz);
CREATE TABLE public.declutter_strikes (cart_line_id uuid, reason text, removed_at timestamptz);
CREATE TABLE public.declutter_refunds (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid, stripe_payment_intent_id text, reason text, paid_cents integer);
CREATE TABLE public.notices (user_id uuid, title text, message text);
CREATE TABLE public.strikes (user_id uuid, reason text, item_id uuid);
CREATE TABLE public.defects (what text);
CREATE FUNCTION public.declutter_pair_talking(a uuid, b uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.declutter_pair_needs_talk(a uuid, b uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.declutter_seller_out(a uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.feature_enabled_for_user(k text, u uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.declutter_notify(p_user uuid, p_kind text, p_title text, p_message text, p_link text, p_actor uuid DEFAULT NULL)
  RETURNS void LANGUAGE sql AS $$ INSERT INTO public.notices VALUES (p_user, p_title, p_message) $$;
CREATE FUNCTION public.declutter_give_strike(p_user uuid, p_side text, p_reason text, p_item uuid, p_why text, p_line uuid DEFAULT NULL)
  RETURNS integer LANGUAGE sql AS $$ INSERT INTO public.strikes VALUES (p_user, p_reason, p_item); SELECT 1 $$;
CREATE FUNCTION public.log_cron_defect(a text, b text, c text) RETURNS void LANGUAGE sql AS $$ INSERT INTO public.defects VALUES (c) $$;
CREATE FUNCTION public.declutter_record_refund(p_order uuid, p_pi text, p_reason text, p_paid integer, p_fee integer) RETURNS uuid
  LANGUAGE sql AS $$ INSERT INTO public.declutter_refunds (order_id, stripe_payment_intent_id, reason, paid_cents) VALUES (p_order, p_pi, p_reason, p_paid) RETURNING id $$;
CREATE FUNCTION public.declutter_refund_answer(p uuid) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('result', 'refunded', 'reason', r.reason, 'refund_cents', r.paid_cents) FROM public.declutter_refunds r WHERE r.id = p $$;
CREATE FUNCTION public.declutter_seller_out_fee_notice(p uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.declutter_card_fee_estimate(p integer) RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
CREATE FUNCTION public.declutter_order_items_named(p uuid) RETURNS text LANGUAGE sql AS $$ SELECT 'the item' $$;
CREATE FUNCTION public.declutter_paid_next_step(p uuid) RETURNS text LANGUAGE sql AS $$ SELECT '' $$;
CREATE FUNCTION public.declutter_claim_setup_fee(p uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
`);

if (RED) {
  for (const f of ["declutter_take_item", "declutter_deadline_sweep", "declutter_attach_checkout_session", "declutter_mark_order_paid"])
    await db.exec(definitionBefore(f, NEW_FILE));
} else {
  const sql = readFileSync(process.env.MIGRATION_PATH ?? MIG_DIR + NEW_FILE, "utf8");
  let applied = true;
  for (let i = 0; i < 3; i++) {
    try { await db.exec(sql); } catch (e) { applied = false; check(`migration applies (run ${i + 1})`, false, e.message); }
  }
  check("migration applies 3x", applied);
}
const q = async (s, p = []) => (await db.query(s, p)).rows;
const tryQ = async (label, s, p = []) => { try { return await q(s, p); } catch (e) { check(label, false, e.message); return []; } };
const item = async (title, status = "live") =>
  (await q(`INSERT INTO public.declutter_items (seller_id, title, status) VALUES ($1, $2, $3) RETURNING id`, [SELLER, title, status]))[0].id;
const offer = async (itemId, buyer) =>
  (await q(`INSERT INTO public.declutter_offers (buyer_id, seller_id, item_id, awaiting, status, respond_by) VALUES ($1, $2, $3, 'seller', 'open', now() + interval '1 hour') RETURNING id`,
    [buyer, SELLER, itemId]))[0].id;
const minsLeft = async (lineId) => Number((await q(`SELECT extract(epoch FROM checkout_by - now()) / 60 AS m FROM public.declutter_cart_items WHERE id = $1`, [lineId]))[0].m);

// 1. Hold lengths.
const chair = await item("Oak chair");
const o1 = await offer(chair, OFFERER);
const buyLine = (await q(`SELECT public.declutter_take_item($1, $2, 4000, 'buy', NULL) AS id`, [chair, BUYER]))[0].id;
const lamp = await item("Brass lamp");
const lampOffer = await offer(lamp, OFFERER2);
const offerLine = (await q(`SELECT public.declutter_take_item($1, $2, 2500, 'offer', $3) AS id`, [lamp, OFFERER2, lampOffer]))[0].id;
const rug = await item("Free rug");
const freeLine = (await q(`SELECT public.declutter_take_item($1, $2, 0, 'buy', NULL) AS id`, [rug, BUYER]))[0].id;
const mBuy = await minsLeft(buyLine), mOffer = await minsLeft(offerLine), mFree = await minsLeft(freeLine);
check("Buy now holds 30 minutes", Math.abs(mBuy - 30) < 1, `${mBuy} min`);
check("an accepted offer holds 24 hours", Math.abs(mOffer - 24 * 60) < 1, `${mOffer} min`);
check("a free claim keeps its 48 hours", Math.abs(mFree - 48 * 60) < 1, `${mFree} min`);
const buyNote = await q(`SELECT title, message FROM public.notices WHERE user_id = $1 AND message LIKE '%Oak chair%'`, [BUYER]);
check("the Buy now notice says 30 minutes", buyNote.some((n) => /30 minutes/.test(n.title + n.message)) && !buyNote.some((n) => /48 hours/.test(n.title + n.message)), JSON.stringify(buyNote));
const offerNote = await q(`SELECT title, message FROM public.notices WHERE user_id = $1 AND message LIKE '%Brass lamp%'`, [OFFERER2]);
check("the accepted offer's notice says 24 hours", offerNote.some((n) => /24 hours/.test(n.message)) && !offerNote.some((n) => /48 hours/.test(n.title + n.message)), JSON.stringify(offerNote));
const voided = await tryQ("voided_by_line is readable", `SELECT status, voided_by_line FROM public.declutter_offers WHERE id = $1`, [o1]);
check("the offer the Buy now hold closed records that hold", voided[0]?.status === "voided" && voided[0]?.voided_by_line === buyLine, JSON.stringify(voided));
const voidNote = await q(`SELECT message FROM public.notices WHERE user_id = $1`, [OFFERER]);
check("its buyer is told it opens again if the hold runs out", voidNote.some((n) => /opens again/.test(n.message)), JSON.stringify(voidNote));

// 2. The payment race, part 1: starting checkout stretches the hold to the Stripe page's end (31 min).
const order = (await q(`INSERT INTO public.declutter_orders (status, buyer_id, seller_id, total_cents, items_cents) VALUES ('awaiting_payment', $1, $2, 4000, 4000) RETURNING id`, [BUYER, SELLER]))[0].id;
await q(`UPDATE public.declutter_cart_items SET order_id = $1, checkout_by = now() + interval '5 minutes' WHERE id = $2`, [order, buyLine]);
await tryQ("attach runs", `SELECT public.declutter_attach_checkout_session($1, 'cs_test_abc')`, [order]);
const mAfter = await minsLeft(buyLine);
check("starting checkout at minute 25 stretches the hold to the page's end (31 min)", mAfter >= 30.9 && mAfter < 32, `${mAfter} min`);
// A line whose own hold plus one page is over is not stretched again (no holding an item forever).
const desk = await item("Desk", "reserved");
const order2 = (await q(`INSERT INTO public.declutter_orders (status, buyer_id, seller_id, total_cents, items_cents) VALUES ('awaiting_payment', $1, $2, 3000, 3000) RETURNING id`, [BUYER, SELLER]))[0].id;
const oldLine = (await q(`INSERT INTO public.declutter_cart_items (item_id, buyer_id, seller_id, price_cents, source, order_id, checkout_by, created_at)
  VALUES ($1, $2, $3, 3000, 'buy', $4, now() + interval '5 minutes', now() - interval '2 hours') RETURNING id`, [desk, BUYER, SELLER, order2]))[0].id;
await tryQ("attach runs (old line)", `SELECT public.declutter_attach_checkout_session($1, 'cs_test_def')`, [order2]);
const mOld = await minsLeft(oldLine);
check("a line already past its own hold plus one page is not stretched again", Math.abs(mOld - 5) < 1, `${mOld} min`);

// 3. Reminders fit the hold: none for a fresh 30-minute Buy now or a fresh 24-hour offer hold.
await q(`DELETE FROM public.notices`);
const bench = await item("Bench");
await q(`SELECT public.declutter_take_item($1, $2, 3500, 'buy', NULL)`, [bench, BUYER]);
const mirror = await item("Mirror");
await q(`SELECT public.declutter_take_item($1, $2, 2000, 'offer', NULL)`, [mirror, OFFERER2]);
await q(`DELETE FROM public.notices`);
await q(`UPDATE public.declutter_cart_items SET order_id = NULL WHERE id = $1`, [buyLine]); // judged below, without an order
await q(`UPDATE public.declutter_cart_items SET checkout_by = now() - interval '1 minute' WHERE id = $1`, [buyLine]);
// The race grace: an awaiting-payment line 5 min past its deadline waits; one 15 min past is released (was 1 hour).
const vase = await item("Vase", "reserved");
const order3 = (await q(`INSERT INTO public.declutter_orders (status, buyer_id, seller_id, total_cents, items_cents) VALUES ('awaiting_payment', $1, $2, 1000, 1000) RETURNING id`, [BUYER, SELLER]))[0].id;
await q(`INSERT INTO public.declutter_cart_items (item_id, buyer_id, seller_id, price_cents, source, order_id, checkout_by, created_at)
  VALUES ($1, $2, $3, 1000, 'buy', $4, now() - interval '5 minutes', now() - interval '40 minutes')`, [vase, BUYER, SELLER, order3]);
const clock = await item("Clock", "reserved");
const order4 = (await q(`INSERT INTO public.declutter_orders (status, buyer_id, seller_id, total_cents, items_cents) VALUES ('awaiting_payment', $1, $2, 1000, 1000) RETURNING id`, [BUYER, SELLER]))[0].id;
await q(`INSERT INTO public.declutter_cart_items (item_id, buyer_id, seller_id, price_cents, source, order_id, checkout_by, created_at)
  VALUES ($1, $2, $3, 1000, 'buy', $4, now() - interval '15 minutes', now() - interval '50 minutes')`, [clock, BUYER, SELLER, order4]);
// Another hold's voided offer on another item: never reopened by this one.
const stool = await item("Stool", "live");
const otherVoided = await offer(stool, OFFERER2);
await q(`UPDATE public.declutter_offers SET status = 'voided' WHERE id = $1`, [otherVoided]);

const ran = (await q(`SELECT public.declutter_deadline_sweep() AS r`))[0].r;
check("the run filed no defect", (await q(`SELECT count(*)::int n FROM public.defects`))[0].n === 0, JSON.stringify(await q(`SELECT * FROM public.defects`)));
const reminders = await q(`SELECT title, message FROM public.notices WHERE message LIKE '%Bench%' OR message LIKE '%Mirror%'`);
check("a fresh 30-minute or 24-hour hold gets no 24 h / 2 h reminder", reminders.length === 0, JSON.stringify(reminders));
const chairNow = (await q(`SELECT status FROM public.declutter_items WHERE id = $1`, [chair]))[0].status;
const lineNow = (await q(`SELECT status FROM public.declutter_cart_items WHERE id = $1`, [buyLine]))[0].status;
check("an unpaid Buy now hold at its end: item back on sale, line released", chairNow === "live" && lineNow === "missed", `${chairNow} / ${lineNow}`);
const o1Now = (await q(`SELECT status, respond_by > now() + interval '47 hours' AS fresh FROM public.declutter_offers WHERE id = $1`, [o1]))[0];
check("the offer that hold closed is open again, with a fresh 48 hours to answer", o1Now.status === "open" && o1Now.fresh === true, JSON.stringify(o1Now));
const ev = await q(`SELECT action FROM public.declutter_offer_events WHERE offer_id = $1 ORDER BY action`, [o1]);
check("  its history says it reopened", ev.some((e) => e.action === "reopen"), JSON.stringify(ev));
const reopenNote = await q(`SELECT title, message FROM public.notices WHERE user_id = $1`, [OFFERER]);
check("  and its buyer is told, naming the item", reopenNote.some((n) => /open again/.test(n.title) && n.message.includes("Oak chair")), JSON.stringify(reopenNote));
check("an offer another hold voided stays closed", (await q(`SELECT status FROM public.declutter_offers WHERE id = $1`, [otherVoided]))[0].status === "voided");
check("the run counts the reopened offer", ran?.offers_reopened === 1, JSON.stringify(ran));
const vaseLine = (await q(`SELECT status FROM public.declutter_cart_items WHERE item_id = $1`, [vase]))[0].status;
const clockLine = (await q(`SELECT status FROM public.declutter_cart_items WHERE item_id = $1`, [clock]))[0].status;
check("a checkout 5 min past its (page-stretched) end still waits for Stripe's paid event", vaseLine === "in_cart", vaseLine);
check("one 15 min past is released (the grace is 10 min, not 1 hour)", clockLine === "missed", clockLine);

// 4. The payment race, part 2: a payment that lands on the released hold is refunded IN FULL, never brought back.
await q(`UPDATE public.declutter_cart_items SET order_id = $1 WHERE id = $2`, [order, buyLine]);
await q(`UPDATE public.declutter_orders SET status = 'expired', close_reason = 'missed_checkout' WHERE id = $1`, [order]);
const late = (await tryQ("mark_order_paid runs (released)", `SELECT public.declutter_mark_order_paid($1, 'pi_late', 4000, now() - interval '2 minutes', 120) AS r`, [order]))[0]?.r;
check("a payment on a released hold is refunded in full", late?.result === "refunded" && late?.refund_cents === 4000, JSON.stringify(late));
const chairAfter = (await q(`SELECT status FROM public.declutter_items WHERE id = $1`, [chair]))[0].status;
check("  the item stays on sale and the reopened offer stays open", chairAfter === "live" && (await q(`SELECT status FROM public.declutter_offers WHERE id = $1`, [o1]))[0].status === "open", chairAfter);
// Paying inside the hold still works.
await q(`UPDATE public.declutter_items SET status = 'reserved' WHERE id = $1`, [vase]);
const ok = (await tryQ("mark_order_paid runs (in time)", `SELECT public.declutter_mark_order_paid($1, 'pi_ok', 1000, now(), 30) AS r`, [order3]))[0]?.r;
check("paying inside the hold still pays", ok?.result === "paid" && (await q(`SELECT status FROM public.declutter_items WHERE id = $1`, [vase]))[0].status === "sold", JSON.stringify(ok));

console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
