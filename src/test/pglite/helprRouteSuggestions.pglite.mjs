#!/usr/bin/env node
/**
 * PGlite proof for 20261027200024_helpr_route_suggestions ("On your way": up to 3 open deliveries
 * that add little to a Helpr's route; owner request 2026-10-27, multi-stop delivery part 3).
 *
 *   node src/test/pglite/helprRouteSuggestions.pglite.mjs                  # after (3x replay)
 *   MUTANT=<name> node src/test/pglite/helprRouteSuggestions.pglite.mjs    # a planted defect: must FAIL
 *
 * World: a helpr_tasks table with the columns the functions read, helpr_task_events, the REAL
 * helpr_task_distance_m and helpr_payout_round_down_cents (newest definitions) and the REAL route
 * planner (20261027194235). Stubbed, and said so, each from a small table so every refusal can be
 * driven: helpr_task_source_require_feature, helpr_task_assert_helpr, helpr_task_vehicle_fits,
 * are_users_blocked, helpr_task_same_stripe_mode, helpr_task_source_held, helpr_task_source_slot_ok.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const FILES = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
const THIS = "20261027200024_helpr_route_suggestions.sql";
const ROUTE = "20261027194235_helpr_my_route.sql";
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
  // A blocked pair is suggested.
  blocked: ["       AND NOT public.are_users_blocked(v_uid, x.customer_id)\n", "\n"],
  // The candidate's exact points are scored (finer than the area words).
  exact: ["jsonb_build_object('key', 'cand:pickup', 'kind', 'pickup', 'lat', round(t.pickup_lat, 2), 'lng', round(t.pickup_lng, 2))",
          "jsonb_build_object('key', 'cand:pickup', 'kind', 'pickup', 'lat', t.pickup_lat, 'lng', t.pickup_lng)"],
  // The two-not-picked-up cap is not applied.
  cap: ["  IF v_held + (CASE WHEN p_with_task IS NULL THEN 0 ELSE 1 END) >= 2 THEN", "  IF false THEN"],
  // Any task id may be "viewed", even one the caller could not see.
  viewed: ["    IF NOT FOUND OR w.status <> 'open' OR w.open_until <= now()", "    IF NOT FOUND"],
  // A delivery the caller backed out of is suggested again.
  released: ["e.task_event IN ('released', 'helpr_no_show'))\n       AND (SELECT min", "e.task_event IN ('none'))\n       AND (SELECT min"],
  // A not-yet-taken drop-off is scored at its ~1 km cell (finer than a Helpr may learn).
  dropcell: ["'kind', 'dropoff', 'lat', round(t.dropoff_lat, 1), 'lng', round(t.dropoff_lng, 1)))", "'kind', 'dropoff', 'lat', round(t.dropoff_lat, 2), 'lng', round(t.dropoff_lng, 2)))"],
  // The pickup-time search runs for days (it traced the seller's windows: review #1).
  unbounded: ["WHILE v_found IS NULL AND i <= 12 AND", "WHILE v_found IS NULL AND i < 7 * 24 * 4 AND"],
  // A paused Helpr (3 back-outs in 7 days) still gets suggestions.
  paused: ["         AND e.created_at > now() - interval '7 days') >= 3 THEN\n    RETURN jsonb_build_object('suggestions', '[]'::jsonb, 'reason', 'too_many_releases');",
           "         AND e.created_at > now() - interval '7 days') >= 99 THEN\n    RETURN jsonb_build_object('suggestions', '[]'::jsonb, 'reason', 'too_many_releases');"],
  // The caller's own hidden drop-off (#3684) is scored at its exact point.
  ownexact: ["      'lat', CASE WHEN v_own_shown THEN t.dropoff_lat ELSE round(t.dropoff_lat, 2) END,", "      'lat', t.dropoff_lat,"],
  // The suggested time ignores the seller's pickup times.
  slot: ["      IF public.helpr_task_source_slot_ok(t.source_kind, t.source_id, v_slot) THEN", "      IF true THEN"],
};
let mig = readFileSync(MIG_DIR + THIS, "utf8");
if (MUTANT) {
  const m = MUTANTS[MUTANT];
  if (!m || !mig.includes(m[0])) throw new Error(`mutant ${MUTANT} did not apply`);
  mig = mig.replace(m[0], m[1]);
}

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };

const ME = "11111111-1111-1111-1111-111111111111";
const BUSY = "22222222-2222-2222-2222-222222222222";
const MINOR = "33333333-3333-3333-3333-333333333333";
const PAUSED = "abababab-0000-0000-0000-000000000001";
const OFF = "44444444-4444-4444-4444-444444444444";
const SELLER = "55555555-5555-5555-5555-555555555555";
const BUYER = "66666666-6666-6666-6666-666666666666";
const ENEMY = "77777777-7777-7777-7777-777777777777";
const TESTBUYER = "88888888-8888-8888-8888-888888888888";
const FRESH = "99999999-9999-9999-9999-999999999999";

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as
    $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  grant usage on schema auth, public to anon, authenticated, service_role;
  create table public.helpr_tasks (
    id uuid primary key, source_kind text not null default 'declutter_delivery', source_id uuid not null,
    status text not null, size text not null default 'small', title text not null,
    pickup_area text not null, dropoff_area text not null,
    pickup_address text not null, pickup_lat numeric not null, pickup_lng numeric not null,
    dropoff_address text not null, dropoff_lat numeric not null, dropoff_lng numeric not null,
    trip_miles integer not null default 5, pay_cents integer not null default 2000, fee_cents integer not null default 170,
    customer_id uuid, pickup_contact_id uuid, helpr_id uuid, pickup_slot_start timestamptz,
    open_until timestamptz not null default now() + interval '2 days', latest_pickup_at timestamptz not null default now() + interval '5 days');
  create table public.helpr_task_events (task_id uuid, task_event text, actor_id uuid, created_at timestamptz default now());
  create table public.switch_off (user_id uuid primary key);
  insert into public.switch_off values ('${OFF}');
  create function public.helpr_task_source_require_feature(p_kind text) returns void language plpgsql as $f$
  begin
    if exists (select 1 from public.switch_off where user_id = auth.uid()) then raise exception 'feature_disabled' using errcode = '42501'; end if;
  end $f$;
  create function public.helpr_task_assert_helpr() returns uuid language plpgsql as $f$
  begin
    if auth.uid() is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
    if auth.uid() = '${MINOR}' then raise exception 'under_18' using errcode = '42501'; end if;
    return auth.uid();
  end $f$;
  create table public.trucks (user_id uuid primary key);
  create function public.helpr_task_vehicle_fits(p_user uuid, p_size text) returns boolean language sql stable as
    $f$ select p_size = 'small' or exists (select 1 from public.trucks where user_id = p_user) $f$;
  create table public.blocks (a uuid, b uuid);
  insert into public.blocks values ('${ME}', '${ENEMY}');
  create function public.are_users_blocked(p1 uuid, p2 uuid) returns boolean language sql stable as
    $f$ select exists (select 1 from public.blocks where (a = p1 and b = p2) or (a = p2 and b = p1)) $f$;
  create function public.helpr_task_same_stripe_mode(p_a uuid, p_b uuid) returns boolean language sql stable as
    $f$ select p_a is not null and p_b is not null and (p_b <> '${TESTBUYER}') $f$;
  create table public.held (source_id uuid primary key);
  create function public.helpr_task_source_held(p_kind text, p_source uuid) returns boolean language sql stable as
    $f$ select exists (select 1 from public.held where source_id = p_source) $f$;
  -- The seller's pickup times: a source may be picked up only from its "opens_at" on.
  create table public.windows (source_id uuid primary key, opens_at timestamptz);
  create function public.helpr_task_source_slot_ok(p_kind text, p_source uuid, p_start timestamptz) returns boolean language sql stable as
    $f$ select p_start > now() and p_start >= coalesce((select opens_at from public.windows where source_id = p_source), '-infinity') $f$;
  create table public.declutter_items (id uuid primary key, title text not null, porch_ok boolean not null default true, status text not null default 'sold');
  create table public.declutter_item_photos (item_id uuid, storage_path text, position smallint);
  create table public.declutter_cart_items (id uuid primary key, item_id uuid, order_id uuid);
`);
for (const fn of ["helpr_task_distance_m", "helpr_payout_round_down_cents"]) await db.exec(newest(fn));
await db.exec(readFileSync(MIG_DIR + ROUTE, "utf8"));
for (let i = 0; i < 3; i++) await db.exec(mig); // replay-safe: applied three times

const now = Date.now();
const iso = (mins) => new Date(now + mins * 60_000).toISOString();
let n = 0;
const id = () => `aaaaaaaa-0000-0000-0000-${String(++n).padStart(12, "0")}`;
/** Insert a task; returns its id. */
async function task(o) {
  const tid = o.id ?? id();
  await db.query(`insert into public.helpr_tasks (id, source_id, status, size, title, pickup_area, dropoff_area, pickup_address, pickup_lat, pickup_lng,
      dropoff_address, dropoff_lat, dropoff_lng, customer_id, pickup_contact_id, helpr_id, pickup_slot_start, open_until, pay_cents, fee_cents)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
    [tid, o.source ?? tid, o.status ?? "open", o.size ?? "small", o.title ?? "Item", o.pa ?? "Mid City", o.da ?? "Shenandoah",
     o.paddr ?? "1 Seller St", o.plat, o.plng, o.daddr ?? "1 Buyer Ln", o.dlat, o.dlng,
     o.customer ?? BUYER, o.contact ?? SELLER, o.helpr ?? null, o.slot ?? null, o.open_until ?? iso(2880), o.pay ?? 2000, o.fee ?? 170]);
  return tid;
}

// ME holds one delivery: pickup in Mid City (booked in 2 h), drop-off in Shenandoah.
await task({ status: "accepted", helpr: ME, slot: iso(120), plat: 30.4500, plng: -91.1500, dlat: 30.4012, dlng: -91.0512, title: "Mine" });
// Candidates.
const NEAR = await task({ title: "Near lamp", plat: 30.4480, plng: -91.1450, dlat: 30.4030, dlng: -91.0540, paddr: "77 Secret Rd", daddr: "88 Hidden Ct", pay: 3000, fee: 220 });
const NEAR2 = await task({ title: "Near chair", plat: 30.4649, plng: -91.1500, dlat: 30.4100, dlng: -91.0600 });
const NEAR3 = await task({ title: "Near rug", plat: 30.4300, plng: -91.1200, dlat: 30.4000, dlng: -91.0700, pay: 3000, fee: 220 });
const NEAR4 = await task({ title: "Near shelf", plat: 30.4850, plng: -91.1500, dlat: 30.4050, dlng: -91.0650 });
const FAR = await task({ title: "Far dresser", plat: 31.3000, plng: -92.4000, dlat: 31.3500, dlng: -92.4500 });
const MINE_SALE = await task({ title: "My own sale", plat: 30.4490, plng: -91.1490, dlat: 30.4020, dlng: -91.0520, contact: ME });
const BLOCKED = await task({ title: "Blocked seller", plat: 30.4490, plng: -91.1490, dlat: 30.4020, dlng: -91.0520, contact: ENEMY });
const BLOCKED_BUYER = await task({ title: "Blocked buyer", plat: 30.4490, plng: -91.1490, dlat: 30.4020, dlng: -91.0520, customer: ENEMY });
const BIG = await task({ title: "Big couch", size: "large", plat: 30.4490, plng: -91.1490, dlat: 30.4020, dlng: -91.0520 });
const TESTMODE = await task({ title: "Test-mode buyer", plat: 30.4490, plng: -91.1490, dlat: 30.4020, dlng: -91.0520, customer: TESTBUYER });
const HELD = await task({ title: "Problem open", plat: 30.4490, plng: -91.1490, dlat: 30.4020, dlng: -91.0520 });
await db.query(`insert into public.held values ($1)`, [HELD]);
const RELEASED = await task({ title: "Backed out", plat: 30.4490, plng: -91.1490, dlat: 30.4020, dlng: -91.0520 });
await db.query(`insert into public.helpr_task_events (task_id, task_event, actor_id) values ($1, 'released', $2)`, [RELEASED, ME]);
const CLOSED = await task({ title: "Closed", plat: 30.4490, plng: -91.1490, dlat: 30.4020, dlng: -91.0520, open_until: iso(-5) });
// The seller of NEAR only opens tomorrow: the suggested time must wait for it.
await db.query(`insert into public.windows values ($1, $2)`, [NEAR, iso(24 * 60)]);
// BUSY already holds two not picked up.
await task({ status: "accepted", helpr: BUSY, slot: iso(60), plat: 30.45, plng: -91.15, dlat: 30.40, dlng: -91.05 });
await task({ status: "accepted", helpr: BUSY, slot: iso(90), plat: 30.45, plng: -91.15, dlat: 30.40, dlng: -91.05 });

async function as(uid, sql, params = []) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ""}', false)`);
  try {
    return { ok: true, rows: (await db.query(sql, params)).rows };
  } catch (e) {
    return { ok: false, code: String(e.message) };
  }
}
const suggest = (uid, withTask = null) => as(uid, "select public.helpr_route_suggestions($1) as r", [withTask]);
// PAUSED backed out of 3 deliveries this week and holds one.
await task({ status: "accepted", helpr: PAUSED, slot: iso(60), plat: 30.45, plng: -91.15, dlat: 30.40, dlng: -91.05 });
for (let k = 0; k < 3; k++) await db.query(`insert into public.helpr_task_events (task_id, task_event, actor_id) values ($1, 'released', $2)`, [id(), PAUSED]);

