/**
 * Q1424 PGlite proof: declutter_listing_rounds_sweep's clock windows, on a fixed clock (./lib/fixedClock.mjs, newest
 * CREATE of the function). declutterListingRounds.pglite.mjs moves listed_until relative to now(); this one moves the
 * clock and reads each edge 1 ms either side:
 *   ends soon   listed_until > now AND listed_until <= now + 3 days   (exactly 3 days out: told; 3 days + 1 ms: not;
 *               the day named in Central time, so an end at 04:00Z reads as the Central day before)
 *   round over  listed_until <= now   (exactly now: relisted, listed_until = now + 30 days, round + 1;
 *               1 ms before: still up); after the 4th round: ended; "keep it up" renews without counting.
 *
 *   node src/test/pglite/declutterListingRoundsClock.pglite.mjs
 *   ROUNDS_SOON_INCLUSIVE=1 node src/test/pglite/declutterListingRoundsClock.pglite.mjs  # RED: the 3-day edge moved by one
 *   ROUNDS_END_STRICT=1 node src/test/pglite/declutterListingRoundsClock.pglite.mjs      # RED: a round ending now is not over
 *   ROUNDS_DAY_UTC=1 node src/test/pglite/declutterListingRoundsClock.pglite.mjs         # RED: the end day named in UTC
 *
 * declutter_notify, declutter_keeps_up and declutter_listing_round_close_offers (their own proofs) are stubbed.
 * pglite is loaded from ~/.lh-pglite (CLAUDE.md). Registered in src/test/clockFunctionsProven.test.ts.
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
  id int PRIMARY KEY, seller_id uuid DEFAULT gen_random_uuid(), title text DEFAULT 'Oak chair', status text DEFAULT 'live',
  relist_count int DEFAULT 0, listed_until timestamptz, round_nudged int, current_price_cents int DEFAULT 5000,
  updated_at timestamptz, keep_up boolean DEFAULT false);
CREATE TABLE public.sent (title text, body text);
CREATE FUNCTION public.declutter_keeps_up(p_id int) RETURNS boolean LANGUAGE sql AS $$ SELECT keep_up FROM public.declutter_items WHERE id = p_id $$;
CREATE FUNCTION public.declutter_notify(p_user uuid, p_type text, p_title text, p_body text, p_link text) RETURNS void
  LANGUAGE sql AS $$ INSERT INTO public.sent VALUES (p_title, p_body) $$;
CREATE FUNCTION public.declutter_listing_round_close_offers(p_id int, p_title text, p_seller uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.log_cron_defect(a text, b text, c text, d jsonb) RETURNS void LANGUAGE sql AS $$ INSERT INTO public.sent VALUES ('defect', c) $$;
`);
const { file, stmt } = newestFunction("declutter_listing_rounds_sweep");
const base = onFixedClock(stmt);
let fixed = base;
check(`every clock read is on the fixed clock (${file})`, !/\bnow\s*\(\s*\)/i.test(fixed) && /_probe_now\(\)/.test(fixed));
const mutations = {
  ROUNDS_SOON_INCLUSIVE: ["i.listed_until <= public._probe_now() + interval '3 days'", "i.listed_until < public._probe_now() + interval '3 days'"],
  ROUNDS_END_STRICT: ["i.listed_until IS NOT NULL AND i.listed_until <= public._probe_now()\n", "i.listed_until IS NOT NULL AND i.listed_until < public._probe_now()\n"],
  ROUNDS_DAY_UTC: ["to_char(it.listed_until AT TIME ZONE 'America/Chicago', 'FMDay, Mon FMDD')", "to_char(it.listed_until AT TIME ZONE 'UTC', 'FMDay, Mon FMDD')"],
};
let mutated = false;
for (const [env, [from, to]] of Object.entries(mutations)) {
  if (!process.env[env]) continue;
  console.log(`${env}=1 (expect FAILs)`);
  check(`${env}: the text to change is in the newest body`, fixed.includes(from));
  fixed = fixed.replace(from, to);
  mutated = true;
}
check("the mutation (if any) applied", !mutated || fixed !== base);
// Replay-safe: applies 3x (the REVOKE/GRANT tail needs the three roles created above).
for (let i = 0; i < 3; i++) await db.exec(fixed);

const iso = (ms) => new Date(ms).toISOString();
const H = 3_600_000;
const D = 24 * H;
const seed = async ({ until, relist = 0, keepUp = false }) => {
  await db.exec(`DELETE FROM public.sent; DELETE FROM public.declutter_items;`);
  await q(`INSERT INTO public.declutter_items (id, listed_until, relist_count, keep_up) VALUES (1, $1, $2, $3)`, [iso(until), relist, keepUp]);
};
const sweep = async (nowMs) => {
  await setClock(db, iso(nowMs));
  await db.exec(`DELETE FROM public.sent;`);
  const res = (await q(`SELECT public.declutter_listing_rounds_sweep() AS r`))[0].r;
  const sent = await q(`SELECT title, body FROM public.sent`);
  const [item] = await q(`SELECT status, relist_count, listed_until::text until, round_nudged FROM public.declutter_items WHERE id = 1`);
  return { res, sent, item };
};

const N = Date.UTC(2026, 6, 15, 20, 0, 0); // Wed 15 July 2026, 3:00 PM CDT
// 1. "Ends soon", 3 days ahead.
{
  await seed({ until: N + 3 * D });
  const r = await sweep(N);
  check("ends exactly 3 days out: told once (round_nudged set)", r.res.nudged === 1 && r.item.round_nudged === 0 && r.sent[0]?.title === "Your listing goes back up soon", JSON.stringify(r));
  check("the day is named in Central time (Saturday, Jul 18)", (r.sent[0]?.body ?? "").includes("On Saturday, Jul 18 it goes back up"), r.sent[0]?.body ?? "");
  const again = await sweep(N + H);
  check("an hour later: not told again this round", again.res.nudged === 0 && again.sent.length === 0, JSON.stringify(again.res));
  await seed({ until: N + 3 * D + 1 });
  const r2 = await sweep(N);
  check("ends 3 days + 1 ms out: not yet", r2.res.nudged === 0 && r2.sent.length === 0, JSON.stringify(r2.res));
  // Ends at 04:00Z Saturday 18 July = 11:00 PM CDT Friday 17 July: the notice names Friday, not Saturday.
  const end = Date.UTC(2026, 6, 18, 4, 0, 0);
  await seed({ until: end });
  const r3 = await sweep(end - 2 * D);
  check("ends at 11:00 PM CDT (04:00Z the next UTC day): names the Central day, Friday, Jul 17", (r3.sent[0]?.body ?? "").includes("On Friday, Jul 17"), r3.sent[0]?.body ?? "");
}
// 2. A round ends exactly at listed_until.
{
  await seed({ until: N + 1 });
  const r = await sweep(N);
  check("1 ms before the round ends: still up, round 1", r.res.relisted === 0 && r.item.relist_count === 0 && r.item.until === "2026-07-15 20:00:00.001+00", JSON.stringify(r));
  await seed({ until: N });
  const r2 = await sweep(N);
  check("exactly when the round ends: relisted for 30 days from the clock, round 2 of 4",
    r2.res.relisted === 1 && r2.item.relist_count === 1 && r2.item.until === "2026-08-14 20:00:00+00" && r2.sent[0]?.body.includes("(round 2 of 4)"), JSON.stringify(r2));
  // 30 days across the fall-back Sunday is 720 clock hours: an end at 3:00 PM CDT 15 Oct relists to 2:00 PM CST 14 Nov.
  const oct = Date.UTC(2026, 9, 15, 20, 0, 0);
  await seed({ until: oct });
  const r3 = await sweep(oct);
  check("across the fall-back Sunday: 30 days = 720 clock hours", r3.item.until === "2026-11-14 20:00:00+00", r3.item.until);
  await seed({ until: N, relist: 3 });
  const r4 = await sweep(N);
  check("the 4th round ends exactly now: comes down", r4.res.ended === 1 && r4.item.status === "ended", JSON.stringify(r4.res));
  await seed({ until: N, relist: 3, keepUp: true });
  const r5 = await sweep(N);
  check("keep it up: renews from the clock, round not counted, no notice",
    r5.res.renewed === 1 && r5.item.relist_count === 3 && r5.item.until === "2026-08-14 20:00:00+00" && r5.sent.length === 0, JSON.stringify(r5));
}

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
