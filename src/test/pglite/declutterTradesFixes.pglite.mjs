#!/usr/bin/env node
/**
 * PGlite proof for 20261108195151_declutter_trades_fixes.sql (trades audit 11-08 #1, #2, #4-#9, #11).
 *
 *   node src/test/pglite/declutterTradesFixes.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/declutterTradesFixes.pglite.mjs   # RED (slices 1 and 4 and the old bodies only)
 *
 * Applies slice 1 (20261106163703) and slice 4 (20261106184913) verbatim, then this migration 3x. Executes:
 *   - accept stamps swap_id on both $0 lines (#2);
 *   - checkout_free with only trade lines skips the setup fee (the fee gate is never reached) and keeps the ID check;
 *     a real free claim in the same checkout still meets the fee gate (#1); trade wording on its notices (#2);
 *   - checkout_free takes only the $0 lines when a trade line sits beside a priced line from the same seller, and a
 *     trade line can never be linked to a card order (#8);
 *   - backing out of a trade line ends the whole trade at once, both items back up, offers on both reopen, trade
 *     wording, no strike (#5, #4);
 *   - the swap sweep: an ended line releases the other side through declutter_end_swap (#4), the "12 hours left"
 *     reminder goes once, offers are emailed through the notifications trigger, a row the seed boundary drops is never
 *     emailed (#11);
 *   - an offered item paused closes the trade; a wanted item paused keeps it (#7); an item made free closes its
 *     trades and its switch (#6);
 *   - a meetup-only item cannot be traded (#9);
 *   - the internal helpers stay service_role only;
 *   - cart "Remove" on a trade line ends the whole trade at once (lead 11-08), with no "Back on sale" notice;
 *   - #3: a guest (anon) can read accepts_trades, and declutter_guest_preview / declutter_guest_first_screen answer it.
 */
import { PGlite, U, makeCheck, readMigration } from "./messageAlertsWorld.mjs";

const SLICE1 = "20261106163703_declutter_trades.sql";
const SLICE4 = "20261106184913_declutter_trades_handover.sql";
const NEW = "20261108195151_declutter_trades_fixes.sql";
const GUEST_PREVIEW = "20261107212823_declutter_guest_preview.sql";
const GUEST_FIRST_SCREEN = "20261107172400_declutter_guest_first_screen.sql";
const REMOVE_CART = "20261103173728_q2390_haul_price_withdraw_guarantee_raise_refund_admin_delivery_cart_shops_rent_not_found_is_404.sql";
const SKIP = process.env.NEW_MIGRATION === "skip";
const { check, state } = makeCheck();

