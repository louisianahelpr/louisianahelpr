/**
 * Q1424 PGlite proof: reap_stranded_instant_payouts' 30-minute edge, on a fixed clock (./lib/fixedClock.mjs, newest
 * CREATE of the function). The edge is strict: an instant payout pending exactly 30 min is left alone (the edge
 * function may still record its outcome); 1 ms older it is reaped to 'failed' with its earlier error text kept, an
 * error_logs row written and the ops alert sent once.
 *
 *   node src/test/pglite/reapInstantPayoutsClock.pglite.mjs
 *   REAP_INCLUSIVE=1 node src/test/pglite/reapInstantPayoutsClock.pglite.mjs   # RED: the 30-min edge made inclusive
 *
 * net.http_post and vault.decrypted_secrets are stubbed (slack-ops-alert is its own proof). pglite is loaded from
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
CREATE SCHEMA net;
CREATE SCHEMA vault;
CREATE TABLE vault.decrypted_secrets (name text, decrypted_secret text);
INSERT INTO vault.decrypted_secrets VALUES ('supabase_url', 'http://probe'), ('service_role_key', 'k');
CREATE TABLE public.alerts (body jsonb);
CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO public.alerts VALUES (body); SELECT 1::bigint $$;
CREATE TABLE public.instant_payouts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), helper_id uuid, net_amount int DEFAULT 1000, status text DEFAULT 'pending',
  error_message text, created_at timestamptz, updated_at timestamptz);
CREATE TABLE public.error_logs (severity text, message text, tags jsonb, context jsonb);
`);
const { file, stmt } = newestFunction("reap_stranded_instant_payouts");
const base = onFixedClock(stmt);
let fixed = base;
check(`every clock read is on the fixed clock (${file})`, !/\bnow\s*\(\s*\)/i.test(fixed) && /_probe_now\(\)/.test(fixed));
if (process.env.REAP_INCLUSIVE) {
  console.log("REAP_INCLUSIVE=1 (expect FAILs)");
  const from = "p.created_at < public._probe_now() - interval '30 minutes'";
  check("REAP_INCLUSIVE: the text to change is there", fixed.includes(from));
  fixed = fixed.replace(from, "p.created_at <= public._probe_now() - interval '30 minutes'");
}
check("the mutation (if any) applied", !process.env.REAP_INCLUSIVE || fixed !== base);
// Replay-safe: applies 3x.
for (let i = 0; i < 3; i++) await db.exec(fixed);

const HELPR = "20202020-2020-4020-8020-202020202020";
const iso = (ms) => new Date(ms).toISOString();
const MIN = 60_000;
const seed = async (createdAt, err = null) => {
  await db.exec(`DELETE FROM public.alerts; DELETE FROM public.error_logs; DELETE FROM public.instant_payouts;`);
  await q(`INSERT INTO public.instant_payouts (helper_id, created_at, error_message) VALUES ($1, $2, $3)`, [HELPR, iso(createdAt), err]);
};
const run = async (nowMs) => {
  await setClock(db, iso(nowMs));
  const r = (await q(`SELECT public.reap_stranded_instant_payouts() AS r`))[0].r;
  const [{ status, error_message }] = await q(`SELECT status, error_message FROM public.instant_payouts`);
  const logs = (await q(`SELECT count(*)::int c FROM public.error_logs`))[0].c;
  const alerts = (await q(`SELECT count(*)::int c FROM public.alerts`))[0].c;
  return { reaped: r.reaped, status, error_message, logs, alerts };
};
const N = Date.UTC(2026, 6, 15, 20, 0, 0);
{
  await seed(N - 30 * MIN);
  const r = await run(N);
  check("pending exactly 30 min: left alone", r.reaped === 0 && r.status === "pending" && r.logs === 0 && r.alerts === 0, JSON.stringify(r));
  await seed(N - 30 * MIN - 1, "fee_uncollected: 25");
  const r2 = await run(N);
  check("pending 30 min + 1 ms: reaped to failed, the earlier note kept, logged, one alert",
    r2.reaped === 1 && r2.status === "failed" && r2.error_message.startsWith("fee_uncollected: 25 | reaped:") && r2.logs === 1 && r2.alerts === 1, JSON.stringify(r2));
}

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