const r = await suggest(ME);
check(r.ok, `[route] ME gets suggestions${r.ok ? "" : ` (${r.code})`}`);
const out = r.ok ? r.rows[0].r : { suggestions: [] };
const got = out.suggestions.map((s) => s.task_id);
const name = (tid) => ({ [NEAR]: "NEAR", [NEAR2]: "NEAR2", [NEAR3]: "NEAR3", [NEAR4]: "NEAR4" }[tid] ?? tid);
check(got.length === 3, `[limit] exactly 3 suggested (got ${got.map(name).join(", ")})`);
check(!got.includes(NEAR), "[slot] a delivery whose seller is not available within 3 hours of the plan is not suggested");
check(!got.includes(FAR), "[detour] a delivery 70 miles away is not suggested");
for (const [tid, why] of [[MINE_SALE, "the caller's own sale"], [BLOCKED, "a blocked seller"], [BLOCKED_BUYER, "a blocked buyer"], [BIG, "a large item without a truck"],
  [TESTMODE, "the other Stripe mode"], [HELD, "an open problem"], [RELEASED, "one the caller backed out of"], [CLOSED, "a closed one"]]) {
  check(!got.includes(tid), `[eligible] never ${why}`);
}
const mins = out.suggestions.map((s) => s.extra_minutes);
check(mins.every((m, i) => i === 0 || mins[i - 1] <= m) && mins.every((m) => m >= 5 && m <= 30 && m % 5 === 0),
  `[detour] fewest extra minutes first, in 5-minute steps, each at most 30 (${mins.join(", ")})`);
