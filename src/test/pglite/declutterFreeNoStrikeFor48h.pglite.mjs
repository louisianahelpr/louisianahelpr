#!/usr/bin/env node
/**
 * Audit DA-12 (owner 2026-10-29, the Free change): a free item never gives a strike just for not choosing a pickup
 * in 48 hours. Runs NEW_FILE VERBATIM (3x) on a prod-shaped fixture of public.declutter_deadline_sweep's tables, then:
 *   - a FREE line past its 48 hours goes back up (item live, line missed) with NO strike, and both sides are told;
 *   - a PAID line past its 48 hours still gives the buyer a strike (unchanged);
 *   - the 24 h and 2 h reminders for a free line do not mention a strike; a paid line's still do;
 *   - the claim notice itself (declutter_take_item) no longer says a free claimer gets a strike; a paid one's still does.
 *
 *   node src/test/pglite/declutterFreeNoStrikeFor48h.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/declutterFreeNoStrikeFor48h.pglite.mjs   # RED: the previous definition
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW_FILE = readdirSync(MIG_DIR).find((f) => f.endsWith("_declutter_free_no_strike_for_48h.sql"));
if (!NEW_FILE) throw new Error("the DA-12 migration is missing");
const RED = process.env.NEW_MIGRATION === "skip";
if (RED) console.log("NEW_MIGRATION=skip: running the PREVIOUS definition (expect FAILs)");

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
const TAKER = "99999999-0000-0000-0000-000000000001";
const BUYER = "99999999-0000-0000-0000-000000000002";

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.user_blocks (blocker_id uuid, blocked_id uuid);
CREATE TABLE public.declutter_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), seller_id uuid, title text, status text,
  updated_at timestamptz, is_seed boolean DEFAULT false);
CREATE FUNCTION public.declutter_price_text(p integer) RETURNS text LANGUAGE sql AS $$ SELECT '$' || (p / 100)::text $$;
CREATE FUNCTION public.seed_hidden_for(u uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE TABLE public.declutter_offers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), buyer_id uuid, seller_id uuid, item_id uuid,
  awaiting text, status text, respond_by timestamptz, closed_at timestamptz, updated_at timestamptz);
CREATE TABLE public.declutter_offer_events (offer_id uuid, actor_side text, action text);
CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text, close_reason text, closed_at timestamptz);
CREATE TABLE public.declutter_cart_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid, buyer_id uuid, seller_id uuid,
  price_cents integer, source text, offer_id uuid, order_id uuid, status text, checkout_by timestamptz, reminded_24h_at timestamptz,
  reminded_2h_at timestamptz, is_seed boolean DEFAULT false, created_at timestamptz DEFAULT now() - interval '3 days',
  closed_at timestamptz, list_price_cents integer);
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
} else {
  const sql = readFileSync(MIG_DIR + NEW_FILE, "utf8");
  for (let i = 0; i < 3; i++) await db.exec(sql);
  check("migration applies 3x", true);
}
const q = async (s, p = []) => (await db.query(s, p)).rows;
const line = async (title, buyer, cents, due) => {
  const item = (await q(`INSERT INTO public.declutter_items (seller_id, title, status) VALUES ($1, $2, 'reserved') RETURNING id`, [SELLER, title]))[0].id;
  await q(`INSERT INTO public.declutter_cart_items (item_id, buyer_id, seller_id, price_cents, status, checkout_by)
           VALUES ($1, $2, $3, $4, 'in_cart', now() + $5::interval)`, [item, buyer, SELLER, cents, due]);
  return item;
};
const freeItem = await line("Free lamp", TAKER, 0, "-1 minute");
const paidItem = await line("Oak chair", BUYER, 4000, "-1 minute");
const freeSoon = await line("Free rug", TAKER, 0, "20 hours");
const paidSoon = await line("Desk", BUYER, 2500, "20 hours");
const free2h = await line("Free vase", TAKER, 0, "1 hour");

await q(`SELECT public.declutter_deadline_sweep()`);

check("the run filed no defect", (await q(`SELECT count(*)::int n FROM public.defects`))[0].n === 0, JSON.stringify(await q(`SELECT * FROM public.defects`)));
const strikes = await q(`SELECT user_id, item_id FROM public.strikes`);
check("a free line past its 48 hours gives NO strike", !strikes.some((s) => s.item_id === freeItem), JSON.stringify(strikes));
check("a paid line past its 48 hours still gives the buyer a strike", strikes.some((s) => s.item_id === paidItem && s.user_id === BUYER));
const fi = (await q(`SELECT status FROM public.declutter_items WHERE id = $1`, [freeItem]))[0].status;
const fl = (await q(`SELECT status FROM public.declutter_cart_items WHERE item_id = $1`, [freeItem]))[0].status;
check("the free item goes back up and its line is closed", fi === "live" && fl === "missed", `${fi} / ${fl}`);
const takerNotes = await q(`SELECT title, message FROM public.notices WHERE user_id = $1`, [TAKER]);
const sellerNotes = await q(`SELECT title, message FROM public.notices WHERE user_id = $1`, [SELLER]);
check("the taker is told it went back up with no strike",
  takerNotes.some((n) => n.message.includes("Free lamp") && /no strike/i.test(n.message)), JSON.stringify(takerNotes));
check("the giver is told the free item is back up, not that a buyer didn't pay",
  sellerNotes.some((n) => n.message.includes("Free lamp") && /back up/.test(n.message) && !/pay/.test(n.message)), JSON.stringify(sellerNotes));
const reminders = takerNotes.filter((n) => n.message.includes("Free rug") || n.message.includes("Free vase"));
check("the free line's 24 h and 2 h reminders are sent", reminders.length === 2, JSON.stringify(reminders));
check("and neither threatens a strike", reminders.length === 2 && reminders.every((n) => !/strike/i.test(n.message + n.title)), JSON.stringify(reminders));
const buyerNotes = await q(`SELECT message FROM public.notices WHERE user_id = $1`, [BUYER]);
check("a paid line's 24 h reminder still says strike", buyerNotes.some((n) => n.message.includes("Desk") && /strike/.test(n.message)));
void freeSoon; void paidSoon; void free2h;

// The claim notice (declutter_take_item): a free claimer is not told about a strike; a paid buyer still is.
await q(`DELETE FROM public.notices`);
const takeFree = (await q(`INSERT INTO public.declutter_items (seller_id, title, status) VALUES ($1, 'Free stool', 'live') RETURNING id`, [SELLER]))[0].id;
const takePaid = (await q(`INSERT INTO public.declutter_items (seller_id, title, status) VALUES ($1, 'Bookcase', 'live') RETURNING id`, [SELLER]))[0].id;
await q(`SELECT public.declutter_take_item($1, $2, 0, 'buy', NULL)`, [takeFree, TAKER]);
await q(`SELECT public.declutter_take_item($1, $2, 3000, 'buy', NULL)`, [takePaid, BUYER]);
const claimNote = await q(`SELECT title, message FROM public.notices WHERE user_id = $1`, [TAKER]);
check("the free claim notice is sent and names the item", claimNote.some((n) => n.message.includes("Free stool")), JSON.stringify(claimNote));
check("and it does not threaten a strike", claimNote.length > 0 && claimNote.every((n) => !/strike/i.test(n.message + n.title)), JSON.stringify(claimNote));
const buyNote = await q(`SELECT message FROM public.notices WHERE user_id = $1`, [BUYER]);
check("a paid reservation notice still says strike", buyNote.some((n) => n.message.includes("Bookcase") && /strike/.test(n.message)), JSON.stringify(buyNote));

console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
