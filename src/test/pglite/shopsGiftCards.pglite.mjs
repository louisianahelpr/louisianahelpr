#!/usr/bin/env node
/**
 * Q2105 step 1 (PGlite proof for 20261111015126_shops_gift_card_ledger): the gift ledger learns Shops orders. Nothing
 * calls the RPC yet; this proves the ledger rules it will be called with.
 *   (1) the gift covers part: reserved and lowered to what it pays, the order's gift_cents set, the card remainder
 *       answered ('needs_hold'); 'held' and 'accepted' alone do NOT redeem it; the capture (captured_at set) does;
 *   (2) the gift covers the whole order ('covered'): the leftover is split off as the buyer's own child gift (value
 *       kept); a decline puts the lowered gift back to 'sent' and leaves the child alone;
 *   (3) every other close before capture puts the gift back once (expired, cancelled from held, superseded); a
 *       refund AFTER capture does not un-redeem it;
 *   (4) a card remainder of 1-49 cents is refused with a sentence and nothing changes; exactly 50 cents is allowed;
 *   (5) the gates: someone else's gift, an unfunded or expired gift, a gift set aside for another order or a job, a
 *       used gift, someone else's order, a held order, a card page still open (the retired one is allowed and cleared);
 *   (6) a second gift on the same order (no page open) puts the first back to 'sent';
 *   (7) grants service_role only; the file replays 3x;
 *   (8) the setup fee (outside total_cents) is part of the price the gift pays;
 *   (9) only the capture redeems (a covered order's step 2 accept sets captured_at with 'accepted'); an accepted but
 *       uncaptured order that is cancelled gets the gift back; only the four closes before capture put a gift back;
 *   (10) a deposit order refuses a gift for now;
 *   (11) the caller's calculated tax is part of the price, written on the order, never added twice.
 *
 *   node src/test/pglite/shopsGiftCards.pglite.mjs                       # all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/shopsGiftCards.pglite.mjs    # RED: the columns alone, no RPC, no trigger
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/shopsGiftCards.pglite.mjs  # RED on a planted defect
 *
 * Real: this file applied verbatim, 3x. Stubbed, said so: shop_orders and gift_cards reduced to the columns read.
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261111015126_shops_gift_card_ledger.sql";
const skip = process.env.NEW_MIGRATION === "skip";

let failures = 0;
const check = (ok, name, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  (${detail})` : ""}`); if (!ok) failures++; };
const U = (n) => `5d0b5d0b-0000-0000-0000-${String(n).padStart(12, "0")}`;

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE TABLE public.shop_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid, buyer_id uuid, status text NOT NULL,
  items_cents integer NOT NULL, premium_cents integer NOT NULL DEFAULT 0, tax_cents integer NOT NULL DEFAULT 0, total_cents integer NOT NULL,
  stripe_payment_intent_id text, stripe_checkout_session_id text, captured_at timestamptz, card_fee_cents integer,
  setup_fee_cents integer NOT NULL DEFAULT 0, payment_plan text NOT NULL DEFAULT 'full_hold');
CREATE TABLE public.gift_cards (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), donor_id uuid, recipient_id uuid, recipient_email text,
  amount numeric NOT NULL, status text NOT NULL, payment_status text, category text, message text, occasion text, design_id text, parent_credit_id uuid,
  job_id uuid, split_for_job_id uuid, restored_from_job_id uuid, declutter_order_id uuid, split_for_declutter_order_id uuid,
  expires_at timestamptz, redeemed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
`);
const mig = readFileSync(process.env.MIGRATION_PATH ?? MIG_DIR + THIS, "utf8"); // MIGRATION_PATH: a planted copy (vacuity)
if (skip) {
  await db.exec(mig.slice(mig.indexOf("ALTER TABLE public.gift_cards"), mig.indexOf("CREATE OR REPLACE FUNCTION public.redeem_gift_card_for_shop_order")));
} else {
  for (let k = 1; k <= 3; k++) await db.exec(mig);
}

const q = async (s, p = []) => (await db.query(s, p)).rows;
const row = async (t, id) => (await q(`SELECT * FROM public.${t} WHERE id = $1`, [id]))[0];
const cents = (n) => Math.round(Number(n) * 100);
const giftsOf = async (uid) => q(`SELECT * FROM public.gift_cards WHERE recipient_id = $1 ORDER BY created_at, amount`, [uid]);
const order = async (buyer, total = 4000, extra = {}) => (await q(`INSERT INTO public.shop_orders (shop_id, buyer_id, status, items_cents, total_cents, stripe_checkout_session_id, setup_fee_cents, payment_plan)
  VALUES ($1, $2, $3, $4, $4, $5, $6, $7) RETURNING id`, [U(900), buyer, extra.status ?? "awaiting_hold", total, extra.session ?? null, extra.fee ?? 0, extra.plan ?? "full_hold"]))[0].id;
const gift = async (to, dollars, extra = {}) => (await q(`INSERT INTO public.gift_cards (donor_id, recipient_id, amount, status, payment_status, expires_at, job_id, shop_order_id)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`, [U(999), to, dollars, extra.status ?? "sent", extra.paid ?? "paid", extra.expires ?? null, extra.job ?? null, extra.shopOrder ?? null]))[0].id;
const redeem = async (g, o, user, retired = null, tax = 0) => {
  try { return (await q(`SELECT public.redeem_gift_card_for_shop_order($1, $2, $3, $4, $5) AS r`, [g, o, user, tax, retired]))[0].r; }
  catch (e) { return { error: e.message }; }
};
const setStatus = (o, status) => q(`UPDATE public.shop_orders SET status = $2 WHERE id = $1`, [o, status]);
const capture = (o) => q(`UPDATE public.shop_orders SET captured_at = now(), card_fee_cents = 80, stripe_payment_intent_id = 'pi_q2105' WHERE id = $1`, [o]);
const safeRow = async (t, id) => { try { return await row(t, id); } catch (e) { return { error: e.message }; } };
const snapshot = async (uid) => JSON.stringify((await giftsOf(uid)).map((g) => [g.id, g.status, cents(g.amount), g.shop_order_id]));

// (1) Part cover: $25 gift on a $40 order; held and accepted leave it reserved; the capture redeems it.
const B1 = U(1);
const o1 = await order(B1);
const g1 = await gift(B1, 25);
const r1 = await redeem(g1, o1, B1);
check(r1?.outcome === "needs_hold" && r1?.difference_cents === 1500 && r1?.applied_cents === 2500 && r1?.leftover_cents === 0,
  "(1) a part-covering gift answers the card remainder", JSON.stringify(r1));
const ord1 = await row("shop_orders", o1);
check(ord1?.gift_cents === 2500 && ord1.gift_card_id === g1 && ord1.status === "awaiting_hold", "(1) the order carries gift_cents and the gift; still awaiting the hold", JSON.stringify(ord1));
check((await row("gift_cards", g1))?.status === "reserved" && (await row("gift_cards", g1))?.shop_order_id === o1 && (await giftsOf(B1)).length === 1,
  "(1) the gift is reserved for the order, no leftover split (it was all applied)");
await setStatus(o1, "held");
await setStatus(o1, "accepted");
check((await row("gift_cards", g1))?.status === "reserved", "(1) 'held' then 'accepted' do not redeem the gift (the capture may still fail)");
await capture(o1);
const gc1 = await row("gift_cards", g1);
check(gc1?.status === "redeemed" && gc1.redeemed_at !== null && gc1.shop_order_id === o1 && cents(gc1.amount) === 2500,
  "(1) the capture redeems the reserved gift, lowered to what it paid", JSON.stringify(gc1));
check((await redeem(g1, o1, B1))?.error === "This order can no longer take a gift", "(1) an accepted order takes no gift");

// (2) Covered in full: $50 gift on a $40 order; the leftover is the buyer's child; a decline puts the parent back.
const B2 = U(2);
const o2 = await order(B2);
const g2 = await gift(B2, 50);
const r2 = await redeem(g2, o2, B2);
check(r2?.outcome === "covered" && r2?.difference_cents === 0 && r2?.applied_cents === 4000 && r2?.leftover_cents === 1000,
  "(2) a gift that covers the whole order answers 'covered' with no remainder", JSON.stringify(r2));
const gs2 = await giftsOf(B2);
const parent2 = gs2.find((g) => g.id === g2), child2 = gs2.find((g) => g.parent_credit_id === g2);
check(parent2?.status === "reserved" && cents(parent2.amount) === 4000 && parent2.shop_order_id === o2,
  "(2) the gift is lowered to the price and reserved (redeemed only at capture)", JSON.stringify(parent2));
check(child2?.status === "sent" && cents(child2.amount) === 1000 && child2.split_for_shop_order_id === o2 && child2.shop_order_id === null
  && child2.payment_status === "paid" && cents(parent2?.amount ?? 0) + cents(child2?.amount ?? 0) === 5000,
  "(2) the leftover is the buyer's own paid gift; parent + child = the original $50", JSON.stringify(child2));
check((await row("shop_orders", o2))?.gift_cents === 4000, "(2) gift_cents = the whole price");
await setStatus(o2, "declined");
const after2 = await giftsOf(B2);
check(after2.find((g) => g.id === g2)?.status === "sent" && after2.find((g) => g.id === g2)?.shop_order_id === null && cents(after2.find((g) => g.id === g2).amount) === 4000,
  "(2) a decline puts the lowered gift back to 'sent' for the buyer", JSON.stringify(after2));
check(after2.find((g) => g.id === child2.id)?.status === "sent" && cents(after2.find((g) => g.id === child2.id).amount) === 1000
  && after2.reduce((s, g) => s + cents(g.amount), 0) === 5000, "(2) the child is untouched; the buyer still has $50 in all");

// (3) Every close before capture puts the gift back, once; a refund after capture does not un-redeem.
for (const [path, steps] of [["expired", ["expired"]], ["cancelled after held", ["held", "cancelled"]], ["superseded", ["superseded"]]]) {
  const B = U(30 + steps.length), o = await order(B), g = await gift(B, 25);
  await redeem(g, o, B);
  for (const s of steps) await setStatus(o, s);
  const gc = await row("gift_cards", g);
  check(gc?.status === "sent" && gc.shop_order_id === null && cents(gc.amount) === 2500 && (await row("shop_orders", o)).gift_card_id === g,
    `(3) ${path}: the reserved gift goes back to 'sent'; the order keeps the trail`, JSON.stringify(gc));
  await setStatus(o, "declined");
  check((await row("gift_cards", g))?.status === "sent", `(3) ${path}: a later status change does not touch the returned gift`);
}
await setStatus(o1, "refunded");
check((await row("gift_cards", g1))?.status === "redeemed", "(3) a refund after capture does not un-redeem the gift (the refund path is its own step)");

// (4) 1-49 cent remainder refused before anything changes; exactly 50 cents allowed.
const B4 = U(4);
const o4 = await order(B4, 4000), g4 = await gift(B4, 39.75);
const before4 = await snapshot(B4);
const r4 = await redeem(g4, o4, B4);
check(/covers all but \$0\.25 of this order/.test(r4?.error ?? "") && /at least \$0\.50/.test(r4.error), "(4) a 25-cent remainder is refused with the sentence", JSON.stringify(r4));
check((await snapshot(B4)) === before4 && (await row("shop_orders", o4)).gift_cents === 0 && (await row("shop_orders", o4)).gift_card_id === null,
  "(4) nothing changed: the gift and the order are as before");
const g4b = await gift(B4, 39.5);
const r4b = await redeem(g4b, o4, B4);
check(r4b?.outcome === "needs_hold" && r4b.difference_cents === 50, "(4) exactly 50 cents to pay by card is allowed", JSON.stringify(r4b));

// (5) The gates.
const B5 = U(5), X5 = U(55);
const o5 = await order(B5);
check((await redeem(await gift(X5, 25), o5, B5))?.error === "This gift is not yours to redeem", "(5) someone else's gift");
check((await redeem(await gift(B5, 25, { paid: "pending" }), o5, B5))?.error === "This gift has not been funded yet", "(5) an unfunded gift");
check((await redeem(await gift(B5, 25, { expires: "2020-01-01" }), o5, B5))?.error === "This gift has expired", "(5) an expired gift");
check((await redeem(await gift(B5, 25, { status: "reserved", shopOrder: U(777) }), o5, B5))?.error === "This gift is set aside for something else", "(5) a gift reserved for another order");
check((await redeem(await gift(B5, 25, { status: "reserved", job: U(778) }), o5, B5))?.error === "This gift is set aside for something else", "(5) a gift reserved for a job");
check((await redeem(await gift(B5, 25, { status: "redeemed" }), o5, B5))?.error === "This gift is no longer available", "(5) a used gift");
check((await redeem(await gift(B5, 25), o5, X5))?.error === "This is not your order", "(5) someone else's order");
check((await redeem(await gift(B5, 25), await order(B5, 4000, { status: "held" }), B5))?.error === "This order can no longer take a gift", "(5) a held order");
check((await redeem(await gift(B5, 25), U(1234), B5))?.error === "Order not found", "(5) an unknown order");
check((await redeem(U(1235), o5, B5))?.error === "Gift not found", "(5) an unknown gift");
check((await redeem(null, o5, B5))?.error?.includes("required"), "(5) missing args");
const o5s = await order(B5, 4000, { session: "cs_open" });
check((await redeem(await gift(B5, 25), o5s, B5))?.error?.startsWith("A card payment for this order is already open"), "(5) a card page still open blocks the gift");
const g5 = await gift(B5, 25);
const r5 = await redeem(g5, o5s, B5, "cs_open");
check(r5?.outcome === "needs_hold" && (await row("shop_orders", o5s)).stripe_checkout_session_id === null && (await row("gift_cards", g5)).status === "reserved",
  "(5) the retired page is allowed and cleared from the order", JSON.stringify(r5));
check((await redeem(g5, o5s, B5))?.outcome === "needs_hold" && (await row("gift_cards", g5)).status === "reserved" && cents((await row("gift_cards", g5)).amount) === 2500
  && (await giftsOf(B5)).filter((g) => g.parent_credit_id === g5).length === 0,
  "(5) applying the same reserved gift again is idempotent (no second split, same amount)");

// (6) A second gift on the same order puts the first back.
const B6 = U(6);
const o6 = await order(B6), g6a = await gift(B6, 25), g6b = await gift(B6, 30);
await redeem(g6a, o6, B6);
const r6 = await redeem(g6b, o6, B6);
const a6 = await row("gift_cards", g6a), b6 = await row("gift_cards", g6b), ord6 = await row("shop_orders", o6);
check(r6?.outcome === "needs_hold" && r6.difference_cents === 1000 && a6.status === "sent" && a6.shop_order_id === null && cents(a6.amount) === 2500
  && b6.status === "reserved" && b6.shop_order_id === o6 && ord6.gift_cents === 3000 && ord6.gift_card_id === g6b,
  "(6) the second gift replaces the first, which goes back to 'sent' at its amount", JSON.stringify({ r6, a6, b6, ord6 }));

// (7) An order with no gift: the trigger never fires (WHEN gift_card_id IS NOT NULL); the constraint holds.
const o7 = await order(U(7));
await setStatus(o7, "held"); await capture(o7); await setStatus(o7, "accepted");
check((await row("shop_orders", o7))?.gift_cents === 0 && (await row("shop_orders", o7)).status === "accepted", "(7) an order with no gift is untouched");
let bad7 = null; try { await q(`UPDATE public.shop_orders SET gift_cents = 9999 WHERE id = $1`, [o7]); } catch (e) { bad7 = e.message; }
check(/shop_orders_gift_cents_check/.test(bad7 ?? ""), "(7) gift_cents above the total is refused by the constraint", bad7 ?? "no error");

// (8) The H4 setup fee is part of the price the gift pays (it lives outside total_cents, as Declutter's).
const B8 = U(8);
const o8 = await order(B8, 4000, { fee: 200 }), g8 = await gift(B8, 50);
const r8 = await redeem(g8, o8, B8);
check(r8?.outcome === "covered" && r8?.applied_cents === 4200 && r8?.leftover_cents === 800 && (await safeRow("shop_orders", o8))?.gift_cents === 4200,
  "(8) a $50 gift on a $40 order with the $2 setup fee pays $42 and splits off $8", JSON.stringify(r8));
const o8b = await order(B8, 4000, { fee: 200 }), g8b = await gift(B8, 40);
const r8b = await redeem(g8b, o8b, B8);
check(r8b?.outcome === "needs_hold" && r8b?.difference_cents === 200, "(8) a $40 gift on the same order leaves the $2 fee to the card", JSON.stringify(r8b));

// (9) A covered order has no hold: its step 2 accept sets captured_at with 'accepted' (one update), which redeems.
// 'accepted' alone never redeems (shop_captures_due cancels an accepted order left uncaptured: the gift must come back).
const B9 = U(9);
const o9 = await order(B9, 4000), g9 = await gift(B9, 40);
await redeem(g9, o9, B9);
await setStatus(o9, "accepted");
check((await safeRow("gift_cards", g9))?.status === "reserved", "(9) a covered order's 'accepted' alone does not redeem");
await setStatus(o9, "cancelled");
check((await safeRow("gift_cards", g9))?.status === "sent", "(9) an accepted-but-uncaptured covered order that is cancelled gets its gift back");
const o9d = await order(B9, 4000), g9d = await gift(B9, 40);
await redeem(g9d, o9d, B9);
await q(`UPDATE public.shop_orders SET status = 'accepted', captured_at = now() WHERE id = $1`, [o9d]);
const gc9 = await safeRow("gift_cards", g9d);
check(gc9?.status === "redeemed" && gc9?.redeemed_at != null, "(9) accepted + captured_at in one update redeems the covered gift", JSON.stringify(gc9));
await setStatus(o9d, "handed_over");
check((await safeRow("gift_cards", g9d))?.status === "redeemed", "(9) handing it over leaves the gift redeemed");
const o9b = await order(B9, 4000), g9b = await gift(B9, 40);
await redeem(g9b, o9b, B9);
await setStatus(o9b, "declined");
check((await safeRow("gift_cards", g9b))?.status === "sent", "(9) a covered order declined before the yes gets its gift back");
// A part-covered order is NOT redeemed by the yes (the card capture may still fail) and a status the order never
// closes on (handed_over without a capture, as a covered order) does not put it back.
const o9c = await order(B9, 4000), g9c = await gift(B9, 25);
await redeem(g9c, o9c, B9);
await setStatus(o9c, "accepted");
check((await safeRow("gift_cards", g9c))?.status === "reserved", "(9) a part-covered order's yes alone does not redeem");
await setStatus(o9c, "handed_over");
check((await safeRow("gift_cards", g9c))?.status === "reserved", "(9) only the four closes put a gift back (handed_over does not)");

// (10) A deposit order takes no gift yet.
const B10 = U(10);
const o10 = await order(B10, 4000, { plan: "deposit" }), g10 = await gift(B10, 25);
const before10 = await snapshot(B10);
check(/deposit order/.test((await redeem(g10, o10, B10))?.error ?? "") && (await snapshot(B10)) === before10,
  "(10) a deposit order refuses the gift with a sentence and nothing changes");

// (11) The tax the caller calculated is part of the price, written on the order, and never added twice.
const B11 = U(11);
const o11 = await order(B11, 4000), g11 = await gift(B11, 50);
const r11 = await redeem(g11, o11, B11, null, 360);
const ord11 = await safeRow("shop_orders", o11);
check(r11?.outcome === "covered" && r11?.applied_cents === 4360 && r11?.leftover_cents === 640 && ord11?.tax_cents === 360 && ord11?.total_cents === 4360 && ord11?.gift_cents === 4360,
  "(11) a $50 gift on a $40 order with $3.60 tax pays $43.60; the order carries the tax and the taxed total", JSON.stringify({ r11, ord11 }));
const r11b = await redeem(g11, o11, B11, null, 360);
check(r11b?.applied_cents === 4360 && (await safeRow("shop_orders", o11))?.total_cents === 4360, "(11) a re-apply with the same tax does not add it twice", JSON.stringify(r11b));
const o11c = await order(B11, 4000), g11c = await gift(B11, 40);
const r11c = await redeem(g11c, o11c, B11, null, 25);
check(/covers all but \$0\.25/.test(r11c?.error ?? ""), "(11) the 50-cent check counts the tax (a $40 gift on $40 + $0.25 tax is refused)", JSON.stringify(r11c));
check((await redeem(await gift(B11, 10), await order(B11), B11, null, -1))?.error?.includes("required"), "(11) a negative tax is refused");

if (!skip) {
  for (const sig of ["public.redeem_gift_card_for_shop_order(uuid, uuid, uuid, integer, text)", "public.shop_order_gift_follows_status()"]) {
    const acl = (await q(`SELECT has_function_privilege('anon', '${sig}', 'EXECUTE') a, has_function_privilege('authenticated', '${sig}', 'EXECUTE') u,
      has_function_privilege('service_role', '${sig}', 'EXECUTE') s`))[0];
    check(!acl.a && !acl.u && (sig.startsWith("public.redeem") ? acl.s : true), `grants on ${sig}: anon ${acl.a} authenticated ${acl.u} service_role ${acl.s}`);
  }
  check((await q(`SELECT count(*)::int n FROM pg_trigger WHERE tgname = 'trg_shop_orders_gift_follows_status'`))[0].n === 1, "(7) one trigger after 3 replays");
}

console.log(failures ? `\n${failures} FAILED` : "\nall PASS");
process.exit(failures ? 1 : 0);
