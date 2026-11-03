/**
 * Q1424 PGlite proof: declutter_refund_request_sweep's deadlines, on a fixed clock (./lib/fixedClock.mjs, newest
 * CREATE of the sweep and of declutter_return_backstop_at). declutterRefundRequests.pglite.mjs moves answer_by /
 * offer_answer_by relative to now(); this one moves the clock and reads each edge 1 ms either side:
 *   open       answer_by <= now          (exactly at answer_by: to an admin; 1 ms before: not yet)
 *   offered    offer_answer_by <= now    (the same)
 *   returning  return_by <= now AND the backstop <= now, the backstop being the later of return_by and
 *              collect: return_at + 24 h; drop_off: Louisiana midnight after return_day + 24 h (CDT, CST and across the
 *              fall-back Sunday, where that midnight is 05:00Z and the next is 06:00Z).
 *
 *   node src/test/pglite/declutterRefundRequestClock.pglite.mjs
 *   REFUND_OPEN_STRICT=1 node src/test/pglite/declutterRefundRequestClock.pglite.mjs     # RED: answer_by edge made strict
 *   REFUND_BACKSTOP_UTC=1 node src/test/pglite/declutterRefundRequestClock.pglite.mjs    # RED: the drop-off midnight read in UTC
 *
 * declutter_lock_order and declutter_refund_request_to_admin (their own proofs) are stubbed to record the call.
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
CREATE TABLE public.declutter_refund_requests (
  id uuid PRIMARY KEY, order_id uuid, status text, answer_by timestamptz, offer_answer_by timestamptz, offer_cents int,
  return_by timestamptz, return_way text, return_at timestamptz, return_day date, return_dropped_off_at timestamptz,
  created_at timestamptz DEFAULT '2026-01-01');
CREATE TABLE public.to_admin (id uuid, why text);
CREATE FUNCTION public.declutter_lock_order(p uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.declutter_refund_request_to_admin(p uuid, p_why text) RETURNS void LANGUAGE sql AS $$ INSERT INTO public.to_admin VALUES (p, p_why) $$;
CREATE FUNCTION public.log_cron_defect(a text, b text, c text) RETURNS void LANGUAGE sql AS $$ INSERT INTO public.to_admin VALUES (NULL, 'defect: ' || c) $$;
`);
const backstop = newestFunction("declutter_return_backstop_at");
const sweepFn = newestFunction("declutter_refund_request_sweep");
let helper = onFixedClock(backstop.stmt);
const base = onFixedClock(sweepFn.stmt);
let fixed = base;
check(`every clock read is on the fixed clock (${sweepFn.file})`, !/\bnow\s*\(\s*\)/i.test(fixed) && /_probe_now\(\)/.test(fixed));
check("the backstop helper reads no clock of its own", !/_probe_now\(\)/.test(helper));
let mutated = false;
if (process.env.REFUND_OPEN_STRICT) {
  console.log("REFUND_OPEN_STRICT=1 (expect FAILs)");
  const from = "WHERE (x.status = 'open' AND x.answer_by <= public._probe_now())";
  check("REFUND_OPEN_STRICT: the text to change is in the newest body", fixed.includes(from));
  fixed = fixed.replace(from, "WHERE (x.status = 'open' AND x.answer_by < public._probe_now())");
  mutated = true;
}
if (process.env.REFUND_BACKSTOP_UTC) {
  console.log("REFUND_BACKSTOP_UTC=1 (expect FAILs)");
  const from = "((r.return_day + 1)::timestamp AT TIME ZONE 'America/Chicago')";
  check("REFUND_BACKSTOP_UTC: the text to change is in the newest helper", helper.includes(from));
  helper = helper.replace(from, "((r.return_day + 1)::timestamp AT TIME ZONE 'UTC')");
  mutated = true;
}
check("the mutation (if any) applied", !mutated || fixed !== base || helper !== onFixedClock(backstop.stmt));
// Replay-safe: applies 3x (the REVOKE/GRANT tails need the three roles created above).
for (let i = 0; i < 3; i++) { await db.exec(helper); await db.exec(fixed); }

const ID = "44444444-4444-4444-8444-444444444444";
const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());
const H = 3_600_000;
const seed = async (row) => {
  await db.exec(`DELETE FROM public.to_admin; DELETE FROM public.declutter_refund_requests;`);
  await q(`INSERT INTO public.declutter_refund_requests (id, order_id, status, answer_by, offer_answer_by, offer_cents, return_by, return_way, return_at, return_day)
           VALUES ($1, gen_random_uuid(), $2, $3, $4, 1500, $5, $6, $7, $8)`,
    [ID, row.status, iso(row.answerBy), iso(row.offerBy), iso(row.returnBy), row.way ?? null, iso(row.returnAt), row.day ?? null]);
};
const sweep = async (nowMs) => {
  await setClock(db, iso(nowMs));
  const res = (await q(`SELECT public.declutter_refund_request_sweep() AS r`))[0].r;
  const calls = await q(`SELECT why FROM public.to_admin`);
  return { n: res.to_admin, why: calls.map((c) => c.why) };
};
const pair = async (name, row, edge, wantWhy) => {
  await seed(row);
  const early = await sweep(edge - 1);
  check(`${name}: 1 ms before: not yet`, early.n === 0 && early.why.length === 0, JSON.stringify(early));
  await seed(row);
  const at = await sweep(edge);
  check(`${name}: exactly at the deadline: to an admin`, at.n === 1 && at.why[0] === wantWhy, JSON.stringify(at));
};

const N = Date.UTC(2026, 6, 15, 20, 0, 0);
await pair("open, seller never answered", { status: "open", answerBy: N }, N, "the seller did not answer in 24 hours");
await pair("offered, buyer never answered", { status: "offered", offerBy: N }, N, "the seller offered $15.00 back and the buyer did not answer in 24 hours");
// Collect: return_by earlier; the backstop is return_at + 24 h.
await pair("returning by collect", { status: "returning", returnBy: N - 30 * H, way: "collect", returnAt: N - 24 * H }, N,
  "the seller agreed to a full refund but did not confirm getting the item back in time");
// Collect, but return_by is the later one: it wins.
await pair("returning by collect, return_by later than return_at + 24 h", { status: "returning", returnBy: N, way: "collect", returnAt: N - 48 * H }, N,
  "the seller agreed to a full refund but did not confirm getting the item back in time");
// Drop-off on Wed 15 July (CDT): Louisiana midnight after it is 05:00Z Thu 16 July; + 24 h = 05:00Z Fri 17 July.
await pair("returning by drop-off, CDT", { status: "returning", returnBy: N, way: "drop_off", day: "2026-07-15" }, Date.UTC(2026, 6, 17, 5, 0, 0),
  "the seller agreed to a full refund but did not confirm getting the item back in time");
// Drop-off on Tue 20 Jan (CST): midnight after is 06:00Z Wed 21 Jan; + 24 h = 06:00Z Thu 22 Jan.
await pair("returning by drop-off, CST", { status: "returning", returnBy: Date.UTC(2026, 0, 20, 12), way: "drop_off", day: "2026-01-20" }, Date.UTC(2026, 0, 22, 6, 0, 0),
  "the seller agreed to a full refund but did not confirm getting the item back in time");
// Drop-off on Sat 31 Oct: the midnight after is Sun 1 Nov 00:00 CDT = 05:00Z; + 24 clock hours = 05:00Z Mon 2 Nov
// (11:00 PM CST Sunday, the fall-back day being 25 hours long).
await pair("returning by drop-off, across the fall-back Sunday", { status: "returning", returnBy: Date.UTC(2026, 9, 31, 12), way: "drop_off", day: "2026-10-31" }, Date.UTC(2026, 10, 2, 5, 0, 0),
  "the seller agreed to a full refund but did not confirm getting the item back in time");

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
