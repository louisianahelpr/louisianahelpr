/**
 * Q1424 PGlite proof: declutter_move_reminder_sweep's Louisiana-day windows, on a fixed clock (./lib/fixedClock.mjs,
 * newest CREATE of the function). declutterMoveReminders.pglite.mjs writes each sale's date relative to today; this
 * one fixes the clock and reads the day edges around a Central midnight:
 *   today        v_today = the Louisiana date of now (America/Chicago), not the UTC date
 *   day before   move_out_on = today + 1 and something still up: "Your move is tomorrow"
 *   day after    move_out_on in [today - 3, today - 1] and something still live: "Your move date has passed"
 * read 1 ms before and at a Central midnight in CDT and CST and on both 2026 DST Sundays (the cron runs at 15:33Z,
 * but a late run or catch-up can land near midnight, and the date must still be Louisiana's).
 *
 *   node src/test/pglite/declutterMoveReminderClock.pglite.mjs
 *   MOVE_DAY_UTC=1 node src/test/pglite/declutterMoveReminderClock.pglite.mjs      # RED: today read in UTC
 *   MOVE_AFTER_NARROW=1 node src/test/pglite/declutterMoveReminderClock.pglite.mjs # RED: the 3-day "after" window cut to 2
 *
 * The switch, member and notice helpers (their own proofs) are stubbed. pglite is loaded from ~/.lh-pglite
 * (CLAUDE.md). Registered in src/test/clockFunctionsProven.test.ts.
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
CREATE TABLE public.declutter_items (id int PRIMARY KEY, seller_id uuid, status text DEFAULT 'live', in_moving_sale boolean DEFAULT true, is_seed boolean DEFAULT false);
CREATE TABLE public.declutter_item_private (item_id int PRIMARY KEY, move_out_on date);
CREATE TABLE public.test_accounts (user_id uuid);
CREATE TABLE public.profiles (user_id uuid, is_seed boolean);
CREATE TABLE public.notification_preferences (user_id uuid, declutter_listings boolean);
CREATE TABLE public.declutter_move_reminders (seller_id uuid, move_out_on date, kind text, PRIMARY KEY (seller_id, move_out_on, kind));
CREATE TABLE public.sent (title text);
CREATE FUNCTION public.feature_enabled_for_user(k text, u uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.declutter_member_out(u uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.declutter_notify(p_user uuid, p_type text, p_title text, p_body text, p_link text, p_other uuid) RETURNS void
  LANGUAGE sql AS $$ INSERT INTO public.sent VALUES (p_title) $$;
CREATE FUNCTION public.log_cron_defect(a text, b text, c text) RETURNS void LANGUAGE sql AS $$ INSERT INTO public.sent VALUES ('defect: ' || c) $$;
`);
const { file, stmt } = newestFunction("declutter_move_reminder_sweep");
const base = onFixedClock(stmt);
let fixed = base;
check(`every clock read is on the fixed clock (${file})`, !/\bnow\s*\(\s*\)/i.test(fixed) && /_probe_now\(\)/.test(fixed));
const mutations = {
  MOVE_DAY_UTC: ["(public._probe_now() AT TIME ZONE 'America/Chicago')::date", "(public._probe_now() AT TIME ZONE 'UTC')::date"],
  MOVE_AFTER_NARROW: ["BETWEEN v_today - 3 AND v_today - 1", "BETWEEN v_today - 2 AND v_today - 1"],
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

const SELLER = "22222222-2222-4222-8222-222222222222";
const iso = (ms) => new Date(ms).toISOString();
const seed = async (moveOut) => {
  await db.exec(`DELETE FROM public.sent; DELETE FROM public.declutter_move_reminders; DELETE FROM public.declutter_item_private; DELETE FROM public.declutter_items;`);
  await q(`INSERT INTO public.declutter_items (id, seller_id) VALUES (1, $1)`, [SELLER]);
  await q(`INSERT INTO public.declutter_item_private VALUES (1, $1)`, [moveOut]);
};
const sweep = async (nowMs) => {
  await setClock(db, iso(nowMs));
  const res = (await q(`SELECT public.declutter_move_reminder_sweep() AS r`))[0].r;
  const sent = (await q(`SELECT title FROM public.sent`)).map((r) => r.title);
  return { told: res.told, errors: res.errors, sent };
};
const TOMORROW = "Your move is tomorrow";
const PASSED = "Your move date has passed";

// Each midnight: [Louisiana midnight in UTC ms, the Louisiana date that begins then, the date before it].
const midnights = [
  { name: "CDT", at: Date.UTC(2026, 6, 15, 5, 0, 0), day: "2026-07-15", prev: "2026-07-14" },
  { name: "CST", at: Date.UTC(2026, 0, 20, 6, 0, 0), day: "2026-01-20", prev: "2026-01-19" },
  // Spring forward Sunday 8 March 2026: Monday the 9th begins at 05:00Z (CDT).
  { name: "spring-forward Sunday", at: Date.UTC(2026, 2, 9, 5, 0, 0), day: "2026-03-09", prev: "2026-03-08" },
  // Fall back Sunday 1 November 2026: Monday the 2nd begins at 06:00Z (CST).
  { name: "fall-back Sunday", at: Date.UTC(2026, 10, 2, 6, 0, 0), day: "2026-11-02", prev: "2026-11-01" },
];
const plus = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
for (const m of midnights) {
  // A move on `day`: 1 ms before Louisiana midnight it is tomorrow; at midnight it is today (no notice).
  await seed(m.day);
  const before = await sweep(m.at - 1);
  check(`${m.name}: move on ${m.day}, 1 ms before Louisiana midnight: "${TOMORROW}"`, before.sent[0] === TOMORROW && before.told === 1, JSON.stringify(before));
  await seed(m.day);
  const at = await sweep(m.at);
  check(`${m.name}: move on ${m.day}, at Louisiana midnight: no notice (the move is today)`, at.told === 0, JSON.stringify(at));
  // A move on `prev`: at Louisiana midnight it is yesterday, so "passed"; 1 ms before it is today, no notice.
  await seed(m.prev);
  const today = await sweep(m.at - 1);
  check(`${m.name}: move on ${m.prev}, 1 ms before midnight: no notice (the move is today)`, today.told === 0, JSON.stringify(today));
  await seed(m.prev);
  const after = await sweep(m.at);
  check(`${m.name}: move on ${m.prev}, at Louisiana midnight: "${PASSED}"`, after.sent[0] === PASSED, JSON.stringify(after));
  // The "after" window holds for 3 days: 3 days ago still told, 4 days ago not.
  await seed(plus(m.day, -3));
  const three = await sweep(m.at);
  check(`${m.name}: move 3 days before ${m.day}: still "${PASSED}"`, three.sent[0] === PASSED, JSON.stringify(three));
  await seed(plus(m.day, -4));
  const four = await sweep(m.at);
  check(`${m.name}: move 4 days before ${m.day}: no notice`, four.told === 0 && four.errors === 0, JSON.stringify(four));
}
// Once: the same day again tells nothing more.
{
  await seed("2026-07-16");
  await sweep(Date.UTC(2026, 6, 15, 15, 33));
  const again = await sweep(Date.UTC(2026, 6, 15, 20, 0));
  check("a second run the same day: not told twice", again.told === 0, JSON.stringify(again));
}

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
