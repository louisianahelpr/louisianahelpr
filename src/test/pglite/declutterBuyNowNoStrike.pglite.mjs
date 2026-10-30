#!/usr/bin/env node
/**
 * Audit DB-5 (owner 2026-10-30): Buy now goes straight to checkout, with no strike for backing out before paying.
 * Runs NEW_FILE VERBATIM (3x) on a prod-shaped fixture of the tables public.declutter_deadline_sweep,
 * public.declutter_take_item and public.declutter_my_cart read, then:
 *   - a Buy now line (source 'buy', price > 0) past its 48 hours goes back up (item live, line missed) with NO strike,
 *     its order expires, both sides are told, and the run counts it as buy_missed_without_strike;
 *   - an accepted-offer line (source 'offer') past its 48 hours still gives the buyer a strike (unchanged);
 *   - a free line (DA-12) still gives no strike;
 *   - the 24 h and 2 h reminders for a Buy now line do not mention a strike; an offer line's still do;
 *   - the Buy now notice (declutter_take_item) no longer threatens a strike; an accepted offer's still does;
 *   - declutter_my_cart returns each line's source, so the cart can tell them apart.
 *
 *   node src/test/pglite/declutterBuyNowNoStrike.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/declutterBuyNowNoStrike.pglite.mjs   # RED: the previous definitions
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW_FILE = readdirSync(MIG_DIR).find((f) => f.endsWith("_declutter_buy_now_no_strike.sql"));
if (!NEW_FILE) throw new Error("the DB-5 migration is missing");
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
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const SELLER = "99999999-0000-0000-0000-000000000000";
const BUYER = "99999999-0000-0000-0000-000000000001"; // Buy now
const OFFERER = "99999999-0000-0000-0000-000000000002"; // accepted offer
const TAKER = "99999999-0000-0000-0000-000000000003"; // free claim

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
CREATE TABLE public.declutter_offer_events (offer_id uuid, actor_side text, action text);
CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text, close_reason text, closed_at timestamptz,
  handover text, premium_cents integer, total_cents integer, delivery_cents integer);
CREATE TABLE public.declutter_order_deliveries (order_id uuid, task_id uuid);
CREATE TABLE public.declutter_cart_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid, buyer_id uuid, seller_id uuid,
  price_cents integer, source text CHECK (source IN ('offer', 'buy')), offer_id uuid, order_id uuid, status text, checkout_by timestamptz,
  reminded_24h_at timestamptz, reminded_2h_at timestamptz, is_seed boolean DEFAULT false,
  created_at timestamptz DEFAULT now() - interval '3 days', closed_at timestamptz, list_price_cents integer);
CREATE TABLE public.declutter_handover_talks (buyer_id uuid, seller_id uuid, opened_at timestamptz, expires_at timestamptz, closed_at timestamptz);
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
`);

if (RED) {
  await db.exec(definitionBefore("declutter_deadline_sweep", NEW_FILE));
  await db.exec(definitionBefore("declutter_take_item", NEW_FILE));
  await db.exec(definitionBefore("declutter_my_cart", NEW_FILE));
} else {
  const sql = readFileSync(MIG_DIR + NEW_FILE, "utf8");
  for (let i = 0; i < 3; i++) await db.exec(sql);
  check("migration applies 3x", true);
}
const q = async (s, p = []) => (await db.query(s, p)).rows;
const line = async (title, buyer, cents, kind, due, withOrder = false) => {
  const item = (await q(`INSERT INTO public.declutter_items (seller_id, title, status) VALUES ($1, $2, 'reserved') RETURNING id`, [SELLER, title]))[0].id;
  // An expired Stripe page: the order is past the 1 h grace, so the sweep judges the line.
  const order = withOrder ? (await q(`INSERT INTO public.declutter_orders (status) VALUES ('awaiting_payment') RETURNING id`))[0].id : null;
  await q(`INSERT INTO public.declutter_cart_items (item_id, buyer_id, seller_id, price_cents, source, order_id, status, checkout_by)
           VALUES ($1, $2, $3, $4, $5, $6, 'in_cart', now() + $7::interval)`, [item, buyer, SELLER, cents, kind, order, due]);
  return { item, order };
};
const buyLate = await line("Oak chair", BUYER, 4000, "buy", "-2 hours", true);
const offerLate = await line("Brass lamp", OFFERER, 2500, "offer", "-1 minute");
const freeLate = await line("Free rug", TAKER, 0, "buy", "-1 minute");
await line("Desk", BUYER, 3000, "buy", "20 hours");
await line("Bench", BUYER, 3500, "buy", "1 hour");
await line("Mirror", OFFERER, 2000, "offer", "20 hours");

const ran = (await q(`SELECT public.declutter_deadline_sweep() AS r`))[0].r;

check("the run filed no defect", (await q(`SELECT count(*)::int n FROM public.defects`))[0].n === 0, JSON.stringify(await q(`SELECT * FROM public.defects`)));
const strikes = await q(`SELECT user_id, item_id FROM public.strikes`);
check("a Buy now line past its 48 hours gives NO strike", !strikes.some((s) => s.item_id === buyLate.item), JSON.stringify(strikes));
check("an accepted-offer line past its 48 hours still gives the buyer a strike", strikes.some((s) => s.item_id === offerLate.item && s.user_id === OFFERER), JSON.stringify(strikes));
check("a free line past its 48 hours still gives no strike (DA-12)", !strikes.some((s) => s.item_id === freeLate.item), JSON.stringify(strikes));
const bi = (await q(`SELECT status FROM public.declutter_items WHERE id = $1`, [buyLate.item]))[0].status;
const bl = (await q(`SELECT status FROM public.declutter_cart_items WHERE item_id = $1`, [buyLate.item]))[0].status;
const bo = (await q(`SELECT status, close_reason FROM public.declutter_orders WHERE id = $1`, [buyLate.order]))[0];
check("the Buy now item goes back up, its line closes and its unpaid order expires",
  bi === "live" && bl === "missed" && bo.status === "expired" && bo.close_reason === "missed_checkout", `${bi} / ${bl} / ${JSON.stringify(bo)}`);
check("the run counts it as a Buy now line missed without a strike", ran?.buy_missed_without_strike === 1 && ran?.checkouts_missed === 1, JSON.stringify(ran));
const buyerNotes = await q(`SELECT title, message FROM public.notices WHERE user_id = $1`, [BUYER]);
const sellerNotes = await q(`SELECT title, message FROM public.notices WHERE user_id = $1`, [SELLER]);
check("the Buy now buyer is told it went back up with no strike",
  buyerNotes.some((n) => n.message.includes("Oak chair") && /no strike/i.test(n.message)), JSON.stringify(buyerNotes));
check("the seller is told the Buy now item is back up for sale",
  sellerNotes.some((n) => n.message.includes("Oak chair") && /back up for sale/.test(n.message)), JSON.stringify(sellerNotes));
const reminders = buyerNotes.filter((n) => n.message.includes("Desk") || n.message.includes("Bench"));
check("the Buy now line's 24 h and 2 h reminders are sent", reminders.length === 2, JSON.stringify(reminders));
check("and neither threatens a strike", reminders.length === 2 && reminders.every((n) => !/strike/i.test(n.message + n.title)), JSON.stringify(reminders));
const offererNotes = await q(`SELECT message FROM public.notices WHERE user_id = $1`, [OFFERER]);
check("an accepted offer's 24 h reminder still says strike", offererNotes.some((n) => n.message.includes("Mirror") && /strike/.test(n.message)), JSON.stringify(offererNotes));

// The take notice (declutter_take_item): a Buy now buyer is not told about a strike; an accepted offer still is.
await q(`DELETE FROM public.notices`);
const takeBuy = (await q(`INSERT INTO public.declutter_items (seller_id, title, status) VALUES ($1, 'Bookcase', 'live') RETURNING id`, [SELLER]))[0].id;
const takeOffer = (await q(`INSERT INTO public.declutter_items (seller_id, title, status) VALUES ($1, 'Side table', 'live') RETURNING id`, [SELLER]))[0].id;
await q(`SELECT public.declutter_take_item($1, $2, 3000, 'buy', NULL)`, [takeBuy, BUYER]);
await q(`SELECT public.declutter_take_item($1, $2, 2000, 'offer', NULL)`, [takeOffer, OFFERER]);
const buyNote = await q(`SELECT title, message FROM public.notices WHERE user_id = $1`, [BUYER]);
check("the Buy now notice is sent and names the item and price", buyNote.some((n) => n.message.includes("Bookcase") && n.message.includes("$30")), JSON.stringify(buyNote));
check("and it does not threaten a strike", buyNote.length > 0 && buyNote.every((n) => !/strike/i.test(n.message + n.title)), JSON.stringify(buyNote));
const offerNote = await q(`SELECT message FROM public.notices WHERE user_id = $1`, [OFFERER]);
check("an accepted offer's notice still says strike", offerNote.some((n) => n.message.includes("Side table") && /strike/.test(n.message)), JSON.stringify(offerNote));

// The cart read says which lines are Buy now.
await q(`SELECT set_config('test.uid', $1, false)`, [BUYER]);
let cart = [];
try {
  cart = await q(`SELECT item_title, source FROM public.declutter_my_cart()`);
} catch (e) {
  check("declutter_my_cart runs", false, e.message);
}
const bookcase = cart.find((r) => r.item_title === "Bookcase");
check("declutter_my_cart returns each line's source", bookcase?.source === "buy", JSON.stringify(cart));

console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
