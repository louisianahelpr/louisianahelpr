/**
 * Q1424 PGlite proof: declutter_price_nudge_sweep's two 14-day windows, on a fixed clock (./lib/fixedClock.mjs,
 * newest CREATE of the function). declutterPriceNudgeSweep.pglite.mjs rewrites live_at / notified_at relative to
 * now(); this one moves the clock and reads each edge 1 ms either side:
 *   live 14 days   i.live_at + 14 days <= now        (exactly 14 days: told; 1 ms short: not yet)
 *   once per 14 d  the last nudge notified_at > now - 14 days skips; the claim re-arms only when
 *                  notified_at <= now - 14 days     (told exactly 14 days ago: told again; 1 ms less: not)
 *   and 14 days is 336 clock hours across the fall-back Sunday.
 *
 *   node src/test/pglite/declutterPriceNudgeClock.pglite.mjs
 *   NUDGE_LIVE_STRICT=1 node src/test/pglite/declutterPriceNudgeClock.pglite.mjs     # RED: live exactly 14 days is not enough
 *   NUDGE_AGAIN_STRICT=1 node src/test/pglite/declutterPriceNudgeClock.pglite.mjs    # RED: the claim's re-arm edge made strict
 *
 * The price helper, the switch and member checks, and declutter_notify (their own proofs) are stubbed.
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
  id uuid PRIMARY KEY, seller_id uuid DEFAULT gen_random_uuid(), title text DEFAULT 'Oak chair', status text DEFAULT 'live',
  current_price_cents int DEFAULT 5000, is_seed boolean DEFAULT false, live_at timestamptz, sale_mode text DEFAULT 'fixed',
  drop_pct int DEFAULT 0);
CREATE TABLE public.declutter_item_private (item_id uuid PRIMARY KEY, floor_price_cents int, drops_stopped boolean);
CREATE TABLE public.test_accounts (user_id uuid);
CREATE TABLE public.profiles (user_id uuid, is_seed boolean);
CREATE TABLE public.declutter_offers (item_id uuid, status text);
CREATE TABLE public.declutter_cart_items (item_id uuid, status text);
CREATE TABLE public.declutter_price_nudges (item_id uuid PRIMARY KEY, notified_at timestamptz);
CREATE TABLE public.sent (title text);
CREATE FUNCTION public.feature_enabled_for_user(k text, u uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.declutter_member_out(u uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.declutter_price_nudge_cents(c int, f int) RETURNS int LANGUAGE sql AS $$ SELECT 4200 $$;
CREATE FUNCTION public.declutter_notify(p_user uuid, p_type text, p_title text, p_body text, p_link text, p_other uuid) RETURNS void
  LANGUAGE sql AS $$ INSERT INTO public.sent VALUES (p_title) $$;
CREATE FUNCTION public.log_cron_defect(a text, b text, c text) RETURNS void LANGUAGE sql AS $$ INSERT INTO public.sent VALUES ('defect: ' || c) $$;
`);
const { file, stmt } = newestFunction("declutter_price_nudge_sweep");
const base = onFixedClock(stmt);
let fixed = base;
check(`every clock read is on the fixed clock (${file})`, !/\bnow\s*\(\s*\)/i.test(fixed) && /_probe_now\(\)/.test(fixed));
const mutations = {
  NUDGE_LIVE_STRICT: ["i.live_at + interval '14 days' <= public._probe_now()", "i.live_at + interval '14 days' < public._probe_now()"],
  NUDGE_AGAIN_STRICT: ["WHERE n.notified_at <= public._probe_now() - interval '14 days'", "WHERE n.notified_at < public._probe_now() - interval '14 days'"],
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

const ITEM = "11111111-1111-4111-8111-111111111111";
const iso = (ms) => new Date(ms).toISOString();
const H = 3_600_000;
const D = 24 * H;
const seed = async ({ liveAt, notifiedAt = null }) => {
  await db.exec(`DELETE FROM public.sent; DELETE FROM public.declutter_price_nudges; DELETE FROM public.declutter_item_private; DELETE FROM public.declutter_items;`);
  await q(`INSERT INTO public.declutter_items (id, live_at) VALUES ($2, $1)`, [iso(liveAt), ITEM]);
  await q(`INSERT INTO public.declutter_item_private (item_id, floor_price_cents) VALUES ($1, 1000)`, [ITEM]);
  if (notifiedAt != null) await q(`INSERT INTO public.declutter_price_nudges VALUES ($2, $1)`, [iso(notifiedAt), ITEM]);
};
const sweep = async (nowMs) => {
  await setClock(db, iso(nowMs));
  await db.exec(`DELETE FROM public.sent;`);
  const res = (await q(`SELECT public.declutter_price_nudge_sweep() AS r`))[0].r;
  const [{ at } = { at: null }] = await q(`SELECT notified_at::text at FROM public.declutter_price_nudges WHERE item_id = $1`, [ITEM]);
  const sent = (await q(`SELECT title FROM public.sent`)).map((r) => r.title);
  return { told: res.told, errors: res.errors, at, sent };
};

const N = Date.UTC(2026, 6, 15, 15, 43, 0); // the cron's 15:43 UTC, 10:43 AM CDT, 15 July
{
  await seed({ liveAt: N - 14 * D + 1 });
  const r = await sweep(N);
  check("live 14 days minus 1 ms: not told yet", r.told === 0 && r.at === null, JSON.stringify(r));
  await seed({ liveAt: N - 14 * D });
  const r2 = await sweep(N);
  check("live exactly 14 days: told, nudge stamped with the clock", r2.told === 1 && r2.at === "2026-07-15 15:43:00+00" && r2.sent[0] === "Oak chair hasn't sold yet. Drop the price?", JSON.stringify(r2));
  const again = await sweep(N + D);
  check("the next day: not told again", again.told === 0, JSON.stringify(again));
}
{
  await seed({ liveAt: N - 60 * D, notifiedAt: N - 14 * D + 1 });
  const r = await sweep(N);
  check("last told 14 days minus 1 ms ago: not told", r.told === 0 && r.at === "2026-07-01 15:43:00.001+00", JSON.stringify(r));
  await seed({ liveAt: N - 60 * D, notifiedAt: N - 14 * D });
  const r2 = await sweep(N);
  check("last told exactly 14 days ago: told again, stamp moved to the clock", r2.told === 1 && r2.at === "2026-07-15 15:43:00+00", JSON.stringify(r2));
}
{
  // Across the fall-back Sunday (1 Nov 2026): 14 days before 9:43 AM CST Mon 9 Nov is 15:43Z Mon 26 Oct (10:43 AM CDT).
  const at = Date.UTC(2026, 10, 9, 15, 43, 0);
  await seed({ liveAt: at - 336 * H });
  const r = await sweep(at);
  check("across the fall-back Sunday: live exactly 336 clock hours: told", r.told === 1, JSON.stringify(r));
  await seed({ liveAt: at - 336 * H + 1 });
  const r2 = await sweep(at);
  check("across the fall-back Sunday: 1 ms short of 336 h: not yet", r2.told === 0, JSON.stringify(r2));
  check("no sweep errors", r.errors === 0 && r2.errors === 0, JSON.stringify([r.errors, r2.errors]));
}

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
