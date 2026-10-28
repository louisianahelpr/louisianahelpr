#!/usr/bin/env node
/**
 * PGlite proof for 20261028160637_declutter_seller_drop_percent (owner 2026-10-28: "they should be able
 * to choose their price drop percentage").
 *
 *   node src/test/pglite/declutterSellerDropPercent.pglite.mjs                 # after (3x replay)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterSellerDropPercent.pglite.mjs  # RED: the migration absent
 *   MUTANT=<name> node src/test/pglite/declutterSellerDropPercent.pglite.mjs   # a planted defect: must FAIL
 *
 * World: the declutterAutoFree.pglite.mjs world (the tables the sweep reads, the REAL declutter_notify,
 * the Q2429 alerts migration and the Q2430 auto-free migration whose sweep this one replaces). Stubbed,
 * and said so: require_feature (a table of members it is off for), is_caller_banned,
 * declutter_assert_member, are_users_blocked, net.http_post, vault.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const FILES = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
const THIS = "20261028160637_declutter_seller_drop_percent.sql";
const ALERTS = "20261027204745_declutter_price_drop_alerts.sql";
const AUTO_FREE = "20261027205327_declutter_auto_free_day12.sql";
const MUTANT = process.env.MUTANT ?? "";
const skip = process.env.NEW_MIGRATION === "skip";

function newest(name, before = ALERTS) {
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
  step: ["(floor(i.current_price_cents * (100 - i.drop_pct) / 10000.0) * 100)::integer", "(floor(i.current_price_cents * 95 / 10000.0) * 100)::integer"],
  dollars: ["(floor(i.current_price_cents * (100 - i.drop_pct) / 10000.0) * 100)::integer", "floor(i.current_price_cents * (100 - i.drop_pct) / 100.0)::integer"],
  off: ["       AND i.drop_pct > 0\n", ""],
  range: ["  IF p_pct IS NULL OR p_pct NOT IN (0, 5, 10, 15, 20) THEN", "  IF p_pct IS NULL THEN"],
  owner: ["   WHERE i.id = p_item_id AND i.seller_id = v_uid FOR UPDATE;", "   WHERE i.id = p_item_id FOR UPDATE;"],
};
let mig = readFileSync(MIG_DIR + THIS, "utf8");
if (MUTANT) {
  const m = MUTANTS[MUTANT];
  if (!m || !mig.includes(m[0])) throw new Error(`mutant ${MUTANT} did not apply`);
  mig = mig.replaceAll(m[0], m[1]);
  // The CHECK constraint is a second wall for `range`; the mutant drops it so the RPC's own check is what is proven.
  if (MUTANT === "range") mig = mig.replace(/ALTER TABLE public\.declutter_items ADD CONSTRAINT declutter_items_drop_pct_check[^;]*;/, "");
}

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };
const U = (n) => `11111111-0000-0000-0000-${String(n).padStart(12, "0")}`;
const I = (n) => `22222222-0000-0000-0000-${String(n).padStart(12, "0")}`;
const SELLER = U(1), OTHER = U(2), BANNED = U(3), OFF = U(4);

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
await db.exec(readFileSync(MIG_DIR + AUTO_FREE, "utf8"));
if (!skip) for (let i = 0; i < 3; i++) await db.exec(mig); // replay-safe: applied three times

const users = [SELLER, OTHER, BANNED, OFF];
await db.exec(`insert into auth.users values ${users.map((u) => `('${u}')`).join(",")};
  insert into public.profiles (user_id, banned) values ${users.map((u) => `('${u}', ${u === BANNED})`).join(",")};
  insert into public.switch_off values ('${OFF}');`);
async function item(n, o = {}) {
  await db.query(`insert into public.declutter_items (id, seller_id, title, price_cents, current_price_cents, status, live_at) values ($1, $2, $3, $4, $4, $5, now() - interval '1 day')`,
    [I(n), o.seller ?? SELLER, `Item ${n}`, o.price ?? 10000, o.status ?? "live"]);
  await db.query(`insert into public.declutter_item_private (item_id, seller_id, floor_price_cents, drop_stop_cents) values ($1, $2, $3, $4)`,
    [I(n), o.seller ?? SELLER, o.floor ?? 2000, o.stop ?? 2001]);
}
async function as(uid, sql, params = []) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ""}', false)`);
  try { return { ok: true, rows: (await db.query(sql, params)).rows }; } catch (e) { return { ok: false, code: String(e.message) }; }
}
const setPct = (uid, n, pct) => as(uid, `select public.declutter_set_drop_pct($1, $2) as r`, [I(n), pct]);
const price = async (n) => (await db.query(`select current_price_cents as c from public.declutter_items where id = $1`, [I(n)])).rows[0]?.c;

await item(1); await item(2); await item(3); await item(4); await item(5);
await item(6, { status: "reserved" });
await item(7, { seller: OTHER });
await item(8, { price: 2100, floor: 2000, stop: 2001 });
await item(9, { price: 3800, floor: 1000, stop: 1001 });
await item(10, { price: 1900, floor: 1000, stop: 1001 });

// A. The default keeps today's rule for every listing that exists (5%).
const def = await db.query(`select drop_pct from public.declutter_items where id = $1`, [I(1)]).catch((e) => ({ rows: [{ drop_pct: `error: ${e.message}` }] }));
check(def.rows[0]?.drop_pct === 5, `an existing listing's step is 5% (got ${def.rows[0]?.drop_pct})`);

// B. The seller sets their own; the server refuses the rest.
check((await setPct(SELLER, 2, 10)).rows?.[0]?.r === 10, "the seller sets 10% on their own listing");
check((await setPct(SELLER, 3, 20)).rows?.[0]?.r === 20, "the seller sets 20%");
check((await setPct(SELLER, 4, 0)).rows?.[0]?.r === 0, "the seller turns drops off (0)");
for (const bad of [3, 25, 50, 100, -5]) {
  const r = await setPct(SELLER, 5, bad);
  check(!r.ok && /invalid_drop_pct/.test(r.code), `${bad}% is refused (invalid_drop_pct)`);
}
const nul = await as(SELLER, `select public.declutter_set_drop_pct($1, null) as r`, [I(5)]);
check(!nul.ok && /invalid_drop_pct/.test(nul.code), "no percent is refused");
const stranger = await setPct(SELLER, 7, 10);
check(!stranger.ok && /item_not_found/.test(stranger.code), "another seller's listing is item_not_found (never 'exists')");
const reserved = await setPct(SELLER, 6, 10);
check(!reserved.ok && /item_not_editable/.test(reserved.code), "a reserved (sold) listing cannot change its step");
const banned = await setPct(BANNED, 1, 10);
check(!banned.ok && /account_restricted/.test(banned.code), "a banned account is refused");
const off = await setPct(OFF, 1, 10);
check(!off.ok && /feature_disabled/.test(off.code), "an ordinary account the switch is off for is refused (feature_disabled)");
const anon = await as(null, `select public.declutter_set_drop_pct($1, 10) as r`, [I(1)]);
check(!anon.ok, "no signed-in member is refused");
const direct = await db.query(`update public.declutter_items set drop_pct = 7 where id = $1`, [I(5)]).then(() => "written", (e) => e.message);
check(/declutter_items_drop_pct_check/.test(direct), "the table itself refuses a step outside 0/5/10/15/20");

// C. The evening sweep uses each listing's own step.
await db.exec(`select set_config('request.jwt.claim.sub', '', false)`);
await db.query(`select public.declutter_price_drop_sweep()`);
check(await price(1) === 9500, `5%: $100 -> $95 (got ${await price(1)})`);
check(await price(2) === 9000, `10%: $100 -> $90 (got ${await price(2)})`);
check(await price(3) === 8000, `20%: $100 -> $80 (got ${await price(3)})`);
check(await price(4) === 10000, `off: stays $100 (got ${await price(4)})`);
const offRow = (await db.query(`select last_price_drop_on, price_dropped_at from public.declutter_items where id = $1`, [I(4)])).rows[0];
check(offRow.last_price_drop_on === null && offRow.price_dropped_at === null, "off: the sweep never touches it (no 'dropped' stamp)");
check(await price(9) === 3600, `whole dollars: $38 at 5% -> $36, never $36.10 (got ${await price(9)})`);
check(await price(10) === 1800, `whole dollars: $19 at 5% -> $18, never $18.05 (got ${await price(10)})`);
check(await price(8) === 2001, `never below the stop/floor: $21 at 5% stops at the stop (got ${await price(8)})`);

const acl = (await db.query(`select proacl::text as a from pg_proc where proname = 'declutter_set_drop_pct'`)).rows[0]?.a ?? "";
check(acl !== "" && !/(^|[{,])=X/.test(acl) && !/anon=X/.test(acl), `declutter_set_drop_pct: no PUBLIC or anon EXECUTE (${acl})`);

console.log(failures ? `\n${failures} FAIL` : "\nall PASS");
process.exit(failures ? 1 : 0);
