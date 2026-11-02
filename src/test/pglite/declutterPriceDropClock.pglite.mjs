/**
 * Q1424 PGlite proof: declutter_price_drop_sweep's two clock windows, on a fixed clock (./lib/fixedClock.mjs,
 * newest CREATE of the function):
 *   live 12 h   i.live_at <= now - 12 h          (live exactly 12 h: drops; 1 ms short of 12 h: not yet)
 *   once a day  last_price_drop_on < the Louisiana date of now   (dropped "yesterday" in Central time: drops
 *               again; dropped today: not), read across a Louisiana midnight (05:00Z in CDT, 06:00Z in CST) and
 *               on both 2026 DST Sundays, so a UTC date would be caught
 *
 *   node src/test/pglite/declutterPriceDropClock.pglite.mjs
 *   PRICE_DROP_AS_UTC=1 node src/test/pglite/declutterPriceDropClock.pglite.mjs      # RED: the day read in UTC
 *   PRICE_DROP_INCLUSIVE=1 node src/test/pglite/declutterPriceDropClock.pglite.mjs   # RED: 12 h edge moved by one
 *
 * declutter_auto_free_due (day 12's "make it free", its own proof) is stubbed to 0 here. pglite is loaded from
 * ~/.lh-pglite (CLAUDE.md). Registered in src/test/clockFunctionsProven.test.ts.
 */
import os from "node:os";
import { installClock, newestFunction, onFixedClock, setClock } from "./lib/fixedClock.mjs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = new PGlite();
const q = async (sql, params) => (await db.query(sql, params)).rows;
await installClock(db);
await db.exec(`
SET TIME ZONE 'UTC';
CREATE ROLE service_role;
CREATE ROLE authenticated;
CREATE ROLE anon;
CREATE TABLE public.declutter_items (
  id serial PRIMARY KEY, title text DEFAULT 'Chair', status text DEFAULT 'live', sale_mode text DEFAULT 'offers',
  drop_pct int DEFAULT 10, live_at timestamptz, current_price_cents int DEFAULT 5000, last_price_drop_on date,
  price_dropped_at timestamptz, updated_at timestamptz, is_seed boolean DEFAULT true);
CREATE TABLE public.declutter_item_private (item_id int PRIMARY KEY, floor_price_cents int DEFAULT 1000, drop_stop_cents int);
CREATE FUNCTION public.declutter_auto_free_due() RETURNS int LANGUAGE sql AS $$ SELECT 0 $$;
`);
const { file, stmt } = newestFunction("declutter_price_drop_sweep");
let fixed = onFixedClock(stmt);
check(`every clock read is on the fixed clock (${file})`, !/\bnow\s*\(\s*\)/i.test(fixed) && /_probe_now\(\)/.test(fixed));
if (process.env.PRICE_DROP_AS_UTC) {
  console.log("PRICE_DROP_AS_UTC=1: the sweep's day read in UTC (expect FAILs)");
  fixed = fixed.replace("(public._probe_now() AT TIME ZONE 'America/Chicago')::date", "(public._probe_now() AT TIME ZONE 'UTC')::date");
}
if (process.env.PRICE_DROP_INCLUSIVE) {
  console.log("PRICE_DROP_INCLUSIVE=1: the 12 h edge moved by one (expect FAILs)");
  fixed = fixed.replace("i.live_at <= public._probe_now() - interval '12 hours'", "i.live_at < public._probe_now() - interval '12 hours'");
}
check("the mutation (if any) applied", !process.env.PRICE_DROP_AS_UTC && !process.env.PRICE_DROP_INCLUSIVE ? true : fixed !== onFixedClock(stmt));
// Replay-safe: applies 3x (the REVOKE/GRANT tail needs the three roles created above).
for (let i = 0; i < 3; i++) await db.exec(fixed);

