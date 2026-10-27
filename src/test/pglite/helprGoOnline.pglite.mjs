#!/usr/bin/env node
/**
 * PGlite proof for 20261027203030_helpr_go_online_for_deliveries ("Go online for deliveries",
 * Q2440, owner-approved 2026-10-27).
 *
 *   node src/test/pglite/helprGoOnline.pglite.mjs                     # after (3x replay)
 *   MUTANT=<name> node src/test/pglite/helprGoOnline.pglite.mjs       # a planted defect: must FAIL
 *
 * World: a helpr_tasks table with the columns the trigger reads, profiles with the columns the
 * offer check reads, notifications, the REAL helpr_task_distance_m, helpr_payout_round_down_cents
 * and declutter_notify (newest definitions). Stubbed, and said so, each from a table so every
 * refusal can be driven: helpr_task_source_require_feature, helpr_task_assert_helpr,
 * member_under_18, declutter_active_strike_count, helper_accept_missing, helpr_task_vehicle_fits,
 * are_users_blocked, helpr_task_same_stripe_mode.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const FILES = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
const THIS = "20261027203030_helpr_go_online_for_deliveries.sql";
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
  // An offline (or timed-out) Helpr is offered deliveries.
  // (The trigger also erases timed-out points first, so the mutant drops both layers.)
  offline: ["  UPDATE public.helpr_delivery_online SET near_lat = NULL, near_lng = NULL\n   WHERE online_until <= now() AND near_lat IS NOT NULL;\n  FOR o IN\n    SELECT h.user_id\n      FROM public.helpr_delivery_online h\n     WHERE h.online_until > now() AND h.near_lat IS NOT NULL",
            "  FOR o IN\n    SELECT h.user_id\n      FROM public.helpr_delivery_online h\n     WHERE h.near_lat IS NOT NULL"],
  // The Helpr's radius is ignored.
  radius: ["           <= h.radius_miles * 1609.344", "           <= 1e9"],
  // A Helpr the buyer blocked is offered the delivery.
  blocked: ["       AND NOT public.are_users_blocked(h.user_id, NEW.customer_id)\n", "\n"],
  // The shared position is stored exactly (background tracking by another name).
  exact: ["    v_lat := round(p_lat, 2);", "    v_lat := p_lat;"],
  // Anyone may go online (the delivery gate is skipped).
  gate: ["  v_uid := public.helpr_task_assert_helpr();\n  IF p_hours", "  v_uid := (SELECT auth.uid());\n  IF p_hours"],
  // A failing offer stops the paid order's task from being created.
  swallow: ["    EXCEPTION WHEN OTHERS THEN\n      RAISE WARNING 'helpr_task_offer_online: offer of task % to % not sent: %', NEW.id, o.user_id, SQLERRM;\n    END;\n  END LOOP;\n  EXCEPTION WHEN OTHERS THEN\n    RAISE WARNING 'helpr_task_offer_online: offers for task % not sent: %', NEW.id, SQLERRM;\n  END;",
            "    END;\n  END LOOP;\n  END;"],
  // One failing notice loses every offer of the task (the per-Helpr sub-block is gone).
  inner: ["    EXCEPTION WHEN OTHERS THEN\n      RAISE WARNING 'helpr_task_offer_online: offer of task % to % not sent: %', NEW.id, o.user_id, SQLERRM;\n    END;\n  END LOOP;",
          "    END;\n  END LOOP;"],
  // The member switch is not re-checked per Helpr at offer time.
  switch: ["       AND public.feature_enabled_for_user('declutter', h.user_id)\n", "\n"],
};
let mig = readFileSync(MIG_DIR + THIS, "utf8");
if (MUTANT) {
  const m = MUTANTS[MUTANT];
  if (!m || !mig.includes(m[0])) throw new Error(`mutant ${MUTANT} did not apply`);
  mig = mig.replace(m[0], m[1]);
}

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };

const U = (n) => `11111111-0000-0000-0000-${String(n).padStart(12, "0")}`;
const NEAR = U(1), FAR = U(2), OFFLINE = U(3), BLOCKED = U(4), MINOR = U(5), NOAREA = U(6), SHARED = U(7),
  EXPIRED = U(8), BANNED = U(9), NOPAY = U(10), SELLER = U(11), BUYER = U(12), SMALLCAR = U(13), OFF = U(14), STRUCK = U(15),
  BROKEN = U(16);

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  grant usage on schema auth, public to anon, authenticated, service_role;
  create table public.profiles (user_id uuid primary key, latitude double precision, longitude double precision,
    ban_status text default 'active', under_13_blocked_at timestamptz, is_seed boolean default false,
    minor boolean default false, strikes int default 0, payout_missing boolean default false);
  create table public.notifications (id bigint generated always as identity, user_id uuid, type text, title text, message text, link text);
  create table public.helpr_tasks (
    id uuid primary key, source_kind text not null default 'declutter_delivery', source_id uuid not null,
    status text not null, size text not null default 'small', title text not null,
    pickup_area text not null, dropoff_area text not null,
    pickup_address text not null, pickup_lat numeric not null, pickup_lng numeric not null,
    dropoff_address text not null, dropoff_lat numeric not null, dropoff_lng numeric not null,
    trip_miles integer not null default 7, pay_cents integer not null default 2500, fee_cents integer not null default 195,
    customer_id uuid, pickup_contact_id uuid, helpr_id uuid, pickup_slot_start timestamptz,
    open_until timestamptz not null default now() + interval '2 days', latest_pickup_at timestamptz not null default now() + interval '5 days');
  create table public.switch_off (user_id uuid primary key);
  insert into public.switch_off values ('${OFF}');
  create function public.feature_enabled_for_user(p_key text, p_user_id uuid) returns boolean language sql stable as
    $f$ select not exists (select 1 from public.switch_off where user_id = p_user_id) $f$;
  create function public.helpr_task_source_require_feature(p_kind text) returns void language plpgsql as $f$
  begin
    if exists (select 1 from public.switch_off where user_id = auth.uid()) then raise exception 'feature_disabled' using errcode = '42501'; end if;
  end $f$;
  create function public.member_under_18(p uuid) returns boolean language sql stable as
    $f$ select coalesce((select minor from public.profiles where user_id = p), false) $f$;
  create function public.declutter_active_strike_count(p uuid) returns int language sql stable as
    $f$ select coalesce((select strikes from public.profiles where user_id = p), 0) $f$;
  create function public.helper_accept_missing(p uuid) returns text[] language sql stable as
    $f$ select case when not exists (select 1 from public.profiles where user_id = p) then array['unknown']
                    when (select payout_missing from public.profiles where user_id = p) then array['payout_setup'] else '{}'::text[] end $f$;
  create function public.helpr_task_assert_helpr() returns uuid language plpgsql as $f$
  begin
    if auth.uid() is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
    if public.member_under_18(auth.uid()) then raise exception 'under_18' using errcode = '42501'; end if;
    return auth.uid();
  end $f$;
  create table public.trucks (user_id uuid primary key);
  create function public.helpr_task_vehicle_fits(p_user uuid, p_size text) returns boolean language sql stable as
    $f$ select p_size = 'small' or exists (select 1 from public.trucks where user_id = p_user) $f$;
  create table public.blocks (a uuid, b uuid);
  insert into public.blocks values ('${BUYER}', '${BLOCKED}');
  create function public.are_users_blocked(p1 uuid, p2 uuid) returns boolean language sql stable as
    $f$ select exists (select 1 from public.blocks where (a = p1 and b = p2) or (a = p2 and b = p1)) $f$;
  create function public.helpr_task_same_stripe_mode(p_a uuid, p_b uuid) returns boolean language sql stable as
    $f$ select p_a is not null and p_b is not null $f$;
`);
for (const fn of ["helpr_task_distance_m", "helpr_payout_round_down_cents", "declutter_notify"]) await db.exec(newest(fn));
for (let i = 0; i < 3; i++) await db.exec(mig); // replay-safe: applied three times

// Members. Mid City Baton Rouge ~ (30.45, -91.15).
const users = [NEAR, FAR, OFFLINE, BLOCKED, MINOR, NOAREA, SHARED, EXPIRED, BANNED, NOPAY, SELLER, BUYER, SMALLCAR, OFF, STRUCK, BROKEN];
await db.exec(`insert into auth.users values ${users.map((u) => `('${u}')`).join(",")}`);
await db.exec(`insert into public.profiles (user_id, latitude, longitude) values
  ('${NEAR}', 30.451234, -91.151234), ('${FAR}', 32.50, -93.75), ('${OFFLINE}', 30.45, -91.15), ('${BLOCKED}', 30.45, -91.15),
  ('${MINOR}', 30.45, -91.15), ('${NOAREA}', null, null), ('${SHARED}', null, null), ('${EXPIRED}', 30.45, -91.15),
  ('${BANNED}', 30.45, -91.15), ('${NOPAY}', 30.45, -91.15), ('${SELLER}', 30.45, -91.15), ('${BUYER}', 30.40, -91.05),
  ('${SMALLCAR}', 30.45, -91.15), ('${OFF}', 30.45, -91.15), ('${STRUCK}', 30.45, -91.15), ('${BROKEN}', 30.45, -91.15)`);
// BROKEN's notice always fails to insert (a stand-in for any one bad recipient).
await db.exec(`create function public.zz_fail_one() returns trigger language plpgsql as $f$
  begin if new.user_id = '${BROKEN}' then raise exception 'boom'; end if; return new; end $f$;
  create trigger zz_fail_one before insert on public.notifications for each row execute function public.zz_fail_one()`);
await db.exec(`update public.profiles set minor = true where user_id = '${MINOR}'`);

async function as(uid, sql, params = []) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ""}', false)`);
  try {
    return { ok: true, rows: (await db.query(sql, params)).rows };
  } catch (e) {
    return { ok: false, code: String(e.message) };
  }
}
const goOnline = (uid, on, hours = null, lat = null, lng = null, radius = null) =>
  as(uid, "select public.helpr_go_online($1, $2, $3, $4, $5) as r", [on, hours, lat, lng, radius]);

// --- Going online.
const near = await goOnline(NEAR, true);
check(near.ok && near.rows[0].r.radius_miles === 15, `[online] a Helpr goes online from their saved area${near.ok ? "" : ` (${near.code})`}`);
const until = near.ok ? new Date(near.rows[0].r.online_until).getTime() - Date.now() : 0;
check(until > 3.9 * 3600_000 && until <= 4 * 3600_000 + 5000, "[auto-off] online for 4 hours by default");
const row = (await db.query(`select near_lat::text as la, near_lng::text as lo from public.helpr_delivery_online where user_id = $1`, [NEAR])).rows[0];
check(row?.la === "30.45" && row?.lo === "-91.15", `[location] the stored point is the saved area rounded to 2 decimals (${row?.la}, ${row?.lo})`);
const noArea = await goOnline(NOAREA, true);
check(!noArea.ok && noArea.code === "location_needed", "[location] with no saved area and nothing shared: location_needed");
const shared = await goOnline(SHARED, true, 2, 30.448811, -91.149922, 10);
const srow = (await db.query(`select near_lat::text as la, near_lng::text as lo, radius_miles from public.helpr_delivery_online where user_id = $1`, [SHARED])).rows[0];
check(shared.ok && srow?.la === "30.45" && srow?.lo === "-91.15" && srow?.radius_miles === 10, "[location] a shared position is stored only rounded to 2 decimals");
check(!(await goOnline(NEAR, true, 13)).ok, "[input] more than 12 hours is refused");
const minor = await goOnline(MINOR, true);
check(!minor.ok && minor.code === "under_18", "[gate] a member who may not deliver cannot go online (under_18)");
const off = await goOnline(OFF, true);
check(!off.ok && off.code === "feature_disabled", "[feature] the member switch is checked first");
// A member the switch no longer covers can still go offline (review #2) and gets no offers.
await db.exec(`insert into public.helpr_delivery_online (user_id, online_until, near_lat, near_lng) values ('${OFF}', now() + interval '1 hour', 30.45, -91.15)`);
const offOff = await goOnline(OFF, false);
check(offOff.ok, `[offline] going offline needs no switch${offOff.ok ? "" : ` (${offOff.code})`}`);
await db.exec(`update public.helpr_delivery_online set online_until = now() + interval '1 hour', near_lat = 30.45, near_lng = -91.15 where user_id = '${OFF}'`);
const anon = await goOnline(null, true);
check(!anon.ok && anon.code === "not_authenticated", "[auth] no session is refused");
for (const u of [FAR, BLOCKED, EXPIRED, BANNED, NOPAY, SELLER, SMALLCAR, OFFLINE, STRUCK, BROKEN]) {
  const r = await goOnline(u, true);
  if (!r.ok) throw new Error(`setup: ${u} could not go online: ${r.code}`);
}
const offR = await goOnline(OFFLINE, false);
const offRow = (await db.query(`select online_until, near_lat from public.helpr_delivery_online where user_id = $1`, [OFFLINE])).rows[0];
check(offR.ok && offRow.online_until === null && offRow.near_lat === null, "[offline] turning it off clears it and forgets the point");
// Who may no longer deliver after going online (the offer re-checks).
await db.exec(`update public.profiles set ban_status = 'banned' where user_id = '${BANNED}';
  update public.profiles set payout_missing = true where user_id = '${NOPAY}';
  update public.profiles set strikes = 3 where user_id = '${STRUCK}'`);

// --- Own row only.
await db.exec(`grant select on public.helpr_delivery_online to authenticated`);
const pol = (await db.query(`select qual from pg_policies where tablename = 'helpr_delivery_online'`)).rows.map((r) => r.qual).join(" | ");
check(/user_id = \(?\s*SELECT auth\.uid\(\)/i.test(pol.replace(/\s+/g, " ")), `[rls] a member reads only their own row (${pol})`);
const tgrants = (await db.query(`select grantee, privilege_type from information_schema.role_table_grants where table_name = 'helpr_delivery_online' and grantee in ('anon','authenticated')`)).rows.map((r) => `${r.grantee}:${r.privilege_type}`).sort().join(",");
check(tgrants === "authenticated:SELECT", `[rls] members may only SELECT; nobody but the RPC writes (${tgrants})`);
const acl = (await db.query(`select coalesce(proacl::text, '') as a from pg_proc where proname = 'helpr_go_online'`)).rows[0].a;
check(/authenticated=X/.test(acl) && !/anon=X/.test(acl) && !/(^|[{,])=X/.test(acl), `[grants] helpr_go_online: authenticated yes, anon and PUBLIC no (${acl})`);
const trgAcl = (await db.query(`select coalesce(proacl::text, '') as a from pg_proc where proname = 'helpr_task_offer_online'`)).rows[0].a;
check(!/authenticated=X|anon=X|(^|[{,])=X/.test(trgAcl), `[grants] the offer trigger function is not callable by members (${trgAcl})`);

// --- An auto-off erases the point at the next delivery or go-online (re-review #1).
await db.exec(`update public.helpr_delivery_online set online_until = now() - interval '1 minute' where user_id = '${SHARED}'`);
await goOnline(NEAR, true);
const stale = (await db.query(`select near_lat from public.helpr_delivery_online where user_id = $1`, [SHARED])).rows[0];
check(stale.near_lat === null, "[location] a timed-out Helpr's point is erased the next time anyone goes online");
await goOnline(SHARED, true, 2, 30.448811, -91.149922, 10);
// EXPIRED's auto-off passes after the last go-online, so only the offer's own checks stand between it and an offer.
await db.exec(`update public.helpr_delivery_online set online_until = now() - interval '1 minute' where user_id = '${EXPIRED}'`);

// --- The offer.
await db.exec(`delete from public.notifications`);
await db.query(`insert into public.helpr_tasks (id, source_id, status, title, pickup_area, dropoff_area, pickup_address, pickup_lat, pickup_lng,
    dropoff_address, dropoff_lat, dropoff_lng, customer_id, pickup_contact_id)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'open', 'Oak dresser', 'Mid City', 'Shenandoah',
    '1450 Government St', 30.452211, -91.148877, '22 Buyer Ln', 30.401111, -91.051111, $1, $2)`, [BUYER, SELLER]);
const got = (await db.query(`select user_id::text as u, type, title, message, link from public.notifications`)).rows;
const who = new Set(got.map((n) => n.u));
check(who.has(NEAR) && who.has(SHARED), "[offer] online Helprs within their radius are offered the new delivery at once, even when one other Helpr's notice fails");
check(!who.has(BROKEN), "[offer] the failing recipient's notice alone is lost");
for (const [u, why] of [[FAR, "too far (Shreveport)"], [OFFLINE, "offline"], [EXPIRED, "timed out (auto-off)"], [BLOCKED, "blocked by the buyer"],
  [BANNED, "banned since going online"], [OFF, "no longer covered by the switch"], [NOPAY, "may no longer deliver (payout gate back on)"], [SELLER, "the seller"], [STRUCK, "3 Declutter strikes"]]) {
  check(!who.has(u), `[offer] never to a Helpr who is ${why}`);
}
const msg = got.find((n) => n.u === NEAR);
check(msg?.message === "$23 · 7 mi · pickup in Mid City" && msg?.title === "New delivery near you" && msg?.type === "job_match" && msg?.link === "/declutter?view=deliver",
  `[offer] "$X · N mi · pickup in <town>", take-home pay only (${msg?.message})`);
check(!got.some((n) => /Government|Buyer Ln|30\.4|91\.1/.test(`${n.title} ${n.message} ${n.link}`)), "[leak] no address and no point in any offer");
// A large item goes only to a Helpr with a truck.
await db.exec(`delete from public.notifications`);
await db.exec(`insert into public.trucks values ('${NEAR}')`);
await db.query(`insert into public.helpr_tasks (id, source_id, status, size, title, pickup_area, dropoff_area, pickup_address, pickup_lat, pickup_lng,
    dropoff_address, dropoff_lat, dropoff_lng, customer_id, pickup_contact_id)
  values ('aaaaaaaa-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002', 'open', 'large', 'Couch', 'Mid City', 'Baker',
    '9 Seller St', 30.45, -91.15, '9 Buyer Ln', 30.55, -91.15, $1, $2)`, [BUYER, SELLER]);
const big = new Set((await db.query(`select user_id::text as u from public.notifications`)).rows.map((r) => r.u));
check(big.has(NEAR) && !big.has(SMALLCAR) && !big.has(SHARED), "[offer] a large item only to an online Helpr with a truck");
// Not a new open task: nothing.
await db.exec(`delete from public.notifications`);
await db.query(`insert into public.helpr_tasks (id, source_id, status, title, pickup_area, dropoff_area, pickup_address, pickup_lat, pickup_lng,
    dropoff_address, dropoff_lat, dropoff_lng, customer_id, pickup_contact_id, helpr_id, pickup_slot_start)
  values ('aaaaaaaa-0000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000003', 'accepted', 'Lamp', 'Mid City', 'Baker',
    '9 Seller St', 30.45, -91.15, '9 Buyer Ln', 30.55, -91.15, $1, $2, $3, now() + interval '1 hour')`, [BUYER, SELLER, FAR]);
check((await db.query(`select count(*)::int as n from public.notifications`)).rows[0].n === 0, "[offer] only a new OPEN delivery is offered");
// A failing offer never stops the task (a paid order's delivery) from being created.
await db.exec(`alter table public.notifications add constraint no_more check (false) not valid`);
const ins = await as(null, `insert into public.helpr_tasks (id, source_id, status, title, pickup_area, dropoff_area, pickup_address, pickup_lat, pickup_lng,
    dropoff_address, dropoff_lat, dropoff_lng, customer_id, pickup_contact_id)
  values ('aaaaaaaa-0000-0000-0000-000000000004', 'bbbbbbbb-0000-0000-0000-000000000004', 'open', 'Rug', 'Mid City', 'Baker',
    '9 Seller St', 30.45, -91.15, '9 Buyer Ln', 30.55, -91.15, '${BUYER}', '${SELLER}') returning id`);
check(ins.ok, `[safety] the delivery task is created even when its offers cannot be sent${ins.ok ? "" : ` (${ins.code})`}`);

console.log(failures === 0 ? `\nALL PASS${MUTANT ? ` (MUTANT=${MUTANT}: expected FAIL)` : " (3x replay)"}` : `\n${failures} FAIL${MUTANT ? ` (MUTANT=${MUTANT})` : ""}`);
process.exit(failures === 0 ? 0 : 1);
