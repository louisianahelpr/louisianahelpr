#!/usr/bin/env node
/**
 * PGlite proof for 20261030031642_helpr_delivery_notices_name_the_item.sql (audit 1c D3-5, 2026-10-29): every Helpr-delivery step notice names the item, and the
 * buyer's open Buying (?tab=buying) and the Helpr's open Deliver (?tab=deliver), never the retired ?view=cart /
 * ?view=deliver. Titles stay as they were (declutter_notice_type files notices by title).
 *
 *   node src/test/pglite/helprDeliveryNoticesNameTheItem.pglite.mjs                  # BEFORE then AFTER (3x)
 *   NEW_MIGRATION=skip node src/test/pglite/helprDeliveryNoticesNameTheItem.pglite.mjs # RED: prod's bodies
 *   MUTANT=<name> node src/test/pglite/helprDeliveryNoticesNameTheItem.pglite.mjs    # a planted defect: must FAIL
 *
 * World: the tables the two functions read (columns they touch, as on prod). The BEFORE bodies are the newest
 * definitions in the migrations before this one, and are checked to be prod's effective bodies by md5(prosrc), read
 * on prod 2026-10-30 (read-only). declutter_order_items_named and helpr_payout_round_down_cents are the real newest
 * bodies (md5-checked the same way). Stubbed, and said so: declutter_notify (records the notice: the real writer,
 * with its kinds and push, is proven in declutterSaleNoticesNameInline.pglite.mjs), helpr_task_log,
 * helpr_task_source_held (false), declutter_complete_handover, declutter_delivery_refund, declutter_close_paid_order.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const THIS = "20261030031642_helpr_delivery_notices_name_the_item.sql";
// md5(prosrc) on prod, 2026-10-30 (read-only): the bodies this migration restates, and the two it calls.
const PROD_MD5 = {
  declutter_delivery_on_task_event: "1779207a3c198e6524bdb751cf841e91",
  helpr_task_confirm: "1db8b4c91e4a5acbb48c5d4b71b0f4ae",
  declutter_order_items_named: "95761388c13918b77af68e26f0cb6752",
  helpr_payout_round_down_cents: "e22217c60ca593af94403cd3b1872529",
};
const MUTANT = process.env.MUTANT ?? "";
const MUTANTS = {
  // The buyer's "A Helpr took your delivery" back to the retired cart address.
  cartlink: ["They leave it at your door with a photo.',\n             public.declutter_order_items_named(o.id),\n             to_char(t.pickup_slot_start AT TIME ZONE 'America/Chicago', 'Dy Mon FMDD at FMHH12:MI AM')),\n      '/declutter?tab=buying'",
    "They leave it at your door with a photo.',\n             public.declutter_order_items_named(o.id),\n             to_char(t.pickup_slot_start AT TIME ZONE 'America/Chicago', 'Dy Mon FMDD at FMHH12:MI AM')),\n      '/declutter?view=cart'"],
  // "Your item is on its way" stops naming the item.
  onitsway: ["format('The Helpr picked up %s. They leave it at your door with a photo; tap \"I got it\" when you have it.',\n             public.declutter_order_items_named(o.id))",
    "format('The Helpr picked up your item. They leave it at your door with a photo; tap \"I got it\" when you have it.%s', '')"],
  // The Helpr's "Delivery done" stops naming the task.
  done: ["format('\"%s\" is delivered. $%s is on its way to your payout account.', t.title, (v_amount / 100)::text)",
    "format('$%s is on its way to your payout account.', (v_amount / 100)::text)"],
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
for (const [fn, want] of Object.entries(PROD_MD5)) {
  const got = (await db.query(`select md5(prosrc) m from pg_proc where proname = $1`, [fn])).rows[0]?.m;
  check(got === want, `[before] ${fn} is prod's effective body (md5(prosrc) ${got})`);
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
console.log(`BEFORE  ${before.length} notices; buyer links: ${[...new Set(before.filter((n) => n.who === "buyer").map((n) => n.link))].join(", ")}`);
check(before.some((n) => n.who === "buyer" && n.link === "/declutter?view=cart"), "[before] buyer delivery notices linked the retired ?view=cart");
check(before.some((n) => n.title === "Your item is on its way" && !/Blue mug|Brass lamp/.test(n.message)), "[before] \"Your item is on its way\" did not name the item");
if (skip) console.log("NEW_MIGRATION=skip: the AFTER checks run on prod's bodies (expect FAILs)");
for (let i = 0; i < (skip ? 0 : 3); i++) {
  try { await db.exec(mig); check(true, `the migration applies (run ${i + 1} of 3)`); } catch (e) { check(false, `the migration applies (run ${i + 1} of 3): ${e.message}`); }
}
const after = await scenarios();
console.log(`AFTER   ${after.length} notices`);
check(after.length === before.length && after.length > 20, `[same notices] the same ${before.length} notices go out, to the same people`);
check(JSON.stringify(after.map((n) => [n.who, n.title])) === JSON.stringify(before.map((n) => [n.who, n.title])), "[titles] every title and recipient is unchanged");
let named = 0;
for (const n of after) {
  // Each notice is about one order: the mug's (T1/O1) or the lamp's; it names that one and never the other.
  const mug = /Blue mug/.test(n.message), lamp = /Brass lamp/.test(n.message);
  check(mug !== lamp, `[names] ${n.who} "${n.title}" names its item: ${n.message}`);
  if (mug !== lamp) named++;
  const want = n.who === "buyer" ? "/declutter?tab=buying" : n.who === "seller" ? "/declutter?tab=selling" : "/declutter?tab=deliver";
  check(n.link === want, `[link] ${n.who} "${n.title}" opens ${want}: ${n.link}`);
}
check(named === after.length, `[names] all ${after.length} notices name their item (${named})`);
const done = after.filter((n) => n.title === "Delivery done");
check(done.length === 2 && /^"Blue mug" is delivered\. \$16 is on its way/.test(done[0].message) && /^"Brass lamp" is delivered\. Set up payouts in Settings to get your \$16\./.test(done[1].message),
  `[helpr] "Delivery done" names the task and keeps the payout words and amount: ${done.map((d) => d.message).join(" | ")}`);
const pay = (await db.query(`select amount_cents, status from public.helpr_task_payouts order by amount_cents`)).rows;
check(pay.length === 2 && pay.every((p) => p.amount_cents === 1600 && p.status === "pending"), `[money] the Helpr payout rows are unchanged: ${JSON.stringify(pay)}`);
const prob = (await db.query(`select reason, reporter_side, photo_paths from public.declutter_problems`)).rows;
check(prob.length === 1 && prob[0].reason === "no_show" && prob[0].photo_paths[0] === "p.jpg", `[problem] the no-show report still opens its problem: ${JSON.stringify(prob)}`);

for (const fn of ["declutter_delivery_on_task_event", "helpr_task_confirm"]) {
  const acl = (await db.query(`select proacl::text a from pg_proc where proname = $1`, [fn])).rows[0]?.a ?? "";
  check(skip || (!/(^|[{,])(anon|authenticated)?=X/.test(acl) && /service_role=X/.test(acl)), `[grants] ${fn} runs for service_role only, never anon, signed-in users or PUBLIC: ${acl}`);
}

console.log(failures ? `\n${failures} FAILED${MUTANT ? ` (mutant ${MUTANT})` : ""}` : `\nALL PASS${MUTANT ? ` (mutant ${MUTANT} was NOT caught)` : ""}`);
process.exit(failures ? 1 : 0);
