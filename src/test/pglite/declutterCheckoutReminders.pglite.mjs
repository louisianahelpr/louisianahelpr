#!/usr/bin/env node
/**
 * PGlite proof for 20261029025838_declutter_checkout_reminders_name_the_item: the 48-hour checkout's two reminders
 * name their item, and every buyer notice declutter_deadline_sweep writes opens /declutter?tab=buying.
 *
 *   node src/test/pglite/declutterCheckoutReminders.pglite.mjs                   # the migration applied 3x: all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/declutterCheckoutReminders.pglite.mjs # RED: the previous (newest) body
 *   MUTANT=<name> node src/test/pglite/declutterCheckoutReminders.pglite.mjs     # a planted defect: must FAIL
 *
 * World, and what is stubbed (said so): the tables the sweep reads and writes, with only the columns it touches
 * (names as on prod); declutter_notify records each notice in a table; declutter_pair_talking reads the stub talk
 * table; declutter_pair_needs_talk and declutter_seller_out answer false; declutter_give_strike records the strike;
 * feature_enabled_for_user is on except for one buyer; log_cron_defect records. The sweep itself is the real body:
 * this migration's (applied 3x), or with NEW_MIGRATION=skip the newest definition before it (read from the files).
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const THIS = "20261029025838_declutter_checkout_reminders_name_the_item.sql";
const MUTANT = process.env.MUTANT ?? "";
const MUTANTS = {
  // The 24-hour reminder back to words that name no item.
  name24: [`ELSE format('"%s" is waiting in your cart. Check out within 24 hours or you get a strike.', r.title) END,`,
    `ELSE 'You have an item waiting in your cart. Check out within 24 hours or you get a strike.' END,`],
  // The 2-hour reminder back to the retired cart address.
  link2h: [`in the next 2 hours or you get a strike and it goes back up for sale.', r.title) END,\n      '/declutter?tab=buying');`,
    `in the next 2 hours or you get a strike and it goes back up for sale.', r.title) END,\n      '/declutter?view=cart');`],
  // No fallback: a line with no item says "" in the message.
  fallback: [`CASE WHEN r.title IS NULL THEN 'You have an item waiting in your cart. Check out within 24 hours or you get a strike.'\n           ELSE format(`,
    `CASE WHEN false THEN ''\n           ELSE format(`],
  // The seller-blocked outcome's buyer notice back to the cart address.
  blocked: [`You were not charged and you get no strike.', v_line.title),\n          '/declutter?tab=buying', v_line.seller_id);`,
    `You were not charged and you get no strike.', v_line.title),\n          '/declutter?view=cart', v_line.seller_id);`],
};
const skip = process.env.NEW_MIGRATION === "skip";

/** The newest CREATE FUNCTION statement (through its grants) for `name` in migrations strictly before `before`. */
function newestBefore(name, before) {
  let found = null;
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql") && x < before).sort()) {
    const sql = readFileSync(MIG_DIR + f, "utf8");
    const re = new RegExp(String.raw`CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.${name}\s*\(`, "gi");
    let m;
    while ((m = re.exec(sql))) {
      const as = /\bAS\s+(\$\w*\$)/g;
      as.lastIndex = m.index;
      const t = as.exec(sql);
      const end = sql.indexOf(t[1], t.index + t[0].length);
      found = { file: f, sql: `${sql.slice(m.index, end + t[1].length)};
REVOKE ALL ON FUNCTION public.${name}() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.${name}() TO service_role;` };
    }
  }
  if (!found) throw new Error(`no definition of ${name}`);
  return found;
}

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };
const U = (n) => `11111111-0000-0000-0000-${String(n).padStart(12, "0")}`;
const I = (n) => `44444444-0000-0000-0000-${String(n).padStart(12, "0")}`;
const SELLER = U(1), BUYER = U(2), BUYER2 = U(3), BUYER_OFF = U(4), BUYER_TALK = U(5), BUYER_BLOCKED = U(6);

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  CREATE TABLE public.declutter_items (id uuid PRIMARY KEY, title text NOT NULL, status text NOT NULL DEFAULT 'reserved',
    updated_at timestamptz DEFAULT now());
  CREATE TABLE public.declutter_offers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), buyer_id uuid, seller_id uuid,
    item_id uuid, awaiting text, status text, respond_by timestamptz, closed_at timestamptz, updated_at timestamptz);
  CREATE TABLE public.declutter_offer_events (offer_id uuid, actor_side text, action text);
  CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text, close_reason text,
    closed_at timestamptz);
  CREATE TABLE public.declutter_cart_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), buyer_id uuid, seller_id uuid,
    item_id uuid, order_id uuid, status text NOT NULL DEFAULT 'in_cart', checkout_by timestamptz NOT NULL,
    reminded_24h_at timestamptz, reminded_2h_at timestamptz, created_at timestamptz NOT NULL DEFAULT now() - interval '30 hours',
    closed_at timestamptz);
  CREATE TABLE public.user_blocks (blocker_id uuid, blocked_id uuid);
  CREATE TABLE public.declutter_handover_talks (buyer_id uuid, seller_id uuid, opened_at timestamptz DEFAULT now(),
    closed_at timestamptz, expires_at timestamptz DEFAULT now() + interval '72 hours');
  CREATE TABLE public.notices (user_id uuid, kind text, title text, message text, link text, other uuid);
  CREATE TABLE public.strikes (user_id uuid, side text, reason text, item uuid);
  CREATE TABLE public.cron_defects_seen (fn text, ref text, msg text);
  CREATE FUNCTION public.declutter_notify(p_user uuid, p_kind text, p_title text, p_message text, p_link text, p_other uuid DEFAULT NULL)
    RETURNS void LANGUAGE sql AS $$ INSERT INTO public.notices VALUES (p_user, p_kind, p_title, p_message, p_link, p_other) $$;
  CREATE FUNCTION public.declutter_pair_talking(p_buyer uuid, p_seller uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM public.declutter_handover_talks t WHERE t.buyer_id = p_buyer AND t.seller_id = p_seller AND t.closed_at IS NULL) $$;
  CREATE FUNCTION public.declutter_pair_needs_talk(p_buyer uuid, p_seller uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
  CREATE FUNCTION public.declutter_seller_out(p_user uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
  CREATE FUNCTION public.feature_enabled_for_user(p_key text, p_user uuid) RETURNS boolean LANGUAGE sql AS $$
    SELECT p_user IS DISTINCT FROM '${BUYER_OFF}'::uuid $$;
  CREATE FUNCTION public.declutter_give_strike(p_user uuid, p_side text, p_reason text, p_item uuid, p_why text, p_line uuid)
    RETURNS void LANGUAGE sql AS $$ INSERT INTO public.strikes VALUES (p_user, p_side, p_reason, p_item) $$;
  CREATE FUNCTION public.log_cron_defect(p_fn text, p_ref text, p_msg text) RETURNS void LANGUAGE sql
    AS $$ INSERT INTO public.cron_defects_seen VALUES (p_fn, p_ref, p_msg) $$;
`);

// The sweep: the previous (newest) body, then this migration 3x on top (unless NEW_MIGRATION=skip).
const prev = newestBefore("declutter_deadline_sweep", THIS);
console.log(`base: declutter_deadline_sweep from ${prev.file}`);
await db.exec(prev.sql);
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

await db.exec(`
  INSERT INTO public.declutter_items (id, title) VALUES
    ('${I(1)}', 'Oak rocking chair'), ('${I(2)}', 'Blue table lamp'), ('${I(3)}', 'Box of mason jars'),
    ('${I(4)}', 'Kids'' bike'), ('${I(5)}', 'Patio umbrella'), ('${I(6)}', 'Bread maker');
  INSERT INTO public.declutter_cart_items (buyer_id, seller_id, item_id, checkout_by) VALUES
    ('${BUYER}',  '${SELLER}', '${I(1)}', now() + interval '20 hours'),   -- 24-hour reminder
    ('${BUYER}',  '${SELLER}', '${I(2)}', now() + interval '22 hours'),   -- 24-hour reminder, second item
    ('${BUYER2}', '${SELLER}', '${I(3)}', now() + interval '1 hour'),     -- 2-hour reminder
    ('${BUYER2}', '${SELLER}', NULL,      now() + interval '20 hours'),   -- no item on the line: old words
    ('${BUYER_TALK}', '${SELLER}', '${I(4)}', now() + interval '20 hours'), -- talking it through: no reminder
    ('${BUYER_OFF}', '${SELLER}', '${I(5)}', now() - interval '1 minute'),   -- missed, switch off: "Checkout closed"
    ('${BUYER_BLOCKED}', '${SELLER}', '${I(6)}', now() - interval '1 minute'); -- missed, seller blocked the buyer
  INSERT INTO public.declutter_handover_talks (buyer_id, seller_id) VALUES ('${BUYER_TALK}', '${SELLER}');
  INSERT INTO public.user_blocks VALUES ('${SELLER}', '${BUYER_BLOCKED}');
`);

const out = (await db.query(`SELECT public.declutter_deadline_sweep() AS r`)).rows[0].r;
const notices = (await db.query(`SELECT user_id, title, message, link FROM public.notices ORDER BY title, message`)).rows;
const to = (u, title) => notices.filter((n) => n.user_id === u && n.title === title);
const defects = (await db.query(`SELECT * FROM public.cron_defects_seen`)).rows;
check(defects.length === 0, `the sweep ran every line (cron defects: ${defects.map((d) => d.msg).join("; ") || "none"})`);
check(out.reminded_24h === 3 && out.reminded_2h === 1, `counts: reminded_24h ${out.reminded_24h} (3), reminded_2h ${out.reminded_2h} (1)`);

const r24 = to(BUYER, "Check out within 24 hours").map((n) => n.message).sort();
check(r24.length === 2
  && r24[0] === '"Blue table lamp" is waiting in your cart. Check out within 24 hours or you get a strike.'
  && r24[1] === '"Oak rocking chair" is waiting in your cart. Check out within 24 hours or you get a strike.',
  `the 24-hour reminder names each item (${JSON.stringify(r24)})`);
const r2 = to(BUYER2, "2 hours left to check out");
check(r2.length === 1 && r2[0].message === 'Check out "Box of mason jars" in the next 2 hours or you get a strike and it goes back up for sale.',
  `the 2-hour reminder names the item (${JSON.stringify(r2.map((n) => n.message))})`);
const noItem = to(BUYER2, "Check out within 24 hours");
check(noItem.length === 1 && noItem[0].message === "You have an item waiting in your cart. Check out within 24 hours or you get a strike.",
  `a line with no item keeps the old words (${JSON.stringify(noItem.map((n) => n.message))})`);
check(to(BUYER_TALK, "Check out within 24 hours").length === 0, "no reminder while the two are talking the handover through (unchanged)");

const closed = to(BUYER_OFF, "Checkout closed");
check(closed.length === 1 && closed[0].message.includes('"Patio umbrella"'), "a missed checkout with the switch off: \"Checkout closed\" (unchanged)");
const cancelled = to(BUYER_BLOCKED, "The seller cancelled");
check(cancelled.length === 1, "a blocked buyer's sale: \"The seller cancelled\" (unchanged)");
const strikes = (await db.query(`SELECT user_id, side, reason FROM public.strikes ORDER BY side`)).rows;
check(strikes.length === 1 && strikes[0].user_id === SELLER && strikes[0].reason === "cancelled_after_offers",
  `strikes unchanged: only the seller who blocked (${JSON.stringify(strikes)})`);

const buyerLinks = notices.filter((n) => n.user_id !== SELLER).map((n) => n.link);
check(buyerLinks.length === 6 && buyerLinks.every((l) => l === "/declutter?tab=buying"),
  `every buyer notice opens Buying (${JSON.stringify(buyerLinks)})`);
const sellerLinks = notices.filter((n) => n.user_id === SELLER).map((n) => n.link);
check(sellerLinks.every((l) => l === "/declutter?tab=selling"), `the seller's notices open Selling (${JSON.stringify(sellerLinks)})`);

const acl = (await db.query(`SELECT has_function_privilege('anon', 'public.declutter_deadline_sweep()', 'EXECUTE') AS a,
  has_function_privilege('authenticated', 'public.declutter_deadline_sweep()', 'EXECUTE') AS u,
  has_function_privilege('service_role', 'public.declutter_deadline_sweep()', 'EXECUTE') AS s`)).rows[0];
check(!acl.a && !acl.u && acl.s, `grants: anon ${acl.a}, authenticated ${acl.u}, service_role ${acl.s}`);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