const iso = (ms) => new Date(ms).toISOString();
const H = 3_600_000;
const seed = async ({ liveAt, lastDrop = null }) => {
  await db.exec(`DELETE FROM public.declutter_item_private; DELETE FROM public.declutter_items;`);
  const [{ id }] = await q(`INSERT INTO public.declutter_items (live_at, last_price_drop_on) VALUES ($1, $2) RETURNING id`, [iso(liveAt), lastDrop]);
  await q(`INSERT INTO public.declutter_item_private (item_id) VALUES ($1)`, [id]);
  return id;
};
const sweep = async (nowMs) => {
  await setClock(db, iso(nowMs));
  return (await q(`SELECT public.declutter_price_drop_sweep() AS n`))[0].n;
};
const priceOf = async () => (await q(`SELECT current_price_cents, last_price_drop_on::text d FROM public.declutter_items`))[0];

// 1. Live for 12 h: exactly 12 h drops, 1 ms short does not (a CDT afternoon).
{
  const N = Date.UTC(2026, 6, 15, 20, 0, 0); // 3:00 PM CDT, 15 July
  await seed({ liveAt: N - 12 * H + 1 });
  const early = await sweep(N);
  check("live 12 h minus 1 ms: no drop yet", early === 0 && (await priceOf()).current_price_cents === 5000, String(early));
  await seed({ liveAt: N - 12 * H });
  const atEdge = await sweep(N);
  const p = await priceOf();
  check("live exactly 12 h: drops 10% to a whole dollar and stamps today's Louisiana date", atEdge === 1 && p.current_price_cents === 4500 && p.d === "2026-07-15", `${atEdge} ${JSON.stringify(p)}`);
}

// 2. Once a Louisiana day, across a Central midnight. Each case: the item last dropped on `lastDrop`, swept at `at`.
const cases = [
  // CDT: Central midnight is 05:00Z. At 04:59:59.999Z it is still 14 July in Louisiana (but 15 July in UTC).
  { name: "CDT, 1 ms before Louisiana midnight, dropped earlier the same Louisiana day", at: Date.UTC(2026, 6, 15, 5, 0, 0) - 1, lastDrop: "2026-07-14", want: 0 },
  { name: "CDT, at Louisiana midnight, dropped the day before", at: Date.UTC(2026, 6, 15, 5, 0, 0), lastDrop: "2026-07-14", want: 1 },
  // CST: Central midnight is 06:00Z.
  { name: "CST, 1 ms before Louisiana midnight, dropped earlier the same Louisiana day", at: Date.UTC(2026, 0, 20, 6, 0, 0) - 1, lastDrop: "2026-01-19", want: 0 },
  { name: "CST, at Louisiana midnight, dropped the day before", at: Date.UTC(2026, 0, 20, 6, 0, 0), lastDrop: "2026-01-19", want: 1 },
  // Spring forward, Sunday 8 March 2026: Louisiana midnight of the 8th is 06:00Z (still CST), of the 9th 05:00Z.
  { name: "spring-forward Sunday, 1 ms before Louisiana midnight", at: Date.UTC(2026, 2, 9, 5, 0, 0) - 1, lastDrop: "2026-03-08", want: 0 },
  { name: "spring-forward Sunday, at Louisiana midnight", at: Date.UTC(2026, 2, 9, 5, 0, 0), lastDrop: "2026-03-08", want: 1 },
  // Fall back, Sunday 1 November 2026: the 1st began at 05:00Z (CDT); the 2nd begins at 06:00Z (CST).
  { name: "fall-back Sunday, 1 ms before Louisiana midnight (a 25-hour day)", at: Date.UTC(2026, 10, 2, 6, 0, 0) - 1, lastDrop: "2026-11-01", want: 0 },
  { name: "fall-back Sunday, at Louisiana midnight", at: Date.UTC(2026, 10, 2, 6, 0, 0), lastDrop: "2026-11-01", want: 1 },
];
for (const c of cases) {
  await seed({ liveAt: c.at - 48 * H, lastDrop: c.lastDrop });
  const n = await sweep(c.at);
  check(c.name, n === c.want, `swept ${n}, want ${c.want}`);
}

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
