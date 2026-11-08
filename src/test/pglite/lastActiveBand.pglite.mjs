#!/usr/bin/env node
/**
 * PGlite proof for 20261108001932_last_active_band_and_seller_badge_blocks (lead 11-07: "last active" is a coarse
 * band, never a sign-in time, and skips blocked, suspended, removed and hidden test users; the seller badges skip
 * blocked and suspended sellers).
 *
 *   node src/test/pglite/lastActiveBand.pglite.mjs                     # ALL PASS (applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/lastActiveBand.pglite.mjs  # RED: the old exact-timestamp function
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/lastActiveBand.pglite.mjs
 *
 * The three earlier migrations (20260609090000, 20261028202132, 20261107235110) are applied verbatim first, so the
 * DROP + CREATE runs over the real old function. Trimmed stand-in tables with only the columns read; auth.uid(),
 * require_feature() and seed_hidden_for() are stubs driven by settings.
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const read = (f) => readFileSync(`${MIG_DIR}${f}`, "utf8");
const mig = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}20261108001932_last_active_band_and_seller_badge_blocks.sql`, "utf8");

let pass = 0, fail = 0;
const ok = (cond, what) => { if (cond) { pass++; console.log(`PASS ${what}`); } else { fail++; console.log(`FAIL ${what}`); } };

const db = new PGlite();
const u = (n) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const ME = u(1), TODAY = u(2), WEEK = u(3), OLD = u(4), IBLOCKED = u(5), BLOCKSME = u(6), BANNED = u(7), SEED = u(8), GONE = u(9);
const TEMP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", LAPSED = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", KID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const NULLBAN = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('t.uid', true), '')::uuid $$;
create function public.require_feature(k text) returns void language plpgsql as $$ begin if coalesce(nullif(current_setting('t.feature', true), ''), 'on') = 'off' then raise exception 'feature_disabled' using errcode='42501'; end if; end $$;
create function public.seed_hidden_for(u uuid) returns boolean language sql stable as $$ select coalesce(nullif(current_setting('t.seedhidden', true), ''), 'on') = 'on' $$;
create table public.profiles(user_id uuid primary key, is_seed boolean not null default false, ban_status text default 'active', auto_suspended_until timestamptz, under_13_blocked_at timestamptz);
create table public.user_blocks(blocker_id uuid not null, blocked_id uuid not null);
create table public.login_history(user_id uuid not null, created_at timestamptz not null);
create table public.declutter_orders(id uuid primary key default gen_random_uuid(), seller_id uuid not null, status text not null, closed_at timestamptz);
create table public.declutter_cart_items(id uuid primary key default gen_random_uuid(), order_id uuid not null, price_cents int not null);
create table public.declutter_strikes(id uuid primary key default gen_random_uuid(), user_id uuid not null, offender_side text not null, reason text not null, given_at timestamptz not null default now(), removed_at timestamptz);
insert into public.profiles (user_id) values ('${ME}'), ('${TODAY}'), ('${WEEK}'), ('${OLD}'), ('${IBLOCKED}'), ('${BLOCKSME}');
insert into public.profiles (user_id, ban_status) values ('${BANNED}', 'permanently_banned'), ('${NULLBAN}', null);
insert into public.profiles (user_id, ban_status, auto_suspended_until) values ('${TEMP}', 'temp_banned', now() + interval '2 days'), ('${LAPSED}', 'temp_banned', now() - interval '1 hour');
insert into public.profiles (user_id, under_13_blocked_at) values ('${KID}', now());
insert into public.profiles (user_id, is_seed) values ('${SEED}', true);
insert into public.user_blocks values ('${ME}', '${IBLOCKED}'), ('${BLOCKSME}', '${ME}');
`);
// Sign-ins: "today" = right now (always today's Louisiana date); "this week" = 3 days back.
const signIn = (id, ago) => db.exec(`insert into public.login_history values ('${id}', now() - interval '${ago}')`);
for (const id of [TODAY, IBLOCKED, BLOCKSME, BANNED, SEED, GONE, TEMP, LAPSED, KID, NULLBAN]) await signIn(id, "1 second");
await signIn(TODAY, "6 days");
await signIn(WEEK, "3 days"); await signIn(WEEK, "20 days");
await signIn(OLD, "9 days");
// Badge fixtures: each seller has 6 handovers this year, priced, no strike (both badges would show).
for (const s of [TODAY, IBLOCKED, BLOCKSME, BANNED, TEMP, LAPSED, GONE, KID]) {
  await db.exec(`with o as (insert into public.declutter_orders (seller_id, status, closed_at) select '${s}', 'handed_over', now() - interval '5 days' from generate_series(1, 6) returning id)
                 insert into public.declutter_cart_items (order_id, price_cents) select id, 500 from o`);
}

for (const f of ["20260609090000_user_last_active_rpc.sql", "20261028202132_declutter_seller_sold_count.sql", "20261107235110_declutter_seller_on_time_handovers.sql"]) await db.exec(read(f));
if (process.env.NEW_MIGRATION !== "skip") for (let i = 0; i < 3; i++) await db.exec(mig);

const set = (k, v) => db.exec(`select set_config('t.${k}', '${v ?? ""}', false)`);
await set("uid", ME);
const bands = async (ids) => {
  try {
    const rows = (await db.query(`select * from public.get_user_last_active($1::uuid[])`, [ids])).rows;
    return { rows, map: Object.fromEntries(rows.map((r) => [r.user_id, r.active_band])) };
  } catch (e) { return { err: e.message }; }
};

const all = [TODAY, WEEK, OLD, IBLOCKED, BLOCKSME, BANNED, SEED, GONE, TEMP, LAPSED, KID, NULLBAN];
const r = await bands(all);
ok(!r.err, `reads without error (${r.err ?? ""})`);
const cols = r.rows?.[0] ? Object.keys(r.rows[0]).sort().join(",") : "";
ok(cols === "active_band,user_id", `returns user_id + active_band only, no timestamp (${cols})`);
ok(r.map?.[TODAY] === "today", "signed in today: 'today'");
ok(r.map?.[WEEK] === "this_week", "signed in 3 days back: 'this_week'");
ok(r.map?.[NULLBAN] === "today", "a profile with no ban_status set is active: 'today'");
ok(r.map?.[LAPSED] === "today", "a temp suspension that already ended does not hide: 'today'");
ok(!(OLD in (r.map ?? {})), "newest sign-in 9 days back: no row");
ok(!(IBLOCKED in (r.map ?? {})), "a user I blocked: no row");
ok(!(BLOCKSME in (r.map ?? {})), "a user who blocked me: no row");
ok(!(BANNED in (r.map ?? {})), "a removed (permanently banned) user: no row");
ok(!(TEMP in (r.map ?? {})), "a user under a running suspension: no row");
ok(!(KID in (r.map ?? {})), "an account waiting on the under-13 delete: no row");
ok(!(GONE in (r.map ?? {})), "a deleted account (sign-ins, no profile): no row");
ok(!(SEED in (r.map ?? {})), "a test user, test accounts hidden from me: no row");
await set("seedhidden", "off");
ok((await bands([SEED])).map?.[SEED] === "today", "a test user, test accounts shown to me: 'today'");
await set("seedhidden", "on");
ok((await bands([])).rows?.length === 0, "an empty list: no rows");
const many = Array.from({ length: 201 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
ok((await bands(many)).err?.includes("too_many_ids"), "201 ids: too_many_ids");
ok(!(await bands(many.slice(0, 200))).err, "200 ids: allowed");
await set("uid", "");
ok((await bands([TODAY])).err?.includes("not_authenticated"), "no caller: not_authenticated");
await set("uid", ME);

const fn = (await db.query(`select proacl::text a, prosecdef d, proconfig::text c, provolatile v from pg_proc where proname = 'get_user_last_active'`)).rows;
ok(fn.length === 1, `one get_user_last_active (${fn.length})`);
ok(fn[0]?.d === true && /search_path=public, pg_temp/.test(fn[0]?.c ?? "") && fn[0]?.v === "s", `SECURITY DEFINER, STABLE, search_path public, pg_temp (${fn[0]?.c})`);
ok(!!fn[0] && !/(^|[{,])anon=/.test(fn[0].a) && !/(^|[{,])=X/.test(fn[0].a) && /authenticated=X/.test(fn[0].a), `members only (${fn[0]?.a})`);

// Seller badges: blocked / suspended / removed sellers read 0 / false.
const badge = async (seller) => {
  const s = (await db.query(`select public.declutter_seller_sold_count('${seller}') n`)).rows[0].n;
  const t = (await db.query(`select public.declutter_seller_on_time_handovers('${seller}') b`)).rows[0].b;
  return { s, t };
};
const good = await badge(TODAY);
ok(good.s === 6 && good.t === true, `a normal seller still counts: sold ${good.s}, on time ${good.t}`);
const lapsed = await badge(LAPSED);
ok(lapsed.s === 6 && lapsed.t === true, `a seller whose suspension ended counts: sold ${lapsed.s}, on time ${lapsed.t}`);
for (const [id, what] of [[IBLOCKED, "a seller I blocked"], [BLOCKSME, "a seller who blocked me"], [BANNED, "a removed seller"], [TEMP, "a suspended seller"], [KID, "an under-13 account"], [GONE, "a deleted seller (no profile)"]]) {
  const b = await badge(id);
  ok(b.s === 0 && b.t === false, `${what}: sold 0, on time false (${b.s}, ${b.t})`);
}
for (const name of ["declutter_seller_sold_count", "declutter_seller_on_time_handovers"]) {
  const f = (await db.query(`select proacl::text a, proconfig::text c from pg_proc where proname = $1`, [name])).rows[0];
  ok(!!f && /search_path=public, pg_temp/.test(f.c) && !/(^|[{,])anon=/.test(f.a) && !/(^|[{,])=X/.test(f.a), `${name}: pg_temp pinned, no anon/PUBLIC (${f?.a})`);
}

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
