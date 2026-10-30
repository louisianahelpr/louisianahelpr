#!/usr/bin/env node
/**
 * PGlite proof for 20261030030408_declutter_auto_free_days (OWN-FREE: "If it doesn't sell, make it free
 * after __ days": Never (default), 7, 14, 21, 30; day-12 listings move to 14; every sale mode).
 *
 *   node src/test/pglite/declutterAutoFreeDays.pglite.mjs                       # after (3x replay)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterAutoFreeDays.pglite.mjs    # prod today: must FAIL
 *   MUTANT=<name> node src/test/pglite/declutterAutoFreeDays.pglite.mjs         # a planted defect: must FAIL
 *
 * World: the fixture of src/test/pglite/declutterAutoFree.pglite.mjs (the Declutter tables the functions
 * read, the REAL declutter_notify, the Q2429 alerts migration 20261027204745, then the day-12 migration
 * 20261027205327 verbatim: prod's effective bodies of all four functions, md5-checked 2026-10-30), then this
 * migration. Stubbed, and said so: require_feature (a table of members it is off for), is_caller_banned,
 * declutter_assert_member, are_users_blocked, net.http_post and vault.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const FILES = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
const THIS = "20261030030408_declutter_auto_free_days.sql";
const DAY12 = "20261027205327_declutter_auto_free_day12.sql";
const ALERTS = "20261027204745_declutter_price_drop_alerts.sql";
const NEW = process.env.NEW_MIGRATION !== "skip";
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
  // The day count is ignored: the fixed 12 days, in the loop's filter AND the claim's re-read (either one alone still
  // holds the line, measured 2026-10-30: dropping only the filter left every check green).
  days: ["make_interval(days => p.auto_free_days) <= now()", "interval '12 days' <= now()",
         "make_interval(days => v_days) > now()", "interval '12 days' > now()"],
  // Only offers listings, as before (lead decision 3 says every sale mode).
  mode: ["       AND NOT i.seller_hidden\n       AND i.current_price_cents > 0", "       AND NOT i.seller_hidden\n       AND i.sale_mode = 'offers'\n       AND i.current_price_cents > 0"],
  // Day 12 maps to Never instead of 14.
  backfill: ["   SET auto_free_days = COALESCE(auto_free_days, 14), auto_free_day12 = false, updated_at = now()\n WHERE auto_free_day12;",
             "   SET auto_free_day12 = false, updated_at = now()\n WHERE auto_free_day12;"],
  // The backfill keeps the old flag, so a replay re-moves a row the seller set to Never.
  replay: ["   SET auto_free_days = COALESCE(auto_free_days, 14), auto_free_day12 = false, updated_at = now()\n WHERE auto_free_day12;",
           "   SET auto_free_days = 14, updated_at = now()\n WHERE auto_free_day12;"],
  // Any day count is accepted.
  choice: ["  IF p_days IS NOT NULL AND p_days NOT IN (7, 14, 21, 30) THEN", "  IF false THEN"],
  // Another member's listing.
  owner: ["  SELECT * INTO v_item FROM public.declutter_items WHERE id = p_item_id AND seller_id = v_uid FOR UPDATE;\n  IF NOT FOUND THEN\n    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';\n  END IF;\n  IF v_item.status NOT IN ('draft', 'pending_review', 'live', 'paused') THEN\n    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023';\n  END IF;\n  IF v_item.current_price_cents = 0 THEN\n    RAISE EXCEPTION 'already_free' USING ERRCODE = '22023', HINT = 'This item is already free.';\n  END IF;\n  UPDATE public.declutter_item_private SET auto_free_days = p_days",
          "  SELECT * INTO v_item FROM public.declutter_items WHERE id = p_item_id FOR UPDATE;\n  IF NOT FOUND THEN\n    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';\n  END IF;\n  IF v_item.status NOT IN ('draft', 'pending_review', 'live', 'paused') THEN\n    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023';\n  END IF;\n  IF v_item.current_price_cents = 0 THEN\n    RAISE EXCEPTION 'already_free' USING ERRCODE = '22023', HINT = 'This item is already free.';\n  END IF;\n  UPDATE public.declutter_item_private SET auto_free_days = p_days"],
  // The old switch's ON overwrites a chosen 21 with 14.
  shim: ["     SET auto_free_days = CASE WHEN p_on THEN COALESCE(auto_free_days, 14) END,", "     SET auto_free_days = CASE WHEN p_on THEN 14 END,"],
  // The seller's notice keeps the fixed 12.
  notice: ["didn''t sell in %s days, so it is now free, as you asked.%s', it.title, v_days,", "didn''t sell in 12 days, so it is now free, as you asked.%s', it.title,"],
  // The claim does not re-read the day count (a seller's later Never is overwritten by the stale snapshot).
  claim: ["      CONTINUE WHEN v_days IS NULL OR it.started + make_interval(days => v_days) > now();\n", ""],
};
let mig = readFileSync(MIG_DIR + THIS, "utf8");
if (MUTANT) {
  const m = MUTANTS[MUTANT];
  if (!m) throw new Error(`mutant ${MUTANT} unknown`);
  for (let k = 0; k < m.length; k += 2) {
    if (!mig.includes(m[k])) throw new Error(`mutant ${MUTANT} did not apply`);
    mig = mig.replace(m[k], m[k + 1]);
  }
}

let pass = 0, failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (ok) pass++; else failures++; };
const U = (n) => `11111111-0000-0000-0000-${String(n).padStart(12, "0")}`;
const I = (n) => `22222222-0000-0000-0000-${String(n).padStart(12, "0")}`;
const SELLER = U(1), BUYER = U(2), WATCHER = U(3), OTHER = U(4), BANNED = U(5), OFF = U(6);

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
await db.exec(newest("declutter_notify", ALERTS));
await db.exec(readFileSync(MIG_DIR + ALERTS, "utf8"));
await db.exec(readFileSync(MIG_DIR + DAY12, "utf8")); // prod's effective auto-free bodies (md5-checked 2026-10-30)

const users = [SELLER, BUYER, WATCHER, OTHER, BANNED, OFF];
await db.exec(`insert into auth.users values ${users.map((u) => `('${u}')`).join(",")};
  insert into public.profiles (user_id, banned) values ${users.map((u) => `('${u}', ${u === BANNED})`).join(",")};
  insert into public.switch_off values ('${OFF}');`);
async function item(n, o = {}) {
  await db.query(`insert into public.declutter_items (id, seller_id, title, price_cents, current_price_cents, status, live_at, sale_mode) values ($1, $2, $3, $4, $4, $5, now() - make_interval(days => $6), $7)`,
    [I(n), o.seller ?? SELLER, o.title ?? `Item ${n}`, o.price ?? 5000, o.status ?? "live", o.days ?? 13, o.mode ?? "offers"]);
  await db.query(`insert into public.declutter_item_private (item_id, seller_id, floor_price_cents, drop_stop_cents) values ($1, $2, $3, $4)`, [I(n), o.seller ?? SELLER, o.floor ?? 4000, 4500]);
}
async function as(uid, sql, params = []) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ""}', false)`);
  try { return { ok: true, rows: (await db.query(sql, params)).rows }; } catch (e) { return { ok: false, code: String(e.message) }; }
}
const setDays = (uid, n, d) => as(uid, `select public.declutter_set_auto_free_days($1, $2) as r`, [I(n), d]);
const days = async (n) => {
  try { return (await db.query(`select auto_free_days as d from public.declutter_item_private where item_id = $1`, [I(n)])).rows[0].d; } catch { return "no column"; }
};
const price = async (n) => (await db.query(`select current_price_cents as c from public.declutter_items where id = $1`, [I(n)])).rows[0].c;

// --- Backfill: listings that exist before the migration, day 12 on and off.
await item(1, { title: "Day-12 on", days: 3 });
await item(2, { title: "Day-12 off", days: 3 });
await db.exec(`update public.declutter_item_private set auto_free_day12 = true where item_id = '${I(1)}'`);
if (NEW) await db.exec(mig);
check((await days(1)) === 14, `[backfill] "Free on day 12" ON moves to 14 days (${await days(1)})`);
check((await days(2)) === null, "[backfill] OFF stays Never");
const day12Left = (await db.query(`select count(*)::int as n from public.declutter_item_private where auto_free_day12`)).rows[0].n;
check(NEW && day12Left === 0, `[backfill] nothing keeps the retired day-12 flag (${day12Left} left)`);
// The seller sets the moved listing to Never; replaying the migration must not move it back.
const never1 = await setDays(SELLER, 1, null);
check(never1.ok && never1.rows[0].r === null, `[choice] the seller chooses Never${never1.ok ? "" : ` (${never1.code})`}`);
if (NEW) { await db.exec(mig); await db.exec(mig); } // replay-safe: applied three times in all
check(NEW && (await days(1)) === null, `[replay] a replay never moves a seller's Never back to 14 (${await days(1)})`);

// --- New listings default to Never.
await item(3, { title: "New" });
check(NEW && (await days(3)) === null, "[default] a new listing is Never");

// --- The seller's choice.
const seven = await setDays(SELLER, 3, 7);
check(seven.ok && seven.rows[0].r === 7 && (await days(3)) === 7, `[choice] the seller chooses 7 days${seven.ok ? "" : ` (${seven.code})`}`);
for (const d of [14, 21, 30]) {
  const r = await setDays(SELLER, 3, d);
  check(r.ok && (await days(3)) === d, `[choice] ${d} days is a choice`);
}
for (const d of [12, 0, 5, 60]) {
  const r = await setDays(SELLER, 3, d);
  check(!r.ok && /invalid_choice/.test(r.code), `[choice] ${d} days is refused (${r.ok ? "accepted" : r.code})`);
}
let direct = "accepted";
try { await db.exec(`update public.declutter_item_private set auto_free_days = 12 where item_id = '${I(3)}'`); } catch (e) { direct = String(e.message); }
check(/declutter_item_private_auto_free_days_choice/.test(direct), `[data] the column holds only 7, 14, 21 or 30 (${direct.slice(0, 80)})`);
await item(5, { title: "Other's", seller: OTHER });
const notMine = await setDays(SELLER, 5, 7);
check(!notMine.ok && /item_not_found/.test(notMine.code), "[owner] never on another member's listing");
const banned = await setDays(BANNED, 3, 7);
check(!banned.ok && /account_restricted/.test(banned.code), "[gate] a banned member is refused");
const off = await setDays(OFF, 3, 7);
check(!off.ok && /feature_disabled/.test(off.code), "[feature] the member switch is checked first");
const state = await as(SELLER, `select public.declutter_auto_free_days_state($1) as r`, [I(3)]);
check(state.ok && state.rows[0].r === 30, `[state] the seller reads their day count (${state.ok ? state.rows[0].r : state.code})`);
const peek = await as(BUYER, `select public.declutter_auto_free_days_state($1) as r`, [I(3)]);
check(!peek.ok && /item_not_found/.test(peek.code), "[owner] nobody else reads it");

// --- The old switch (app builds already installed).
await setDays(SELLER, 3, 21);
const oldOn = await as(SELLER, `select public.declutter_set_auto_free($1, true) as r`, [I(3)]);
check(oldOn.ok && (await days(3)) === 21, `[old app] the old switch's ON keeps a chosen 21 days (${await days(3)})`);
const oldOff = await as(SELLER, `select public.declutter_set_auto_free($1, false) as r`, [I(3)]);
check(oldOff.ok && (await days(3)) === null, "[old app] the old switch's OFF is Never");
const oldOn2 = await as(SELLER, `select public.declutter_set_auto_free($1, true) as r`, [I(3)]);
check(oldOn2.ok && (await days(3)) === 14, `[old app] the old switch's ON from Never is 14 days (${await days(3)})`);
const oldState = await as(SELLER, `select public.declutter_auto_free_state($1) as r`, [I(3)]);
check(oldState.ok && oldState.rows[0].r === true, "[old app] the old switch reads ON while a day count is chosen");
await setDays(SELLER, 3, null);
const oldState2 = await as(SELLER, `select public.declutter_auto_free_state($1) as r`, [I(3)]);
check(oldState2.ok && oldState2.rows[0].r === false, "[old app] and OFF for Never");

// --- The evening sweep.
await item(10, { title: "Seven days", days: 8 });            // 7 days, live 8: free
await item(11, { title: "Thirty days", days: 13 });          // 30 days, live 13: not yet
await item(12, { title: "Auction", days: 15, mode: "auction" }); // 14 days, live 15, auction: free (every sale mode)
await item(13, { title: "Never", days: 40 });                // Never: never free
await item(14, { title: "Reserved", days: 40, status: "reserved" }); // 7 days but reserved: never free
await item(15, { title: "Hidden", days: 40 });               // 7 days but the seller is hidden: never free
await item(16, { title: "Twenty-one", days: 22 });           // 21 days, live 22: free, no haul-away line
await item(17, { title: "Broken", days: 40 });               // 7 days, fails: stays, logged
for (const [n, d] of [[10, 7], [11, 30], [12, 14], [14, 7], [15, 7], [16, 21], [17, 7]]) {
  try { await db.query(`update public.declutter_item_private set auto_free_days = $2 where item_id = $1`, [I(n), d]); } catch { /* skip: no column without the migration */ }
}
await db.exec(`update public.declutter_items set seller_hidden = true where id = '${I(15)}';
  insert into public.declutter_watchlist (user_id, item_id) values ('${WATCHER}', '${I(10)}');
  insert into public.declutter_offers (id, item_id, buyer_id) values ('33333333-0000-0000-0000-000000000001', '${I(10)}', '${BUYER}');
  create function public.zz_fail_item() returns trigger language plpgsql as $f$ begin if new.id = '${I(17)}' and new.current_price_cents = 0 then raise exception 'boom'; end if; return new; end $f$;
  create trigger zz_fail_item before update on public.declutter_items for each row execute function public.zz_fail_item()`);
