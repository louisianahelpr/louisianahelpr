#!/usr/bin/env node
/**
 * PGlite proof for 20261027205327_declutter_auto_free_day12 (Q2430, owner 2026-10-27: "If it hasn't
 * sold by day 12, make it free" -- the price-drop sweep sets it Free, one last chance before the 14-day
 * haul-away; watchers get the Q2429 alert).
 *
 *   node src/test/pglite/declutterAutoFree.pglite.mjs                  # after (3x replay)
 *   MUTANT=<name> node src/test/pglite/declutterAutoFree.pglite.mjs    # a planted defect: must FAIL
 *
 * World: the Declutter tables the functions read (items with the free CHECK, private, offers and their
 * events, watchlist, notifications, profiles), the REAL declutter_notify and the Q2429 migration
 * (20261027204745, its trigger and sweep) under this one. Stubbed, and said so: require_feature (a
 * table of members it is off for), is_caller_banned, declutter_assert_member, are_users_blocked,
 * net.http_post and vault.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const FILES = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
const THIS = "20261027205327_declutter_auto_free_day12.sql";
const ALERTS = "20261027204745_declutter_price_drop_alerts.sql";
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
  optin: ["     WHERE p.auto_free_day12\n       AND i.status = 'live'", "     WHERE i.status = 'live'"],
  day: ["       AND COALESCE(i.live_at, i.submitted_at, i.created_at) + interval '12 days' <= now()", "       AND true"],
  live: ["       AND i.status = 'live'\n       AND NOT i.seller_hidden", "       AND NOT i.seller_hidden"],
  hidden: ["       AND NOT i.seller_hidden\n", "\n"],
  // The buyer of a closed offer is skipped whenever they watch it (even when the watchers' alert was capped).
  capped: ["        CONTINUE WHEN EXISTS (SELECT 1 FROM public.declutter_price_alerts a\n                               WHERE a.item_id = it.id AND a.user_id = b AND a.sent_at = now());",
           "        CONTINUE WHEN EXISTS (SELECT 1 FROM public.declutter_watchlist w WHERE w.item_id = it.id AND w.user_id = b);"],
  // One failing item undoes the whole evening.
  isolate: ["    EXCEPTION WHEN OTHERS THEN\n      RAISE WARNING 'declutter_auto_free_due: item % not made free: %', it.id, SQLERRM;\n      PERFORM public.log_cron_defect('declutter_auto_free_due', it.id::text, SQLERRM, '{}'::jsonb);\n", ""],
  offers: ["         WHERE item_id = it.id AND status = 'open'\n        RETURNING id, buyer_id", "         WHERE false\n        RETURNING id, buyer_id"],
  owner: ["  SELECT * INTO v_item FROM public.declutter_items WHERE id = p_item_id AND seller_id = v_uid FOR UPDATE;\n  IF NOT FOUND THEN\n    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';\n  END IF;\n  IF v_item.status NOT IN ('draft', 'pending_review', 'live', 'paused')",
          "  SELECT * INTO v_item FROM public.declutter_items WHERE id = p_item_id FOR UPDATE;\n  IF NOT FOUND THEN\n    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';\n  END IF;\n  IF v_item.status NOT IN ('draft', 'pending_review', 'live', 'paused')"],
  sweep: ["  v_n := v_n + public.declutter_auto_free_due();\n", ""],
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
const I = (n) => `22222222-0000-0000-0000-${String(n).padStart(12, "0")}`;
const SELLER = U(1), BUYER = U(2), WATCHER = U(3), OTHER = U(4), BANNED = U(5), OFF = U(6), BOTH = U(7), CAPPED = U(8);

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth; create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  grant usage on schema auth, public to anon, authenticated, service_role;
  create table public.profiles (user_id uuid primary key, is_seed boolean default false, banned boolean default false);
  create table public.declutter_items (id uuid primary key, seller_id uuid not null, status text not null default 'live', title text not null,
    price_cents integer not null, current_price_cents integer not null, is_seed boolean not null default false, sale_mode text not null default 'offers',
    live_at timestamptz, submitted_at timestamptz, created_at timestamptz not null default now(),
    last_price_drop_on date, price_dropped_at timestamptz, updated_at timestamptz default now(), seller_hidden boolean not null default false,
    constraint free_both check ((price_cents = 0) = (current_price_cents = 0)));
  create table public.defects (fn text, ref text);
  create function public.log_cron_defect(p_fn text, p_ref text, p_err text, p_context jsonb default '{}'::jsonb) returns void language sql as $f$ insert into public.defects values (p_fn, p_ref) $f$;
  create table public.declutter_item_private (item_id uuid primary key, seller_id uuid, floor_price_cents integer not null, drop_stop_cents integer,
    updated_at timestamptz default now());
  create table public.declutter_offers (id uuid primary key, item_id uuid, buyer_id uuid, status text not null default 'open', closed_at timestamptz, updated_at timestamptz);
  create table public.declutter_offer_events (offer_id uuid, actor_side text, action text);
  create table public.declutter_watchlist (user_id uuid, item_id uuid, created_at timestamptz default now(), primary key (user_id, item_id));
  create table public.notifications (id bigint generated always as identity primary key, user_id uuid, type text, title text, message text, link text);
  create table public.switch_off (user_id uuid primary key);
  create function public.require_feature(p_key text) returns void language plpgsql as $f$
  begin if exists (select 1 from public.switch_off where user_id = auth.uid()) then raise exception 'feature_disabled' using errcode = '42501'; end if; end $f$;
  create function public.is_caller_banned() returns boolean language sql stable as $f$ select coalesce((select banned from public.profiles where user_id = auth.uid()), false) $f$;
  create function public.declutter_assert_member(p boolean) returns uuid language plpgsql as $f$
  begin if auth.uid() is null then raise exception 'not_authenticated' using errcode = '42501'; end if; return auth.uid(); end $f$;
  create function public.are_users_blocked(p1 uuid, p2 uuid) returns boolean language sql stable as $f$ select false $f$;
  create schema net; create table net.calls (body jsonb);
  create function net.http_post(url text, headers jsonb, body jsonb) returns bigint language sql as $f$ insert into net.calls values (body) returning 1::bigint $f$;
  create schema vault; create table vault.decrypted_secrets (name text, decrypted_secret text);
`);
await db.exec(newest("declutter_notify"));
await db.exec(readFileSync(MIG_DIR + ALERTS, "utf8"));
for (let i = 0; i < 3; i++) await db.exec(mig); // replay-safe: applied three times

const users = [SELLER, BUYER, WATCHER, OTHER, BANNED, OFF, BOTH, CAPPED];
await db.exec(`insert into auth.users values ${users.map((u) => `('${u}')`).join(",")};
  insert into public.profiles (user_id, banned) values ${users.map((u) => `('${u}', ${u === BANNED})`).join(",")};
  insert into public.switch_off values ('${OFF}');`);
async function item(n, o = {}) {
  await db.query(`insert into public.declutter_items (id, seller_id, title, price_cents, current_price_cents, status, live_at) values ($1, $2, $3, $4, $4, $5, now() - make_interval(days => $6))`,
    [I(n), o.seller ?? SELLER, o.title ?? `Item ${n}`, o.price ?? 5000, o.status ?? "live", o.days ?? 13]);
  await db.query(`insert into public.declutter_item_private (item_id, seller_id, floor_price_cents, drop_stop_cents) values ($1, $2, $3, $4)`, [I(n), o.seller ?? SELLER, o.floor ?? 4000, 4500]);
}
async function as(uid, sql, params = []) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ""}', false)`);
  try { return { ok: true, rows: (await db.query(sql, params)).rows }; } catch (e) { return { ok: false, code: String(e.message) }; }
}
const setAuto = (uid, n, on) => as(uid, `select public.declutter_set_auto_free($1, $2) as r`, [I(n), on]);
const itemRow = async (n) => (await db.query(`select i.price_cents, i.current_price_cents, p.floor_price_cents, p.drop_stop_cents, p.auto_free_day12
  from public.declutter_items i join public.declutter_item_private p on p.item_id = i.id where i.id = $1`, [I(n)])).rows[0];

await item(1, { title: "Oak dresser", days: 13 });          // switched on, 13 days live: becomes free
await item(2, { title: "Lamp", days: 11 });                 // switched on, 11 days: not yet
await item(3, { title: "Rug", days: 13 });                  // not switched on: never free
await item(4, { title: "Chair", days: 13, status: "reserved" }); // switched on but reserved: never free
await item(5, { title: "Other's", days: 13, seller: OTHER });
await db.exec(`insert into public.declutter_watchlist (user_id, item_id) values ('${WATCHER}', '${I(1)}');
  insert into public.declutter_offers (id, item_id, buyer_id) values ('33333333-0000-0000-0000-000000000001', '${I(1)}', '${BUYER}');
  insert into public.declutter_watchlist (user_id, item_id) values ('${BOTH}', '${I(1)}');
  insert into public.declutter_offers (id, item_id, buyer_id) values ('33333333-0000-0000-0000-000000000002', '${I(1)}', '${BOTH}');
  insert into public.declutter_watchlist (user_id, item_id) values ('${CAPPED}', '${I(1)}');
  insert into public.declutter_offers (id, item_id, buyer_id) values ('33333333-0000-0000-0000-000000000003', '${I(1)}', '${CAPPED}')`);
// CAPPED is over the watchers' daily alert cap (fixture, 2026-10-27): the watchers alert skips them, so the offer notice must not.
await db.exec(`insert into public.declutter_price_alerts (item_id, user_id, price_cents) select '${I(3)}', '${CAPPED}', 100 from generate_series(1, 5)`);
await item(6, { title: "Hidden seller's", days: 13 });
await db.exec(`update public.declutter_items set seller_hidden = true where id = '${I(6)}'; update public.declutter_item_private set auto_free_day12 = true where item_id = '${I(6)}'`);
// Item 7 cannot be made free (a stand-in for any one failure): the rest of the evening still happens.
await item(7, { title: "Broken", days: 13 });
await db.exec(`update public.declutter_item_private set auto_free_day12 = true where item_id = '${I(7)}';
  create function public.zz_fail_item() returns trigger language plpgsql as $f$ begin if new.id = '${I(7)}' and new.current_price_cents = 0 then raise exception 'boom'; end if; return new; end $f$;
  create trigger zz_fail_item before update on public.declutter_items for each row execute function public.zz_fail_item()`);

// --- The seller's switch.
const on1 = await setAuto(SELLER, 1, true);
check(on1.ok && on1.rows[0].r === true && (await itemRow(1)).auto_free_day12 === true, `[opt-in] the seller switches it on for their own listing${on1.ok ? "" : ` (${on1.code})`}`);
for (const n of [2, 4]) await db.query(`update public.declutter_item_private set auto_free_day12 = true where item_id = $1`, [I(n)]);
const notMine = await setAuto(SELLER, 5, true);
check(!notMine.ok && notMine.code === "item_not_found", "[owner] never on another member's listing");
const banned = await setAuto(BANNED, 1, true);
check(!banned.ok && banned.code === "account_restricted", "[gate] a banned member is refused");
const off = await setAuto(OFF, 1, true);
check(!off.ok && off.code === "feature_disabled", "[feature] the member switch is checked first");
const state = await as(SELLER, `select public.declutter_auto_free_state($1) as r`, [I(1)]);
check(state.ok && state.rows[0].r === true, "[state] the seller reads their switch");
const peek = await as(BUYER, `select public.declutter_auto_free_state($1) as r`, [I(1)]);
check(!peek.ok && peek.code === "item_not_found", "[owner] nobody else reads it");

// --- The evening sweep.
await db.exec(`select set_config('request.jwt.claim.sub', '', false)`);
await db.exec(`select public.declutter_price_drop_sweep()`);
const r1 = await itemRow(1);
check(r1.price_cents === 0 && r1.current_price_cents === 0 && r1.floor_price_cents === 0 && r1.drop_stop_cents === null && r1.auto_free_day12 === false,
  `[free] day 12+: the listing becomes free exactly as a free listing is (${JSON.stringify(r1)})`);
const offers = (await db.query(`select status from public.declutter_offers`)).rows;
check(offers.length === 3 && offers.every((o) => o.status === "voided"), "[offers] its open offers close");
const capped = (await db.query(`select title from public.notifications where user_id = $1`, [CAPPED])).rows;
check(capped.length === 1 && capped[0].title === "Now free", `[offers] a buyer over the watchers' daily cap is still told their offer closed (${capped.length})`);
const both = (await db.query(`select title from public.notifications where user_id = $1`, [BOTH])).rows;
check(both.length === 1 && both[0].title === "Now free", `[offers] a buyer who also watches it gets one notice, not two (${both.length})`);
const buyerNote = (await db.query(`select message from public.notifications where user_id = $1`, [BUYER])).rows;
check(buyerNote.some((n) => /"Oak dresser" is now free, so your offer is closed/.test(n.message)), "[offers] the buyer is told");
const watcherNote = (await db.query(`select title, message from public.notifications where user_id = $1`, [WATCHER])).rows;
check(watcherNote.length === 1 && watcherNote[0].title === "Now free" && watcherNote[0].message === '"Oak dresser" is now free.', "[watchers] watchers get the Q2429 'now free' alert");
const sellerNote = (await db.query(`select message from public.notifications where user_id = $1`, [SELLER])).rows;
check(sellerNote.some((n) => /didn't sell in 12 days, so it is now free/.test(n.message)), "[seller] the seller is told");
check((await itemRow(2)).current_price_cents > 0, "[day] at 11 days it is not free yet (the normal drop applies)");
check((await itemRow(3)).current_price_cents > 0, "[opt-in] a listing not switched on is never made free");
check((await itemRow(4)).current_price_cents === 5000, "[live] a reserved item is never made free");
check((await itemRow(6)).current_price_cents > 0, "[hidden] a hidden seller's listing is never made free");
const r7 = await itemRow(7);
check(r7.current_price_cents > 0 && r7.auto_free_day12 === true, "[isolation] an item that fails stays as it was (its switch too)");
check((await db.query(`select count(*)::int as n from public.defects where fn = 'declutter_auto_free_due' and ref = $1`, [I(7)])).rows[0].n === 1, "[isolation] the failure is logged where ops sees it");
// The member gate only on switching ON: a seller who can no longer sell can still switch it off.
await item(8, { days: 2 });
await db.exec(`update public.declutter_item_private set auto_free_day12 = true where item_id = '${I(8)}';
  create or replace function public.declutter_assert_member(p boolean) returns uuid language plpgsql as $f$ begin raise exception 'declutter_strikes_blocked' using errcode = '42501'; end $f$`);
const offOk = await setAuto(SELLER, 8, false);
check(offOk.ok && offOk.rows[0].r === false, `[gate] a seller who can no longer sell can still switch it off${offOk.ok ? "" : ` (${offOk.code})`}`);
const onNo = await setAuto(SELLER, 8, true);
check(!onNo.ok && onNo.code === "declutter_strikes_blocked", "[gate] but cannot switch it on");
await db.exec(`create or replace function public.declutter_assert_member(p boolean) returns uuid language plpgsql as $f$
  begin if auth.uid() is null then raise exception 'not_authenticated' using errcode = '42501'; end if; return auth.uid(); end $f$`);
const again = await setAuto(SELLER, 1, true);
check(!again.ok && again.code === "already_free", "[free] a free item has nothing to switch");

const acl = (await db.query(`select proname, coalesce(proacl::text, '') as a from pg_proc where proname in ('declutter_set_auto_free','declutter_auto_free_state','declutter_auto_free_due') order by 1`)).rows;
const aclOf = Object.fromEntries(acl.map((r) => [r.proname, r.a]));
check(/service_role=X/.test(aclOf.declutter_auto_free_due) && !/authenticated=X|anon=X/.test(aclOf.declutter_auto_free_due), `[grants] the day-12 sweep step is service-role only (${aclOf.declutter_auto_free_due})`);
for (const fn of ["declutter_set_auto_free", "declutter_auto_free_state"]) {
  check(/authenticated=X/.test(aclOf[fn]) && !/anon=X/.test(aclOf[fn]) && !/(^|[{,])=X/.test(aclOf[fn]), `[grants] ${fn}: authenticated, not anon or PUBLIC (${aclOf[fn]})`);
}

console.log(failures === 0 ? `\nALL PASS${MUTANT ? ` (MUTANT=${MUTANT}: expected FAIL)` : " (3x replay)"}` : `\n${failures} FAIL${MUTANT ? ` (MUTANT=${MUTANT})` : ""}`);
process.exit(failures === 0 ? 0 : 1);