check(out.suggestions.every((s) => Number.isInteger(s.extra_miles)), "[detour] extra miles are whole miles");
const rug = out.suggestions.find((s) => s.task_id === NEAR3);
check(rug?.take_home_cents === 2700, `[pay] "+$X" is the take-home pay, rounded down to the dollar (${rug?.take_home_cents})`);
check(out.suggestions.every((s) => new Date(s.pickup_slot_start) > new Date(now) && new Date(s.pickup_slot_start).getUTCMinutes() % 15 === 0),
  "[slot] every suggested time is in the future, on the quarter hour");
const keys = [...new Set(out.suggestions.flatMap((s) => Object.keys(s)))].sort().join(",");
check(keys === "dropoff_area,extra_miles,extra_minutes,latest_pickup_at,pickup_area,pickup_slot_start,size,take_home_cents,task_id,title,trip_miles",
  `[leak] only area words, rough miles, pay and times: ${keys}`);
const text = JSON.stringify(out);
check(!/Secret Rd|Hidden Ct|30\.4[0-9]{2}|91\.[0-9]{3}/.test(text), "[leak] no address and no point of any candidate");

// Only coarse points are scored: moving a candidate's pickup inside its ~1 km cell and its drop-off
// inside its ~11 km cell changes nothing a Helpr reads (lh-authz-rls review #2).
const a = (await suggest(ME)).rows?.[0]?.r;
await db.query(`update public.helpr_tasks set pickup_lat = 30.4551, dropoff_lat = 30.3600, dropoff_lng = -91.0700 where id = $1`, [NEAR2]);
const b = (await suggest(ME)).rows?.[0]?.r;
const pick = (x) => JSON.stringify(x?.suggestions?.find((s) => s.task_id === NEAR2) ?? null);
check(pick(a) !== "null" && pick(a) === pick(b), "[leak] moving a candidate inside its pickup (~1 km) and drop-off (~11 km) cells changes no number a Helpr reads");