await db.exec(`select set_config('request.jwt.claim.sub', '', false)`);
await db.exec(`select public.declutter_price_drop_sweep()`);
check((await price(10)) === 0 && (await days(10)) === null, "[free] 7 days chosen, live 8 days: free tonight, and the choice resets");
check((await price(11)) > 0, "[days] 30 days chosen, live 13 days: not yet");
check((await price(12)) === 0, "[mode] an auction listing is made free too (every sale mode)");
check((await price(13)) > 0, "[opt-in] Never is never made free, however long it is up");
check((await price(14)) === 5000, "[live] a reserved item is never made free");
check((await price(15)) > 0, "[hidden] a hidden seller's listing is never made free");
check((await price(16)) === 0, "[free] 21 days chosen, live 22 days: free");
check((await price(17)) > 0 && (await days(17)) === 7, "[isolation] an item that fails stays as it was (its day count too)");
check((await db.query(`select count(*)::int as n from public.defects where fn = 'declutter_auto_free_due' and ref = $1`, [I(17)])).rows[0].n === 1, "[isolation] the failure is logged where ops sees it");
const offers = (await db.query(`select status from public.declutter_offers where item_id = $1`, [I(10)])).rows;
check(offers.length === 1 && offers[0].status === "voided", "[offers] its open offers close");
const buyerNote = (await db.query(`select message from public.notifications where user_id = $1`, [BUYER])).rows;
check(buyerNote.some((n) => /"Seven days" is now free, so your offer is closed/.test(n.message)), "[offers] the buyer is told");
const sellerNotes = (await db.query(`select message from public.notifications where user_id = $1 order by id`, [SELLER])).rows.map((r) => r.message);
check(sellerNotes.includes(`"Seven days" didn't sell in 7 days, so it is now free, as you asked. One more chance before haul-away.`), `[notice] the seller is told the listing's own day count (${JSON.stringify(sellerNotes.find((m) => /Seven days/.test(m)))})`);
check(sellerNotes.includes(`"Twenty-one" didn't sell in 21 days, so it is now free, as you asked.`), `[notice] after day 14 it does not promise a haul-away still to come (${JSON.stringify(sellerNotes.find((m) => /Twenty-one/.test(m)))})`);

