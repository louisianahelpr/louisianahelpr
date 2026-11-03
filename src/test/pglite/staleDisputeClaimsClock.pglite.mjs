/**
 * Q1424 PGlite proof: check_stale_dispute_settlement_claims' window, on a fixed clock (./lib/fixedClock.mjs, newest
 * CREATE of the monitor and of dispute_settlement_claim_ttl, 10 minutes). The edge is strict: a settlement claim
 * exactly 10 min old is still live (not reported, not cleared); 1 ms older it is stale, reported, and cleared when no
 * money can be half-moved (unstamped), or kept when its money step was stamped on a held escrow.
 *
 *   node src/test/pglite/staleDisputeClaimsClock.pglite.mjs
 *   STALE_CLAIM_INCLUSIVE=1 node src/test/pglite/staleDisputeClaimsClock.pglite.mjs   # RED: the 10-min edge made inclusive
 *
 * report_stale_dispute_settlement_claim (its own proof) is stubbed to record the report. pglite is loaded from
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
CREATE TABLE public.jobs (id uuid PRIMARY KEY, status text, payment_status text);
CREATE TABLE public.disputes (job_id uuid, status text, execution_status text);
CREATE TABLE public.dispute_settlement_claims (job_id uuid, action text, claimed_by uuid, claimed_at timestamptz, token uuid, money_step_at timestamptz);
CREATE TABLE public.reports (job_id uuid);
CREATE FUNCTION public.report_stale_dispute_settlement_claim(j uuid, a text, b uuid, at timestamptz, t uuid, src text, m timestamptz) RETURNS boolean
  LANGUAGE sql AS $$ INSERT INTO public.reports VALUES (j); SELECT true $$;
`);
const ttl = newestFunction("dispute_settlement_claim_ttl");
const mon = newestFunction("check_stale_dispute_settlement_claims");
const base = onFixedClock(mon.stmt);
let fixed = base;
check(`every clock read is on the fixed clock (${mon.file})`, !/\bnow\s*\(\s*\)/i.test(fixed) && /_probe_now\(\)/.test(fixed));
check("the claim TTL is 10 minutes", /interval '10 minutes'/.test(ttl.stmt));
if (process.env.STALE_CLAIM_INCLUSIVE) {
  console.log("STALE_CLAIM_INCLUSIVE=1 (expect FAILs)");
  const from = "c.claimed_at < public._probe_now() - public.dispute_settlement_claim_ttl()";
  check("STALE_CLAIM_INCLUSIVE: the text to change is there", fixed.includes(from));
  fixed = fixed.replace(from, "c.claimed_at <= public._probe_now() - public.dispute_settlement_claim_ttl()");
}
check("the mutation (if any) applied", !process.env.STALE_CLAIM_INCLUSIVE || fixed !== base);
// Replay-safe: applies 3x.
for (let i = 0; i < 3; i++) { await db.exec(onFixedClock(ttl.stmt)); await db.exec(fixed); }

const JOB = "19191919-1919-4919-8919-191919191919";
const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());
const MIN = 60_000;
const seed = async ({ claimedAt, stamped = false, payment = "escrow" }) => {
  await db.exec(`DELETE FROM public.reports; DELETE FROM public.dispute_settlement_claims; DELETE FROM public.jobs;`);
  await q(`INSERT INTO public.jobs VALUES ($1, 'disputed', $2)`, [JOB, payment]);
  await q(`INSERT INTO public.dispute_settlement_claims VALUES ($1, 'refund', gen_random_uuid(), $2, gen_random_uuid(), $3)`, [JOB, iso(claimedAt), stamped ? iso(claimedAt) : null]);
};
const run = async (nowMs) => {
  await setClock(db, iso(nowMs));
  const r = (await q(`SELECT public.check_stale_dispute_settlement_claims() AS r`))[0].r;
  const left = (await q(`SELECT count(*)::int c FROM public.dispute_settlement_claims`))[0].c;
  return { ...r, left };
};
const N = Date.UTC(2026, 6, 15, 20, 0, 0);
{
  await seed({ claimedAt: N - 10 * MIN });
  const r = await run(N);
  check("claim exactly 10 min old: still live (not stale, kept)", r.stale === 0 && r.reported === 0 && r.left === 1, JSON.stringify(r));
  await seed({ claimedAt: N - 10 * MIN - 1 });
  const r2 = await run(N);
  check("claim 10 min + 1 ms old, money step never stamped: stale, reported, cleared", r2.stale === 1 && r2.reported === 1 && r2.cleared === 1 && r2.left === 0, JSON.stringify(r2));
  await seed({ claimedAt: N - 10 * MIN - 1, stamped: true });
  const r3 = await run(N);
  check("claim 10 min + 1 ms old with its money step stamped on a held escrow: reported, kept for a person", r3.reported === 1 && r3.cleared === 0 && r3.left === 1, JSON.stringify(r3));
}

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
