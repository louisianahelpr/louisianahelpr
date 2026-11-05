#!/usr/bin/env node
/**
 * Q2106 S3b step 4 part 2 (PGlite proof for 20261105052751_declutter_gift_delivery_refunds): a delivery-fee or shipping
 * refund row of a gift-paid order carries its gift share, and a gift-only order gets the refund at all.
 *   (1) card-only order: declutter_delivery_refund writes the whole fee as card (gift share 0), as before;
 *   (2) mixed order (gift 600 of 1000): the fee splits proportionally (fee 200 -> gift 120, card 80);
 *   (3) gift-only order (NO payment intent): declutter_delivery_refund no longer raises no_delivery_fee; the row has no
 *       payment intent and is all gift;
 *   (4) declutter_ship_refund_after_void on a gift-only shipped order writes the shipping row (it RETURNed NULL before),
 *       all gift, and the buyer notice names the gift balance; on a mixed order it names both parts;
 *   (5) declutter_delivery_refunds_due hands declutter-money the CARD part as refund_cents and the gift share apart;
 *   (6) a row with no payment intent and any card part is refused (CHECK); a gift share above the refund is refused;
 *   (7) declutter_order_refunds_recorded_cents counts only the card part of a succeeded delivery row;
 *   (8) step 5: declutter_refund_notice_names_gift (the wrap of declutter_close_paid_order's buyer notice) leaves a
 *       card-only refund's text as is and names the gift balance for a refund row's gift share;
 *   the file replays 3x.
 *   node src/test/pglite/declutterGiftDeliveryRefunds.pglite.mjs                     # all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/declutterGiftDeliveryRefunds.pglite.mjs  # RED
 * Real, run verbatim: declutter_delivery_refunds' CREATE TABLE (20261017055505), the reason CHECK of 20261102051521,
 * declutter_order_gift_net_cents + declutter_refund_gift_split (20261105030604), the step-3 migration
 * 20261105042758 (declutter_refunds gift columns), and with skip off this file's migration. Without it, the NEWEST
 * definitions before it are loaded (declutter_delivery_refund from 20261027153244, declutter_ship_refund_after_void
 * from 20261102051521, declutter_delivery_refunds_due from 20261017055505). Stubs: declutter_orders, gift_cards,
 * declutter_refunds (the 20261014224914 CREATE TABLE), shipments, declutter_notify (records the notice).
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const skip = process.env.NEW_MIGRATION === "skip";
let failures = 0;
const check = (ok, name, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  (${detail})` : ""}`); if (!ok) failures++; };
const read = (f) => readFileSync(MIG_DIR + f, "utf8");
/** One function's CREATE ... $fn$; statement plus its REVOKE/GRANT lines, from a migration file (last match wins). */
const fnFrom = (file, name) => {
  const src = read(file);
  const re = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\n\\$fn\\$;`, "g");
  const all = src.match(re);
  if (!all) throw new Error(`${name} not found in ${file}`);
  return all[all.length - 1];
};

const helpr = read("20261017055505_declutter_helpr_delivery.sql");
const createDelivery = /CREATE TABLE IF NOT EXISTS public\.declutter_delivery_refunds \([\s\S]*?\n\);/.exec(helpr)[0];
const createRefunds = /CREATE TABLE IF NOT EXISTS public\.declutter_refunds \([\s\S]*?\n\);/.exec(read("20261014224914_declutter_slice3b_payments.sql"))[0];
const db = new PGlite();
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY, buyer_id uuid, seller_id uuid, stripe_checkout_session_id text,
    stripe_payment_intent_id text, setup_fee_state text, setup_fee_cents integer NOT NULL DEFAULT 0,
    total_cents integer NOT NULL DEFAULT 0, delivery_cents integer NOT NULL DEFAULT 0, shipping_cents integer NOT NULL DEFAULT 0,
    gift_cents integer NOT NULL DEFAULT 0, handover text, status text);
  CREATE TABLE public.gift_cards (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), amount numeric, restored_from_declutter_order_id uuid);
  CREATE TABLE public.shipments (declutter_order_id uuid, label_state text);
  CREATE TABLE public.helpr_tasks (id uuid PRIMARY KEY);
  CREATE TABLE public.notes (user_id uuid, title text, body text);
  CREATE FUNCTION public.declutter_notify(p_user uuid, p_kind text, p_title text, p_body text, p_link text, p_from uuid)
    RETURNS void LANGUAGE sql AS $$ INSERT INTO public.notes VALUES (p_user, p_title, p_body) $$;
  ${createRefunds}
  ALTER TABLE public.declutter_refunds ADD COLUMN IF NOT EXISTS payment_livemode boolean,
    ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now();
  ALTER TABLE public.declutter_refunds DROP CONSTRAINT IF EXISTS declutter_refunds_reason_check,
    DROP CONSTRAINT IF EXISTS declutter_refunds_fee_policy_check;
  CREATE TABLE public.declutter_payouts (id uuid PRIMARY KEY, order_id uuid, seller_id uuid, status text);
  CREATE TABLE public.payout_payee_waits (payout_kind text, payout_id uuid, category text);
  CREATE TABLE public.payout_holds (helper_id uuid);
  ${createDelivery}
  ALTER TABLE public.declutter_delivery_refunds DROP CONSTRAINT IF EXISTS declutter_delivery_refunds_reason_check;
  ALTER TABLE public.declutter_delivery_refunds ADD CONSTRAINT declutter_delivery_refunds_reason_check
    CHECK (reason IN ('no_helpr', 'delivery_not_done', 'ship_void_refunded'));
  ${fnFrom("20261105030604_declutter_gift_cards.sql", "declutter_order_gift_net_cents")}
  ${fnFrom("20261105030604_declutter_gift_cards.sql", "declutter_refund_gift_split")}
  ${fnFrom("20261027153244_declutter_seller_delivery.sql", "declutter_delivery_refund")}
  ${fnFrom("20261102051521_shipping_refund_after_void.sql", "declutter_ship_refund_after_void")}
  ${fnFrom("20261017055505_declutter_helpr_delivery.sql", "declutter_delivery_refunds_due")}`);