// --- The claim re-reads the day count under the lock: the loop's snapshot says due, the row now says Never.
// Stand-in for a seller who chose Never while the sweep waited on the item lock: item 6 (ordered before 18,
// both due) closes an offer, and a statement trigger on that close sets 18 to Never after the loop's query
// read it as 7 days.
await item(6, { title: "Goes first", days: 40 });
await item(18, { title: "Changed mind", days: 40 });
for (const n of [6, 18]) {
  try { await db.query(`update public.declutter_item_private set auto_free_days = 7 where item_id = $1`, [I(n)]); } catch { /* no column */ }
}
await db.exec(`create function public.zz_change_mind() returns trigger language plpgsql as $f$
  begin update public.declutter_item_private set auto_free_days = null where item_id = '${I(18)}'; return null; end $f$;
  create trigger zz_change_mind after update on public.declutter_offers for each statement execute function public.zz_change_mind();
  insert into public.declutter_offers (id, item_id, buyer_id) values ('33333333-0000-0000-0000-000000000006', '${I(6)}', '${BUYER}')`);
await db.exec(`select public.declutter_auto_free_due()`);
check((await price(6)) === 0, "[claim] the item before it is made free (the stand-in ran)");
check((await price(18)) > 0, "[claim] a seller who chose Never while the sweep was running is respected");

