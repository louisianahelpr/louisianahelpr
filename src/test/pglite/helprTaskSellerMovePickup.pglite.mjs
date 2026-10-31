#!/usr/bin/env node
/**
 * PGlite proof for 20261031095846_helpr_task_seller_move_pickup (BUY-42: the seller's one move of a Helpr's pickup).
 *
 *   node src/test/pglite/helprTaskSellerMovePickup.pglite.mjs                     # ALL PASS (migration applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/helprTaskSellerMovePickup.pglite.mjs  # RED: no such function
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/helprTaskSellerMovePickup.pglite.mjs
 *
 * helpr_task_lock, helpr_task_log, helpr_task_source_held, helpr_task_source_slot_ok and
 * helpr_task_source_require_feature are read verbatim from their newest file (20261017055505). The event CHECK before
 * is 20261030012018's, read verbatim. Tables and the leaf helpers (require_feature, is_caller_banned,
 * declutter_lock_order, declutter_delivery_slot_ok, declutter_notify, declutter_order_items_named) are stubs shaped as
 * the bodies read them (said so inline).
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW_FILE = "20261031095846_helpr_task_seller_move_pickup.sql";
const mig = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8");
const base = readFileSync(`${MIG_DIR}20261017055505_declutter_helpr_delivery.sql`, "utf8");
const handover = readFileSync(`${MIG_DIR}20261030012018_helpr_delivery_seller_handover.sql`, "utf8");
const fnFrom = (src, name) => {
  const m = src.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?AS (\\$[a-z_]*\\$)\\n[\\s\\S]*?\\1;`));
  if (!m) throw new Error(`no ${name}`);
  return m[0];
};
const checkBefore = handover.match(/ALTER TABLE public\.helpr_task_events ADD CONSTRAINT helpr_task_events_task_event_check[\s\S]*?\)\);/)[0];

let pass = 0, fail = 0;
const ok = (cond, what) => { if (cond) { pass++; console.log(`PASS ${what}`); } else { fail++; console.log(`FAIL ${what}`); } };

const db = new PGlite();
const SELLER = "11111111-1111-4111-8111-111111111111", BUYER = "22222222-2222-4222-8222-222222222222";
const HELPR = "33333333-3333-4333-8333-333333333333", OTHER = "44444444-4444-4444-8444-444444444444";
const ORDER = "a0000000-0000-4000-8000-000000000001", ORDER2 = "a0000000-0000-4000-8000-000000000002";
const T = "d0000000-0000-4000-8000-000000000001", T_HANDED = "d0000000-0000-4000-8000-000000000002";
await db.exec(`
set timezone = 'UTC';
create role anon; create role authenticated; create role service_role;
create schema auth; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('t.uid', true), '')::uuid $$;
-- Stubs: the columns the bodies read (prod's helpr_tasks has more, all nullable or defaulted for these rows).
create table public.helpr_tasks(id uuid primary key, source_kind text, source_id uuid, status text, title text,
  customer_id uuid, pickup_contact_id uuid, helpr_id uuid, latest_pickup_at timestamptz, accepted_at timestamptz,
  pickup_slot_start timestamptz, handed_over_at timestamptz, handed_over_to uuid, updated_at timestamptz);
create table public.helpr_task_events(id bigserial primary key, task_id uuid, task_event text, actor_id uuid, detail text,
  created_at timestamptz not null default clock_timestamp());
create table public.declutter_problems(order_id uuid, status text);
create table public.notices(user_id uuid, title text, message text, link text);
create table public.banned(user_id uuid);
create function public.require_feature(text) returns void language sql as $$ select $$;
create function public.is_caller_banned() returns boolean language sql stable as $$ select exists (select 1 from public.banned where user_id = auth.uid()) $$;
create function public.declutter_lock_order(uuid) returns void language sql as $$ select $$;
-- Seller's pickup times stub: on the hour or half hour, 8 AM to 8 PM UTC.
create function public.declutter_delivery_slot_ok(p_order uuid, p_start timestamptz) returns boolean language sql stable as $$
  select extract(minute from p_start at time zone 'UTC') in (0, 30) and extract(hour from p_start at time zone 'UTC') between 8 and 19 $$;
create function public.declutter_notify(p_user uuid, p_type text, p_title text, p_message text, p_link text, p_other uuid default null)
  returns void language sql as $$ insert into public.notices values (p_user, p_title, p_message, p_link) $$;
create function public.declutter_order_items_named(uuid) returns text language sql stable as $$ select '"Oak chair"' $$;
`);
await db.exec(checkBefore);
for (const f of ["helpr_task_log", "helpr_task_source_require_feature", "helpr_task_source_slot_ok", "helpr_task_source_held", "helpr_task_lock"]) {
  await db.exec(fnFrom(base, f));
}
// A slot day: tomorrow at 15:00 UTC (booked), and 17:00 UTC (the move); latest pickup in 5 days.
const day = (h, plusDays = 1) => `(date_trunc('day', now()) + interval '${plusDays} days' + interval '${h} hours')`;
const reset = async () => {
  await db.exec(`truncate helpr_tasks, helpr_task_events, declutter_problems, notices, banned;
    insert into helpr_tasks values
      ('${T}', 'declutter_delivery', '${ORDER}', 'accepted', 'Oak chair', '${BUYER}', '${SELLER}', '${HELPR}', now() + interval '5 days',
       now() - interval '1 hour', ${day(15)}, null, null, now()),
      ('${T_HANDED}', 'declutter_delivery', '${ORDER2}', 'accepted', 'Lamp', '${BUYER}', '${SELLER}', '${HELPR}', now() + interval '5 days',
       now() - interval '1 hour', ${day(15)}, now(), '${HELPR}', now());`);
};
const as = async (uid, sql) => { await db.exec(`select set_config('t.uid', '${uid ?? ""}', false)`); return db.query(sql); };
const err = async (uid, sql) => { try { await as(uid, sql); return ""; } catch (e) { return e.message; } };
const move = (task, at) => `select public.helpr_task_seller_move_pickup('${task}', ${at}) r`;
const slot = async (task) => (await db.query(`select pickup_slot_start s from helpr_tasks where id = '${task}'`)).rows[0].s?.toISOString();

let failedApply = "";
if (process.env.NEW_MIGRATION !== "skip") {
  try { for (let i = 0; i < 3; i++) await db.exec(mig); } catch (e) { failedApply = e.message; }
}
ok(failedApply === "", `migration applies 3x ${failedApply}`);
const exists = (await db.query(`select to_regprocedure('public.helpr_task_seller_move_pickup(uuid, timestamptz)') r`)).rows[0].r;
ok(exists !== null, "helpr_task_seller_move_pickup(uuid, timestamptz) exists");

if (exists) {
  await reset();
  const before = await slot(T);
  ok((await err(OTHER, move(T, day(17)))).includes("task_not_found"), "a stranger: task_not_found");
  ok((await err(HELPR, move(T, day(17)))).includes("task_not_found"), "the Helpr cannot move it (only the seller)");
  ok((await err(BUYER, move(T, day(17)))).includes("task_not_found"), "the buyer cannot move it");
  ok((await err(null, move(T, day(17)))).includes("not_authenticated"), "no caller: not_authenticated");
  ok((await err(SELLER, move(T, day(15)))).includes("invalid_slot"), "the same time: invalid_slot");
  ok((await err(SELLER, move(T, day(17) + " + interval '10 minutes'"))).includes("invalid_slot"), "outside the seller's pickup times: invalid_slot");
  ok((await err(SELLER, move(T, "now() + interval '30 minutes'"))).includes("invalid_slot"), "under 2 hours away: invalid_slot");
  ok((await err(SELLER, move(T, day(17, 6)))).includes("invalid_slot"), "past the latest pickup: invalid_slot");
  ok(await slot(T) === before, "refused moves change nothing");
  ok((await err(SELLER, move(T_HANDED, day(17)))).includes("task_not_active"), "after Handed over: task_not_active");
  await db.exec(`insert into declutter_problems values ('${ORDER}', 'open')`);
  ok((await err(SELLER, move(T, day(17)))).includes("problem_open"), "an open problem holds it: problem_open");
  await db.exec(`truncate declutter_problems`);
  await db.exec(`insert into banned values ('${SELLER}')`);
  ok((await err(SELLER, move(T, day(17)))).includes("account_restricted"), "a banned seller: account_restricted");
  await db.exec(`truncate banned`);

  let moved = null;
  try { moved = (await as(SELLER, move(T, day(17)))).rows[0].r; } catch (e) { console.log(`  (move failed: ${e.message})`); }
  ok(moved?.result === "moved", `the seller moves it once: ${JSON.stringify(moved)}`);
  const after = await slot(T);
  ok(after !== before && new Date(after).getUTCHours() === 17, `the booked time is the new one (${after})`);
  const ev = (await db.query(`select task_event, actor_id from helpr_task_events where task_id = '${T}'`)).rows;
  ok(ev.length === 1 && ev[0].task_event === "pickup_moved" && ev[0].actor_id === SELLER, "one 'pickup_moved' event by the seller");
  const n = (await db.query(`select user_id, title, link, message from notices order by link`)).rows;
  ok(n.some((x) => x.user_id === HELPR && x.title === "Pickup time changed" && x.link === "/declutter?tab=deliver" && x.message.includes("Oak chair")),
    "the Helpr is told, naming the item, on Deliver");
  ok(n.some((x) => x.user_id === BUYER && x.title === "Pickup time changed" && x.link === "/declutter?tab=buying" && x.message.includes("Oak chair")),
    "the buyer is told, naming the item, on Buying");
  ok(n.length === 2, `two notices only (${n.length})`);
  ok((await err(SELLER, move(T, day(18)))).includes("already_moved"), "a second move: already_moved");
  ok(await slot(T) === after, "the refused second move changes nothing");
  // A new Helpr booking (after a back-out) gets a fresh move.
  await db.exec(`update helpr_tasks set helpr_id = '${OTHER}', accepted_at = clock_timestamp() + interval '1 second' where id = '${T}'`);
  await db.exec(`update helpr_task_events set created_at = now() - interval '1 day' where task_id = '${T}'`);
  ok((await err(SELLER, move(T, day(18)))) === "", "a new Helpr's booking can be moved once again");
  // Started: too_late.
  await reset();
  await db.exec(`update helpr_tasks set pickup_slot_start = now() - interval '5 minutes' where id = '${T}'`);
  ok((await err(SELLER, move(T, day(17)))).includes("too_late"), "after the booked time started: too_late");
  await db.exec(`update helpr_tasks set status = 'picked_up' where id = '${T}'`);
  ok((await err(SELLER, move(T, day(17)))).includes("task_not_active"), "picked up: task_not_active");

  const acl = (await db.query(`select proacl::text a, prosecdef d, proconfig::text c from pg_proc where oid = 'public.helpr_task_seller_move_pickup(uuid, timestamptz)'::regprocedure`)).rows[0];
  ok(acl.d === true && /search_path=public, pg_temp/.test(acl.c ?? ""), "SECURITY DEFINER with search_path public, pg_temp");
  ok(!/(^|[{,])anon=/.test(acl.a) && !/(^|[{,])=X/.test(acl.a), `anon and PUBLIC cannot run it (${acl.a})`);
  ok(/authenticated=X/.test(acl.a) && /service_role=X/.test(acl.a), "members and service_role can");
}
// Every event the CHECK allowed before is still allowed.
const before = checkBefore.match(/'[a-z_]+'/g);
let allowedAll = true;
for (const e of before) { try { await db.exec(`insert into helpr_task_events(task_id, task_event) values (null, ${e})`); } catch { allowedAll = false; } }
ok(before.length >= 13 && allowedAll, `every earlier event still allowed (${before.length})`);

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
