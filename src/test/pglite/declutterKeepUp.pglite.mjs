#!/usr/bin/env node
/**
 * PGlite proof for 20261029154323_declutter_keep_up_until_sold (owner decision 2026-10-29, pop-up answer:
 * "Keep it up until it sells", a seller switch, off by default).
 *
 *   node src/test/pglite/declutterKeepUp.pglite.mjs                    # after (3x replay)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterKeepUp.pglite.mjs # RED: the migration absent
 *   MUTANT=<name> node src/test/pglite/declutterKeepUp.pglite.mjs      # a planted defect: must FAIL
 *
 * World: the declutter tables the sweep, trigger and switch read (items with the real status set and the
 * relist_count CHECK, private, offers and their events, notifications, profiles), the REAL declutter_notify
 * (newest before this migration: a wrapper over declutter_notify_strict) and the REAL listing-rounds migration
 * (20261028164424) under this one. Stubbed, and said so: declutter_notify_strict (a plain bell-row insert; its
 * wording helpers are not under test here), log_cron_defect (records the call), require_feature (a table of
 * members it is off for), is_caller_banned, declutter_assert_member.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const FILES = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
const THIS = "20261029154323_declutter_keep_up_until_sold.sql";
const ROUNDS = "20261028164424_declutter_listing_rounds.sql";
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
  // The sweep ignores the switch when a round ends (relists and caps as before).
  renew: ["      IF public.declutter_keeps_up(r.id) THEN", "      IF false THEN"],
  // The "ends soon" notice still goes out with the switch on.
  nudge: ["       AND NOT public.declutter_keeps_up(i.id)\n", "\n", "      IF FOUND AND NOT public.declutter_keeps_up(it.id) THEN", "      IF FOUND THEN"],
  // Renewing counts the round (would break the 0..3 CHECK and end it once switched off).
  count: ["           SET listed_until = now() + interval '30 days', round_nudged = NULL, updated_at = now()\n         WHERE id = r.id;\n        v_renewed",
          "           SET relist_count = least(relist_count + 1, 3), listed_until = now() + interval '30 days', round_nudged = NULL, updated_at = now()\n         WHERE id = r.id;\n        v_renewed"],
  // Switching off lets it end at once, with no notice.
  grace: ["  IF v_was AND NOT p_on AND v_item.status = 'live' THEN", "  IF false THEN"],
  // Anyone's listing.
  owner: ["  SELECT * INTO v_item FROM public.declutter_items WHERE id = p_item_id AND seller_id = v_uid FOR UPDATE;",
          "  SELECT * INTO v_item FROM public.declutter_items WHERE id = p_item_id FOR UPDATE;"],
  banned: ["  IF public.is_caller_banned() THEN\n    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';\n  END IF;\n  IF p_on IS NULL THEN",
           "  IF p_on IS NULL THEN"],
  feature: ["  PERFORM public.require_feature('declutter');\n  IF public.is_caller_banned() THEN", "  IF public.is_caller_banned() THEN"],
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
const SELLER = U(1), OTHER = U(2), BANNED = U(3), OFF = U(4);

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth; create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  grant usage on schema auth, public to anon, authenticated, service_role;
  create table public.profiles (user_id uuid primary key, is_seed boolean default false, banned boolean default false);
  create table public.declutter_items (id uuid primary key, seller_id uuid not null, title text not null,
    status text not null default 'draft' check (status in ('draft','pending_review','live','paused','reserved','sold','completed','ended','withdrawn','rejected','removed')),
    relist_count smallint not null default 0 check (relist_count between 0 and 3),
    current_price_cents integer not null default 4000, live_at timestamptz, submitted_at timestamptz,
    created_at timestamptz not null default now(), updated_at timestamptz default now());
  create table public.declutter_item_private (item_id uuid primary key, seller_id uuid, floor_price_cents integer not null default 0, updated_at timestamptz default now());
  create table public.declutter_offers (id uuid primary key, item_id uuid, buyer_id uuid, status text not null default 'open', closed_at timestamptz, updated_at timestamptz);
  create table public.declutter_offer_events (offer_id uuid, actor_side text, action text);
  create table public.notifications (id bigint generated always as identity primary key, user_id uuid, type text, title text, message text, link text);
  create table public.defects (fn text, ref text);
  create function public.log_cron_defect(p_fn text, p_ref text, p_err text, p_context jsonb default '{}'::jsonb) returns void language sql as $f$ insert into public.defects values (p_fn, p_ref) $f$;
  create table public.switch_off (user_id uuid primary key);
  create function public.require_feature(p_key text) returns void language plpgsql as $f$
  begin if exists (select 1 from public.switch_off where user_id = auth.uid()) then raise exception 'feature_disabled' using errcode = '42501'; end if; end $f$;
  create function public.is_caller_banned() returns boolean language sql stable as $f$ select coalesce((select banned from public.profiles where user_id = auth.uid()), false) $f$;
  create function public.declutter_assert_member(p boolean) returns uuid language plpgsql as $f$
  begin if auth.uid() is null then raise exception 'not_authenticated' using errcode = '42501'; end if; return auth.uid(); end $f$;
  insert into auth.users values ('${SELLER}'), ('${OTHER}'), ('${BANNED}'), ('${OFF}');
  insert into public.profiles (user_id, banned) values ('${SELLER}', false), ('${OTHER}', false), ('${BANNED}', true), ('${OFF}', false);
  insert into public.switch_off values ('${OFF}');
`);
await db.exec(newest("declutter_notify"));
await db.exec(`create function public.declutter_notify_strict(p_user uuid, p_type text, p_title text, p_message text, p_link text, p_other uuid default null)
  returns void language sql as $f$ insert into public.notifications (user_id, type, title, message, link) values (p_user, p_type, p_title, p_message, p_link) $f$;`);
await db.exec(readFileSync(MIG_DIR + ROUNDS, "utf8"));
if (!skip) for (let i = 0; i < 3; i++) await db.exec(mig); // replay-safe: applied three times

async function item(n, o = {}) {
  await db.query(`insert into public.declutter_items (id, seller_id, title, status, live_at, current_price_cents) values ($1, $2, $3, $4, now(), $5)`,
    [I(n), o.seller ?? SELLER, o.title ?? `Item ${n}`, o.status ?? "live", o.price ?? 4000]);
  await db.query(`insert into public.declutter_item_private (item_id, seller_id) values ($1, $2)`, [I(n), o.seller ?? SELLER]);
}
const row = async (n) => (await db.query(`select status, relist_count, listed_until, round_nudged,
  extract(epoch from (listed_until - now()))/86400 as days_left from public.declutter_items where id = $1`, [I(n)])).rows[0];
const sweep = async () => (await db.query(`select public.declutter_listing_rounds_sweep() as r`).catch((e) => ({ rows: [{ r: { error: e.message } }] }))).rows[0].r;
const notesFor = async (n) => Number((await db.query(`select count(*)::int as n from public.notifications where message like $1`, [`%Item ${n}%`])).rows[0].n);
const setUntil = (n, sql) => db.query(`update public.declutter_items set listed_until = ${sql} where id = $1`, [I(n)]);
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
const setKeep = (uid, n, on) => as(uid, `select public.declutter_set_keep_up($1, $2)`, [I(n), on]);
const keepState = (uid, n) => as(uid, `select public.declutter_keep_up_state($1)`, [I(n)]);

// A. Off by default; the seller's own switch.
await item(1);
check((await keepState(SELLER, 1)).v === false, "off by default");
const on = await setKeep(SELLER, 1, true);
check(on.ok && on.v === true && (await keepState(SELLER, 1)).v === true, `the seller turns it on (${JSON.stringify(on)})`);
// Refusals: not the seller, banned, the Declutter switch off, signed out, an item that is not editable.
await item(2, { seller: OTHER });
const notMine = await setKeep(SELLER, 2, true);
check(!notMine.ok && /item_not_found/.test(notMine.err) && (await keepState(OTHER, 2)).v === false, `someone else's listing is refused and unchanged (${notMine.err})`);
check(!(await keepState(SELLER, 2)).ok, "someone else's switch cannot be read");
await item(3, { seller: BANNED });
const ban = await setKeep(BANNED, 3, true);
check(!ban.ok && /account_restricted/.test(ban.err), `a banned caller is refused (${ban.err})`);
await item(4, { seller: OFF });
const off = await setKeep(OFF, 4, true);
check(!off.ok && /feature_disabled/.test(off.err), `refused while Declutter is off for the caller (${off.err})`);
check(!(await keepState(OFF, 4)).ok, "the state read is behind the switch too");
const anon = await setKeep(null, 1, true);
check(!anon.ok && /not_authenticated/.test(anon.err), `signed out is refused (${anon.err})`);
await item(5, { status: "sold" });
const sold = await setKeep(SELLER, 5, true);
check(!sold.ok && /item_not_editable/.test(sold.err), `a sold item has nothing to switch (${sold.err})`);
await item(6, { price: 0, title: "Item 6" });
check((await setKeep(SELLER, 6, true)).v === true, "a free listing can keep it up too (free items run in the same rounds)");

// B. With it ON: no "ends soon" notice, and a round renews every 30 days with no cap and no notice.
await setUntil(1, "now() + interval '2 days'");
let s = await sweep();
check((await notesFor(1)) === 0 && (await row(1)).round_nudged === null, `no "ends soon" notice with the switch on (${JSON.stringify(s)})`);
for (let k = 1; k <= 5; k++) {
  await setUntil(1, "now() - interval '1 minute'");
  s = await sweep();
  const r = await row(1);
  if (k === 5) check(r.status === "live" && r.relist_count === 0 && Number(r.days_left) > 29.9 && s.renewed >= 1,
    `5 rounds ended with it on: still live, renewed for 30 more days each time, relist_count untouched (${JSON.stringify(r)}, ${JSON.stringify(s)})`);
}
check((await notesFor(1)) === 0, "no \"back up\" notice at any renewal");
// Past the normal cap: a listing at relist_count 3 with it on is renewed, not ended.
await item(7);
await db.query(`update public.declutter_items set relist_count = 3 where id = $1`, [I(7)]);
await setKeep(SELLER, 7, true);
await setUntil(7, "now() - interval '1 minute'");
await sweep();
check((await row(7)).status === "live" && Number((await row(7)).days_left) > 29.9, "at relist_count 3 with it on: renewed, never ended");

// C. Off behaves exactly as before (a control listing beside them).
await item(8);
await setUntil(8, "now() - interval '1 minute'");
s = await sweep();
check((await row(8)).relist_count === 1 && (await notesFor(8)) === 1, `with it off: the normal relist, counted and told (${JSON.stringify(await row(8))})`);

// D. Turning it off mid-way: picks up the normal rules from relist_count, never ends sooner than 3 days, notice due.
await setUntil(7, "now() + interval '1 hour'");
const offNow = await setKeep(SELLER, 7, false);
const r7 = await row(7);
check(offNow.ok && r7.round_nudged === null && Number(r7.days_left) > 2.9 && Number(r7.days_left) < 3.1,
  `switched off an hour before its round ended: the end moves to 3 days from now (${JSON.stringify(r7)})`);
await db.exec(`select pg_sleep(0.01)`);
s = await sweep();
const comesDown = Number((await db.query(`select count(*)::int as n from public.notifications where title = 'Your listing comes down soon' and message like '%Item 7%'`)).rows[0].n);
check(comesDown === 1, `the seller gets the "comes down soon" notice for its last round (${JSON.stringify(s)})`);
await setUntil(7, "now() - interval '1 minute'");
await sweep();
check((await row(7)).status === "ended", "and at relist_count 3 it then comes down as the normal rules say");
// A round far away is not shortened.
await setUntil(1, "now() + interval '20 days'");
await setKeep(SELLER, 1, false);
check(Number((await row(1)).days_left) > 19.9, "switching off with 20 days left keeps the 20 days");
await setUntil(1, "now() - interval '1 minute'");
await sweep();
check((await row(1)).relist_count === 1, "and the next round is the first normal relist (from relist_count 0)");
// Turning off a switch that was already off changes nothing.
await setUntil(8, "now() + interval '1 hour'");
await setKeep(SELLER, 8, false);
check(Number((await row(8)).days_left) < 0.1, "turning off an already-off switch does not move the round");
// Turning it off is never refused for a seller who can no longer sell (the member gate is only for ON).
await db.exec(`create or replace function public.declutter_assert_member(p boolean) returns uuid language plpgsql as $f$ begin raise exception 'declutter_strikes_blocked' using errcode = '42501'; end $f$;`);
check((await setKeep(SELLER, 6, true)).ok === false, "a seller who can no longer sell cannot turn it on");
check((await setKeep(SELLER, 6, false)).ok === true, "but can still turn it off");

const acl = (await db.query(`select proname, proacl::text as a from pg_proc where proname in ('declutter_set_keep_up', 'declutter_keep_up_state', 'declutter_keeps_up', 'declutter_listing_rounds_sweep')`)).rows;
const by = Object.fromEntries(acl.map((x) => [x.proname, x.a ?? ""]));
check(acl.length === 4, `all four functions exist (${acl.length})`);
check(!/anon=X|(^|[{,])=X/.test(by.declutter_set_keep_up ?? "x=X") && /authenticated=X/.test(by.declutter_set_keep_up ?? ""), `set: signed-in only, never anon or PUBLIC (${by.declutter_set_keep_up})`);
check(!/anon=X|(^|[{,])=X/.test(by.declutter_keep_up_state ?? "x=X") && /authenticated=X/.test(by.declutter_keep_up_state ?? ""), `state: signed-in only (${by.declutter_keep_up_state})`);
check(!/authenticated=X|anon=X|(^|[{,])=X/.test(by.declutter_keeps_up ?? "x=X"), `the sweep's read: no client privilege (${by.declutter_keeps_up})`);
check(!/authenticated=X|anon=X|(^|[{,])=X/.test(by.declutter_listing_rounds_sweep ?? "x=X"), `sweep: service role only (${by.declutter_listing_rounds_sweep})`);

console.log(failures ? `\n${failures} FAIL` : "\nall PASS");
process.exit(failures ? 1 : 0);