await db.exec(read("20261105042758_declutter_gift_refund_rows.sql"));
if (!skip) {
  const mig = read("20261105052751_declutter_gift_delivery_refunds.sql");
  for (let i = 0; i < 3; i++) await db.exec(mig);
}

const B = "00000000-0000-4000-8000-0000000000b0";
const S = "00000000-0000-4000-8000-0000000000c0";
const CARD = "00000000-0000-4000-8000-000000000001";
const MIX = "00000000-0000-4000-8000-000000000002";
const GIFT = "00000000-0000-4000-8000-000000000003";
const SHIPG = "00000000-0000-4000-8000-000000000004";
const SHIPM = "00000000-0000-4000-8000-000000000005";
await db.exec(`INSERT INTO public.declutter_orders (id, buyer_id, seller_id, stripe_payment_intent_id, total_cents, delivery_cents, shipping_cents, gift_cents, handover, status) VALUES
  ('${CARD}', '${B}', '${S}', 'pi_card', 1000, 200, 0, 0, 'helpr_delivery', 'paid'),
  ('${MIX}', '${B}', '${S}', 'pi_mix', 1000, 200, 0, 600, 'helpr_delivery', 'paid'),
  ('${GIFT}', '${B}', '${S}', NULL, 1000, 200, 0, 1000, 'helpr_delivery', 'paid'),
  ('${SHIPG}', '${B}', '${S}', NULL, 1000, 0, 300, 1000, 'ship', 'refunded'),
  ('${SHIPM}', '${B}', '${S}', 'pi_shipm', 1000, 0, 300, 500, 'ship', 'refunded');
  INSERT INTO public.shipments VALUES ('${SHIPG}', 'voided'), ('${SHIPM}', 'voided');
  INSERT INTO public.declutter_refunds (order_id, stripe_payment_intent_id, reason, fee_policy, paid_cents, card_fee_cents, refund_cents, gift_refund_cents) VALUES
  ('${SHIPG}', NULL, 'buyer_cancelled', 'keep_card_fee', 700, 0, 700, 700),
  ('${SHIPM}', 'pi_shipm', 'buyer_cancelled', 'keep_card_fee', 700, 20, 680, 350);`);
const row = async (order) => (await db.query(`SELECT * FROM public.declutter_delivery_refunds WHERE order_id = '${order}'`)).rows[0];
const call = async (sql) => { try { return (await db.query(sql)).rows[0]; } catch (e) { return { error: String(e.message).slice(0, 120) }; } };

await call(`SELECT public.declutter_delivery_refund('${CARD}', 'no_helpr')`);
const rc = await row(CARD);
check(rc?.refund_cents === 200 && (rc?.gift_refund_cents ?? 0) === 0 && rc?.stripe_payment_intent_id === "pi_card", "(1) card-only: 200 to the card, gift 0", JSON.stringify(rc));
await call(`SELECT public.declutter_delivery_refund('${MIX}', 'no_helpr')`);
const rm = await row(MIX);
check(rm?.refund_cents === 200 && rm?.gift_refund_cents === 120, "(2) mixed: fee 200 = gift 120 + card 80", JSON.stringify(rm));
const g = await call(`SELECT public.declutter_delivery_refund('${GIFT}', 'delivery_not_done') AS id`);
const rg = await row(GIFT);
check(!g?.error && rg?.refund_cents === 200 && rg?.gift_refund_cents === 200 && rg?.stripe_payment_intent_id === null,
  "(3) gift-only: no no_delivery_fee raise; the row is all gift with no payment intent", JSON.stringify(g?.error ? g : rg));

await call(`SELECT public.declutter_ship_refund_after_void('${SHIPG}')`);
const rsg = await row(SHIPG);
check(rsg?.reason === "ship_void_refunded" && rsg?.refund_cents === 300 && rsg?.gift_refund_cents === 300 && rsg?.stripe_payment_intent_id === null,
  "(4) ship void on a gift-only order writes the shipping row, all gift", JSON.stringify(rsg));
