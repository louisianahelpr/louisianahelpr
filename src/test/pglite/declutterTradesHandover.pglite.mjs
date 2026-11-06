#!/usr/bin/env node
/**
 * PGlite proof for 20261106184913_declutter_trades_handover.sql (Declutter trades slice 4: the handover end of an accepted trade).
 *
 *   node src/test/pglite/declutterTradesHandover.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/declutterTradesHandover.pglite.mjs   # RED (slice 1's sweep only)
 *
 * Applies slice 1 (20261106163703, verbatim) and then this migration 3x on a world where the REAL
 * declutter_close_paid_order (its newest CREATE before this migration) closes the free orders. Proves:
 *   - one side checked out (free order paid) and the other side's line ran out: the free order is closed with NO
 *     strike, its item goes back up, both sides are told, and the trade is 'lapsed';
 *   - both checked out and one order then closed unfinished: the other free order is closed too, no strike;
 *   - both handed over: the trade is 'completed';
 *   - one handed over and the other ended unfinished: the trade is 'lapsed' and the handed-over order is untouched;
 *   - a bundled $0 order (declutter_checkout_free puts every free line from one seller in ONE order) holding the trade
 *     line and an unrelated free claim: only the trade line is released, the claim stays paid and the order open;
 *   - a card order is never closed by the sweep; a second sweep changes nothing; the sweep stays service_role only.
 */
import { PGlite, U, makeCheck, liveFunctionSql, readMigration } from "./messageAlertsWorld.mjs";

const SLICE1 = "20261106163703_declutter_trades.sql";
const NEW = "20261106184913_declutter_trades_handover.sql";
const SKIP = process.env.NEW_MIGRATION === "skip";
const { check, state } = makeCheck();

const A = U(1);
const B = U(2);

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
CREATE TABLE public.notices (user_id uuid, kind text, title text, message text);
CREATE TABLE public.strikes (member uuid, side text);
CREATE FUNCTION public.declutter_notify(p_user uuid, p_type text, p_title text, p_message text, p_link text, p_actor uuid DEFAULT NULL)
RETURNS void LANGUAGE sql AS $$ INSERT INTO public.notices VALUES (p_user, p_type, p_title, p_message) $$;
CREATE FUNCTION public.declutter_give_strike(p_member uuid, p_side text, p_reason text, p_item uuid, p_why text, p_line uuid)
RETURNS void LANGUAGE sql AS $$ INSERT INTO public.strikes VALUES (p_member, p_side) $$;
CREATE FUNCTION public.declutter_reopen_voided_offers(p_line uuid) RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
CREATE TABLE public.declutter_items (
  id uuid PRIMARY KEY, seller_id uuid NOT NULL, title text NOT NULL, status text NOT NULL,
  price_cents integer NOT NULL, current_price_cents integer NOT NULL, is_seed boolean NOT NULL DEFAULT false,
  seller_hidden boolean NOT NULL DEFAULT false, updated_at timestamptz);
CREATE TABLE public.declutter_seller_defaults (member_id uuid PRIMARY KEY);
CREATE TABLE public.declutter_orders (
  id uuid PRIMARY KEY, buyer_id uuid, seller_id uuid, status text NOT NULL, paid_with text NOT NULL DEFAULT 'card',
  stripe_payment_intent_id text, close_reason text, closed_at timestamptz);
CREATE TABLE public.declutter_cart_items (
  id uuid PRIMARY KEY, item_id uuid, buyer_id uuid, seller_id uuid, price_cents integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'in_cart', order_id uuid, closed_at timestamptz);