// #3684: a new Helpr's own drop-off more than 2 hours out is scored at its ~1 km point only, so a
// suggestion never gives away more than the route does.
const NEWBIE = "abababab-0000-0000-0000-000000000009";
const NB = await task({ status: "accepted", helpr: NEWBIE, slot: iso(300), plat: 30.4500, plng: -91.1500, dlat: 30.401234, dlng: -91.051234, title: "Newbie's" });
const nbA = JSON.stringify((await suggest(NEWBIE)).rows?.[0]?.r);
await db.query(`update public.helpr_tasks set dropoff_lat = 30.404999, dropoff_lng = -91.054999 where id = $1`, [NB]);
const nbB = JSON.stringify((await suggest(NEWBIE)).rows?.[0]?.r);
check(nbA && nbA.includes("task_id") && nbA === nbB, "[3684] moving a new Helpr's hidden drop-off inside its ~1 km cell changes no suggestion number");

// Viewing an open delivery: suggestions relative to it; never itself; an unseeable one is refused.
const v = await suggest(FRESH, NEAR3);
check(v.ok && v.rows[0].r.suggestions.length > 0 && !v.rows[0].r.suggestions.some((s) => s.task_id === NEAR3),
  "[view] a Helpr with no route who views a delivery gets ones on its way, never the same one");