const notes = (await db.query(`SELECT body FROM public.notes`)).rows.map((r) => r.body);
check(notes.some((b) => /\$3\.00 you paid for shipping is going back to your gift balance/.test(b)), "(4) the gift-only notice names the gift balance", JSON.stringify(notes));
await call(`SELECT public.declutter_ship_refund_after_void('${SHIPM}')`);
const rsm = await row(SHIPM);
check(rsm?.refund_cents === 300 && rsm?.gift_refund_cents === 150, "(4) ship void on a mixed order: 300 = gift 150 + card 150", JSON.stringify(rsm));
const notes2 = (await db.query(`SELECT body FROM public.notes`)).rows.map((r) => r.body);
check(notes2.some((b) => /\$1\.50 to your card and \$1\.50 to your gift balance/.test(b)), "(4) the mixed notice names both parts", JSON.stringify(notes2));
// Replays: a second call writes nothing new and the notice is not repeated.
await call(`SELECT public.declutter_ship_refund_after_void('${SHIPM}')`);
const n3 = (await db.query(`SELECT count(*)::int AS n FROM public.declutter_delivery_refunds WHERE order_id = '${SHIPM}'`)).rows[0].n;
check(n3 === 1, "(4) a second void call writes no second row", String(n3));

let due = [];
try { due = (await db.query(`SELECT * FROM public.declutter_delivery_refunds_due(50)`)).rows; } catch (e) { due = String(e.message); }
const byOrder = (o) => Array.isArray(due) ? due.find((r) => r.order_id === o) : undefined;
check(byOrder(CARD)?.refund_cents === 200 && byOrder(CARD)?.gift_refund_cents === 0, "(5) card row: 200 to the card, no gift", JSON.stringify(byOrder(CARD) ?? due));
check(byOrder(MIX)?.refund_cents === 80 && byOrder(MIX)?.gift_refund_cents === 120, "(5) mixed row: 80 to the card (decided in SQL), 120 to the gift balance", JSON.stringify(byOrder(MIX) ?? due));
check(byOrder(GIFT)?.refund_cents === 0 && byOrder(GIFT)?.gift_refund_cents === 200 && byOrder(GIFT)?.payment_intent_id === null,
  "(5) gift-only row: no payment intent, 0 to the card, 200 to the gift balance", JSON.stringify(byOrder(GIFT) ?? due));

const O6 = "00000000-0000-4000-8000-000000000006";
await db.exec(`INSERT INTO public.declutter_orders (id, total_cents) VALUES ('${O6}', 1000)`);
const ins = async (pi, refund, gift) => {
  try { await db.query(`INSERT INTO public.declutter_delivery_refunds (order_id, stripe_payment_intent_id, reason, refund_cents, gift_refund_cents) VALUES ('${O6}', ${pi}, 'no_helpr', ${refund}, ${gift})`); await db.query(`DELETE FROM public.declutter_delivery_refunds WHERE order_id = '${O6}'`); return "ok"; }
  catch (e) { return String(e.message).slice(0, 120); }
};
check(await ins("NULL", 200, 100) !== "ok", "(6) no payment intent with a card part is refused");
check(await ins("'pi_x'", 200, 201) !== "ok", "(6) a gift share above the refund is refused");
check(await ins("'pi_x'", 200, -1) !== "ok", "(6) a negative gift share is refused");

await db.exec(`UPDATE public.declutter_delivery_refunds SET status = 'succeeded' WHERE order_id = '${MIX}'`);
const rec = await call(`SELECT public.declutter_order_refunds_recorded_cents('${MIX}') AS c`);
check(rec?.c === 80, "(7) recorded_cents counts the delivery row's card part only (80, not 200)", JSON.stringify(rec));

// (8) step 5: the close_paid_order notice wrap.
const nn = async (refundOrder, text) => call(`SELECT public.declutter_refund_notice_names_gift((SELECT id FROM public.declutter_refunds WHERE order_id = '${refundOrder}'), '${text}') AS t`);
const CARDR = "00000000-0000-4000-8000-000000000007";
await db.exec(`INSERT INTO public.declutter_orders (id, total_cents) VALUES ('${CARDR}', 1000);
  INSERT INTO public.declutter_refunds (order_id, stripe_payment_intent_id, reason, fee_policy, paid_cents, card_fee_cents, refund_cents) VALUES
  ('${CARDR}', 'pi_cardr', 'order_closed', 'full_platform_absorbs', 1000, 0, 1000)`);
const t1 = await nn(CARDR, "All $10.00 is coming back to your card.");
check(t1?.t === "All $10.00 is coming back to your card.", "(8) a card-only refund's notice is unchanged", JSON.stringify(t1));
const t2 = await nn(SHIPM, "All $6.80 is coming back to your card.");
check(t2?.t === "All $6.80 is coming back to you. $3.50 goes back to your gift balance and $3.30 to your card.", "(8) a mixed refund names both parts", JSON.stringify(t2));
const t3 = await nn(SHIPG, "All $7.00 is coming back to your card.");
check(t3?.t === "All $7.00 is coming back to you. It all goes back to your gift balance ($7.00).", "(8) an all-gift refund names the gift balance only", JSON.stringify(t3));
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