-- close_paid_order declares a row of this (its paid-card branch; never reached by a free order).
CREATE TABLE public.helpr_tasks (id uuid PRIMARY KEY, status text);
INSERT INTO auth.users VALUES ('${A}'), ('${B}');
${liveFunctionSql("declutter_close_paid_order", SLICE1).sql}
`);
// Slice 1's migration needs these only by name (the trade RPCs are not called here).
await db.exec(`
CREATE FUNCTION public.require_feature(text) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.attach_unconfirmed_email_gate() RETURNS void LANGUAGE sql AS $$ SELECT $$;
`);
try { await db.exec(readMigration(SLICE1)); check("slice 1 applies", true); }
catch (e) { check("slice 1 applies", false, e.message); }
if (!SKIP) {
  const migration = readMigration(NEW);
  for (let i = 1; i <= 3; i++) {
    try { await db.exec(migration); check(`applies, pass ${i}`, true); }
    catch (e) { check(`applies, pass ${i}`, false, e.message); }
  }
}

const one = async (sql) => { try { return (await db.query(sql)).rows[0]; } catch (e) { return { error: e.message }; } };
const attempt = async (sql) => { try { await db.exec(sql); return "allowed"; } catch (e) { return e.message; } };

/**
 * One accepted trade n: A's item ia (B gets it on line lb, order ob) and B's item ib (A gets it on line la, order oa).
 * bLine/aLine: 'in_cart' | 'missed' | 'paid'; bOrder/aOrder: the order status when the line is paid.
 */
let n = 100;
async function trade({ bLine, bOrder, aLine, aOrder, paidWith = "free" }) {
  n += 10;
  const [ia, ib, lb, la, ob, oa, s] = [U(n), U(n + 1), U(n + 2), U(n + 3), U(n + 4), U(n + 5), U(n + 6)];
  const itemStatus = (line) => (line === "paid" ? "sold" : line === "in_cart" ? "reserved" : "live");
  await db.exec(`
    INSERT INTO public.declutter_items (id, seller_id, title, status, price_cents, current_price_cents) VALUES
      ('${ia}', '${A}', 'Lamp ${n}', '${itemStatus(bLine)}', 2000, 2000), ('${ib}', '${B}', 'Chair ${n}', '${itemStatus(aLine)}', 3000, 3000);
    INSERT INTO public.declutter_orders (id, buyer_id, seller_id, status, paid_with) VALUES
      ('${ob}', '${B}', '${A}', '${bOrder ?? "expired"}', '${paidWith}'), ('${oa}', '${A}', '${B}', '${aOrder ?? "expired"}', '${paidWith}');
    INSERT INTO public.declutter_cart_items (id, item_id, buyer_id, seller_id, status, order_id) VALUES
      ('${lb}', '${ia}', '${B}', '${A}', '${bLine}', ${bLine === "paid" ? `'${ob}'` : "NULL"}),
      ('${la}', '${ib}', '${A}', '${B}', '${aLine}', ${aLine === "paid" ? `'${oa}'` : "NULL"});
    INSERT INTO public.declutter_swap_offers (id, item_id, offered_item_id, buyer_id, seller_id, status, respond_by, buyer_line_id, seller_line_id)
      VALUES ('${s}', '${ia}', '${ib}', '${B}', '${A}', 'accepted', now(), '${lb}', '${la}');`);
  return { ia, ib, lb, la, ob, oa, s };
}
const st = async (table, id) => (await one(`SELECT status FROM public.${table} WHERE id = '${id}'`))?.status;

// 1. B checked out (free order paid), A's 48 hours ran out (line missed).
const t1 = await trade({ bLine: "paid", bOrder: "paid", aLine: "missed" });
// 2. Both checked out; A's order then closed unfinished (close_paid_order set its line missed, order refunded).
const t2 = await trade({ bLine: "paid", bOrder: "paid", aLine: "missed", aOrder: "refunded" });
// 3. Both handed over.
const t3 = await trade({ bLine: "paid", bOrder: "handed_over", aLine: "paid", aOrder: "handed_over" });
// 4. B handed over, A's line ran out.
const t4 = await trade({ bLine: "paid", bOrder: "handed_over", aLine: "missed" });
// 5. Still in progress: B checked out, A still choosing (in the cart).
const t5 = await trade({ bLine: "paid", bOrder: "paid", aLine: "in_cart" });
// 6. A card order (never a trade's, but the sweep must never close one).
const t6 = await trade({ bLine: "paid", bOrder: "paid", aLine: "missed", paidWith: "card" });
// 7. Like 1, but declutter_checkout_free bundled B's trade line with an unrelated free claim from the same seller (A)
//    into ONE $0 order: only the trade line is released; the claim stays paid and its item stays sold.
const t7 = await trade({ bLine: "paid", bOrder: "paid", aLine: "missed" });
const [claimItem, claimLine] = [U(900), U(901)];
await db.exec(`
  INSERT INTO public.declutter_items (id, seller_id, title, status, price_cents, current_price_cents) VALUES
    ('${claimItem}', '${A}', 'Free rug', 'sold', 0, 0);
  INSERT INTO public.declutter_cart_items (id, item_id, buyer_id, seller_id, status, order_id) VALUES
    ('${claimLine}', '${claimItem}', '${B}', '${A}', 'paid', '${t7.ob}');`);

const sw = await one(`SELECT public.declutter_swap_sweep() AS r`);
check("the sweep runs", !sw?.error, JSON.stringify(sw));

check("checked out vs ran out: the trade lapses", (await st("declutter_swap_offers", t1.s)) === "lapsed", await st("declutter_swap_offers", t1.s));
check("checked out vs ran out: the free order is closed", (await st("declutter_orders", t1.ob)) === "refunded", await st("declutter_orders", t1.ob));
check("checked out vs ran out: its item is back up", (await st("declutter_items", t1.ia)) === "live", await st("declutter_items", t1.ia));
check("one order closed unfinished: the other free order is closed too",
  (await st("declutter_orders", t2.ob)) === "refunded" && (await st("declutter_swap_offers", t2.s)) === "lapsed",
  `${await st("declutter_orders", t2.ob)} / ${await st("declutter_swap_offers", t2.s)}`);
const strikes = await one(`SELECT count(*)::int AS c FROM public.strikes`);
check("nobody gets a strike from the sweep", strikes?.c === 0, JSON.stringify(strikes));
const told = await one(`SELECT count(*)::int AS c FROM public.notices WHERE title = 'Free pickup cancelled'`);
check("both sides of each closed order are told (the bundled order is not closed)", told?.c === 4, JSON.stringify(told));
check("bundled order: the trade lapses", (await st("declutter_swap_offers", t7.s)) === "lapsed", await st("declutter_swap_offers", t7.s));
check("bundled order: only the trade line is released", (await st("declutter_cart_items", t7.lb)) === "missed", await st("declutter_cart_items", t7.lb));
check("bundled order: the trade item is back up", (await st("declutter_items", t7.ia)) === "live", await st("declutter_items", t7.ia));
check("bundled order: the order itself stays paid", (await st("declutter_orders", t7.ob)) === "paid", await st("declutter_orders", t7.ob));
check("bundled order: the unrelated free claim stays paid", (await st("declutter_cart_items", claimLine)) === "paid", await st("declutter_cart_items", claimLine));
check("bundled order: the claimed item stays sold", (await st("declutter_items", claimItem)) === "sold", await st("declutter_items", claimItem));
const toldPart = (await db.query(`SELECT user_id FROM public.notices WHERE title LIKE 'Trade item taken off%' ORDER BY user_id`)).rows.map((r) => r.user_id);
check("bundled order: both sides are told", toldPart.length === 2 && toldPart.includes(A) && toldPart.includes(B), JSON.stringify(toldPart));
check("both handed over: the trade is completed", (await st("declutter_swap_offers", t3.s)) === "completed", await st("declutter_swap_offers", t3.s));
check("one handed over, the other ran out: the trade lapses and the handed-over order is untouched",
  (await st("declutter_swap_offers", t4.s)) === "lapsed" && (await st("declutter_orders", t4.ob)) === "handed_over",
  `${await st("declutter_swap_offers", t4.s)} / ${await st("declutter_orders", t4.ob)}`);
check("a side still choosing keeps the trade open",
  (await st("declutter_swap_offers", t5.s)) === "accepted" && (await st("declutter_orders", t5.ob)) === "paid",
  `${await st("declutter_swap_offers", t5.s)} / ${await st("declutter_orders", t5.ob)}`);
check("a card order is never closed by the sweep", (await st("declutter_orders", t6.ob)) === "paid", await st("declutter_orders", t6.ob));
check("the sweep counts what it did", sw?.r?.lapsed === 4 && sw?.r?.completed === 1, JSON.stringify(sw?.r));

const sw2 = await one(`SELECT public.declutter_swap_sweep() AS r`);
check("a second sweep changes nothing", sw2?.r?.lapsed === 0 && sw2?.r?.expired === 0 && (sw2?.r?.completed ?? 0) === 0, JSON.stringify(sw2));
const bad = await attempt(`UPDATE public.declutter_swap_offers SET status = 'bogus' WHERE id = '${t5.s}'`);
check("the status list still refuses an unknown status", /check constraint|violates/.test(bad), bad);
// Slice 3's reads embed the two items and the two lines by these constraint names (src/lib/declutter/trades.ts).
const fks = (await db.query(`SELECT conname FROM pg_constraint WHERE conrelid = 'public.declutter_swap_offers'::regclass AND contype = 'f' ORDER BY conname`)).rows.map((r) => r.conname);
check("the four foreign keys the trade cards read have their default names",
  ["declutter_swap_offers_buyer_line_id_fkey", "declutter_swap_offers_item_id_fkey", "declutter_swap_offers_offered_item_id_fkey", "declutter_swap_offers_seller_line_id_fkey"]
    .every((n) => fks.includes(n)), fks.join(", "));
const priv = await one(`SELECT has_function_privilege('authenticated', 'public.declutter_swap_sweep()', 'EXECUTE') AS a,
  has_function_privilege('anon', 'public.declutter_swap_sweep()', 'EXECUTE') AS n`);
check("the sweep stays service_role only", priv && priv.a === false && priv.n === false, JSON.stringify(priv));

console.log(`\n${state.failures ? "RED" : "GREEN"}: ${state.failures} failed`);
process.exit(state.failures ? 1 : 0);
