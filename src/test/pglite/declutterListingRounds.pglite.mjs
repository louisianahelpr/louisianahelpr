#!/usr/bin/env node
/**
 * PGlite proof for 20261028164424_declutter_listing_rounds (owner decision 2026-10-28 on Q2461 / #3728:
 * "30 days per round": up 30 days, relisted by itself up to 3 more times, a notice before each round ends,
 * then off sale with the next step offered).
 *
 *   node src/test/pglite/declutterListingRounds.pglite.mjs                    # after (3x replay)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterListingRounds.pglite.mjs # RED: the migration absent
 *   MUTANT=<name> node src/test/pglite/declutterListingRounds.pglite.mjs      # a planted defect: must FAIL
 *
 * World: the declutter tables the sweep and trigger read (items with the real status set and the
 * relist_count CHECK, offers and their events, notifications, profiles), the REAL declutter_notify
 * (newest before this migration). Stubbed, and said so: log_cron_defect (records the call).
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const FILES = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
const THIS = "20261028164424_declutter_listing_rounds.sql";
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
  cap: ["      IF r.relist_count < 3 THEN", "      IF r.relist_count < 4 THEN"],
  // Both once-per-round walls (the scan's filter and the claiming UPDATE's) removed together: each alone holds.
  // (The re-read's status = 'live' under the row lock guards a race between scan and lock; one session cannot plant it.)
  nudgeOnce: ["       AND i.round_nudged IS DISTINCT FROM i.relist_count\n", "\n",
    "       WHERE i.id = it.id AND i.status = 'live' AND i.round_nudged IS DISTINCT FROM it.relist_count\n", "       WHERE i.id = it.id AND i.status = 'live'\n"],
  offers: ["        PERFORM public.declutter_listing_round_close_offers(r.id, r.title, r.seller_id);\n", ""],
  stamp: ["    NEW.listed_until := now() + interval '30 days';", "    NULL;"],
  isolate: ["    EXCEPTION WHEN OTHERS THEN\n      v_errors := v_errors + 1;\n      RAISE WARNING 'declutter_listing_rounds_sweep: item % not moved: %', it.id, SQLERRM;\n      PERFORM public.log_cron_defect('declutter_listing_rounds_sweep', it.id::text, SQLERRM, '{}'::jsonb);\n", ""],
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
const SELLER = U(1), BUYER = U(2);

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth; create table auth.users (id uuid primary key);
  grant usage on schema auth, public to anon, authenticated, service_role;
  create table public.profiles (user_id uuid primary key, is_seed boolean default false);
  create table public.declutter_items (id uuid primary key, seller_id uuid not null, title text not null,
    status text not null default 'draft' check (status in ('draft','pending_review','live','paused','reserved','sold','completed','ended','withdrawn','rejected','removed')),
    relist_count smallint not null default 0 check (relist_count between 0 and 3),
    current_price_cents integer not null default 4000, live_at timestamptz, submitted_at timestamptz,
    created_at timestamptz not null default now(), updated_at timestamptz default now());
  create table public.declutter_offers (id uuid primary key, item_id uuid, buyer_id uuid, status text not null default 'open', closed_at timestamptz, updated_at timestamptz);
  create table public.declutter_offer_events (offer_id uuid, actor_side text, action text);
  create table public.notifications (id bigint generated always as identity primary key, user_id uuid, type text, title text, message text, link text);
  create table public.defects (fn text, ref text);
  create function public.log_cron_defect(p_fn text, p_ref text, p_err text, p_context jsonb default '{}'::jsonb) returns void language sql as $f$ insert into public.defects values (p_fn, p_ref) $f$;
  insert into auth.users values ('${SELLER}'), ('${BUYER}');
  insert into public.profiles (user_id) values ('${SELLER}'), ('${BUYER}');
`);
await db.exec(newest("declutter_notify"));
// A listing already live before the migration (the backfill's case).
await db.exec(`insert into public.declutter_items (id, seller_id, title, status, live_at) values ('${I(9)}', '${SELLER}', 'Old lamp', 'live', now() - interval '40 days')`);
if (!skip) for (let i = 0; i < 3; i++) await db.exec(mig); // replay-safe: applied three times

const row = async (n) => (await db.query(`select status, relist_count, listed_until, round_nudged,
  extract(epoch from (listed_until - now()))/86400 as days_left from public.declutter_items where id = $1`, [I(n)]).catch((e) => ({ rows: [{ error: e.message }] }))).rows[0];
const sweep = async () => (await db.query(`select public.declutter_listing_rounds_sweep() as r`).catch((e) => ({ rows: [{ r: { error: e.message } }] }))).rows[0].r;
const notes = async (title) => Number((await db.query(`select count(*)::int as n from public.notifications where title = $1`, [title])).rows[0].n);
const setUntil = (n, sql) => db.query(`update public.declutter_items set listed_until = ${sql} where id = $1`, [I(n)])
  .catch((e) => { failures++; console.log(`FAIL  set listed_until: ${e.message}`); });

// A. The backfill: a listing live 40 days gets a round that ends no sooner than 3 days from now.
const old = await row(9);
check(old?.listed_until && Number(old.days_left) > 2.9 && Number(old.days_left) < 3.1, `backfill: a 40-day-old live listing ends in 3 days, not at once (days_left ${old?.days_left})`);

// B. Going live stamps a 30-day round (publish = draft -> live), without restating any RPC.
await db.exec(`insert into public.declutter_items (id, seller_id, title) values ('${I(1)}', '${SELLER}', 'Oak dresser')`);
check((await row(1)).listed_until === null, "a draft has no round");
await db.query(`update public.declutter_items set status = 'live', live_at = now() where id = $1`, [I(1)]);
const r1 = await row(1);
check(Number(r1.days_left) > 29.9 && Number(r1.days_left) < 30.1, `publishing starts a 30-day round (days_left ${r1.days_left})`);

// C. The "ends soon" notice: once per round, 3 days ahead.
await setUntil(1, "now() + interval '2 days'");
let s = await sweep();
check(s.nudged === 2 && (await row(1)).round_nudged === 0 && (await notes("Your listing goes back up soon")) === 2, `2 days left (and the backfilled one at 3): each seller told once (${JSON.stringify(s)})`);
s = await sweep();
check(s.nudged === 0, "the next hourly run does not tell them again");

// D. Round ends: relisted, counted, told; up to 3 times.
for (let k = 1; k <= 3; k++) {
  await setUntil(1, "now() - interval '1 minute'");
  s = await sweep();
  const r = await row(1);
  check(r.status === "live" && r.relist_count === k && Number(r.days_left) > 29.9 && r.round_nudged === null,
    `round ${k} ended: back up for 30 more days, relist_count ${k} (${JSON.stringify(r)})`);
}
check((await notes("Back up for another 30 days")) === 3, "the seller is told at each of the 3 relists");
// The last round's notice says it comes down.
await setUntil(1, "now() + interval '1 day'");
await sweep();
check((await notes("Your listing comes down soon")) === 1, "before the last round ends the seller is told it comes down");

// E. After the 4th round: off sale ('ended'), open offers closed (buyer told), seller offered the next step.
await db.exec(`insert into public.declutter_offers (id, item_id, buyer_id) values ('33333333-0000-0000-0000-000000000001', '${I(1)}', '${BUYER}')`);
await setUntil(1, "now() - interval '1 minute'");
s = await sweep();
const end = await row(1);
check(end.status === "ended" && end.relist_count === 3, `after 4 rounds it comes off sale (${JSON.stringify(end)}, ${JSON.stringify(s)})`);
const offer = (await db.query(`select status from public.declutter_offers where item_id = $1`, [I(1)])).rows[0];
check(offer.status === "voided", "its open offer is closed");
check((await notes("Item came down")) === 1, "the buyer is told (nothing was charged)");
check((await notes("Your listing came down")) === 1, "the seller is told the next step (donate or give away)");

// F. Never under a buyer: a reserved or paused listing past its round is left alone.
await db.exec(`insert into public.declutter_items (id, seller_id, title, status, live_at) values ('${I(2)}', '${SELLER}', 'Rug', 'live', now()), ('${I(3)}', '${SELLER}', 'Chair', 'live', now())`);
await db.query(`update public.declutter_items set status = 'reserved' where id = $1`, [I(2)]);
await db.query(`update public.declutter_items set status = 'paused' where id = $1`, [I(3)]);
await setUntil(2, "now() - interval '1 minute'"); await setUntil(3, "now() - interval '1 minute'");
await sweep();
check((await row(2)).status === "reserved" && (await row(2)).relist_count === 0, "a reserved listing is never relisted or ended");
check((await row(3)).status === "paused" && (await row(3)).relist_count === 0, "a paused listing is left alone");
// Back on sale after its round ran out: a fresh round, not a counted relist.
await db.query(`update public.declutter_items set status = 'live' where id = $1`, [I(3)]);
const back = await row(3);
check(back.relist_count === 0 && Number(back.days_left) > 29.9, "back on sale after a pause past its round: a new 30-day round, not counted");

// F2. A free item's notices never say "lower the price" (there is none), and no notice offers a step that
// does not exist for an ended item (a free giveaway): review 2026-10-28 #1.
await db.exec(`insert into public.declutter_items (id, seller_id, title, status, live_at, current_price_cents) values ('${I(6)}', '${SELLER}', 'Free crib mattress', 'live', now(), 0)`);
await setUntil(6, "now() + interval '1 day'");
await sweep();
const freeNote = (await db.query(`select message from public.notifications where message like '%Free crib mattress%' order by id desc limit 1`)).rows[0]?.message ?? "";
check(/No one has claimed/.test(freeNote) && !/lower the price/i.test(freeNote), `a free item's reminder never says lower the price (${freeNote})`);
const anyGiveaway = Number((await db.query(`select count(*)::int as n from public.notifications where message ilike '%give it away%'`)).rows[0].n);
check(anyGiveaway === 0, "no notice offers a giveaway for an ended item (not built)");

// G. One bad item does not stop the run.
await db.exec(`insert into public.declutter_items (id, seller_id, title, status, live_at) values ('${I(4)}', '${SELLER}', 'Broken', 'live', now()), ('${I(5)}', '${SELLER}', 'Fine', 'live', now());
  create function public.zz_fail() returns trigger language plpgsql as $f$ begin if new.id = '${I(4)}' and new.relist_count > old.relist_count then raise exception 'boom'; end if; return new; end $f$;
  create trigger zz_fail before update on public.declutter_items for each row execute function public.zz_fail();`);
await setUntil(4, "now() - interval '1 minute'"); await setUntil(5, "now() - interval '1 minute'");
s = await sweep();
check((await row(5)).relist_count === 1 && s.errors === 1, `a failing item is logged and the rest still relist (${JSON.stringify(s)})`);

const acl = (await db.query(`select proname, proacl::text as a from pg_proc where proname in ('declutter_listing_rounds_sweep', 'declutter_listing_round_close_offers')`)).rows;
check(acl.length === 2 && acl.every((x) => !/authenticated=X|anon=X|(^|[{,])=X/.test(x.a ?? "")), `service role only (${JSON.stringify(acl)})`);

console.log(failures ? `\n${failures} FAIL` : "\nall PASS");
process.exit(failures ? 1 : 0);
