#!/usr/bin/env node
/**
 * PGlite proof for 20261031102758_helpr_backout_after_seller_move_is_free (LEAD-MOVE-BACKOUT, lead 10-31): a Helpr who
 * backs out after the seller moved the pickup (helpr_task_seller_move_pickup) gets no strike, and that back-out does not
 * count toward the 3-in-7-days pause (helpr_task_accept and helpr_route_suggestions).
 *
 *   node src/test/pglite/helprBackoutAfterSellerMove.pglite.mjs                     # ALL PASS (migration applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/helprBackoutAfterSellerMove.pglite.mjs  # RED: the bodies before it
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/helprBackoutAfterSellerMove.pglite.mjs
 *
 * With NEW_MIGRATION=skip the three functions are loaded from their earlier newest files (20261017055505,
 * 20261028012406, 20261027200024), so the red run is the real "before". helpr_task_reopen, helpr_task_lock,
 * helpr_task_log, helpr_task_source_held, helpr_task_source_slot_ok and helpr_task_source_require_feature are read
 * verbatim from 20261017055505; helpr_task_seller_move_pickup verbatim from 20261031095846. The leaf helpers
 * (assert_helpr, accept block reason, vehicle fit, stripe mode, blocks, strike, source event, notify) are stubs shaped
 * as the bodies call them (said so inline).
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW_FILE = "20261031102758_helpr_backout_after_seller_move_is_free.sql";
const mig = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8");
const base = readFileSync(`${MIG_DIR}20261017055505_declutter_helpr_delivery.sql`, "utf8");
const vehicle = readFileSync(`${MIG_DIR}20261028012406_helpr_vehicle_needs_a_car.sql`, "utf8");
const route = readFileSync(`${MIG_DIR}20261027200024_helpr_route_suggestions.sql`, "utf8");
const movePickup = readFileSync(`${MIG_DIR}20261031095846_helpr_task_seller_move_pickup.sql`, "utf8");
const fnFrom = (src, name) => {
  const m = src.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?AS (\\$[a-z_]*\\$)\\n[\\s\\S]*?\\1;`));
  if (!m) throw new Error(`no ${name}`);
  return m[0];
};

let pass = 0, fail = 0;
const ok = (cond, what) => { if (cond) { pass++; console.log(`PASS ${what}`); } else { fail++; console.log(`FAIL ${what}`); } };

const db = new PGlite();
const SELLER = "11111111-1111-4111-8111-111111111111", BUYER = "22222222-2222-4222-8222-222222222222";
const HELPR = "33333333-3333-4333-8333-333333333333";
const ORDER = "a0000000-0000-4000-8000-000000000001";
const T = "d0000000-0000-4000-8000-000000000001", T2 = "d0000000-0000-4000-8000-000000000002";
await db.exec(`
set timezone = 'UTC';
create role anon; create role authenticated; create role service_role;
create schema auth; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('t.uid', true), '')::uuid $$;
-- Stubs: the columns the bodies read (prod's helpr_tasks has more, all nullable or defaulted for these rows).
create table public.helpr_tasks(id uuid primary key, source_kind text, source_id uuid, status text, title text,
  customer_id uuid, pickup_contact_id uuid, helpr_id uuid, latest_pickup_at timestamptz, accepted_at timestamptz,
  pickup_slot_start timestamptz, handed_over_at timestamptz, handed_over_to uuid, updated_at timestamptz,
  releases integer not null default 0, open_until timestamptz, wrong_codes integer not null default 0, size text,
  pickup_lat numeric, pickup_lng numeric, dropoff_lat numeric, dropoff_lng numeric);
create table public.helpr_task_events(id bigserial primary key, task_id uuid, task_event text, actor_id uuid, detail text,
  created_at timestamptz not null default clock_timestamp());
create table public.helpr_vehicles(user_id uuid, has_car boolean);
create table public.declutter_problems(order_id uuid, status text);
create table public.strikes(user_id uuid, kind text, task uuid);
create table public.notices(user_id uuid, title text);
create function public.require_feature(text) returns void language sql as $$ select $$;
create function public.is_caller_banned() returns boolean language sql stable as $$ select false $$;
create function public.declutter_lock_order(uuid) returns void language sql as $$ select $$;
create function public.declutter_delivery_slot_ok(p_order uuid, p_start timestamptz) returns boolean language sql stable as $$ select true $$;
create function public.declutter_notify(p_user uuid, p_type text, p_title text, p_message text, p_link text, p_other uuid default null)
  returns void language sql as $$ insert into public.notices values (p_user, p_title) $$;
create function public.declutter_order_items_named(uuid) returns text language sql stable as $$ select '"Oak chair"' $$;
-- The Helpr's gates (payout, ID, vehicle, blocks, Stripe mode) all pass: this proof is about the back-out count.
create function public.helpr_task_assert_helpr() returns uuid language sql stable as $$ select auth.uid() $$;
create function public.helper_accept_block_reason(uuid) returns text language sql stable as $$ select null::text $$;
create function public.are_users_blocked(uuid, uuid) returns boolean language sql stable as $$ select false $$;
create function public.helpr_task_same_stripe_mode(uuid, uuid) returns boolean language sql stable as $$ select true $$;
create function public.helpr_task_vehicle_fits(uuid, text) returns boolean language sql stable as $$ select true $$;
create function public.helpr_task_source_event(uuid, text, text) returns void language sql as $$ select $$;
create function public.helpr_task_give_job_strike(p_user uuid, p_type text, p_task uuid, p_description text)
  returns void language sql as $$ insert into public.strikes values (p_user, p_type, p_task) $$;
`);
for (const f of ["helpr_task_log", "helpr_task_source_require_feature", "helpr_task_source_slot_ok", "helpr_task_source_held",
  "helpr_task_lock", "helpr_task_reopen"]) {
  await db.exec(fnFrom(base, f));
}
await db.exec(fnFrom(movePickup, "helpr_task_seller_move_pickup"));
// The "before": each function's earlier newest definition.
await db.exec(fnFrom(base, "helpr_task_release"));
await db.exec(fnFrom(vehicle, "helpr_task_accept"));
await db.exec(fnFrom(route, "helpr_route_suggestions"));

let failedApply = "";
if (process.env.NEW_MIGRATION !== "skip") {
  try { for (let i = 0; i < 3; i++) await db.exec(mig); } catch (e) { failedApply = e.message; }
}
ok(failedApply === "", `migration applies 3x ${failedApply}`);

const as = async (uid, sql) => { await db.exec(`select set_config('t.uid', '${uid ?? ""}', false)`); return db.query(sql); };
const err = async (uid, sql) => { try { await as(uid, sql); return ""; } catch (e) { return e.message; } };
// T: booked by the Helpr an hour ago, pickup in 1 hour (inside the 2-hour strike window).
const reset = async () => {
  await db.exec(`truncate helpr_tasks, helpr_task_events, declutter_problems, strikes, notices;
    insert into helpr_tasks (id, source_kind, source_id, status, title, customer_id, pickup_contact_id, helpr_id, latest_pickup_at,
                             accepted_at, pickup_slot_start, updated_at, open_until, size)
    values ('${T}', 'declutter_delivery', '${ORDER}', 'accepted', 'Oak chair', '${BUYER}', '${SELLER}', '${HELPR}',
            now() + interval '5 days', now() - interval '1 hour', now() + interval '1 hour', now(), now() + interval '1 day', 'small'),
           ('${T2}', 'declutter_delivery', '${ORDER}', 'open', 'Lamp', '${BUYER}', '${SELLER}', null,
            now() + interval '5 days', null, null, now(), now() + interval '1 day', 'small');`);
};
const release = (task) => `select public.helpr_task_release('${task}') r`;
const strikes = async () => Number((await db.query(`select count(*) n from strikes`)).rows[0].n);
const relDetail = async (task) => (await db.query(`select detail from helpr_task_events where task_id = '${task}' and task_event = 'released'`)).rows[0]?.detail;
const sellerMoved = (createdSql) => db.exec(`insert into helpr_task_events (task_id, task_event, actor_id, detail, created_at)
  values ('${T}', 'pickup_moved', '${SELLER}', 'moved', ${createdSql})`);
// Three earlier back-outs this week by the Helpr, with the given detail.
const pastBackouts = (details) => db.exec(details.map((d, i) => `insert into helpr_task_events (task_id, task_event, actor_id, detail, created_at)
  values (gen_random_uuid(), 'released', '${HELPR}', ${d === null ? "null" : `'${d}'`}, now() - interval '${i + 1} days');`).join("\n"));
const accept = `select public.helpr_task_accept('${T2}', now() + interval '1 day') r`;
const suggest = `select public.helpr_route_suggestions(null) r`;

// 1. Control: no move, under 2 hours: a strike, as before.
await reset();
let r = (await as(HELPR, release(T))).rows[0].r;
ok(r.strike === true && (await strikes()) === 1 && (await relDetail(T)) === "late", "no move: backing out under 2 h still costs a strike");

// 2. The seller moved this booking's pickup (the real RPC, then the time is under 2 h): no strike, detail seller_moved.
await reset();
await db.exec(`update helpr_tasks set pickup_slot_start = now() + interval '1 day' where id = '${T}'`);
const mv = await err(SELLER, `select public.helpr_task_seller_move_pickup('${T}', date_trunc('hour', now()) + interval '30 hours')`);
ok(mv === "", `the seller moves the pickup (${mv})`);
await db.exec(`update helpr_tasks set pickup_slot_start = now() + interval '1 hour' where id = '${T}'`);
r = (await as(HELPR, release(T))).rows[0].r;
ok(r.strike === false, `after the seller's move: no strike in the answer (${JSON.stringify(r)})`);
ok((await strikes()) === 0, "after the seller's move: no strike given");
ok((await relDetail(T)) === "seller_moved", `the back-out is logged as 'released' with detail seller_moved (${await relDetail(T)})`);
ok((await err(HELPR, `select public.helpr_task_accept('${T}', now() + interval '1 day')`)).includes("task_taken"),
  "the Helpr still cannot take back the delivery they backed out of");

// 3. A move in an EARLIER booking (before this Helpr's accepted_at) does not waive this Helpr's strike.
await reset();
await sellerMoved("now() - interval '2 hours'");
r = (await as(HELPR, release(T))).rows[0].r;
ok(r.strike === true && (await strikes()) === 1, "a move before this booking: the strike still applies");

// 4. A 'pickup_moved' by someone other than the seller does not count.
await reset();
await db.exec(`insert into helpr_task_events (task_id, task_event, actor_id, created_at) values ('${T}', 'pickup_moved', '${HELPR}', now())`);
r = (await as(HELPR, release(T))).rows[0].r;
ok(r.strike === true, "a move event not by the seller: the strike still applies");

// 5. The pause: three seller-moved back-outs do not pause taking; three ordinary ones do; two + one moved does not.
await reset();
await db.exec(`update helpr_tasks set helpr_id = null, status = 'open' where id = '${T}'`);
await pastBackouts(["seller_moved", "seller_moved", "seller_moved"]);
// Suggestions first: once the Helpr takes T2 the route is no longer empty (suggestions answer "no_route" when empty).
ok((await as(HELPR, suggest)).rows[0].r.reason === "no_route", "three seller-moved back-outs: route suggestions are not paused");
ok((await err(HELPR, accept)) === "", "... and the Helpr can still take a delivery");
await reset();
await db.exec(`update helpr_tasks set helpr_id = null, status = 'open' where id = '${T}'`);
await pastBackouts(["late", null, null]);
ok((await as(HELPR, suggest)).rows[0].r.reason === "too_many_releases", "three ordinary back-outs: route suggestions paused (unchanged)");
ok((await err(HELPR, accept)).includes("too_many_releases"), "... and taking: too_many_releases (unchanged)");
await reset();
await db.exec(`update helpr_tasks set helpr_id = null, status = 'open' where id = '${T}'`);
await pastBackouts(["late", null, "seller_moved"]);
ok((await err(HELPR, accept)) === "", "two ordinary + one seller-moved back-out: not paused");
await reset();
await db.exec(`update helpr_tasks set helpr_id = null, status = 'open' where id = '${T}'`);
await pastBackouts(["late", null]);
await db.exec(`insert into helpr_task_events (task_id, task_event, actor_id, created_at) values (gen_random_uuid(), 'helpr_no_show', '${HELPR}', now())`);
ok((await err(HELPR, accept)).includes("too_many_releases"), "two back-outs + a no-show still pause (unchanged)");

for (const sig of ["helpr_task_release(uuid)", "helpr_task_accept(uuid, timestamptz)", "helpr_route_suggestions(uuid)"]) {
  const acl = (await db.query(`select proacl::text a, prosecdef d, proconfig::text c from pg_proc where oid = 'public.${sig}'::regprocedure`)).rows[0];
  ok(acl.d === true && /search_path=public, pg_temp/.test(acl.c ?? ""), `${sig}: SECURITY DEFINER, search_path public, pg_temp`);
  ok(!/(^|[{,])anon=/.test(acl.a ?? "") && !/(^|[{,])=X/.test(acl.a ?? "") && /authenticated=X/.test(acl.a ?? ""),
    `${sig}: members only, not anon or PUBLIC (${acl.a})`);
}

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
