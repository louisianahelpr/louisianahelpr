#!/usr/bin/env node
/**
 * PGlite proof for the DA-17 migration (a nightly drop never lands on odd cents because of the private stop).
 *
 *   node src/test/pglite/declutterDropStopWholeDollar.pglite.mjs                 # after (3x replay)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterDropStopWholeDollar.pglite.mjs  # RED: the migration absent
 *   MUTANT=<name> node src/test/pglite/declutterDropStopWholeDollar.pglite.mjs   # a planted defect: must FAIL
 *
 * World: the tables the sweep reads and the previous definition of the sweep (newest before this migration), run
 * verbatim. Stubbed, and said so: declutter_auto_free_due (returns 0; the day-12 free rule is proven by
 * declutterAutoFreeDays.pglite.mjs). The price-drop alert trigger is not installed: it does not change the price.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const FILES = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
const THIS = FILES.find((f) => f.endsWith("_declutter_drop_stop_whole_dollar.sql"));
if (!THIS) throw new Error("migration not found");
const MUTANT = process.env.MUTANT ?? "";
const skip = process.env.NEW_MIGRATION === "skip";
const STOP = "(ceil(COALESCE(p.drop_stop_cents, p.floor_price_cents) / 100.0) * 100)::integer";

function newestSweepBefore(before) {
  for (let i = FILES.length - 1; i >= 0; i--) {
    if (FILES[i] >= before) continue;
    const src = readFileSync(MIG_DIR + FILES[i], "utf8");
    const start = src.lastIndexOf("CREATE OR REPLACE FUNCTION public.declutter_price_drop_sweep(");
    if (start < 0) continue;
    const tag = /AS\s+(\$[A-Za-z_]*\$)/.exec(src.slice(start))[1];
    const open = src.indexOf(tag, start);
    return src.slice(start, src.indexOf(tag, open + tag.length) + tag.length) + ";";
  }
  throw new Error("no earlier sweep");
}

const MUTANTS = {
  // Rounds the stop DOWN: the price would pass the seller's private stop.
  down: [STOP, "(floor(COALESCE(p.drop_stop_cents, p.floor_price_cents) / 100.0) * 100)::integer"],
  // The WHERE keeps the raw stop: a listing at its rounded stop is "dropped" to itself every night.
  where: [`AND i.current_price_cents > greatest(p.floor_price_cents, ${STOP})`, "AND i.current_price_cents > greatest(p.floor_price_cents, COALESCE(p.drop_stop_cents, p.floor_price_cents))"],
  // The floor no longer wins.
  floor: [`SET current_price_cents = greatest(p.floor_price_cents, ${STOP},`, `SET current_price_cents = greatest(${STOP},`],
  // Definer grants left open.
  grant: ["REVOKE ALL ON FUNCTION public.declutter_price_drop_sweep() FROM PUBLIC, anon, authenticated;", "GRANT EXECUTE ON FUNCTION public.declutter_price_drop_sweep() TO anon;"],
};
let mig = readFileSync(MIG_DIR + THIS, "utf8");
if (MUTANT) {
  const m = MUTANTS[MUTANT];
  if (!m || !mig.includes(m[0])) throw new Error(`mutant ${MUTANT} did not apply`);
  mig = mig.replaceAll(m[0], m[1]);
}

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };
const I = (n) => `22222222-0000-0000-0000-${String(n).padStart(12, "0")}`;
const SELLER = "11111111-0000-0000-0000-000000000001";

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  grant usage on schema public to anon, authenticated, service_role;
  create table public.declutter_items (id uuid primary key, seller_id uuid not null, status text not null default 'live', title text not null,
    price_cents integer not null, current_price_cents integer not null, is_seed boolean not null default false, sale_mode text not null default 'offers',
    drop_pct smallint not null default 5, live_at timestamptz, last_price_drop_on date, price_dropped_at timestamptz, updated_at timestamptz default now());
  create table public.declutter_item_private (item_id uuid primary key, floor_price_cents integer not null, drop_stop_cents integer);
  create function public.declutter_auto_free_due() returns integer language sql as $f$ select 0 $f$;
`);
await db.exec(newestSweepBefore(THIS));
await db.exec("REVOKE ALL ON FUNCTION public.declutter_price_drop_sweep() FROM PUBLIC, anon, authenticated; GRANT EXECUTE ON FUNCTION public.declutter_price_drop_sweep() TO service_role;");
if (!skip) for (let i = 0; i < 3; i++) await db.exec(mig); // replay-safe: applied three times

async function item(n, { current, floor = 2000, stop = null, pct = 5 }) {
  await db.query(`insert into public.declutter_items (id, seller_id, title, price_cents, current_price_cents, drop_pct, live_at) values ($1, $2, $3, 10000, $4, $5, now() - interval '2 days')`,
    [I(n), SELLER, `Item ${n}`, current, pct]);
  await db.query(`insert into public.declutter_item_private (item_id, floor_price_cents, drop_stop_cents) values ($1, $2, $3)`, [I(n), floor, stop]);
}
const price = async (n) => (await db.query("select current_price_cents c, last_price_drop_on d from public.declutter_items where id = $1", [I(n)])).rows[0];

await item(1, { current: 2200, stop: 2137 }); // the step ($20) is below the stop ($21.37): the case that showed odd cents
await item(2, { current: 4000, stop: 2137 }); // the step wins, as before: $38
await item(3, { current: 2200, stop: 2137 + 63 }); // already at a stop that is a whole dollar: nothing happens
await item(4, { current: 2150, floor: 2000, stop: 2137 }); // $21.50, rounded stop $22 is ABOVE it: left alone, never raised
await item(5, { current: 2500, floor: 2050 }); // no stop, a floor with cents: $23, then down to $21, never below $20.50
await item(6, { current: 2393, floor: 2000, stop: 2157 }); // the old odd price on prod's seed rows: settles on a whole dollar
await item(9, { current: 3000, floor: 2550, stop: 2100, pct: 20 }); // a floor above the stop still wins: 30 * .8 = 24, the floor $25.50 holds
await item(7, { current: 2100, floor: 2000, stop: 2001, pct: 20 }); // the seller's own step still rules: 21 * .8 = 16.8, the stop $21 holds

const n = (await db.query("select public.declutter_price_drop_sweep() n")).rows[0].n;
const p1 = await price(1), p2 = await price(2), p3 = await price(3), p4 = await price(4), p5 = await price(5), p6 = await price(6), p7 = await price(7);
check(p1.c === 2200 && p1.d === null, `$22.00 with a $21.37 stop stays $22, not "dropped" to itself (got ${p1.c})`);
check(p2.c === 3800, `$40 at 5% is still $38, the step's own whole dollar (got ${p2.c})`);
check(p3.c === 2200 && p3.d === null, `at a whole-dollar stop: untouched (got ${p3.c})`);
check(p4.c === 2150 && p4.d === null, `a price under the rounded stop is never RAISED (got ${p4.c})`);
check(p5.c === 2300, `$25 at 5% with a $20.50 floor: $23 (got ${p5.c})`);
check(p6.c === 2200, `an old $23.93 with a $21.57 stop drops to a whole $22, never $21.57 (got ${p6.c})`);
check(p7.c === 2100 && p7.d === null, `at the rounded stop already: the drop does not fire (got ${p7.c})`);
const p9 = await price(9);
check(p9.c === 2550, `the seller's floor always wins (got ${p9.c})`);
check(n === 4 && [p2, p5, p6, p9].every((p) => p.d !== null), `only the four that moved are marked dropped (sweep returned ${n})`);

// Walking a listing down night by night: never odd cents, never below the stop, and it stops.
await db.exec("delete from public.declutter_items; delete from public.declutter_item_private;");
await item(8, { current: 3000, floor: 1500, stop: 2137, pct: 10 });
const seen = [];
for (let night = 0; night < 8; night++) {
  await db.exec(`update public.declutter_items set last_price_drop_on = null;`);
  await db.query("select public.declutter_price_drop_sweep()");
  seen.push((await price(8)).c);
}
check(seen.every((c) => c % 100 === 0), `a whole walk down is whole dollars: ${seen.join(", ")}`);
check(seen.every((c) => c >= 2137), `never below the private stop: ${seen.at(-1)}`);
check(seen.at(-1) === 2200, `it ends at the stop's next whole dollar, $22 (got ${seen.at(-1)})`);

// Definer and grants: only the service role runs it.
const acl = (await db.query("select prosecdef, proacl::text acl from pg_proc where proname = 'declutter_price_drop_sweep'")).rows[0];
check(acl.prosecdef === true, "still SECURITY DEFINER");
check(!/(^|[{,])anon=/.test(acl.acl) && !/(^|[{,])authenticated=/.test(acl.acl) && !/(^|[{,])=X/.test(acl.acl) && /service_role=X/.test(acl.acl), `granted to service_role only: ${acl.acl}`);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
