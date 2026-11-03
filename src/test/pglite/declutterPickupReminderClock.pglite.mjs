/**
 * Q1424 PGlite proof: declutter_pickup_reminder_sweep's clock windows, on a fixed clock (./lib/fixedClock.mjs,
 * newest CREATE of the function). declutterPickupReminders.pglite.mjs moves slot_start relative to now(); this one
 * moves the clock and reads each edge 1 ms either side:
 *   in the future   b.slot_start > now                     (slot exactly now: no reminder; 1 ms later: reminded)
 *   within the hour b.slot_start <= now + 60 min           (exactly 60 min: reminded; 60 min + 1 ms: not yet)
 *   the title       slot - now >= 50 min: "Pickup in 1 hour"; 1 ms under 50 min: "Pickup at <Central time>"
 *   the day word    "today" / "tomorrow" by the Louisiana date of now and of the slot, across a Central
 *                   midnight in CDT and CST and on both 2026 DST Sundays (a UTC date would say the wrong day),
 *                   and the time printed in Central time on those days.
 *
 *   node src/test/pglite/declutterPickupReminderClock.pglite.mjs
 *   PICKUP_REMIND_INCLUSIVE=1 node src/test/pglite/declutterPickupReminderClock.pglite.mjs  # RED: the 60-min edge moved by one
 *   PICKUP_REMIND_AS_UTC=1 node src/test/pglite/declutterPickupReminderClock.pglite.mjs     # RED: the day read in UTC
 *   PICKUP_REMIND_TITLE_EDGE=1 node src/test/pglite/declutterPickupReminderClock.pglite.mjs # RED: the 50-min edge made strict
 *
 * declutter_pickup_remind (bell, push and email; its own proof) is stubbed to record what it was asked to send.
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
CREATE TABLE public.declutter_orders (id int PRIMARY KEY, status text DEFAULT 'paid', handover text DEFAULT 'pickup_home');
CREATE TABLE public.declutter_bookings (
  order_id int PRIMARY KEY, buyer_id uuid DEFAULT gen_random_uuid(), seller_id uuid DEFAULT gen_random_uuid(),
  slot_start timestamptz, porch_mode text, reminded_slot_start timestamptz);
CREATE TABLE public.declutter_items (id int PRIMARY KEY, title text);
CREATE TABLE public.declutter_cart_items (id serial PRIMARY KEY, order_id int, item_id int, created_at timestamptz DEFAULT '2026-01-01');
CREATE TABLE public.error_logs (severity text, message text, tags jsonb, context jsonb);
CREATE TABLE public.sent (user_id uuid, title text, body text);
CREATE FUNCTION public.declutter_pickup_remind(p_user uuid, p_title text, p_body text, p_link text, p_other uuid)
RETURNS void LANGUAGE sql AS $$ INSERT INTO public.sent VALUES (p_user, p_title, p_body) $$;
`);
const { file, stmt } = newestFunction("declutter_pickup_reminder_sweep");
const base = onFixedClock(stmt);
let fixed = base;
check(`every clock read is on the fixed clock (${file})`, !/\bnow\s*\(\s*\)/i.test(fixed) && /_probe_now\(\)/.test(fixed));
const mutations = {
  PICKUP_REMIND_INCLUSIVE: ["b.slot_start <= public._probe_now() + interval '60 minutes'", "b.slot_start < public._probe_now() + interval '60 minutes'"],
  PICKUP_REMIND_AS_UTC: ["(public._probe_now() AT TIME ZONE 'America/Chicago')::date", "(public._probe_now() AT TIME ZONE 'UTC')::date"],
  PICKUP_REMIND_FUTURE_EDGE: ["b.slot_start > public._probe_now()\n", "b.slot_start >= public._probe_now()\n"],
  PICKUP_REMIND_TITLE_EDGE: ["r.slot_start - public._probe_now() >= interval '50 minutes'", "r.slot_start - public._probe_now() > interval '50 minutes'"],
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
const MIN = 60_000;
const seed = async ({ slot, handover = "pickup_home" }) => {
  await db.exec(`DELETE FROM public.sent; DELETE FROM public.declutter_cart_items; DELETE FROM public.declutter_items;
                 DELETE FROM public.declutter_bookings; DELETE FROM public.declutter_orders;`);
  await q(`INSERT INTO public.declutter_orders (id, handover) VALUES (1, $1)`, [handover]);
  await q(`INSERT INTO public.declutter_bookings (order_id, slot_start) VALUES (1, $1)`, [iso(slot)]);
  await q(`INSERT INTO public.declutter_items VALUES (1, 'Oak chair')`);
  await q(`INSERT INTO public.declutter_cart_items (order_id, item_id) VALUES (1, 1)`);
};
const sweep = async (nowMs) => {
  await setClock(db, iso(nowMs));
  const n = (await q(`SELECT public.declutter_pickup_reminder_sweep() AS n`))[0].n;
  const sent = await q(`SELECT title, body FROM public.sent ORDER BY body`);
  return { n, sent };
};

// 1. The window's two edges, on a CDT afternoon.
const N = Date.UTC(2026, 6, 15, 20, 0, 0); // 3:00 PM CDT, 15 July
{
  await seed({ slot: N });
  const r = await sweep(N);
  check("slot exactly now: no reminder (the time has come)", r.n === 0 && r.sent.length === 0, String(r.n));
  await seed({ slot: N + 1 });
  const r2 = await sweep(N);
  check("slot 1 ms from now: reminded, both sides", r2.n === 1 && r2.sent.length === 2, String(r2.n));
  await seed({ slot: N + 60 * MIN });
  const r3 = await sweep(N);
  check("slot exactly 60 min away: reminded, \"Pickup in 1 hour\"", r3.n === 1 && r3.sent.every((s) => s.title === "Pickup in 1 hour"), JSON.stringify(r3.sent.map((s) => s.title)));
  await seed({ slot: N + 60 * MIN + 1 });
  const r4 = await sweep(N);
  check("slot 60 min + 1 ms away: not yet", r4.n === 0 && r4.sent.length === 0, String(r4.n));
}

// 2. The title's 50-minute edge.
{
  await seed({ slot: N + 50 * MIN });
  const r = await sweep(N);
  check("slot exactly 50 min away: \"Pickup in 1 hour\"", r.sent.length === 2 && r.sent.every((s) => s.title === "Pickup in 1 hour"), JSON.stringify(r.sent.map((s) => s.title)));
  await seed({ slot: N + 50 * MIN - 1 });
  const r2 = await sweep(N);
  // 3:49:59.999 PM CDT prints as 3:49 PM (to_char drops the seconds).
  check("slot 1 ms under 50 min away: names the Central time", r2.sent.length === 2 && r2.sent.every((s) => s.title === "Pickup at 3:49 PM"), JSON.stringify(r2.sent.map((s) => s.title)));
  await seed({ slot: N + 30 * MIN, handover: "porch" });
  const r3 = await sweep(N);
  check("a porch pickup 30 min away: \"Porch pickup at 3:30 PM\"", r3.sent.length === 2 && r3.sent.every((s) => s.title === "Porch pickup at 3:30 PM"), JSON.stringify(r3.sent.map((s) => s.title)));
}

// 3. Today or tomorrow, by the Louisiana date, across a Central midnight. Each case: swept at `at`, slot 30 min later.
const days = [
  // CDT: Louisiana midnight is 05:00Z. 04:40Z is 11:40 PM the day before; the slot at 05:10Z is 12:10 AM tomorrow.
  { name: "CDT, 11:40 PM, slot 12:10 AM after Louisiana midnight", at: Date.UTC(2026, 6, 15, 4, 40), slotMin: 30, day: "tomorrow", time: "12:10 AM" },
  { name: "CDT, 12:00 AM exactly, slot 12:30 AM the same Louisiana day", at: Date.UTC(2026, 6, 15, 5, 0), slotMin: 30, day: "today", time: "12:30 AM" },
  // Also CDT: 00:30Z is 7:30 PM Central the same day, although it is already the next day in UTC.
  { name: "CDT evening, already tomorrow in UTC: still today in Louisiana", at: Date.UTC(2026, 6, 16, 0, 30), slotMin: 30, day: "today", time: "8:00 PM" },
  // CST: Louisiana midnight is 06:00Z.
  { name: "CST, 11:40 PM, slot 12:10 AM after Louisiana midnight", at: Date.UTC(2026, 0, 20, 5, 40), slotMin: 30, day: "tomorrow", time: "12:10 AM" },
  { name: "CST, 1 ms before Louisiana midnight, slot 30 min later", at: Date.UTC(2026, 0, 20, 6, 0) - 1, slotMin: 30, day: "tomorrow", time: "12:29 AM" },
  // Spring forward, Sunday 8 March 2026: 2:00 AM CST jumps to 3:00 AM CDT at 08:00Z. A slot at 08:10Z is 3:10 AM CDT.
  { name: "spring-forward Sunday, 1:50 AM CST, slot at 3:10 AM CDT (20 min later)", at: Date.UTC(2026, 2, 8, 7, 50), slotMin: 20, day: "today", time: "3:10 AM" },
  // ... and its Louisiana midnight that night is 05:00Z on the 9th (CDT).
  { name: "spring-forward Sunday night, 11:50 PM CDT, slot 12:10 AM Monday", at: Date.UTC(2026, 2, 9, 4, 50), slotMin: 20, day: "tomorrow", time: "12:10 AM" },
  // Fall back, Sunday 1 November 2026: 2:00 AM CDT falls back to 1:00 AM CST at 07:00Z; the 2nd begins at 06:00Z.
  { name: "fall-back Sunday, 1:50 AM CDT, slot 1:10 AM CST (20 min later)", at: Date.UTC(2026, 10, 1, 6, 50), slotMin: 20, day: "today", time: "1:10 AM" },
  { name: "fall-back Sunday night, 11:50 PM CST, slot 12:10 AM Monday", at: Date.UTC(2026, 10, 2, 5, 50), slotMin: 20, day: "tomorrow", time: "12:10 AM" },
];
for (const c of days) {
  await seed({ slot: c.at + c.slotMin * MIN });
  const r = await sweep(c.at);
  const buyer = r.sent.find((s) => s.body.startsWith("Your pickup"));
  const want = `Your pickup of Oak chair is at ${c.time} ${c.day}.`;
  check(c.name, r.n === 1 && !!buyer && buyer.body.startsWith(want), buyer ? buyer.body : `swept ${r.n}`);
}

// 4. Once per slot: the same clock again sends nothing more.
{
  await seed({ slot: N + 40 * MIN });
  await sweep(N);
  const again = await sweep(N + 5 * MIN);
  check("the next run (5 min later) does not remind the same slot again", again.n === 0, String(again.n));
}

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
