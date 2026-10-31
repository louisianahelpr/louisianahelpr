#!/usr/bin/env node
/**
 * PGlite proof for 20261031170803_declutter_no_helpr_notice_offers_refund.sql (LEAD-NOHELPR-NOTICE, with BUY-2): when
 * no Helpr takes a delivery, the buyer's notice also offers BUY-2's cancel for a refund (the amount is on Buying; no fee
 * is named, membersSeeNoFeeWords),
 * and the seller's says the buyer may cancel and the item then goes back on sale. Every other notice is unchanged.
 *
 *   node src/test/pglite/declutterNoHelprNoticeOffersRefund.pglite.mjs                  # BEFORE then AFTER (3x)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterNoHelprNoticeOffersRefund.pglite.mjs # RED: the old words
 *   MUTANT=<name> node src/test/pglite/declutterNoHelprNoticeOffersRefund.pglite.mjs    # a planted defect: must FAIL
 *
 * World and stubs: as helprDeliverySellerToldDelivered.pglite.mjs (its world, copied). BEFORE is the newest body before
 * this migration (20261031140431), read with newestBefore.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const THIS = "20261031170803_declutter_no_helpr_notice_offers_refund.sql";
const MUTANT = process.env.MUTANT ?? "";
const MUTANTS = {
  // The buyer's notice drops the pointer to the amount.
  fee: [" Buying shows how much comes back before you choose.',", "',"],
  // The seller's notice goes to the buyer.
  who: ["      PERFORM public.declutter_notify(o.seller_id, 'payment', 'The buyer will pick it up',", "      PERFORM public.declutter_notify(o.buyer_id, 'payment', 'The buyer will pick it up',"],
};
const skip = process.env.NEW_MIGRATION === "skip";
let mig = readFileSync(MIG_DIR + THIS, "utf8");
if (MUTANT) {
  const m = MUTANTS[MUTANT];
  if (!m || !mig.includes(m[0])) throw new Error(`mutant ${MUTANT} did not apply`);
  mig = mig.replaceAll(m[0], m[1]);
}

/** The newest CREATE FUNCTION text for `name` in migrations strictly before `before` (any dollar tag). */
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
      found = `${sql.slice(m.index, end + t[1].length)};`;
    }
  }
  if (!found) throw new Error(`no definition of ${name}`);
  return found;
}

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };
const U = (n) => `11111111-0000-0000-0000-${String(n).padStart(12, "0")}`;
const SELLER = U(1), BUYER = U(2), HELPR = U(3), HELPR2 = U(4);

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create table public.profiles (user_id uuid primary key, stripe_account_id text);
  create table public.notes (user_id uuid, kind text, title text, message text, link text, actor uuid, at timestamptz default clock_timestamp());
  create function public.declutter_notify(p_user uuid, p_type text, p_title text, p_message text, p_link text, p_actor uuid)
    returns void language sql as $f$ insert into public.notes (user_id, kind, title, message, link, actor) values (p_user, p_type, p_title, p_message, p_link, p_actor) $f$;
  create table public.declutter_items (id uuid primary key, title text not null);
  create table public.declutter_cart_items (id uuid primary key default gen_random_uuid(), item_id uuid, order_id uuid, created_at timestamptz default now());
  create table public.declutter_orders (id uuid primary key, buyer_id uuid, seller_id uuid, status text, handover text,
    delivery_cents integer default 1800, paid_at timestamptz default now(), is_seed boolean default false);
  create table public.helpr_tasks (id uuid primary key, status text not null, helpr_id uuid, customer_id uuid, title text,
    source_kind text default 'declutter_delivery', source_id uuid, pickup_slot_start timestamptz, pay_cents integer default 1800,
    fee_cents integer default 160, confirmed_at timestamptz, confirmed_by text, closed_at timestamptz, updated_at timestamptz);
  create table public.helpr_task_payouts (id uuid primary key default gen_random_uuid(), task_id uuid unique, helpr_id uuid,
    pay_cents integer, fee_cents integer, amount_cents integer, status text);
  create table public.declutter_problems (id uuid primary key default gen_random_uuid(), order_id uuid, reporter_id uuid, reporter_side text,
    reason text, note text, photo_paths text[], is_seed boolean default false);
  create function public.helpr_task_log(p_task uuid, p_event text, p_actor uuid, p_note text) returns void language sql as $f$ select $f$;
  create function public.helpr_task_source_held(p_kind text, p_id uuid) returns boolean language sql stable as $f$ select false $f$;
  create function public.declutter_complete_handover(p_order uuid, p_by text) returns jsonb language sql as $f$ select '{}'::jsonb $f$;
  create function public.declutter_delivery_refund(p_order uuid, p_reason text) returns uuid language sql as $f$ select null::uuid $f$;
  create function public.declutter_close_paid_order(p_order uuid, p_reason text, a text, b text, c text) returns jsonb language sql as $f$ select '{}'::jsonb $f$;