const acl = (await db.query(`select proname, coalesce(proacl::text, '') as a from pg_proc where proname in ('declutter_set_auto_free_days','declutter_auto_free_days_state','declutter_set_auto_free','declutter_auto_free_state','declutter_auto_free_due') order by 1`)).rows;
const aclOf = Object.fromEntries(acl.map((r) => [r.proname, r.a]));
check(/service_role=X/.test(aclOf.declutter_auto_free_due ?? "") && !/authenticated=X|anon=X/.test(aclOf.declutter_auto_free_due ?? ""), `[grants] the sweep step is service-role only (${aclOf.declutter_auto_free_due})`);
for (const fn of ["declutter_set_auto_free_days", "declutter_auto_free_days_state", "declutter_set_auto_free", "declutter_auto_free_state"]) {
  const a = aclOf[fn] ?? "";
  check(/authenticated=X/.test(a) && !/anon=X/.test(a) && !/(^|[{,])=X/.test(a), `[grants] ${fn}: authenticated, not anon or PUBLIC (${a || "missing"})`);
}

const label = MUTANT ? `MUTANT=${MUTANT}: expected FAIL` : NEW ? "WITH the migration (3x)" : "PROD's definitions (NEW_MIGRATION=skip): expected FAIL";
console.log(`\n${label}: ${pass} pass, ${failures} fail`);
process.exit(failures === 0 ? 0 : 1);
