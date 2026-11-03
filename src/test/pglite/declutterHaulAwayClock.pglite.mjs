/**
 * Q1424 PGlite proof: declutter_haul_away_sweep's clock windows, on a fixed clock (./lib/fixedClock.mjs, newest CREATE
 * of the function). declutterHaulAwaySweep.pglite.mjs moves jobs.updated_at and the link and listing timestamps
 * relative to now(); this one moves the clock and reads each edge 1 ms either side:
 *   A. 14 days unsold   COALESCE(live_at, submitted_at, created_at) + 14 days <= now  (exactly: "Haul-away is open";
 *                       1 ms short: not yet), once per item
 *   B. abandoned job    a declined card's haul-away job untouched for 1 day: updated_at <= now - 1 day (exactly 1
 *                       day: abandoned; 1 ms less: not)
 *   C. link undone      a link at least 7 days old whose job holds nothing: the in-loop re-check
 *                       updated_at > now - 7 days skips (exactly 7 days old: undone, item back on sale; 1 ms younger: kept)
 *
 *   node src/test/pglite/declutterHaulAwayClock.pglite.mjs
 *   HAUL_NOTICE_STRICT=1 ...    # RED: the 14-day edge made strict
 *   HAUL_ABANDON_STRICT=1 ...   # RED: part B's 1-day edges made strict
 *   HAUL_LINK_INCLUSIVE=1 ...   # RED: part C's 7-day re-check made inclusive
 *
 * declutter_haul_away_sweep_candidates (its own 7-day pick) is stubbed to offer every link, so the sweep's own re-check
 * decides; the notice, switch, member and hold helpers are stubbed. pglite is loaded from ~/.lh-pglite (CLAUDE.md).
 * Registered in src/test/clockFunctionsProven.test.ts.
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
  id uuid PRIMARY KEY, seller_id uuid, title text DEFAULT 'Oak chair', status text DEFAULT 'live',
  live_at timestamptz, submitted_at timestamptz, created_at timestamptz, updated_at timestamptz);
CREATE TABLE public.declutter_haul_away_notices (item_id uuid PRIMARY KEY);
CREATE TABLE public.declutter_haul_aways (item_id uuid PRIMARY KEY, job_id uuid, prior_status text, updated_at timestamptz);
CREATE TABLE public.declutter_cart_items (item_id uuid, status text);
CREATE TABLE public.declutter_item_photos (item_id uuid);
CREATE TABLE public.jobs (
  id uuid PRIMARY KEY, status text DEFAULT 'open', payment_status text DEFAULT 'failed', stripe_session_id text,
  stripe_payment_intent_id text, updated_at timestamptz, is_seed boolean DEFAULT false);
CREATE TABLE public.gift_cards (job_id uuid, status text);
CREATE TABLE public.calls (what text);
CREATE FUNCTION public.feature_enabled_for_user(k text, u uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.declutter_member_out(u uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.declutter_notify(p_user uuid, p_type text, p_title text, p_body text, p_link text, p_other uuid) RETURNS void
  LANGUAGE sql AS $$ INSERT INTO public.calls VALUES ('notify:' || p_title) $$;
CREATE FUNCTION public.declutter_haul_away_sweep_candidates(n int) RETURNS TABLE (item_id uuid) LANGUAGE sql AS $$ SELECT h.item_id FROM public.declutter_haul_aways h $$;
CREATE FUNCTION public.declutter_haul_job_hold(j uuid) RETURNS text LANGUAGE sql AS $$ SELECT 'none'::text $$;
CREATE FUNCTION public.log_cron_defect(a text, b text, c text) RETURNS void LANGUAGE sql AS $$ INSERT INTO public.calls VALUES ('defect:' || c) $$;
`);
const { file, stmt } = newestFunction("declutter_haul_away_sweep");
const base = onFixedClock(stmt);
let fixed = base;
check(`every clock read is on the fixed clock (${file})`, !/\bnow\s*\(\s*\)/i.test(fixed) && /_probe_now\(\)/.test(fixed));
const mutations = {
  HAUL_NOTICE_STRICT: ["+ interval '14 days' <= public._probe_now()", "+ interval '14 days' < public._probe_now()"],
  HAUL_ABANDON_STRICT: ["AND j.updated_at <= public._probe_now() - interval '1 day'", "AND j.updated_at < public._probe_now() - interval '1 day'"],
  HAUL_LINK_INCLUSIVE: ["v_link.updated_at > public._probe_now() - interval '7 days'", "v_link.updated_at >= public._probe_now() - interval '7 days'"],
};
let mutated = false;
for (const [env, [from, to]] of Object.entries(mutations)) {
  if (!process.env[env]) continue;
  console.log(`${env}=1 (expect FAILs)`);
  check(`${env}: the text to change is in the newest body`, fixed.includes(from));
  fixed = fixed.split(from).join(to);
  mutated = true;
}
check("the mutation (if any) applied", !mutated || fixed !== base);
// Replay-safe: applies 3x.
for (let i = 0; i < 3; i++) await db.exec(fixed);

const ITEM = "12121212-1212-4212-8212-121212121212";
const SELLER = "13131313-1313-4313-8313-131313131313";
const JOB = "14141414-1414-4414-8414-141414141414";
const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());
const H = 3_600_000;
const D = 24 * H;
const reset = async () => db.exec(`DELETE FROM public.calls; DELETE FROM public.declutter_haul_away_notices; DELETE FROM public.declutter_haul_aways;
  DELETE FROM public.declutter_item_photos; DELETE FROM public.jobs; DELETE FROM public.declutter_items;`);
const sweep = async (nowMs) => {
  await setClock(db, iso(nowMs));
  const r = (await q(`SELECT public.declutter_haul_away_sweep() AS r`))[0].r;
  const calls = (await q(`SELECT what FROM public.calls`)).map((c) => c.what);
  return { r, calls };
};

const N = Date.UTC(2026, 6, 15, 20, 0, 0);
// A. 14 days unsold.
for (const [label, liveAt, want] of [["live 14 days minus 1 ms: no notice yet", N - 14 * D + 1, 0], ["live exactly 14 days: \"Haul-away is open\"", N - 14 * D, 1]]) {
  await reset();
  await q(`INSERT INTO public.declutter_items (id, seller_id, live_at) VALUES ($1, $2, $3)`, [ITEM, SELLER, iso(liveAt)]);
  const r = await sweep(N);
  check(label, r.r.notified_items === want && r.calls.filter((c) => c === "notify:Haul-away is open").length === want, JSON.stringify(r));
}
{
  // Never went live: submitted_at stands in, and the notice comes once.
  await reset();
  await q(`INSERT INTO public.declutter_items (id, seller_id, submitted_at, created_at) VALUES ($1, $2, $3, $4)`, [ITEM, SELLER, iso(N - 14 * D), iso(N - 30 * D)]);
  const r = await sweep(N);
  const again = await sweep(N + D);
  check("no live_at: submitted_at exactly 14 days ago counts (not created_at); told once", r.r.notified_items === 1 && again.r.notified_items === 0, JSON.stringify([r.r, again.r]));
}
// B. A declined card's job untouched for 1 day.
for (const [label, touched, want] of [["job untouched 1 day minus 1 ms: still failed", N - D + 1, "failed"], ["job untouched exactly 1 day: abandoned", N - D, "abandoned"]]) {
  await reset();
  await q(`INSERT INTO public.declutter_items (id, seller_id, status, live_at) VALUES ($1, $2, 'ended', $3)`, [ITEM, SELLER, iso(N - D)]);
  await q(`INSERT INTO public.jobs (id, updated_at) VALUES ($1, $2)`, [JOB, iso(touched)]);
  await q(`INSERT INTO public.declutter_haul_aways VALUES ($1, $2, 'live', $3)`, [ITEM, JOB, iso(N)]);
  await sweep(N);
  const [{ payment_status }] = await q(`SELECT payment_status FROM public.jobs`);
  check(label, payment_status === want, payment_status);
}
// C. The link 7 days old whose job holds nothing: undone, the item back on sale (it has 3 photos).
for (const [label, linkAt, wantUndone] of [["link 7 days minus 1 ms old: kept", N - 7 * D + 1, 0], ["link exactly 7 days old: undone, back on sale", N - 7 * D, 1]]) {
  await reset();
  await q(`INSERT INTO public.declutter_items (id, seller_id, status, live_at) VALUES ($1, $2, 'ended', $3)`, [ITEM, SELLER, iso(N - 3 * D)]);
  await q(`INSERT INTO public.declutter_item_photos VALUES ($1), ($1), ($1)`, [ITEM]);
  await q(`INSERT INTO public.declutter_haul_aways VALUES ($1, NULL, 'live', $2)`, [ITEM, iso(linkAt)]);
  const r = await sweep(N);
  const [{ status }] = await q(`SELECT status FROM public.declutter_items`);
  check(label, r.r.links_undone === wantUndone && status === (wantUndone ? "live" : "ended") && r.r.errors === 0, JSON.stringify({ ...r.r, status }));
}

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