`);
for (const fn of ["declutter_order_items_named", "helpr_payout_round_down_cents", "declutter_delivery_on_task_event", "helpr_task_confirm"]) {
  await db.exec(newestBefore(fn, THIS));
}

const O1 = "22222222-0000-0000-0000-000000000001", O2 = "22222222-0000-0000-0000-000000000002";
const T1 = "33333333-0000-0000-0000-000000000001", T2 = "33333333-0000-0000-0000-000000000002";
async function reset() {
  await db.exec(`
    truncate public.notes, public.declutter_items, public.declutter_cart_items, public.declutter_orders, public.helpr_tasks,
      public.helpr_task_payouts, public.declutter_problems, public.profiles;
    insert into public.profiles values ('${HELPR}', 'acct_1'), ('${HELPR2}', null);
    insert into public.declutter_items values ('44444444-0000-0000-0000-000000000001', 'Blue mug'), ('44444444-0000-0000-0000-000000000002', 'Brass lamp');
    insert into public.declutter_orders (id, buyer_id, seller_id, status, handover) values
      ('${O1}', '${BUYER}', '${SELLER}', 'paid', 'delivery'), ('${O2}', '${BUYER}', '${SELLER}', 'paid', 'delivery');
    insert into public.declutter_cart_items (item_id, order_id) values ('44444444-0000-0000-0000-000000000001', '${O1}'), ('44444444-0000-0000-0000-000000000002', '${O2}');
    insert into public.helpr_tasks (id, status, helpr_id, customer_id, title, source_id, pickup_slot_start) values
      ('${T1}', 'delivered', '${HELPR}', '${BUYER}', 'Blue mug', '${O1}', '2026-10-31T15:00:00Z'),
      ('${T2}', 'delivered', '${HELPR2}', '${BUYER}', 'Brass lamp', '${O2}', '2026-10-31T16:00:00Z');`);
}
const ev = (o, t, e, by = "helpr") => db.query(`select public.declutter_delivery_on_task_event($1, $2, $3, $4)`, [o, t, e, by]);

/** Every notice each step sends, for one order (the mug) and the other (the lamp) side by side. */
async function scenarios() {
  await reset();
  for (const e of ["accepted", "released", "picked_up", "delivered"]) { await ev(O1, T1, e); await ev(O2, T2, e); }
  await ev(O1, T1, "pickup_no_show", "40|p.jpg");
  await ev(O1, T1, "unfilled");
  await db.query(`update public.declutter_orders set paid_at = now() - interval '6 days', handover = 'delivery' where id = $1`, [O2]);
  await ev(O2, T2, "unfilled");
  await db.query(`select public.helpr_task_confirm($1, 'customer', $2)`, [T1, BUYER]);
  await db.query(`select public.helpr_task_confirm($1, 'auto', null)`, [T2]);
  const rows = (await db.query(`select user_id, title, message, link from public.notes order by at`)).rows;
  return rows.map((r) => ({ who: r.user_id === BUYER ? "buyer" : r.user_id === SELLER ? "seller" : "helpr", ...r }));
}


const before = await scenarios();
const unfilled = (rows) => rows.filter((n) => n.title === "No Helpr took your delivery" || n.title === "The buyer will pick it up");
check(unfilled(before).length === 2 && !unfilled(before).some((n) => /cancel/.test(n.message)), "[before] the two no-Helpr notices never mention cancelling");
for (let i = 0; i < (skip ? 0 : 3); i++) {
  try { await db.exec(mig); check(true, `the migration applies (run ${i + 1} of 3)`); } catch (e) { check(false, `the migration applies (run ${i + 1} of 3): ${e.message}`); }
}
const after = await scenarios();
const [buyer, seller] = [unfilled(after).find((n) => n.who === "buyer"), unfilled(after).find((n) => n.who === "seller")];
check(buyer?.message === `No Helpr took the delivery of "Blue mug". The $18.00 you paid for delivery is coming back to your card. Book a time to pick up at the seller's home before your 7-day deadline, or cancel the sale for a refund. Buying shows how much comes back before you choose.`
  && buyer?.link === "/declutter?tab=buying",
  `[buyer] offered the cancel and pointed to the amount (no fee named): ${JSON.stringify(buyer)}`);
check(seller?.message === `No Helpr took the delivery of "Blue mug". The buyer can book a pickup at your home or cancel the sale. If they cancel, your item goes back on sale.`
  && seller?.link === "/declutter?tab=selling",
  `[seller] told the buyer may cancel, and the item goes back on sale: ${JSON.stringify(seller)}`);
const strip = (rows) => rows.filter((n) => !unfilled([n]).length);
check(before.length > 20 && after.length === before.length && JSON.stringify(strip(after)) === JSON.stringify(strip(before)),
  `[same] every other notice is unchanged (${before.length})`);
const pay = (await db.query(`select amount_cents, status from public.helpr_task_payouts order by amount_cents`)).rows;
check(pay.length === 2 && pay.every((p) => p.amount_cents === 1600 && p.status === "pending"), `[money] the Helpr payout rows are unchanged: ${JSON.stringify(pay)}`);
const ho = (await db.query(`select handover from public.declutter_orders where id = $1`, [O1])).rows[0]?.handover;
check(ho === "pickup_home", `[state] the order still becomes a pickup at the seller's home: ${ho}`);
const acl = (await db.query(`select proacl::text a from pg_proc where proname = 'declutter_delivery_on_task_event'`)).rows[0]?.a ?? "";
check(skip || (!/(^|[{,])(anon|authenticated)?=X/.test(acl) && /service_role=X/.test(acl)), `[grants] service_role only: ${acl}`);
console.log(failures ? `\n${failures} FAILED${MUTANT ? ` (mutant ${MUTANT})` : ""}` : `\nALL PASS${MUTANT ? ` (mutant ${MUTANT} was NOT caught)` : ""}`);
process.exit(failures ? 1 : 0);
