#!/usr/bin/env node
/**
 * PGlite proof for 20261120152652_declutter_haul_away_opt_in (owner 2026-11-20: haul-away only when the seller picks
 * it; "If it doesn't sell, offer me a haul-away", off by default).
 *
 *   node src/test/pglite/declutterHaulAwayOptIn.pglite.mjs                    # after (3x replay)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterHaulAwayOptIn.pglite.mjs # RED: the three senders as before
 *   MUTANT=<name> node src/test/pglite/declutterHaulAwayOptIn.pglite.mjs      # a planted defect: must FAIL
 *
 * World: the columns the three senders and the new RPCs read (items, private, haul-away notices and links, cart
 * lines, offers and events, price alerts, photos, jobs, gift cards, notifications). The senders' bodies are the REAL
 * newest definitions (this migration's, or with NEW_MIGRATION=skip the ones before it, read from the migrations),
 * as are declutter_haul_away_sweep_candidates and declutter_keeps_up. Stubbed, and said so: declutter_notify (a plain
 * bell-row insert; its wording and push are not under test), log_cron_defect, require_feature and
 * feature_enabled_for_user (a table of switches that are off per member), declutter_member_out (false),
 * declutter_haul_job_hold ('none'), declutter_listing_round_close_offers (no-op), is_caller_banned,
 * declutter_assert_member.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const FILES = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
const THIS = "20261120152652_declutter_haul_away_opt_in.sql";
const MUTANT = process.env.MUTANT ?? "";
const skip = process.env.NEW_MIGRATION === "skip";

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
  // Part A tells every seller again (the owner's bug): the scan and the claim both ignore the choice. (Either one
  // alone still filters, by design: the claim re-checks what the scan read.)
  sweep: ["       AND public.declutter_haul_away_opted_in(i.id)\n", "\n", "         WHERE public.declutter_haul_away_opted_in(x)  -- HAUL-OPT-IN: switched off since the scan, never told\n", "\n"],
  // "One more chance before haul-away." for everyone again.
  free: ["CASE WHEN v_days <= 14 AND public.declutter_haul_away_opted_in(it.id) THEN", "CASE WHEN v_days <= 14 THEN"],
  // The fourth round's "came down" notice offers the Helpr to everyone.
  rounds: ["          CASE WHEN public.declutter_haul_away_opted_in(r.id)\n", "          CASE WHEN true\n"],
  // Anyone's listing.
  owner: ["  SELECT * INTO v_item FROM public.declutter_items WHERE id = p_item_id AND seller_id = v_uid FOR UPDATE;\n  IF NOT FOUND THEN\n    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';\n  END IF;\n  IF v_item.status NOT IN ('draft', 'pending_review', 'live', 'paused', 'ended')",
          "  SELECT * INTO v_item FROM public.declutter_items WHERE id = p_item_id FOR UPDATE;\n  IF NOT FOUND THEN\n    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';\n  END IF;\n  IF v_item.status NOT IN ('draft', 'pending_review', 'live', 'paused', 'ended')"],
  // Turning it on without the haul-away switch.
  feature: ["    PERFORM public.require_feature('declutter_haul_away');\n", ""],
  // The list read returns every seller's opted-in items.
  list: ["   WHERE i.seller_id = v_uid AND p.haul_away_opt_in;", "   WHERE p.haul_away_opt_in;"],
};
let mig = readFileSync(MIG_DIR + THIS, "utf8");
if (MUTANT) {
  const m = MUTANTS[MUTANT];
  if (!m || !mig.includes(m[0])) throw new Error(`mutant ${MUTANT} did not apply`);
  mig = mig.replace(m[0], m[1]);
  if (m[2]) {
    if (!mig.includes(m[2])) throw new Error(`mutant ${MUTANT} part 2 did not apply`);
    mig = mig.replace(m[2], m[3]);
  }
}

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };
const U = (n) => `11111111-0000-0000-0000-${String(n).padStart(12, "0")}`;
const I = (n) => `22222222-0000-0000-0000-${String(n).padStart(12, "0")}`;
const SELLER = U(1), OTHER = U(2), BANNED = U(3), NOHAUL = U(4), SELLER5 = U(5);

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  create table public.profiles (user_id uuid primary key, banned boolean default false);
  create table public.declutter_items (id uuid primary key, seller_id uuid not null, title text not null,
    status text not null default 'live', relist_count smallint not null default 0 check (relist_count between 0 and 3),
    price_cents integer not null default 4000, current_price_cents integer not null default 4000,
    seller_hidden boolean not null default false, live_at timestamptz, submitted_at timestamptz,
    listed_until timestamptz, round_nudged smallint,
    created_at timestamptz not null default now(), updated_at timestamptz default now());
  create table public.declutter_item_private (item_id uuid primary key, seller_id uuid, floor_price_cents integer not null default 0,
    drop_stop_cents integer, auto_free_days smallint, auto_free_day12 boolean not null default false,
    keep_up_until_sold boolean not null default false, updated_at timestamptz default now());
  create table public.declutter_haul_away_notices (item_id uuid primary key, notified_at timestamptz not null default now());
  create table public.declutter_haul_aways (item_id uuid primary key, job_id uuid, prior_status text, updated_at timestamptz default now());
  create table public.declutter_cart_items (item_id uuid, status text);
  create table public.declutter_item_photos (item_id uuid);
  create table public.declutter_offers (id uuid primary key, item_id uuid, buyer_id uuid, status text not null default 'open', closed_at timestamptz, updated_at timestamptz);
  create table public.declutter_offer_events (offer_id uuid, actor_side text, action text);
  create table public.declutter_price_alerts (item_id uuid, user_id uuid, sent_at timestamptz);
  create table public.jobs (id uuid primary key, status text, payment_status text, stripe_session_id text,
    stripe_payment_intent_id text, is_seed boolean default false, updated_at timestamptz default now());
  create table public.gift_cards (job_id uuid, status text);
  create table public.notifications (id bigint generated always as identity primary key, user_id uuid, type text, title text, message text, link text);
  create table public.defects (fn text, ref text);
  create function public.log_cron_defect(p_fn text, p_ref text, p_err text, p_context jsonb default '{}'::jsonb) returns void language sql as $f$ insert into public.defects values (p_fn, p_ref) $f$;
  create function public.declutter_notify(p_user uuid, p_type text, p_title text, p_message text, p_link text, p_other uuid default null)
    returns void language sql as $f$ insert into public.notifications (user_id, type, title, message, link) values (p_user, p_type, p_title, p_message, p_link) $f$;
  create table public.switch_off (user_id uuid, key text);
  create function public.feature_enabled_for_user(p_key text, p_user uuid) returns boolean language sql stable as $f$
    select not exists (select 1 from public.switch_off where user_id = p_user and key = p_key) $f$;
  create function public.require_feature(p_key text) returns void language plpgsql as $f$
  begin if not public.feature_enabled_for_user(p_key, auth.uid()) then raise exception 'feature_disabled' using errcode = '42501'; end if; end $f$;
  create function public.declutter_member_out(p uuid) returns boolean language sql stable as $f$ select false $f$;
  create function public.declutter_haul_job_hold(p uuid) returns text language sql as $f$ select 'none' $f$;
  create function public.declutter_listing_round_close_offers(p_item uuid, p_title text, p_seller uuid) returns void language sql as $f$ select $f$;
  create function public.is_caller_banned() returns boolean language sql stable as $f$ select coalesce((select banned from public.profiles where user_id = auth.uid()), false) $f$;
  create function public.declutter_assert_member(p boolean) returns uuid language plpgsql as $f$
  begin if auth.uid() is null then raise exception 'not_authenticated' using errcode = '42501'; end if; return auth.uid(); end $f$;
  insert into public.profiles (user_id, banned) values ('${SELLER}', false), ('${OTHER}', false), ('${BANNED}', true), ('${NOHAUL}', false), ('${SELLER5}', false);
  insert into public.switch_off values ('${NOHAUL}', 'declutter_haul_away');
`);
await db.exec(newest("declutter_haul_away_sweep_candidates"));
await db.exec(newest("declutter_keeps_up"));
if (skip) {
  for (const fn of ["declutter_haul_away_sweep", "declutter_auto_free_due", "declutter_listing_rounds_sweep"]) await db.exec(newest(fn));
  await db.exec(`alter table public.declutter_item_private add column haul_away_opt_in boolean not null default false;`);
} else {
  for (let i = 0; i < 3; i++) await db.exec(mig); // replay-safe: applied three times
}

async function item(n, o = {}) {
  await db.query(`insert into public.declutter_items (id, seller_id, title, status, live_at, current_price_cents, price_cents)
    values ($1, $2, $3, $4, now() - make_interval(days => $5), $6, $6)`,
    [I(n), o.seller ?? SELLER, `Item ${n}`, o.status ?? "live", o.days ?? 0, o.price ?? 4000]);
  await db.query(`insert into public.declutter_item_private (item_id, seller_id) values ($1, $2)`, [I(n), o.seller ?? SELLER]);
}
const as = async (uid, sql, params = []) => {
  try {
    await db.exec(`set request.jwt.claim.sub = '${uid ?? ""}'`);
    const r = await db.query(sql, params);
    return { ok: true, v: Object.values(r.rows[0] ?? {})[0] };
  } catch (e) {
    return { ok: false, err: e.message };
  } finally {
    await db.exec(`reset request.jwt.claim.sub`);
  }
};
const setOpt = (uid, n, on) => as(uid, `select public.declutter_set_haul_away_opt_in($1, $2)`, [I(n), on]);
const optState = (uid, n) => as(uid, `select public.declutter_haul_away_opt_in_state($1)`, [I(n)]);
const optList = (uid) => as(uid, `select public.declutter_haul_away_opt_ins()`);
const setDirect = (n, on) => db.query(`update public.declutter_item_private set haul_away_opt_in = $2 where item_id = $1`, [I(n), on]);
const notes = async (title, n) => (await db.query(`select message from public.notifications where title = $1 and message like $2`, [title, `%Item ${n}%`])).rows.map((r) => r.message);
const haulNotes = async (uid) => Number((await db.query(`select count(*)::int as n from public.notifications where user_id = $1 and title = 'Haul-away is open'`, [uid])).rows[0].n);

// A. The choice: off by default for every listing, the seller's own, behind the switches.
await item(1, { days: 20 });
check((await optState(SELLER, 1)).v === false, "off by default");
check(JSON.stringify((await optList(SELLER)).v) === "[]", "the seller's list starts empty");
const on = await setOpt(SELLER, 1, true);
check(on.ok && on.v === true && (await optState(SELLER, 1)).v === true, `the seller turns it on (${JSON.stringify(on)})`);
check(JSON.stringify((await optList(SELLER)).v) === JSON.stringify([I(1)]), "and it is in the seller's list");
await item(2, { seller: OTHER, days: 20 });
await setDirect(2, true);
const notMine = await setOpt(SELLER, 2, false);
check(!notMine.ok && /item_not_found/.test(notMine.err), `someone else's listing is refused (${notMine.err})`);
check(!(await optState(SELLER, 2)).ok, "someone else's choice cannot be read");
check((await optList(SELLER)).ok && !String(JSON.stringify((await optList(SELLER)).v)).includes(I(2)), "someone else's opted-in item is not in the seller's list");
await setDirect(2, false);
await item(3, { seller: BANNED });
const ban = await setOpt(BANNED, 3, true);
check(!ban.ok && /account_restricted/.test(ban.err), `a banned caller is refused (${ban.err})`);
await item(4, { seller: NOHAUL });
const noHaul = await setOpt(NOHAUL, 4, true);
check(!noHaul.ok && /feature_disabled/.test(noHaul.err), `turning it on is refused while haul-away is off for the member (${noHaul.err})`);
check((await setOpt(NOHAUL, 4, false)).v === false, "turning it off always works");
check((await optState(NOHAUL, 4)).ok && (await optState(NOHAUL, 4)).v === null, "the state reads NULL (nothing to choose) while haul-away is off for the member");
const anon = await setOpt(null, 1, true);
check(!anon.ok && /not_authenticated/.test(anon.err), `signed out is refused (${anon.err})`);
await item(9, { status: "sold" });
const sold = await setOpt(SELLER, 9, true);
check(!sold.ok && /item_not_editable/.test(sold.err), `a sold item has nothing to choose (${sold.err})`);
const grants = (await db.query(`select p.proname, coalesce(p.proacl::text, '') as acl from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('declutter_haul_away_opted_in', 'declutter_set_haul_away_opt_in', 'declutter_haul_away_opt_in_state', 'declutter_haul_away_opt_ins')`)).rows;
const acl = Object.fromEntries(grants.map((g) => [g.proname, g.acl]));
check(/service_role=X/.test(acl.declutter_haul_away_opted_in ?? "") && !/authenticated=X|anon=X|[{,]=X/.test(acl.declutter_haul_away_opted_in ?? ""),
  `the sweeps' read is service role only (${acl.declutter_haul_away_opted_in})`);
for (const fn of ["declutter_set_haul_away_opt_in", "declutter_haul_away_opt_in_state", "declutter_haul_away_opt_ins"]) {
  check(/authenticated=X/.test(acl[fn] ?? "") && !/anon=X|[{,]=X/.test(acl[fn] ?? ""), `${fn}: members only, never anon or PUBLIC (${acl[fn]})`);
}

// B. The 14-day sweep tells only sellers who opted in; nobody else, and no catch-up.
await item(5, { seller: SELLER5, days: 20 });   // not opted in: the owner's case
await item(6, { days: 20 });                    // the seller's second listing, not opted in
await item(7, { days: 5 });                     // opted in, too soon
await setDirect(7, true);
let r = (await db.query(`select public.declutter_haul_away_sweep() as r`)).rows[0].r;
check((await haulNotes(SELLER5)) === 0, `a seller who did not opt in is never told "Haul-away is open" (${JSON.stringify(r)})`);
const told = (await db.query(`select message from public.notifications where user_id = $1 and title = 'Haul-away is open'`, [SELLER])).rows.map((x) => x.message);
check(told.length === 1 && told[0].includes("Item 1") && !told.some((m) => /2 of your items/.test(m)),
  `the seller who opted in item 1 is told about item 1 only, not item 6 (${JSON.stringify(told)})`);
const marked = (await db.query(`select item_id from public.declutter_haul_away_notices order by item_id`)).rows.map((x) => x.item_id);
check(JSON.stringify(marked) === JSON.stringify([I(1)]), `only the opted-in listing is marked told (${JSON.stringify(marked)})`);
// Opting in later: told on the next run, once.
await setDirect(5, true);
await db.query(`select public.declutter_haul_away_sweep()`);
await db.query(`select public.declutter_haul_away_sweep()`);
check((await haulNotes(SELLER5)) === 1, "a seller who opts in later is told on the next run, once");
check((await haulNotes(SELLER)) === 1, "never twice for the same listing");

// C. Auto-free: "One more chance before haul-away." only for an opted-in listing.
await item(10, { days: 8 });
await item(11, { days: 8 });
await db.query(`update public.declutter_item_private set auto_free_days = 7 where item_id in ($1, $2)`, [I(10), I(11)]);
await setDirect(11, true);
await db.query(`select public.declutter_auto_free_due()`);
const free10 = await notes("Your item is now free", 10);
const free11 = await notes("Your item is now free", 11);
check(free10.length === 1 && !/haul/i.test(free10[0]), `not opted in: the free notice says nothing about haul-away (${JSON.stringify(free10)})`);
check(free11.length === 1 && free11[0].includes("One more chance before haul-away."), `opted in: the haul-away line stays (${JSON.stringify(free11)})`);

// D. Listing rounds: the Helpr-to-donation step only for an opted-in listing.
await item(12, {});
await item(13, {});
await item(14, { price: 0 });
await db.query(`update public.declutter_items set relist_count = 3, listed_until = now() + interval '2 days' where id in ($1, $2, $3)`, [I(12), I(13), I(14)]);
await setDirect(13, true);
await db.query(`select public.declutter_listing_rounds_sweep()`);
const soon12 = await notes("Your listing comes down soon", 12);
const soon13 = await notes("Your listing comes down soon", 13);
const soon14 = await notes("Your listing comes down soon", 14);
check(soon12.length === 1 && !/Helpr|donation/.test(soon12[0]) && /lower the price/i.test(soon12[0]), `not opted in: "comes down soon" offers no Helpr (${JSON.stringify(soon12)})`);
check(soon13.length === 1 && soon13[0].includes("take it to donation"), `opted in: "comes down soon" keeps the Helpr step (${JSON.stringify(soon13)})`);
check(soon14.length === 1 && !/Helpr|donation/.test(soon14[0]), `a free listing, not opted in: no Helpr (${JSON.stringify(soon14)})`);
await db.query(`update public.declutter_items set listed_until = now() - interval '1 minute' where id in ($1, $2)`, [I(12), I(13)]);
await db.query(`select public.declutter_listing_rounds_sweep()`);
const down12 = await notes("Your listing came down", 12);
const down13 = await notes("Your listing came down", 13);
check(down12.length === 1 && !/Helpr|donation/.test(down12[0]), `not opted in: "came down" offers no Helpr (${JSON.stringify(down12)})`);
check(down13.length === 1 && down13[0].includes("take it to donation"), `opted in: "came down" keeps the Helpr step (${JSON.stringify(down13)})`);
check(Number((await db.query(`select count(*)::int as n from public.defects`)).rows[0].n) === 0, "no sender logged a defect");

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
