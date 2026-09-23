#!/usr/bin/env node
/**
 * Concurrency proof for the ops alert ledger (docs/OPEN.md Q1, review HIGH):
 * the ledger must NEVER block the transaction that raised the alert.
 *
 * PGlite is one backend, so it cannot hold two transactions at once. This runs
 * a real, throwaway Postgres (embedded-postgres, not a repo dependency):
 *
 *   mkdir -p ~/.lh-pg-embedded && cd ~/.lh-pg-embedded \
 *     && echo '{"name":"lh-pg-embedded","private":true,"type":"module"}' > package.json \
 *     && npm i embedded-postgres pg
 *   node scripts/probes/ops-alert-ledger-concurrency.embedded-pg.mjs
 *
 * Two clusters:
 *   BEFORE  only 20260923043402_ops_alert_ledger. Expected to BLOCK: tx2 waits
 *           for tx1's COMMIT. (Shown red on the original; bounded here with a
 *           5 s statement_timeout so the probe itself cannot hang.)
 *   AFTER   + 20260923050059 (bounded lock_timeout + ops_alert_pending).
 *           tx2 must return in < 1 s, neither transaction may fail, the
 *           caller's own lock_timeout must be untouched afterwards, and the
 *           deferred occurrence must be counted after ops_alert_verify().
 */
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DIR = process.env.PG_EMBED_DIR ?? `${process.env.HOME}/.lh-pg-embedded`;
let EmbeddedPostgres, pg;
try {
  ({ default: EmbeddedPostgres } = await import(`${DIR}/node_modules/embedded-postgres/dist/index.js`));
  ({ default: pg } = await import(`${DIR}/node_modules/pg/lib/index.js`));
} catch (e) {
  console.error(`Could not load embedded-postgres/pg from ${DIR}: ${e.message}`);
  process.exit(2);
}

