/**
 * PGlite proof: sweep_disputes_closed_without_payment never reports a SEED job's dispute (20261117041858).
 *
 * Measured on prod 2026-11-16 (read-only SQL): the sweep wrote "Dispute c5c85b7e on job 7e52c767 is marked executed
 * but moved no money ..." (source dispute-unsettled-seed, context is_seed:true), and four more seed disputes since
 * 2026-10-20. Owner rule: test or seed data never writes owner-facing alerts or error_logs rows.
 *
 * Runs the NEWEST CREATE of the sweep (any dollar tag, ./lib/fixedClock.mjs newestFunction), applied 3x:
 *   - a real job's executed-but-unpaid dispute is reported once, fatal, source dispute-unsettled (unchanged);
 *   - a seed job's identical dispute writes nothing;
 *   - a second run reports nothing new (the per-dispute dedupe still holds).
 *
 *   node src/test/pglite/disputeSweepSkipsSeedJobs.pglite.mjs
 *   SEED_REPORTED=1 node ...   # RED: the seed exclusion removed (the state before 20261117041858)
 *
 * pglite is loaded from ~/.lh-pglite (CLAUDE.md; override with PGLITE_DIR).
 */
import os from "node:os";
import { newestFunction } from "./lib/fixedClock.mjs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = new PGlite();
const q = async (sql, params) => (await db.query(sql, params)).rows;
await db.exec(`
CREATE ROLE service_role; CREATE ROLE authenticated; CREATE ROLE anon;
CREATE TABLE public.jobs (id uuid PRIMARY KEY, payment_status text, status text, is_seed boolean NOT NULL DEFAULT false,
  is_group_job boolean DEFAULT false, dispute_status text);
CREATE TABLE public.disputes (id uuid PRIMARY KEY, job_id uuid REFERENCES public.jobs(id), execution_status text,
  execution_transfer_id text, execution_refund_id text, execution_helper_cents int, execution_refund_cents int,
  execution_error text, payout_split jsonb, decided_at timestamptz);
CREATE TABLE public.error_logs (id serial PRIMARY KEY, severity text, message text, tags jsonb, context jsonb,
  created_at timestamptz DEFAULT now());
`);

const fn = newestFunction("sweep_disputes_closed_without_payment");
let stmt = fn.stmt;
const EXCLUDE = "AND j.is_seed IS NOT TRUE";
check(`the newest sweep (${fn.file}) leaves seed jobs out`, stmt.includes(EXCLUDE));
if (process.env.SEED_REPORTED) {
  console.log("SEED_REPORTED=1 (expect FAILs)");
  stmt = stmt.split(EXCLUDE).join("");
}
for (let i = 0; i < 3; i++) await db.exec(stmt);

const REAL_JOB = "11111111-1111-4111-8111-111111111111";
const SEED_JOB = "22222222-2222-4222-8222-222222222222";
const REAL_DISPUTE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SEED_DISPUTE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
await q(`INSERT INTO public.jobs (id, payment_status, status, is_seed) VALUES ($1, 'payout_pending', 'completed', false), ($2, 'payout_pending', 'completed', true)`,
  [REAL_JOB, SEED_JOB]);
await q(`INSERT INTO public.disputes (id, job_id, execution_status, decided_at) VALUES ($1, $2, 'executed', now() - interval '2 days'), ($3, $4, 'executed', now() - interval '2 days')`,
  [REAL_DISPUTE, REAL_JOB, SEED_DISPUTE, SEED_JOB]);

const first = (await q(`SELECT public.sweep_disputes_closed_without_payment() AS r`))[0].r;
const rows = await q(`SELECT severity, tags, context FROM public.error_logs ORDER BY id`);
const realRows = rows.filter((r) => r.context?.dispute_id === REAL_DISPUTE);
const seedRows = rows.filter((r) => r.context?.dispute_id === SEED_DISPUTE);
check("a real job's executed-but-unpaid dispute is reported once, fatal",
  realRows.length === 1 && realRows[0].severity === "fatal" && realRows[0].tags?.source === "dispute-unsettled" && realRows[0].tags?.area === "dispute-unsettled",
  JSON.stringify(realRows));
check("a seed job's identical dispute writes no error_logs row", seedRows.length === 0, JSON.stringify(seedRows));
check("the sweep counts only the real one", first.reported === 1, JSON.stringify(first));

const second = (await q(`SELECT public.sweep_disputes_closed_without_payment() AS r`))[0].r;
const total = (await q(`SELECT count(*)::int n FROM public.error_logs`))[0].n;
check("a second run reports nothing new (dedupe per dispute)", second.reported === 0 && total === 1, JSON.stringify({ second, total }));

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
