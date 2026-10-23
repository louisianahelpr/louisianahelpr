/**
 * Q1424 PGlite proof: sms_dispatch_due's one clock edge, on a fixed clock
 * (./lib/fixedClock.mjs, newest CREATE of the function):
 *   due   a 'pending' sms_messages row is due when due_at <= now. A row due
 *         exactly now wakes send-sms-notification once; a row due 1 ms from
 *         now does not (no network call on a minute with nothing due); a row
 *         that is not 'pending' never counts.
 *
 *   node src/test/pglite/smsDispatchClock.pglite.mjs
 *   SMS_DISPATCH_STRICT=1 node src/test/pglite/smsDispatchClock.pglite.mjs   # RED: the edge moved by one
 *
 * pglite is loaded from ~/.lh-pglite (CLAUDE.md). Registered in
 * src/test/clockFunctionsProven.test.ts.
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
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TABLE public.sms_messages (id serial, status text NOT NULL, due_at timestamptz NOT NULL);
-- The network call is out of scope (smsAlerts.pglite.mjs proves the send): record each wake.
CREATE TABLE public._probe_posts (id serial, body jsonb);
CREATE FUNCTION public.sms_post_to_edge(p_body jsonb) RETURNS void LANGUAGE sql AS $$ INSERT INTO public._probe_posts (body) VALUES (p_body) $$;
`);
const { file, stmt } = newestFunction("sms_dispatch_due");
let fixed = onFixedClock(stmt);
check(`every clock read is on the fixed clock (${file})`, !/\bnow\s*\(\s*\)/i.test(fixed) && /_probe_now\(\)/.test(fixed));
if (process.env.SMS_DISPATCH_STRICT) {
  console.log("SMS_DISPATCH_STRICT=1: the due edge moved by one (expect FAILs)");
  fixed = fixed.replace("due_at <= public._probe_now()", "due_at < public._probe_now()");
}
for (let i = 0; i < 3; i++) await db.exec(fixed); // replay-safe: applies 3x

const iso = (ms) => new Date(ms).toISOString();
const N = Date.UTC(2026, 10, 1, 12, 0, 0); // the fall-back day: 24 h of UTC, 25 of Central wall clock
await setClock(db, iso(N));
const run = async () => (await q(`SELECT public.sms_dispatch_due() AS r`))[0].r;
const posts = async () => (await q(`SELECT count(*)::int n FROM public._probe_posts`))[0].n;
const reset = () => db.exec(`DELETE FROM public.sms_messages; DELETE FROM public._probe_posts;`);

{
  await reset();
  await q(`INSERT INTO public.sms_messages (status, due_at) VALUES ('pending', $1)`, [iso(N + 1)]);
  const r = await run();
  check("a pending text due 1 ms from now is not due: no wake", Number(r.due) === 0 && (await posts()) === 0, JSON.stringify(r));
}
{
  await reset();
  await q(`INSERT INTO public.sms_messages (status, due_at) VALUES ('pending', $1)`, [iso(N)]);
  const r = await run();
  const p = await q(`SELECT body FROM public._probe_posts`);
  check("a pending text due exactly now is due: one wake with {drain:true}", Number(r.due) === 1 && p.length === 1 && p[0].body.drain === true, JSON.stringify(r));
}
{
  await reset();
  await q(`INSERT INTO public.sms_messages (status, due_at) VALUES ('pending', $1), ('pending', $2)`, [iso(N - 1), iso(N - 60_000)]);
  const r = await run();
  check("two overdue texts wake the function ONCE (it drains them)", Number(r.due) === 2 && (await posts()) === 1, JSON.stringify(r));
}
{
  await reset();
  await q(`INSERT INTO public.sms_messages (status, due_at) VALUES ('sent', $1), ('skipped', $1), ('failed', $1)`, [iso(N - 1)]);
  const r = await run();
  check("settled rows (sent, skipped, failed) never count as due", Number(r.due) === 0 && (await posts()) === 0, JSON.stringify(r));
}
{
  // Move the clock itself: the same row is not due a millisecond before its time and is due at it.
  await reset();
  await q(`INSERT INTO public.sms_messages (status, due_at) VALUES ('pending', $1)`, [iso(N + 180_000)]);
  await setClock(db, iso(N + 180_000 - 1));
  const before = await run();
  await setClock(db, iso(N + 180_000));
  const at = await run();
  check("moving the clock to the due time (3 min on) makes the queued text due", Number(before.due) === 0 && Number(at.due) === 1 && (await posts()) === 1, `${JSON.stringify(before)} ${JSON.stringify(at)}`);
  await setClock(db, iso(N));
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
