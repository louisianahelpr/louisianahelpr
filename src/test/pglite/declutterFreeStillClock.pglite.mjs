/**
 * Q1424 PGlite proof: declutter_free_still_available_sweep's two 14-day windows, on a fixed clock
 * (./lib/fixedClock.mjs, newest CREATE of the function). declutterFreeStillAvailable.pglite.mjs rewrites live_at /
 * asked_at / answered_at relative to now(); this one moves the clock and reads each edge 1 ms either side:
 *   live 14 days   i.live_at + 14 days <= now        (exactly 14 days: asked; 1 ms short: not yet)
 *   once per 14 d  the later of asked_at / answered_at > now - 14 days skips; the claim re-arms only when it is
 *                  <= now - 14 days (asked exactly 14 days ago: asked again; 1 ms less: not; a seller's answer
 *                  since then restarts the 14 days)
 *   and 14 days is 336 clock hours across the fall-back Sunday.
 *
 *   node src/test/pglite/declutterFreeStillClock.pglite.mjs
 *   FREE_LIVE_STRICT=1 node src/test/pglite/declutterFreeStillClock.pglite.mjs     # RED: live exactly 14 days is not enough
 *   FREE_AGAIN_STRICT=1 node src/test/pglite/declutterFreeStillClock.pglite.mjs    # RED: the claim's re-arm edge made strict
 *
 * The switch and member checks and declutter_notify (their own proofs) are stubbed.
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
  current_price_cents int DEFAULT 0, is_seed boolean DEFAULT false, live_at timestamptz);
CREATE TABLE public.notification_preferences (user_id uuid, declutter_listings boolean);
CREATE TABLE public.test_accounts (user_id uuid);
CREATE TABLE public.profiles (user_id uuid, is_seed boolean);
CREATE TABLE public.declutter_cart_items (item_id uuid, status text);
CREATE TABLE public.declutter_free_still_asks (item_id uuid PRIMARY KEY, asked_at timestamptz, answered_at timestamptz);
CREATE TABLE public.sent (title text);
CREATE FUNCTION public.feature_enabled_for_user(k text, u uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.declutter_member_out(u uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.declutter_notify(p_user uuid, p_type text, p_title text, p_body text, p_link text, p_other uuid) RETURNS void
  LANGUAGE sql AS $$ INSERT INTO public.sent VALUES (p_title) $$;
CREATE FUNCTION public.log_cron_defect(a text, b text, c text) RETURNS void LANGUAGE sql AS $$ INSERT INTO public.sent VALUES ('defect: ' || c) $$;
`);
const { file, stmt } = newestFunction("declutter_free_still_available_sweep");
const base = onFixedClock(stmt);
let fixed = base;
check(`every clock read is on the fixed clock (${file})`, !/\bnow\s*\(\s*\)/i.test(fixed) && /_probe_now\(\)/.test(fixed));
const mutations = {
  FREE_LIVE_STRICT: ["i.live_at + interval '14 days' <= public._probe_now()", "i.live_at + interval '14 days' < public._probe_now()"],
  FREE_AGAIN_STRICT: ["OR GREATEST(a.asked_at, a.answered_at) <= public._probe_now() - interval '14 days'", "OR GREATEST(a.asked_at, a.answered_at) < public._probe_now() - interval '14 days'"],
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
const seed = async ({ liveAt, notifiedAt = null, answeredAt = null }) => {
  await db.exec(`DELETE FROM public.sent; DELETE FROM public.declutter_free_still_asks; DELETE FROM public.declutter_items;`);
  await q(`INSERT INTO public.declutter_items (id, live_at) VALUES ($2, $1)`, [iso(liveAt), ITEM]);
  if (notifiedAt != null) await q(`INSERT INTO public.declutter_free_still_asks VALUES ($2, $1, $3)`, [iso(notifiedAt), ITEM, answeredAt == null ? null : iso(answeredAt)]);
};
const sweep = async (nowMs) => {
  await setClock(db, iso(nowMs));
  await db.exec(`DELETE FROM public.sent;`);
  const res = (await q(`SELECT public.declutter_free_still_available_sweep() AS r`))[0].r;
  const [{ at } = { at: null }] = await q(`SELECT asked_at::text at FROM public.declutter_free_still_asks WHERE item_id = $1`, [ITEM]);
  const sent = (await q(`SELECT title FROM public.sent`)).map((r) => r.title);
  return { told: res.told, errors: res.errors, at, sent };
};

const N = Date.UTC(2026, 6, 15, 15, 51, 0); // the cron's 15:51 UTC, 10:51 AM CDT, 15 July
{
  await seed({ liveAt: N - 14 * D + 1 });
  const r = await sweep(N);
  check("live 14 days minus 1 ms: not asked yet", r.told === 0 && r.at === null, JSON.stringify(r));
  await seed({ liveAt: N - 14 * D });
  const r2 = await sweep(N);
  check("live exactly 14 days: asked, stamped with the clock", r2.told === 1 && r2.at === "2026-07-15 15:51:00+00" && r2.sent[0] === 'Is "Oak chair" still available?', JSON.stringify(r2));
  const again = await sweep(N + D);
  check("the next day: not asked again", again.told === 0, JSON.stringify(again));
}
{
  await seed({ liveAt: N - 60 * D, notifiedAt: N - 14 * D + 1 });
  const r = await sweep(N);
  check("last asked 14 days minus 1 ms ago: not asked", r.told === 0 && r.at === "2026-07-01 15:51:00.001+00", JSON.stringify(r));
  await seed({ liveAt: N - 60 * D, notifiedAt: N - 14 * D });
  const r2 = await sweep(N);
  check("last asked exactly 14 days ago: asked again, stamp moved to the clock", r2.told === 1 && r2.at === "2026-07-15 15:51:00+00", JSON.stringify(r2));
  await seed({ liveAt: N - 60 * D, notifiedAt: N - 20 * D, answeredAt: N - 14 * D + 1 });
  const r3 = await sweep(N);
  check("asked 20 days ago but answered 14 days minus 1 ms ago: not asked (the answer restarts the 14 days)", r3.told === 0, JSON.stringify(r3));
  await seed({ liveAt: N - 60 * D, notifiedAt: N - 20 * D, answeredAt: N - 14 * D });
  const r4 = await sweep(N);
  check("answered exactly 14 days ago: asked again", r4.told === 1, JSON.stringify(r4));
}
{
  // Across the fall-back Sunday (1 Nov 2026): 14 days before 9:51 AM CST Mon 9 Nov is 15:51Z Mon 26 Oct (10:51 AM CDT).
  const at = Date.UTC(2026, 10, 9, 15, 51, 0);
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