const A = U(1); // seller of the wanted item
const B = U(2); // buyer, offers their own item
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
-- The bell: declutter_notify writes public.notifications; a stand-in for notifications_seed_boundary (BEFORE INSERT)
-- drops a row to a member in seed_ids, as the real boundary drops a row it may not write. notices reads the rows.
CREATE TABLE public.notifications (id bigserial PRIMARY KEY, user_id uuid, type text, title text, message text, link text);
CREATE TABLE public.seed_ids (id uuid PRIMARY KEY);
CREATE FUNCTION public.seed_boundary_stub() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF EXISTS (SELECT 1 FROM public.seed_ids WHERE id = NEW.user_id) THEN RETURN NULL; END IF; RETURN NEW; END $$;
CREATE TRIGGER notifications_seed_boundary BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.seed_boundary_stub();
CREATE VIEW public.notices AS SELECT user_id, type AS kind, title, message FROM public.notifications;
CREATE TABLE public.emails (user_id uuid, title text, kind text);
CREATE TABLE public.strikes (member uuid, side text);
CREATE TABLE public.reopened (line uuid);
CREATE TABLE public.gate_calls (gate text, member uuid);
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, full_name text);
CREATE FUNCTION public.declutter_notify(p_user uuid, p_type text, p_title text, p_message text, p_link text, p_actor uuid DEFAULT NULL)
RETURNS void LANGUAGE sql AS $$ INSERT INTO public.notifications (user_id, type, title, message, link) VALUES (p_user, p_type, p_title, p_message, p_link) $$;
CREATE FUNCTION public.send_notice_email(p_user_id uuid, p_title text, p_message text, p_type text, p_link text, p_job_id uuid)
RETURNS void LANGUAGE sql AS $$ INSERT INTO public.emails VALUES (p_user_id, p_title, p_type) $$;
CREATE FUNCTION public.declutter_give_strike(p_member uuid, p_side text, p_reason text, p_item uuid, p_why text, p_line uuid)
RETURNS integer LANGUAGE sql AS $$ INSERT INTO public.strikes VALUES (p_member, p_side); SELECT 1 $$;
CREATE FUNCTION public.declutter_active_strike_count(p uuid) RETURNS integer LANGUAGE sql AS $$ SELECT count(*)::int FROM public.strikes WHERE member = p $$;
CREATE FUNCTION public.declutter_reopen_voided_offers(p_line uuid) RETURNS integer LANGUAGE sql AS $$ INSERT INTO public.reopened VALUES (p_line); SELECT 0 $$;
CREATE FUNCTION public.member_display_name(n text, d text) RETURNS text LANGUAGE sql AS $$ SELECT coalesce(n, d) $$;
CREATE FUNCTION public.require_feature(text) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.attach_unconfirmed_email_gate() RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.declutter_assert_member(b boolean) RETURNS uuid LANGUAGE plpgsql AS $$
BEGIN IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF; RETURN auth.uid(); END $$;
CREATE FUNCTION public.declutter_seller_out(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.declutter_member_out(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.are_users_blocked(uuid, uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.seed_hidden_for(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.member_under_18(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.declutter_notice_ref(uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.log_cron_defect(text, text, text, jsonb) RETURNS void LANGUAGE sql AS $$ SELECT $$;
-- Both gates record that they ran; the fee gate refuses (every member here still owes the $2 fee).
CREATE FUNCTION public.declutter_free_claim_gate(p uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN INSERT INTO public.gate_calls VALUES ('fee', p); RAISE EXCEPTION 'setup_fee_required_to_claim'; END $$;
CREATE FUNCTION public.declutter_identity_gate(p uuid, code text) RETURNS void LANGUAGE sql AS $$ INSERT INTO public.gate_calls VALUES ('id', p) $$;
CREATE FUNCTION public.declutter_handover_refused(uuid[], text) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE TABLE public.declutter_items (
  id uuid PRIMARY KEY, seller_id uuid NOT NULL, title text NOT NULL, status text NOT NULL,
  price_cents integer NOT NULL, current_price_cents integer NOT NULL, is_seed boolean NOT NULL DEFAULT false,
  seller_hidden boolean NOT NULL DEFAULT false, porch_ok boolean NOT NULL DEFAULT true, handovers text[],
  updated_at timestamptz,
  -- declutter_guest_preview's card columns (20261107212823); anon holds SELECT on each of them on prod (not on accepts_trades).
  description text, category text, condition_stars int, delivery_size text, area_label text, area_lat float8, area_lng float8,
  created_at timestamptz DEFAULT now(), live_at timestamptz DEFAULT now(), accepts_offers boolean DEFAULT true,
  sale_mode text, last_price_drop_on date, drop_pct int, drops_stopped boolean);
CREATE TABLE public.declutter_item_photos (id uuid PRIMARY KEY, item_id uuid, storage_path text, position int);
GRANT SELECT (id, seller_id, status, title, description, category, condition_stars, delivery_size, price_cents, current_price_cents,
  area_label, area_lat, area_lng, created_at, live_at, porch_ok, accepts_offers, sale_mode, last_price_drop_on, drop_pct,
  drops_stopped) ON public.declutter_items TO anon;
GRANT SELECT ON public.declutter_item_photos TO anon;
CREATE TABLE public.declutter_seller_defaults (member_id uuid PRIMARY KEY);
CREATE TABLE public.declutter_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), buyer_id uuid, seller_id uuid, status text NOT NULL DEFAULT 'awaiting_payment',
  paid_with text NOT NULL DEFAULT 'card', handover text, items_cents int, premium_cents int, tax_cents int, delivery_cents int,
  total_cents int, setup_fee_cents int, card_fee_cents int, paid_at timestamptz, stripe_checkout_session_id text,
  stripe_payment_intent_id text, close_reason text, closed_at timestamptz, created_at timestamptz DEFAULT now());
CREATE TABLE public.declutter_cart_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid, buyer_id uuid, seller_id uuid, price_cents integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'in_cart', order_id uuid, closed_at timestamptz,
  checkout_by timestamptz NOT NULL DEFAULT now() + interval '48 hours', source text DEFAULT 'buy');
CREATE TABLE public.declutter_porch_places (id uuid PRIMARY KEY, seller_id uuid, label text, address text, area text, lat float8, lng float8, weekdays int[]);
CREATE TABLE public.declutter_porch_place_choices (buyer_id uuid, seller_id uuid, place_id uuid);
CREATE TABLE public.declutter_order_porch_places (order_id uuid, seller_id uuid, place_id uuid, label text, address text, area text, lat float8, lng float8, weekdays int[]);
CREATE TABLE public.helpr_tasks (id uuid PRIMARY KEY, status text);
-- take_item at $0: reserves the item and makes a cart line.
CREATE FUNCTION public.declutter_take_item(p_item uuid, p_buyer uuid, p_price int, p_source text, p_offer uuid)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid;
BEGIN
  UPDATE public.declutter_items SET status = 'reserved' WHERE id = p_item;
  INSERT INTO public.declutter_cart_items (item_id, buyer_id, seller_id, price_cents, source)
  SELECT p_item, p_buyer, i.seller_id, p_price, p_source FROM public.declutter_items i WHERE i.id = p_item RETURNING id INTO v;
  RETURN v;
END $$;
INSERT INTO auth.users VALUES ('${A}'), ('${B}');
INSERT INTO public.profiles VALUES ('${A}', 'Ann'), ('${B}', 'Bea');
`);
try { await db.exec(readMigration(SLICE1)); await db.exec(readMigration(SLICE4)); check("slices 1 and 4 apply", true); }
catch (e) { check("slices 1 and 4 apply", false, e.message); }
// The prod bodies this migration restates beyond the trade slices (md5(prosrc) equal on prod 11-08), verbatim:
// declutter_guest_preview (its whole migration) and declutter_remove_cart_item (cut from 20261103173728).
try {
  await db.exec(readMigration(GUEST_PREVIEW));
  await db.exec(readMigration(GUEST_FIRST_SCREEN));
  const q2390 = readMigration(REMOVE_CART);
  const at = q2390.indexOf("CREATE OR REPLACE FUNCTION public.declutter_remove_cart_item(");
  const end = q2390.indexOf("TO authenticated, service_role;", at) + "TO authenticated, service_role;".length;
  await db.exec(q2390.slice(at, end));
  check("the restated prod bodies apply", true);
} catch (e) { check("the restated prod bodies apply", false, e.message); }
// The restated bodies are only CREATEd here (plpgsql checks a body when it runs); the RPCs below that they would
// need beyond this world (my_cart, deadline_sweep) are pinned by declutterTradesFixes.test.ts instead.
if (!SKIP) {
  const migration = readMigration(NEW);
  for (let i = 1; i <= 3; i++) {
    try { await db.exec(migration); check(`applies, pass ${i}`, true); }
    catch (e) { check(`applies, pass ${i}`, false, e.message); }
  }
}

const one = async (sql) => { try { return (await db.query(sql)).rows[0]; } catch (e) { return { error: e.message }; } };
const as = async (uid, sql) => { try { await db.exec(`SET test.uid = '${uid}'`); return (await db.query(sql)).rows[0]; } catch (e) { return { error: e.message }; } finally { await db.exec(`RESET test.uid`); } };
const st = async (table, id) => (await one(`SELECT status FROM public.${table} WHERE id = '${id}'`))?.status;
const count = async (sql) => (await one(`SELECT count(*)::int AS c FROM (${sql}) q`))?.c;

let n = 100;
async function items({ wantHandovers = null, giveHandovers = null, seed = false } = {}) {
  n += 10;
  const [ia, ib] = [U(n), U(n + 1)];
  await db.exec(`INSERT INTO public.declutter_items (id, seller_id, title, status, price_cents, current_price_cents, accepts_trades, handovers, is_seed) VALUES
    ('${ia}', '${A}', 'Lamp ${n}', 'live', 6000, 6000, true, ${wantHandovers ? `ARRAY[${wantHandovers.map((h) => `'${h}'`)}]` : "NULL"}, ${seed}),
    ('${ib}', '${B}', 'Chair ${n}', 'live', 5000, 5000, false, ${giveHandovers ? `ARRAY[${giveHandovers.map((h) => `'${h}'`)}]` : "NULL"}, ${seed})`);
  return { ia, ib };
}
async function accepted(opts) {
  const { ia, ib } = await items(opts);
  const off = await as(B, `SELECT public.declutter_offer_swap('${ia}', '${ib}') AS id`);
  const acc = await as(A, `SELECT public.declutter_respond_swap('${off?.id}', 'accept') AS r`);
  const s = await one(`SELECT * FROM public.declutter_swap_offers WHERE id = '${off?.id}'`);
  return { ia, ib, s: off?.id, lb: s?.buyer_line_id, la: s?.seller_line_id, acc, off };
}

// #2: accept marks both lines.
const t1 = await accepted();
check("accept works", t1.acc?.r === "accepted", JSON.stringify(t1.acc ?? t1.off));
const marked = await one(`SELECT count(*) FILTER (WHERE swap_id = '${t1.s}')::int AS c FROM public.declutter_cart_items WHERE id IN ('${t1.lb}', '${t1.la}')`);
check("#2 accept stamps swap_id on both $0 lines", marked?.c === 2, JSON.stringify(marked));
check("#11 the new offer is emailed to the seller", (await count(`SELECT 1 FROM public.emails WHERE user_id = '${A}' AND title = 'New trade offer'`)) >= 1);
check("#11 the accept is emailed to the buyer", (await count(`SELECT 1 FROM public.emails WHERE user_id = '${B}' AND title LIKE 'Trade accepted%'`)) >= 1);

// #1: checking out only trade lines never meets the $2 fee gate; the ID check runs.
await db.exec(`DELETE FROM public.gate_calls`);
const co = await as(B, `SELECT public.declutter_checkout_free('${A}', 'porch') AS o`);
check("#1 a trade-only checkout succeeds while the member still owes the setup fee", co?.o && !co.error, JSON.stringify(co));
check("#1 the fee gate is never reached for a trade-only checkout", (await count(`SELECT 1 FROM public.gate_calls WHERE gate = 'fee'`)) === 0);
check("#1 the once-per-account ID check still runs", (await count(`SELECT 1 FROM public.gate_calls WHERE gate = 'id' AND member = '${B}'`)) === 1);
check("#2 the checkout notices say trade, never free item",
  (await count(`SELECT 1 FROM public.notices WHERE title IN ('Trade pickup set', 'Trade pickup chosen')`)) === 2
  && (await count(`SELECT 1 FROM public.notices WHERE title IN ('It''s yours', 'Free item claimed')`)) === 0);

// #1 control: a real free claim in the checkout still meets the fee gate.
const [freeItem, freeLine] = [U(950), U(951)];
await db.exec(`INSERT INTO public.declutter_items (id, seller_id, title, status, price_cents, current_price_cents) VALUES ('${freeItem}', '${A}', 'Free rug', 'reserved', 0, 0);
  INSERT INTO public.declutter_cart_items (id, item_id, buyer_id, seller_id, price_cents) VALUES ('${freeLine}', '${freeItem}', '${B}', '${A}', 0);`);
const coFree = await as(B, `SELECT public.declutter_checkout_free('${A}', 'porch') AS o`);
check("#1 control: a real free claim still meets the setup-fee gate", /setup_fee_required_to_claim/.test(coFree?.error ?? ""), JSON.stringify(coFree));
await db.exec(`DELETE FROM public.declutter_cart_items WHERE id = '${freeLine}'`);

// #8: a trade line beside a priced line from the same seller: only the $0 trade line checks out here.
const t8 = await accepted();
const [paidItem, paidLine] = [U(960), U(961)];
await db.exec(`INSERT INTO public.declutter_items (id, seller_id, title, status, price_cents, current_price_cents) VALUES ('${paidItem}', '${A}', 'Desk', 'reserved', 4000, 4000);
  INSERT INTO public.declutter_cart_items (id, item_id, buyer_id, seller_id, price_cents) VALUES ('${paidLine}', '${paidItem}', '${B}', '${A}', 4000);`);
const co8 = await as(B, `SELECT public.declutter_checkout_free('${A}', 'porch') AS o`);
check("#8 a trade line beside a priced line checks out as a free pickup", co8?.o && !co8.error, JSON.stringify(co8));
check("#8 the trade line is paid", (await st("declutter_cart_items", t8.lb)) === "paid");
check("#8 the priced line stays in the cart for its card checkout", (await st("declutter_cart_items", paidLine)) === "in_cart");
const card = await one(`INSERT INTO public.declutter_orders (buyer_id, seller_id, paid_with) VALUES ('${A}', '${B}', 'card') RETURNING id`);
const link = await one(`UPDATE public.declutter_cart_items SET order_id = '${card.id}' WHERE id = '${t8.la}' RETURNING id`);
check("#8 a trade line can never join a card order", /trade_checkout_first/.test(link?.error ?? ""), JSON.stringify(link));

// #5: the giver backs out of a trade line: the whole trade ends at once, no strike, trade wording.
const t5 = await accepted();
await db.exec(`DELETE FROM public.notices; DELETE FROM public.reopened`);
const cancel = await as(A, `SELECT public.declutter_seller_cancel_sale('${t5.ia}') AS r`);
check("#5 backing out of a trade line works", !cancel?.error, JSON.stringify(cancel));
check("#5 the trade ends at once", (await st("declutter_swap_offers", t5.s)) === "lapsed", await st("declutter_swap_offers", t5.s));
check("#5 the canceller's own hold is released too", (await st("declutter_cart_items", t5.la)) === "missed", await st("declutter_cart_items", t5.la));
check("#5 both items are back up", (await st("declutter_items", t5.ia)) === "live" && (await st("declutter_items", t5.ib)) === "live");
check("#4 held-back money offers on BOTH items reopen", (await count(`SELECT DISTINCT line FROM public.reopened WHERE line IN ('${t5.lb}', '${t5.la}')`)) === 2);
check("#5 no strike for backing out", (await count(`SELECT 1 FROM public.strikes`)) === 0);
check("#5 trade wording, not 'The giver cancelled' (the other side: Trade cancelled; the one who backed out: You cancelled the trade)",
  (await count(`SELECT 1 FROM public.notices WHERE title = 'Trade cancelled' AND user_id = '${B}'`)) === 1
  && (await count(`SELECT 1 FROM public.notices WHERE title = 'You cancelled the trade' AND user_id = '${A}'`)) === 1
  && (await count(`SELECT 1 FROM public.notices WHERE title LIKE 'The giver%' OR message LIKE '%free%'`)) === 0);
check("#11 the other side is emailed that the trade is off", (await count(`SELECT 1 FROM public.emails WHERE user_id = '${B}' AND title = 'Trade cancelled'`)) === 1);

// #4/#2: one side ran out (deadline sweep marked it missed): the swap sweep releases the other side, once.
const t4 = await accepted();
await db.exec(`UPDATE public.declutter_cart_items SET status = 'missed' WHERE id = '${t4.lb}';
  UPDATE public.declutter_items SET status = 'live' WHERE id = '${t4.ia}';
  DELETE FROM public.notices; DELETE FROM public.reopened;`);
// #11: an offer 6 hours from its end gets the reminder; a test-account trade never emails.
const tr = await items();
const offR = await as(B, `SELECT public.declutter_offer_swap('${tr.ia}', '${tr.ib}') AS id`);
await db.exec(`UPDATE public.declutter_swap_offers SET respond_by = now() + interval '6 hours' WHERE id = '${offR?.id}'`);
const tseed = await items({ seed: true });
const offS = await as(B, `SELECT public.declutter_offer_swap('${tseed.ia}', '${tseed.ib}') AS id`);
await db.exec(`UPDATE public.declutter_swap_offers SET respond_by = now() + interval '6 hours' WHERE id = '${offS?.id}'`);
const sw = await one(`SELECT public.declutter_swap_sweep() AS r`);
check("the sweep runs", !sw?.error, JSON.stringify(sw));
check("#4 the other side's line is released", (await st("declutter_cart_items", t4.la)) === "missed" && (await st("declutter_items", t4.ib)) === "live");
check("#4 offers on both items reopen", (await count(`SELECT DISTINCT line FROM public.reopened WHERE line IN ('${t4.lb}', '${t4.la}')`)) === 2);
check("#2 each side is told once", (await count(`SELECT 1 FROM public.notices WHERE title = 'Trade ended, no strike'`)) === 2);
check("#11 the 12-hour reminder goes to the seller (A sells both offers due in 6 hours)", (await count(`SELECT 1 FROM public.emails WHERE user_id = '${A}' AND title LIKE 'Trade offer: about 12 hours left'`)) === 2);
check("#11 each reminder row written is emailed once, through the notifications trigger",
  (await count(`SELECT 1 FROM public.notices WHERE title LIKE 'Trade offer: about 12 hours left'`)) === 2
  && (await count(`SELECT 1 FROM public.emails WHERE title LIKE 'Trade offer: about 12 hours left'`)) === 2);
const sw2 = await one(`SELECT public.declutter_swap_sweep() AS r`);
check("a second sweep sends no second reminder and ends nothing", sw2?.r?.reminded === 0 && sw2?.r?.lapsed === 0, JSON.stringify(sw2));
await db.exec(`UPDATE public.declutter_swap_offers SET respond_by = now() - interval '1 minute' WHERE id = '${offR?.id}'`);
await one(`SELECT public.declutter_swap_sweep()`);
check("#11 an expired offer is emailed to the buyer", (await count(`SELECT 1 FROM public.emails WHERE user_id = '${B}' AND title = 'Trade offer expired'`)) === 1);

// #7: pausing the OFFERED item closes the trade; pausing the WANTED item keeps it.
const p1 = await items();
const op1 = await as(B, `SELECT public.declutter_offer_swap('${p1.ia}', '${p1.ib}') AS id`);
await db.exec(`UPDATE public.declutter_items SET status = 'paused' WHERE id = '${p1.ib}'`);
check("#7 an offered item paused closes the trade", (await st("declutter_swap_offers", op1?.id)) === "voided", await st("declutter_swap_offers", op1?.id));
const p2 = await items();
const op2 = await as(B, `SELECT public.declutter_offer_swap('${p2.ia}', '${p2.ib}') AS id`);
await db.exec(`UPDATE public.declutter_items SET status = 'paused' WHERE id = '${p2.ia}'`);
check("#7 the seller's own item paused keeps the trade", (await st("declutter_swap_offers", op2?.id)) === "open", await st("declutter_swap_offers", op2?.id));

// #6: an item made free (the auto-free sweep's UPDATE) closes its trades and turns its switch off.
const f1 = await items();
const of1 = await as(B, `SELECT public.declutter_offer_swap('${f1.ia}', '${f1.ib}') AS id`);
await db.exec(`UPDATE public.declutter_items SET price_cents = 0, current_price_cents = 0 WHERE id = '${f1.ia}'`);
check("#6 an item made free closes its open trades", (await st("declutter_swap_offers", of1?.id)) === "voided", await st("declutter_swap_offers", of1?.id));
check("#6 an item made free stops taking trades", (await one(`SELECT accepts_trades FROM public.declutter_items WHERE id = '${f1.ia}'`))?.accepts_trades === false);

// #9: a meetup-only item cannot be traded (a trade is only ever a free pickup).
const m1 = await items({ wantHandovers: ["meetup"] });
const om1 = await as(B, `SELECT public.declutter_offer_swap('${m1.ia}', '${m1.ib}') AS id`);
check("#9 a meetup-only item cannot be traded", /trade_needs_pickup/.test(om1?.error ?? ""), JSON.stringify(om1));
const m2 = await items({ wantHandovers: ["porch", "meetup"] });
const om2 = await as(B, `SELECT public.declutter_offer_swap('${m2.ia}', '${m2.ib}') AS id`);
check("#9 control: an item with porch pickup can be traded", om2?.id && !om2.error, JSON.stringify(om2));

// Lead 11-08: the buyer's cart "Remove" on a trade line ends the whole trade at once (not at the next :47 sweep).
// B has made 10 offers today above (the daily cap): age them, so this one is not refused trade_rate_limited.
await db.exec(`UPDATE public.declutter_swap_offers SET created_at = created_at - interval '2 days'`);
const tx = await accepted();
await db.exec(`DELETE FROM public.notices; DELETE FROM public.reopened; DELETE FROM public.emails`);
const rm = await as(B, `SELECT public.declutter_remove_cart_item('${tx.lb}') AS r`);
check("Remove on a trade line works", rm?.r === "removed", JSON.stringify(rm) + JSON.stringify(tx.off));
check("Remove ends the trade at once", (await st("declutter_swap_offers", tx.s)) === "lapsed", await st("declutter_swap_offers", tx.s));
check("Remove releases the other side's line too", (await st("declutter_cart_items", tx.la)) === "missed", await st("declutter_cart_items", tx.la));
check("Remove puts both items back up", (await st("declutter_items", tx.ia)) === "live" && (await st("declutter_items", tx.ib)) === "live");
check("Remove reopens held-back money offers on both items", (await count(`SELECT DISTINCT line FROM public.reopened WHERE line IN ('${tx.lb}', '${tx.la}')`)) === 2);
check("Remove on a trade line sends trade wording, never 'Back on sale'",
  (await count(`SELECT 1 FROM public.notices WHERE title = 'Trade cancelled' AND user_id = '${A}'`)) === 1
  && (await count(`SELECT 1 FROM public.notices WHERE title = 'You cancelled the trade' AND user_id = '${B}'`)) === 1
  && (await count(`SELECT 1 FROM public.notices WHERE title = 'Back on sale'`)) === 0);
check("Remove on a trade line: the other side is emailed, the one who backed out is not", (await count(`SELECT 1 FROM public.emails WHERE user_id = '${A}' AND title = 'Trade cancelled'`)) === 1
  && (await count(`SELECT 1 FROM public.emails WHERE user_id = '${B}'`)) === 0);
check("Remove on a trade line gives no strike", (await count(`SELECT 1 FROM public.strikes`)) === 0);
// Control: a plain Buy-now line still sends "Back on sale" and touches no trade.
const [plainItem, plainLine] = [U(970), U(971)];
await db.exec(`INSERT INTO public.declutter_items (id, seller_id, title, status, price_cents, current_price_cents) VALUES ('${plainItem}', '${A}', 'Stool', 'reserved', 2000, 2000);
  INSERT INTO public.declutter_cart_items (id, item_id, buyer_id, seller_id, price_cents) VALUES ('${plainLine}', '${plainItem}', '${B}', '${A}', 2000);
  DELETE FROM public.notices;`);
const rmPlain = await as(B, `SELECT public.declutter_remove_cart_item('${plainLine}') AS r`);
check("control: Remove on a plain line still says 'Back on sale'", rmPlain?.r === "removed"
  && (await count(`SELECT 1 FROM public.notices WHERE title = 'Back on sale'`)) === 1
  && (await count(`SELECT 1 FROM public.notices WHERE title = 'Trade cancelled'`)) === 0, JSON.stringify(rmPlain));

// #3: a guest can read accepts_trades (the badge), and the guest preview names it.
const anonCol = await one(`SELECT has_column_privilege('anon', 'public.declutter_items', 'accepts_trades', 'SELECT') AS ok`);
check("#3 anon may read accepts_trades", anonCol?.ok === true, JSON.stringify(anonCol));
let gp;
try { await db.exec(`SET ROLE anon`); gp = (await db.query(`SELECT public.declutter_guest_preview() AS p`)).rows[0]; }
catch (e) { gp = { error: e.message }; }
finally { await db.exec(`RESET ROLE`); }
const firstGuestItem = gp?.p?.items?.[0];
check("#3 the guest preview runs as anon and answers accepts_trades", !!firstGuestItem && "accepts_trades" in firstGuestItem, JSON.stringify(gp).slice(0, 300));
let gf;
try { await db.exec(`SET ROLE anon`); gf = (await db.query(`SELECT public.declutter_guest_first_screen() AS p`)).rows[0]; }
catch (e) { gf = { error: e.message }; }
finally { await db.exec(`RESET ROLE`); }
const firstListItem = gf?.p?.items?.[0];
check("#3 the guest's whole list (no preview) runs as anon and answers accepts_trades", !!firstListItem && "accepts_trades" in firstListItem, JSON.stringify(gf).slice(0, 300));

// #11: a trade email follows only a row the seed boundary let through, and only the trade titles are emailed.
const S = U(990);
await db.exec(`INSERT INTO public.seed_ids VALUES ('${S}'); DELETE FROM public.emails;`);
await one(`SELECT public.declutter_notify('${S}', 'declutter_offers', 'New trade offer', 'x', '/declutter?tab=selling', '${A}')`);
check("#11 a trade notice the seed boundary drops is never emailed", (await count(`SELECT 1 FROM public.notices WHERE user_id = '${S}'`)) === 0
  && (await count(`SELECT 1 FROM public.emails`)) === 0);
await one(`SELECT public.declutter_notify('${A}', 'declutter_sales', 'Trade set: choose a pickup within 48 hours', 'x', '/declutter?tab=buying', '${B}')`);
await one(`SELECT public.declutter_notify('${A}', 'declutter_offers', 'New trade offer', 'x', '/jobs', '${B}')`);
check("#11 bell-only trade notices and non-Declutter links are not emailed", (await count(`SELECT 1 FROM public.emails`)) === 0);
const swapFns = await one(`SELECT count(*)::int AS c FROM pg_proc WHERE proname LIKE 'declutter_%swap%' AND prosrc LIKE '%send_notice_email%'`);
check("#11 no trade function emails directly (only the notifications trigger does)", swapFns?.c === 0, JSON.stringify(swapFns));

// Lander 11-08 (lead): main's trg_email_declutter_notice (20261108202546) also emails every declutter_offers /
// declutter_sales notice outside its exclusion list, so with both triggers a trade notice went out twice.
// 20261109005133 makes the trade trigger the one path. RED: TRADE_ONCE=skip (each emailed trade title goes twice,
// and the three bell-only titles are emailed once).
{
  const NOTICES = "20261108202546_declutter_notices_email_and_honest_sold.sql";
  const ONCE = "20261109005133_declutter_trade_email_once.sql";
  const notices = readMigration(NOTICES);
  const at = notices.indexOf("CREATE OR REPLACE FUNCTION public.email_declutter_notice()");
  const tail = "EXECUTE FUNCTION public.email_declutter_notice();";
  const end = notices.indexOf(tail, at) + tail.length;
  check("main's Declutter notice trigger is cut verbatim from 20261108202546", at > 0 && end > at);
  await db.exec(`CREATE OR REPLACE FUNCTION public.is_test_member(p uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;`);
  await db.exec(notices.slice(at, end));
  if (process.env.TRADE_ONCE !== "skip") {
    try { for (let i = 0; i < 3; i++) await db.exec(readMigration(ONCE)); check("20261109005133 applies 3x", true); }
    catch (e) { check("20261109005133 applies 3x", false, e.message); }
  }
  const emailed = [
    ["declutter_offers", "New trade offer"], ["declutter_offers", "Trade offer declined"],
    ["declutter_offers", "Trade offer expired"], ["declutter_offers", "Trade offer closed"],
    ["declutter_offers", "Trade offer: about 12 hours left"],
    ["declutter_sales", "Trade accepted: choose a pickup within 48 hours"],
    ["declutter_sales", "Trade cancelled"], ["declutter_sales", "Trade ended, no strike"],
  ];
  for (const [kind, title] of emailed) {
    await db.exec(`DELETE FROM public.emails`);
    await one(`SELECT public.declutter_notify('${A}', '${kind}', '${title}', 'x', '/declutter?tab=selling', '${B}')`);
    const n = await count(`SELECT 1 FROM public.emails WHERE user_id = '${A}'`);
    check(`one trade notice is emailed exactly once: "${title}"`, n === 1, `send_notice_email calls: ${n}`);
  }
  const bellOnly = [
    ["declutter_offers", "Trade offer withdrawn"], ["declutter_sales", "Trade set: choose a pickup within 48 hours"],
    ["declutter_sales", "You cancelled the trade"],
  ];
  for (const [kind, title] of bellOnly) {
    await db.exec(`DELETE FROM public.emails`);
    await one(`SELECT public.declutter_notify('${A}', '${kind}', '${title}', 'x', '/declutter?tab=buying', '${B}')`);
    const n = await count(`SELECT 1 FROM public.emails`);
    check(`a bell-only trade notice is never emailed: "${title}"`, n === 0, `send_notice_email calls: ${n}`);
  }
  // A non-trade Declutter action notice is still emailed once, by main's trigger.
  await db.exec(`DELETE FROM public.emails`);
  await one(`SELECT public.declutter_notify('${A}', 'declutter_offers', 'Offer accepted', 'x', '/declutter?tab=buying', '${B}')`);
  const other = await count(`SELECT 1 FROM public.emails WHERE user_id = '${A}'`);
  check("a non-trade Declutter offer notice is still emailed once", other === 1, `send_notice_email calls: ${other}`);
}

for (const fn of ["declutter_end_swap(uuid, uuid)", "declutter_swap_sweep()"]) {
  const priv = await one(`SELECT has_function_privilege('authenticated', 'public.${fn}', 'EXECUTE') AS a, has_function_privilege('anon', 'public.${fn}', 'EXECUTE') AS n`);
  check(`${fn} is service_role only`, priv && priv.a === false && priv.n === false, JSON.stringify(priv));
}

console.log(`\n${state.failures ? "RED" : "GREEN"}: ${state.failures} failed`);
process.exit(state.failures ? 1 : 0);
