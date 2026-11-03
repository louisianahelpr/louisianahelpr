/**
 * Q1424 PGlite proof: declutter_wanted_sweep's clock windows, on a fixed clock (./lib/fixedClock.mjs, newest CREATE
 * of the function). declutterWantedMatchManage.pglite.mjs moves expires_at relative to now(); this one moves the
 * clock and reads each edge 1 ms either side:
 *   ends soon     w.expires_at > now AND w.expires_at <= now + 3 days
 *                 (ends exactly 3 days out: told; 3 days + 1 ms: not yet; ends exactly now: not told, it has ended;
 *                 1 ms from now: told), once (expiry_told_at stamped with the clock), across a DST Sunday too
 *                 (3 days is 72 hours of clock time, not 3 calendar days);
 *   photo check   w.photo_added_at <= now - 1 hour: an unchecked photo goes to an admin exactly 1 h after it was
 *                 added, not 1 ms sooner.
 *
 *   node src/test/pglite/declutterWantedSweepClock.pglite.mjs
 *   WANTED_ENDS_INCLUSIVE=1 node src/test/pglite/declutterWantedSweepClock.pglite.mjs   # RED: the 3-day edge moved by one
 *   WANTED_ENDED_COUNTS=1 node src/test/pglite/declutterWantedSweepClock.pglite.mjs     # RED: a post ending now counts as ahead
 *   WANTED_PHOTO_STRICT=1 node src/test/pglite/declutterWantedSweepClock.pglite.mjs     # RED: the 1-hour edge made strict
 *
 * The notice, block, photo-hold and match helpers (their own proofs) are stubbed to record their calls.
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
CREATE TABLE public.feature_switches (key text PRIMARY KEY, audience text);
INSERT INTO public.feature_switches VALUES ('declutter', 'everyone'), ('declutter_wanted', 'everyone');
CREATE TABLE public.declutter_wanted (
  id int PRIMARY KEY, user_id uuid DEFAULT gen_random_uuid(), what text DEFAULT 'Crib', status text DEFAULT 'open',
  removed_at timestamptz, expiry_told_at timestamptz, expires_at timestamptz, photo_added_at timestamptz,
  photo_paths text[] DEFAULT '{}', photos_cleared text[] DEFAULT '{}', photos_held text[] DEFAULT '{}');
CREATE TABLE public.declutter_wanted_queue (item_id int PRIMARY KEY, queued_at timestamptz, attempts int DEFAULT 0);
CREATE TABLE public.calls (kind text, wanted_id int);
CREATE FUNCTION public.declutter_wanted_alert_block(p_user uuid) RETURNS text LANGUAGE sql AS $$ SELECT NULL::text $$;
CREATE FUNCTION public.declutter_wanted_notify(p_user uuid, p_title text, p_body text, p_link text) RETURNS int
  LANGUAGE sql AS $$ INSERT INTO public.calls SELECT 'notify', w.id FROM public.declutter_wanted w WHERE w.user_id = p_user; SELECT 1 $$;
CREATE FUNCTION public.declutter_wanted_hold_photos(p_id int, p_by uuid, p_why text) RETURNS void
  LANGUAGE sql AS $$ INSERT INTO public.calls VALUES ('hold', p_id) $$;
CREATE FUNCTION public.declutter_wanted_match_item(p_item int) RETURNS int LANGUAGE sql AS $$ SELECT 0 $$;
CREATE FUNCTION public.log_cron_defect(a text, b text, c text) RETURNS void LANGUAGE sql AS $$ INSERT INTO public.calls VALUES ('defect: ' || c, NULL) $$;
`);
const { file, stmt } = newestFunction("declutter_wanted_sweep");
const base = onFixedClock(stmt);
let fixed = base;
check(`every clock read is on the fixed clock (${file})`, !/\bnow\s*\(\s*\)/i.test(fixed) && /_probe_now\(\)/.test(fixed));
const mutations = {
  WANTED_ENDS_INCLUSIVE: ["w.expires_at <= public._probe_now() + interval '3 days'", "w.expires_at < public._probe_now() + interval '3 days'"],
  WANTED_ENDED_COUNTS: ["w.expires_at > public._probe_now() AND", "w.expires_at >= public._probe_now() AND"],
  WANTED_PHOTO_STRICT: ["w.photo_added_at <= public._probe_now() - interval '1 hour'", "w.photo_added_at < public._probe_now() - interval '1 hour'"],
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
// Replay-safe: applies 3x (the REVOKE/GRANT tail, if any, needs the three roles created above).
for (let i = 0; i < 3; i++) await db.exec(fixed);

const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());
const H = 3_600_000;
const D = 24 * H;
const seed = async ({ expiresAt, photoAddedAt = null }) => {
  await db.exec(`DELETE FROM public.calls; DELETE FROM public.declutter_wanted;`);
  await q(`INSERT INTO public.declutter_wanted (id, expires_at, photo_added_at, photo_paths) VALUES (1, $1, $2, $3)`,
    [iso(expiresAt), iso(photoAddedAt), photoAddedAt == null ? [] : ["w/1/a.jpg"]]);
};
const sweep = async (nowMs) => {
  await setClock(db, iso(nowMs));
  await db.exec(`DELETE FROM public.calls;`);
  await q(`SELECT public.declutter_wanted_sweep()`);
  const calls = await q(`SELECT kind FROM public.calls`);
  const [{ told }] = await q(`SELECT expiry_told_at::text told FROM public.declutter_wanted WHERE id = 1`);
  return { notified: calls.filter((c) => c.kind === "notify").length, held: calls.filter((c) => c.kind === "hold").length,
    defects: calls.filter((c) => c.kind.startsWith("defect")).map((c) => c.kind), told };
};

const N = Date.UTC(2026, 6, 15, 20, 0, 0); // 3:00 PM CDT, 15 July
// 1. The "ends soon" window.
{
  await seed({ expiresAt: N + 3 * D });
  const r = await sweep(N);
  check("ends exactly 3 days out: told once, expiry_told_at = the clock", r.notified === 1 && r.told === "2026-07-15 20:00:00+00", JSON.stringify(r));
  const again = await sweep(N + H);
  check("an hour later: not told again", again.notified === 0, JSON.stringify(again));
  await seed({ expiresAt: N + 3 * D + 1 });
  const r2 = await sweep(N);
  check("ends 3 days + 1 ms out: not yet", r2.notified === 0 && r2.told === null, JSON.stringify(r2));
  await seed({ expiresAt: N });
  const r3 = await sweep(N);
  check("ends exactly now: not told (it has ended)", r3.notified === 0 && r3.told === null, JSON.stringify(r3));
  await seed({ expiresAt: N + 1 });
  const r4 = await sweep(N);
  check("ends 1 ms from now: told", r4.notified === 1, JSON.stringify(r4));
}
// 2. Across the fall-back Sunday (1 Nov 2026, a 25-hour Louisiana day): 3 days is 72 hours of clock time.
{
  const at = Date.UTC(2026, 9, 30, 17, 0, 0); // Fri 30 Oct, 12:00 PM CDT
  await seed({ expiresAt: at + 72 * H });
  const r = await sweep(at);
  check("fall-back weekend: ends exactly 72 h out (11:00 AM CST Monday): told", r.notified === 1, JSON.stringify(r));
  await seed({ expiresAt: at + 72 * H + 1 });
  const r2 = await sweep(at);
  check("fall-back weekend: 72 h + 1 ms out (although before noon Monday, Central): not yet", r2.notified === 0, JSON.stringify(r2));
}
// 3. The unchecked photo goes to an admin after 1 hour.
{
  await seed({ expiresAt: N + 20 * D, photoAddedAt: N - H + 1 });
  const r = await sweep(N);
  check("photo added 1 h minus 1 ms ago, never checked: not held yet", r.held === 0, JSON.stringify(r));
  await seed({ expiresAt: N + 20 * D, photoAddedAt: N - H });
  const r2 = await sweep(N);
  check("photo added exactly 1 h ago, never checked: held for an admin", r2.held === 1, JSON.stringify(r2));
  check("no sweep defects were logged", r.defects.length === 0 && r2.defects.length === 0, JSON.stringify([...r.defects, ...r2.defects]));
}

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