const mig = (f) => readFileSync(new URL(`../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const OLD = mig("20260923043402_ops_alert_ledger.sql");
const NEW = mig("20260923050059_ops_alert_ledger_never_blocks_and_keeps_status_codes.sql");

const SETUP = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE TYPE public.app_role AS ENUM ('admin','customer','helper');
CREATE TABLE public.user_roles (user_id uuid, role public.app_role);
CREATE OR REPLACE FUNCTION public.has_role(_uid uuid, _role public.app_role) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role = _role) $$;
CREATE TABLE public.error_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  severity text, message text, url text, stack text, user_id uuid,
  tags jsonb, context jsonb, created_at timestamptz DEFAULT now());
CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_session_id text, payment_status text, created_at timestamptz DEFAULT now());
CREATE TABLE public.cron_work_expectations (jobname text PRIMARY KEY, registered_at timestamptz,
  expected_max_gap interval, min_streak int, note text, candidate_key text, disposition_keys text[]);
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;
`;

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LOG = (msg) => `INSERT INTO public.error_logs (severity, message, tags)
  VALUES ('error', '${msg}', '{"source":"stripe-webhook","origin":"server"}')`;

async function cluster(label, migrations, port) {
  const dataDir = mkdtempSync(join(tmpdir(), `lh-ledger-${label}-`));
  const server = new EmbeddedPostgres({ databaseDir: dataDir, user: "postgres", password: "pw", port, persistent: false, onLog: () => {} });
  await server.initialise();
  await server.start();
  const conn = () => new pg.Client({ host: "localhost", port, user: "postgres", password: "pw", database: "postgres" });
  const admin = conn();
  await admin.connect();
  await admin.query(SETUP);
  await admin.query(`INSERT INTO public.cron_work_expectations (jobname, registered_at) VALUES ('ops-daily-digest', now() - interval '10 days')`);
  for (const m of migrations) await admin.query(m);
  const stop = async () => {
    await admin.end().catch(() => {});
    await server.stop().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
  };
  return { admin, conn, stop };
}

/**
 * tx1 logs `msg` and holds its transaction open for HOLD ms; meanwhile tx2
 * logs the same fingerprint. Returns tx2's elapsed ms and both outcomes.
 */
async function race({ conn }, msg, { holdMs = 3000, tx2Setup = "" } = {}) {
  const c1 = conn(), c2 = conn();
  await c1.connect(); await c2.connect();
  await c1.query("SET ROLE service_role"); await c2.query("SET ROLE service_role");
  // Mirror prod: lock_timeout 0; service_role has no statement_timeout of its
  // own. 5 s here only so the BEFORE case cannot hang the probe.
  await c2.query("SET statement_timeout = '5s'");
  await c1.query("BEGIN");
  await c1.query(LOG(msg));
  await c2.query("BEGIN");
  if (tx2Setup) await c2.query(tx2Setup);
  const t0 = performance.now();
  const tx1Done = sleep(holdMs).then(() => c1.query("COMMIT")).then(() => "committed", (e) => `failed: ${e.message}`);
  let tx2 = "ok", lockAfter = null;
  try {
    await c2.query(LOG(msg));
  } catch (e) { tx2 = `failed: ${e.message}`; }
  const ms = performance.now() - t0;
  if (tx2 === "ok") lockAfter = (await c2.query("SHOW lock_timeout")).rows[0].lock_timeout;
  const tx2Commit = tx2 === "ok" ? await c2.query("COMMIT").then(() => "committed", (e) => `failed: ${e.message}`) : (await c2.query("ROLLBACK"), "rolled back");
  const tx1 = await tx1Done;
  await c1.end(); await c2.end();
  return { ms: Math.round(ms), tx1, tx2, tx2Commit, lockAfter };
}

const count = async (db, like) =>
  Number((await db.admin.query(`SELECT coalesce(sum(count),0) n FROM public.ops_alert_ledger WHERE sample LIKE $1`, [like])).rows[0].n);
const pending = async (db) => Number((await db.admin.query(`SELECT count(*) n FROM public.ops_alert_pending`)).rows[0].n);

// ── BEFORE: the original migration alone ─────────────────────────────────────
{
  const db = await cluster("before", [OLD], 54391);
  // committed row exists; tx1 holds its row lock
  await db.admin.query(LOG("Transfer failed for job 11111111-1111-1111-1111-111111111111"));
  const r = await race(db, "Transfer failed for job 22222222-2222-2222-2222-222222222222");
  console.log(`BEFORE  existing row: tx2 waited ${r.ms} ms (tx1 held 3000 ms)  tx1=${r.tx1} tx2=${r.tx2}`);
  check("BEFORE fix, the second logger BLOCKS on the first (original bug reproduced)", r.ms >= 2500, `${r.ms} ms`);
  await db.stop();
}

// ── AFTER: + the fix ────────────────────────────────────────────────────────
{
  const db = await cluster("after", [OLD, NEW, OLD, NEW, OLD, NEW], 54392);
  check("AFTER: old+new migrations apply 3x in order", true);

  // 1. a committed row exists; tx1 holds its row lock
  await db.admin.query(LOG("Transfer failed for job 11111111-1111-1111-1111-111111111111"));
  let r = await race(db, "Transfer failed for job 22222222-2222-2222-2222-222222222222");
  console.log(`AFTER   existing row: tx2 returned in ${r.ms} ms  tx1=${r.tx1} tx2=${r.tx2}/${r.tx2Commit} lock_timeout after=${r.lockAfter}`);
  check("existing hot row: second logger returns < 1 s", r.ms < 1000, `${r.ms} ms`);
  check("existing hot row: neither transaction fails", r.tx1 === "committed" && r.tx2 === "ok" && r.tx2Commit === "committed", JSON.stringify(r));
  check("caller's lock_timeout is untouched afterwards (0, not 100ms)", r.lockAfter === "0", r.lockAfter);
  check("the deferred occurrence is queued, not lost", (await pending(db)) === 1, `pending=${await pending(db)}`);
  check("ledger count before fold = 2 (seed + tx1)", (await count(db, "Transfer failed%")) === 2);
  const v = (await db.admin.query(`SELECT public.ops_alert_verify() r`)).rows[0].r;
  check("ops_alert_verify folds it: count = 3, pending = 0", (await count(db, "Transfer failed%")) === 3 && (await pending(db)) === 0 && v.folded === 1, JSON.stringify(v));

  // 2. brand-new fingerprint, first insert still uncommitted
  r = await race(db, "Refund failed for job 33333333-3333-3333-3333-333333333333");
  console.log(`AFTER   new fingerprint in flight: tx2 returned in ${r.ms} ms  tx1=${r.tx1} tx2=${r.tx2}/${r.tx2Commit}`);
  check("brand-new fingerprint in flight: second logger returns < 1 s", r.ms < 1000, `${r.ms} ms`);
  check("brand-new fingerprint: neither transaction fails", r.tx1 === "committed" && r.tx2 === "ok" && r.tx2Commit === "committed", JSON.stringify(r));
  await db.admin.query(`SELECT public.ops_alert_verify()`);
  check("brand-new fingerprint: one item, count 2 after fold",
    Number((await db.admin.query(`SELECT count(*) n, max(count) c FROM public.ops_alert_ledger WHERE sample LIKE 'Refund failed%'`)).rows[0].c) === 2);

  // 3. a caller with its OWN tighter lock_timeout keeps it
  r = await race(db, "Transfer failed for job 44444444-4444-4444-4444-444444444444", { tx2Setup: "SET LOCAL lock_timeout = '50ms'" });
  check("a caller's own 50ms lock_timeout is kept, and it still returns promptly", r.lockAfter === "50ms" && r.ms < 1000, `${r.lockAfter}, ${r.ms} ms`);

  // 4. uncontended: nothing is deferred
  const before = await pending(db);
  await db.admin.query(LOG("Transfer failed for job 55555555-5555-5555-5555-555555555555"));
  check("uncontended write goes straight to the ledger", (await pending(db)) === before);

  await db.stop();
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