const vb = await suggest(FRESH, BIG);
check(!vb.ok && vb.code === "task_not_found", "[view] viewing one the caller may not take (too large) is task_not_found");
const vc = await suggest(FRESH, CLOSED);
check(!vc.ok && vc.code === "task_not_found", "[view] viewing a closed one is task_not_found");
const vt = await suggest(ME, NEAR3);
check(vt.ok && vt.rows[0].r.reason === "too_many_taken" && vt.rows[0].r.suggestions.length === 0,
  "[cap] one in hand + the viewed one = 2 not picked up: nothing suggested (too_many_taken)");
const busy = await suggest(BUSY);
check(busy.ok && busy.rows[0].r.reason === "too_many_taken" && busy.rows[0].r.suggestions.length === 0, "[cap] two not picked up: nothing suggested");
const none = await suggest(FRESH);
check(none.ok && none.rows[0].r.reason === "no_route", "[route] no route and nothing viewed: no_route");

// Refusals and grants.
const minor = await suggest(MINOR);
check(!minor.ok && minor.code === "under_18", "[gate] helpr_task_assert_helpr's refusal stands (under_18)");
const off = await suggest(OFF);
check(!off.ok && off.code === "feature_disabled", "[feature] the member switch is checked first");
const anon = await suggest(null);
check(!anon.ok && anon.code === "not_authenticated", "[auth] no session is refused");
const args = (await db.query(`select pg_get_function_identity_arguments(oid) as a from pg_proc where proname = 'helpr_route_suggestions'`)).rows.map((r) => r.a);
check(args.length === 1 && args[0] === "p_with_task uuid", `[input] the caller's position is not an input (review #1): (${args.join(" | ")})`);
const paused = await suggest(PAUSED);
check(paused.ok && paused.rows[0].r.reason === "too_many_releases" && paused.rows[0].r.suggestions.length === 0,
  "[eligible] a Helpr paused for 3 back-outs this week gets nothing (the accept would refuse it)");
const acl = (await db.query(`select coalesce(proacl::text, '') as a from pg_proc where proname = 'helpr_route_suggestions'`)).rows[0].a;
check(/authenticated=X/.test(acl) && !/anon=X/.test(acl) && !/(^|[{,])=X/.test(acl), `[grants] authenticated yes, anon and PUBLIC no (${acl})`);

console.log(failures === 0 ? `\nALL PASS${MUTANT ? ` (MUTANT=${MUTANT}: expected FAIL)` : " (3x replay)"}` : `\n${failures} FAIL${MUTANT ? ` (MUTANT=${MUTANT})` : ""}`);
process.exit(failures === 0 ? 0 : 1);
