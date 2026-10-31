#!/usr/bin/env node
/**
 * PGlite proof for 20261031014011_helpr_delivery_still_in_hand_nudge (BUY-37).
 *
 *   node src/test/pglite/helprDeliveryStillInHand.pglite.mjs                     # GREEN (migration applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/helprDeliveryStillInHand.pglite.mjs  # RED: the sweep before it
 *   MUTANT=<name> node src/test/pglite/helprDeliveryStillInHand.pglite.mjs       # a planted defect: must FAIL
 *
 * Checks: 24 hours after "Picked up" the Helpr, buyer and seller are each told, once; a week later again; never before
 * 24 hours, on a held task, on another status or for test data; a member's Pickups switch is obeyed; no status, money or
 * strike changes; a failed notice retries on the next run; not callable by members.
 *
 * World: helpr_tasks, declutter_orders, declutter_problems, profiles, test_accounts, notification_preferences, and the
 * REAL helpr_task_lock, helpr_task_source_held. Stubbed, and said so: declutter_pickup_remind (records the notice),
 * declutter_order_items_named, declutter_lock_order (no-op), log_cron_defect (records), helpr_task_close,
 * helpr_task_reopen, helpr_task_give_job_strike, declutter_delivery_on_task_event (records: a money event here is a failure).
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const FILES = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
const THIS = "20261031014011_helpr_delivery_still_in_hand_nudge.sql";
const skip = process.env.NEW_MIGRATION === "skip";
const MUTANT = process.env.MUTANT ?? "";

function newest(name, before = THIS) {
  for (let i = FILES.length - 1; i >= 0; i--) {
    if (FILES[i] >= before) continue;
    const src = readFileSync(MIG_DIR + FILES[i], "utf8");
    const start = src.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
    if (start < 0) continue;
    const tag = /AS\s+(\$[A-Za-z_]*\$)/.exec(src.slice(start))[1];
    const open = src.indexOf(tag, start);
    return src.slice(start, src.indexOf(tag, open + tag.length) + tag.length) + ";";
  }
  throw new Error(`${name}: no definition before ${before}`);
}

const MUTANTS = {
  // Fires from the moment of pickup (both the scan and the re-check).
  early: [["            WHERE x.status = 'picked_up' AND x.picked_up_at + interval '24 hours' <= now()\n", "            WHERE x.status = 'picked_up'\n"],
          ["      IF t.status = 'picked_up' AND t.picked_up_at + interval '24 hours' <= now()\n", "      IF t.status = 'picked_up'\n"]],
  // Never stamps, so every 10-minute run sends again.
  nostamp: [["        UPDATE public.helpr_tasks SET in_hand_nudged_at = now() WHERE id = t.id;\n", ""]],
  // A held task is nudged (both the scan and the re-check).
  held: [["              AND NOT public.helpr_task_source_held(x.source_kind, x.source_id)\n", ""],
         ["         AND (t.in_hand_nudged_at IS NULL OR t.in_hand_nudged_at + interval '7 days' <= now())\n         AND NOT public.helpr_task_source_held(t.source_kind, t.source_id) THEN", "         AND (t.in_hand_nudged_at IS NULL OR t.in_hand_nudged_at + interval '7 days' <= now()) THEN"]],
  // Test data reaches people.
  seed: [["              AND x.is_seed IS NOT TRUE\n", ""]],
  // A Helpr who switched Pickups off is nudged anyway.
  pref: [["  IF NOT EXISTS (SELECT 1 FROM public.notification_preferences np WHERE np.user_id = t.helpr_id AND np.declutter_pickups IS FALSE) THEN", "  IF true THEN"]],
  // The buyer isn't told.
  nobuyer: [["PERFORM public.declutter_pickup_remind(o.buyer_id, 'Is your delivery still coming?'", "PERFORM public.declutter_pickup_remind(t.helpr_id, 'Is your delivery still coming?'"]],
  // The nudge goes down the money path.
  money: [["      RETURN public.declutter_delivery_still_in_hand(t.source_id, t.id);\n", "      RETURN public.declutter_delivery_on_task_event(t.source_id, t.id, 'confirmed', 'auto');\n"]],
};
let mig = readFileSync(MIG_DIR + THIS, "utf8");
if (MUTANT) {
  if (!MUTANTS[MUTANT]) throw new Error(`no mutant ${MUTANT}`);
  for (const [from, to] of MUTANTS[MUTANT]) {
    if (!mig.includes(from)) throw new Error(`mutant ${MUTANT} did not apply`);
    mig = mig.replace(from, to);
  }
}

let failures = 0;
let passes = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (ok) passes++; else failures++; };

const HELPR = "11111111-1111-1111-1111-111111111111";
const BUYER = "33333333-3333-3333-3333-333333333333";
const SELLER = "44444444-4444-4444-4444-444444444444";
const TESTER = "55555555-5555-5555-5555-555555555555";
const SEEDED = "66666666-6666-6666-6666-666666666666";

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create table public.helpr_tasks (
    id uuid primary key, source_kind text not null default 'declutter_delivery', source_id uuid not null,
    status text not null, title text not null default 'Lamp', customer_id uuid, pickup_contact_id uuid, helpr_id uuid,
    open_until timestamptz not null default now() + interval '1 day', pickup_slot_start timestamptz,
    picked_up_at timestamptz, delivered_at timestamptz, closed_at timestamptz, close_note text,
    is_seed boolean not null default false, updated_at timestamptz not null default now());
  create table public.declutter_orders (id uuid primary key, buyer_id uuid, seller_id uuid, status text not null default 'paid');
  create table public.declutter_problems (id uuid primary key default gen_random_uuid(), order_id uuid not null, status text not null);
  create table public.profiles (user_id uuid primary key, is_seed boolean not null default false);
  create table public.test_accounts (user_id uuid primary key);
  create table public.notification_preferences (user_id uuid primary key, declutter_pickups boolean);
  create table public.notices (who uuid, title text, message text, link text);
  create table public.money_events (task uuid, event text);
  create table public.cron_defects (what text, id text, err text);
  create table public.failing (who uuid);
  create function public.declutter_lock_order(p uuid) returns void language sql as $f$ select $f$;
  create function public.declutter_order_items_named(p uuid) returns text language sql stable as $f$ select '"Lamp"'::text $f$;
  create function public.declutter_pickup_remind(p_user uuid, p_title text, p_message text, p_link text, p_other uuid) returns void
    language plpgsql as $f$ begin
      if exists (select 1 from public.failing f where f.who = p_user) then raise exception 'notice failed'; end if;
      insert into public.notices values (p_user, p_title, p_message, p_link); end $f$;
  create function public.log_cron_defect(a text, b text, c text) returns void language sql as $f$ insert into public.cron_defects values (a, b, c) $f$;
  create function public.helpr_task_close(a uuid, b text, c text) returns text language sql as $f$ select 'x'::text $f$;
  create function public.helpr_task_reopen(a uuid, b text, c uuid, d text) returns void language sql as $f$ select $f$;
  create function public.helpr_task_give_job_strike(a uuid, b text, c uuid, d text) returns void language sql as $f$ select $f$;
  create function public.declutter_delivery_on_task_event(p_order_id uuid, p_task uuid, p_event text, p_by text) returns jsonb language sql as
    $f$ insert into public.money_events values (p_task, p_event); select '{}'::jsonb $f$;
`);
for (const fn of ["helpr_task_lock", "helpr_task_source_held", "helpr_task_source_event", "helpr_task_sweep"]) {
  await db.exec(newest(fn));
}
if (skip) {
  console.log("NEW_MIGRATION=skip: the sweep before 20261031014011 (expect FAILs)");
  await db.exec(`alter table public.helpr_tasks add column in_hand_nudged_at timestamptz`);
} else {
  for (let i = 0; i < 3; i++) {
    try { await db.exec(mig); check(true, `the migration applies (run ${i + 1} of 3)`); }
    catch (e) { check(false, `the migration applies (run ${i + 1} of 3): ${e.message}`); }
  }
}

const T = (n) => `aaaaaaaa-0000-0000-0000-${String(n).padStart(12, "0")}`;
const O = (n) => `bbbbbbbb-0000-0000-0000-${String(n).padStart(12, "0")}`;
async function task(n, status, hoursAgo, { buyer = BUYER, seed = false } = {}) {
  await db.exec(`insert into public.declutter_orders (id, buyer_id, seller_id) values ('${O(n)}', '${buyer}', '${SELLER}');
    insert into public.helpr_tasks (id, source_id, status, customer_id, pickup_contact_id, helpr_id, picked_up_at, is_seed)
    values ('${T(n)}', '${O(n)}', '${status}', '${buyer}', '${SELLER}', '${HELPR}', now() - interval '${hoursAgo} hours', ${seed})`);
}
const sweep = async () => (await db.query(`select public.helpr_task_sweep() as r`)).rows[0].r;
const notices = async () => (await db.query(`select who::text, title, message, link from public.notices order by title`)).rows;
const clear = () => db.exec(`delete from public.notices`);
const fieldsOf = async (n) => (await db.query(`select status, in_hand_nudged_at from public.helpr_tasks where id = '${T(n)}'`)).rows[0];

await db.exec(`insert into public.test_accounts values ('${TESTER}'); insert into public.profiles (user_id, is_seed) values ('${SEEDED}', true)`);

// Under 24 hours: nothing.
await task(1, "picked_up", 23);
await sweep();
check((await notices()).length === 0, "23 hours after pickup: nobody is told");

// Over 24 hours: all three, once.
await task(2, "picked_up", 25);
const out = await sweep();
let n = await notices();
check(out.still_in_hand_nudged === 1, "25 hours after pickup: the sweep counts one nudge");
check(n.length === 3 && [HELPR, BUYER, SELLER].every((w) => n.some((x) => x.who === w)), "the Helpr, the buyer and the seller are each told");
const buyerNotice = n.find((x) => x.who === BUYER);
check(buyerNotice?.link === "/declutter?tab=buying" && /Lamp/.test(buyerNotice.message) && /report a problem/.test(buyerNotice.message) && /stays held/.test(buyerNotice.message),
  "the buyer's notice names the item, opens Buying, offers the report and says the money stays held");
check(n.find((x) => x.who === HELPR)?.link === "/declutter?view=deliver", "the Helpr's opens Deliver");
check(n.find((x) => x.who === SELLER)?.link === "/declutter?tab=selling", "the seller's opens Selling");
check(n.every((x) => !/refund|strike/i.test(x.message)), "no notice promises a refund or threatens a strike");

await clear();
await sweep();
check((await notices()).length === 0, "the next run sends nothing");

// Nothing moved.
check((await fieldsOf(2)).status === "picked_up", "the task stays picked up");
check((await db.query(`select count(*)::int c from public.money_events`)).rows[0].c === 0, "the money function is never called");

// Weekly.
await db.exec(`update public.helpr_tasks set in_hand_nudged_at = now() - interval '6 days' where id = '${T(2)}'`);
await sweep();
check((await notices()).length === 0, "6 days after the last nudge: nothing");
await db.exec(`update public.helpr_tasks set in_hand_nudged_at = now() - interval '7 days 1 minute' where id = '${T(2)}'`);
await sweep();
check((await notices()).length === 3, "7 days after the last nudge: all three again");
await clear();

// Delivered in the meantime: nothing more, whatever the clock says.
await db.exec(`update public.helpr_tasks set status = 'confirmed', in_hand_nudged_at = null where id = '${T(2)}'`);
await sweep();
check((await notices()).length === 0, "another status is never nudged");

// A problem is open: an admin has it.
await task(3, "picked_up", 30);
await db.exec(`insert into public.declutter_problems (order_id, status) values ('${O(3)}', 'open')`);
await sweep();
check((await notices()).length === 0, "an open problem holds the nudge");
await db.exec(`update public.helpr_tasks set status = 'confirmed' where id = '${T(3)}'`);

// Test data.
await task(4, "picked_up", 30, { seed: true });
await task(5, "picked_up", 30, { buyer: TESTER });
await task(6, "picked_up", 30, { buyer: SEEDED });
await sweep();
check((await notices()).length === 0, "test data reaches nobody (is_seed task, test account, seeded profile)");
await db.exec(`update public.helpr_tasks set status = 'confirmed' where id in ('${T(4)}', '${T(5)}', '${T(6)}')`);

// The member's switch.
await db.exec(`insert into public.notification_preferences values ('${HELPR}', false)`);
await task(7, "picked_up", 30);
await sweep();
n = await notices();
check(n.length === 2 && !n.some((x) => x.who === HELPR), "a Helpr with Pickups off isn't told; the other two are");
await clear();
await db.exec(`delete from public.notification_preferences; update public.helpr_tasks set status = 'confirmed' where id = '${T(7)}'`);

// A failure rolls back and retries.
await db.exec(`insert into public.failing values ('${SELLER}')`);
await task(8, "picked_up", 30);
await sweep();
check((await fieldsOf(8)).in_hand_nudged_at === null, "a failed notice rolls the stamp back");
check((await notices()).length === 0, "a failed notice rolls back the other two");
check((await db.query(`select count(*)::int c from public.cron_defects where id = '${T(8)}'`)).rows[0].c === 1, "and is logged as a defect");
await db.exec(`delete from public.failing`);
await sweep();
check((await notices()).length === 3, "the next run sends it");

// Who can call it.
if (!skip) {
  const acl = (await db.query(`select proname, proacl::text a from pg_proc where proname in ('declutter_delivery_still_in_hand', 'helpr_task_source_event', 'helpr_task_sweep')`)).rows;
  check(acl.length === 3 && acl.every((r) => r.a && !/(^|[{,])=X/.test(r.a) && !/anon=|authenticated=/.test(r.a) && /service_role=X/.test(r.a)),
    "only the service role can run them");
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
