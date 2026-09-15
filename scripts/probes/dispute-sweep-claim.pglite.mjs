#!/usr/bin/env node
/**
 * PGlite proof for the two SQL halves closed on top of 20260915034822:
 *
 *   A. auto-resolve-disputes takes the settlement claim as 'sweep'.
 *   B. stale claims page (check_stale_dispute_settlement_claims), and the
 *      claim's own expiry reports a stale claim instead of deleting it silently.
 *
 *   node scripts/probes/dispute-sweep-claim.pglite.mjs [rounds=20] [before-migration.sql]
 *
 * pglite is not a dependency (CLAUDE.md):
 *   mkdir -p ~/.lh-pglite-probe && cd ~/.lh-pglite-probe && npm i @electric-sql/pglite
 *
 * BEFORE is the migration as it stood at 51305c81c (pass the file, e.g.
 *   git show 51305c81c:supabase/migrations/20260914194614_dispute_settlement_claim_and_race_locks.sql > /tmp/before.sql
 * ); AFTER is the working-tree file. The sweep round replays the sweep's
 * sequence exactly as auto-resolve-disputes/index.ts runs it (claim -> ledger
 * -> guarded flip -> release) with a Quick Refund holding the claim and its
 * Stripe refund already out. BAD = the job ends payout_pending (the Helpr is
 * paid 24h later on top of the refund).
 *
 * ONE connection: this proves the loser's resumption, not wall-clock
 * interleaving (see dispute-races.pglite.mjs). The claim is a PK INSERT, so
 * resumption is the whole story for it.
 */
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${process.env.HOME}/.lh-pglite-probe`;
let PGlite;
try {
  ({ PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`));
} catch {
  console.error(`Could not load pglite from ${PGLITE_DIR} (npm i @electric-sql/pglite there).`);
  process.exit(2);
}

const ROUNDS = Number(process.argv[2] ?? 20);
const BEFORE_FILE = process.argv[3];
const AFTER = readFileSync(
  new URL("../../supabase/migrations/20260915034822_dispute_settlement_claim_and_race_locks.sql", import.meta.url).pathname,
  "utf8",
);
const BEFORE = BEFORE_FILE ? readFileSync(BEFORE_FILE, "utf8") : null;
// pg_cron cannot run in PGlite: the schedule block takes its own RAISE NOTICE branch.

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const SCHEMA = `
  DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
  END $$;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$
    SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  CREATE TYPE job_status AS ENUM (
    'open','accepted','in_progress','revision_requested','completed','cancelled','disputed','expired');
  CREATE TABLE public.jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text, customer_id uuid, helper_id uuid,
    status job_status NOT NULL DEFAULT 'open', payment_status text, dispute_status text,
    dispute_reason text, dispute_evidence_urls text[], dispute_resolved_at timestamptz,
    disputed_at timestamptz, disputed_by uuid, payout_scheduled_at timestamptz,
    is_seed boolean NOT NULL DEFAULT false);
  CREATE TABLE public.disputes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE, opener_id uuid, reason text,
    evidence_urls text[] NOT NULL DEFAULT '{}', status text NOT NULL DEFAULT 'open',
    decided_at timestamptz, decided_by uuid, decision_text text, payout_split jsonb,
    execution_status text, executed_at timestamptz, execution_started_at timestamptz,
    execution_helper_cents integer, execution_refund_cents integer, execution_transfer_id text,
    execution_refund_id text, execution_error text, created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid, title text, message text, type text, link text);
  CREATE TABLE public.user_roles (user_id uuid, role text);
  CREATE TABLE public.fraud_flags (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid, job_id uuid, flag_type text, details text, resolved boolean NOT NULL DEFAULT false);
  CREATE FUNCTION public.check_dispute_velocity(_uid uuid) RETURNS boolean LANGUAGE sql AS $f$ SELECT true $f$;
  CREATE FUNCTION public.notify_ops_dispute_filed(uuid, text, text, uuid, boolean) RETURNS void
    LANGUAGE sql AS $f$ SELECT NULL::void $f$;
  -- Prod shapes, verified live 2026-09-14: payout_transfers HAS status,
  -- payment_refunds does NOT.
  CREATE TABLE public.payout_transfers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id uuid, status text NOT NULL DEFAULT 'pending');
  CREATE TABLE public.payment_refunds (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id uuid, stripe_refund_id text NOT NULL, amount_cents integer NOT NULL DEFAULT 0);
  CREATE TABLE public.error_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    severity text NOT NULL DEFAULT 'error' CHECK (severity IN ('info','warning','error','fatal')),
    message text NOT NULL, context jsonb NOT NULL DEFAULT '{}', tags jsonb NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.cron_work_expectations (jobname text PRIMARY KEY, expected_max_gap interval,
    note text NOT NULL DEFAULT '', registered_at timestamptz NOT NULL DEFAULT now());
  CREATE SCHEMA net; CREATE SCHEMA vault;
  CREATE TABLE vault.decrypted_secrets (name text, decrypted_secret text);
  INSERT INTO vault.decrypted_secrets VALUES ('supabase_url','https://x'),('service_role_key','k');
  CREATE TABLE net.calls (id serial, body jsonb);
  CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb) RETURNS bigint
    LANGUAGE sql AS $f$ INSERT INTO net.calls (body) VALUES (body) RETURNING id::bigint $f$;
`;

const POSTER = "11111111-1111-1111-1111-111111111111";
const HELPER = "22222222-2222-2222-2222-222222222222";
const ADMIN = "33333333-3333-3333-3333-333333333333";

async function freshDb(migration) {
  const db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(migration);
  return db;
}
const one = async (db, sql, p) => (await db.query(sql, p)).rows[0];

/**
 * One round of THE race. A Quick Refund has claimed the job and its Stripe
 * refund has returned (ledger row written) but its flip has not landed. The
 * 72h sweep ticks now, exactly as auto-resolve-disputes/index.ts runs:
 *   BEFORE (51305c81c edge code): no claim, flip guarded on escrow only.
 *   AFTER: claim 'sweep' -> skip unless claimed -> refund ledger -> flip -> release.
 * Then the admin's flip runs. BAD = the job is payout_pending.
 */
async function sweepRound(db, withClaim) {
  const { id: jobId } = await one(db,
    `INSERT INTO public.jobs (title, customer_id, helper_id, status, payment_status, dispute_status)
     VALUES ('sweep race', $1, $2, 'disputed', 'escrow', 'open') RETURNING id`, [POSTER, HELPER]);
  const refund = await one(db, `SELECT public.claim_dispute_settlement($1, 'refund', $2) AS v`, [jobId, ADMIN]);
  await db.query(`INSERT INTO public.payment_refunds (job_id, stripe_refund_id) VALUES ($1, 're_' || gen_random_uuid())`, [jobId]);

  let sweepMayFlip = true;
  let sweepToken = null;
  if (withClaim) {
    let v;
    try {
      v = (await one(db, `SELECT public.claim_dispute_settlement($1, 'sweep', NULL) AS v`, [jobId])).v;
    } catch {
      v = { verdict: "error" }; // edge: claim RPC error -> fail closed, skip
    }
    if (v.verdict !== "claimed" || !v.token) sweepMayFlip = false;
    else {
      sweepToken = v.token;
      const { n } = await one(db, `SELECT count(*)::int AS n FROM public.payment_refunds WHERE job_id = $1`, [jobId]);
      if (n > 0) sweepMayFlip = false;
    }
  }
  if (sweepMayFlip) {
    await db.query(
      `UPDATE public.jobs SET status='completed', payment_status='payout_pending', dispute_status='auto_resolved',
         dispute_resolved_at=now(), payout_scheduled_at=now() + interval '24 hours'
       WHERE id = $1 AND payment_status = 'escrow'`, [jobId]);
  }
  if (sweepToken) await db.query(`SELECT public.release_dispute_settlement_claim($1, $2)`, [jobId, sweepToken]);

  // The admin refund's own guarded flip, then its release.
  await db.query(`UPDATE public.jobs SET status='cancelled', payment_status='refunded' WHERE id=$1 AND status='disputed'`, [jobId]);
  if (refund.v?.token) await db.query(`SELECT public.release_dispute_settlement_claim($1, $2)`, [jobId, refund.v.token]);

  const j = await one(db, `SELECT payment_status FROM public.jobs WHERE id = $1`, [jobId]);
  await db.query(`DELETE FROM public.payment_refunds WHERE job_id = $1`, [jobId]);
  await db.query(`DELETE FROM public.jobs WHERE id = $1`, [jobId]);
  return j.payment_status === "payout_pending";
}

async function tally(label, fn) {
  let bad = 0;
  for (let i = 0; i < ROUNDS; i++) if (await fn()) bad++;
  console.log(`  ${label}: ${bad}/${ROUNDS}`);
  return bad;
}

// ── A. The sweep race ──────────────────────────────────────────────────────
let beforeSweep = null;
if (BEFORE) {
  console.log("\n── BEFORE (51305c81c migration + edge sequence) ──");
  const db = await freshDb(BEFORE);
  beforeSweep = await tally("sweep pays the Helpr on top of an in-flight Quick Refund", () => sweepRound(db, false));
  // And the BEFORE claim cannot even be taken as 'sweep'.
  const { id } = await one(db, `INSERT INTO public.jobs (status, payment_status) VALUES ('disputed','escrow') RETURNING id`);
  let rejected = false;
  try { await db.query(`SELECT public.claim_dispute_settlement($1, 'sweep', NULL)`, [id]); } catch { rejected = true; }
  check("BEFORE: 'sweep' is not a claim action (the sweep had no lock to take)", rejected);
  const stale = await one(db, `SELECT to_regprocedure('public.check_stale_dispute_settlement_claims()') AS p`);
  check("BEFORE: no stale-claim monitor exists", stale.p === null);
  await db.close();
}

console.log("\n── AFTER ──");
const db = await freshDb(AFTER);
await db.exec(AFTER);
await db.exec(AFTER);
console.log("  migration applied 3× (replay-safe)");
const afterSweep = await tally("sweep pays the Helpr on top of an in-flight Quick Refund", () => sweepRound(db, true));
if (beforeSweep !== null) {
  check(`sweep race: ${beforeSweep}/${ROUNDS} -> ${afterSweep}/${ROUNDS}`, beforeSweep === ROUNDS && afterSweep === 0);
} else {
  check(`sweep race AFTER ${afterSweep}/${ROUNDS} (pass a BEFORE file for the red half)`, afterSweep === 0);
}

// Exclusivity in BOTH orders, and the sweep's own re-entrancy.
{
  const { id } = await one(db, `INSERT INTO public.jobs (status, payment_status) VALUES ('disputed','escrow') RETURNING id`);
  const s1 = (await one(db, `SELECT public.claim_dispute_settlement($1,'sweep',NULL) AS v`, [id])).v;
  const r1 = (await one(db, `SELECT public.claim_dispute_settlement($1,'refund',$2) AS v`, [id, ADMIN])).v;
  const rel1 = (await one(db, `SELECT public.claim_dispute_settlement($1,'release',$2) AS v`, [id, ADMIN])).v;
  const sp1 = (await one(db, `SELECT public.claim_dispute_settlement($1,'split',NULL) AS v`, [id])).v;
  const s2 = (await one(db, `SELECT public.claim_dispute_settlement($1,'sweep',NULL) AS v`, [id])).v;
  // sp1: a split on a job with no decided dispute is not_disputed (round 5 —
  // a split claims only a decided, unexecuted dispute), never a winner.
  check("sweep holds: refund and release are refused held_by_sweep, and a split cannot claim",
    s1.verdict === "claimed" && [r1, rel1].every((v) => v.verdict === "held_by_sweep") && sp1.verdict !== "claimed",
    JSON.stringify([s1.verdict, r1, rel1, sp1]));
  check("an overlapping sweep run joins with NO token (so it skips)", s2.verdict === "joined" && !s2.token, JSON.stringify(s2));
  await db.query(`SELECT public.release_dispute_settlement_claim($1,$2)`, [id, s1.token]);
  const r2 = (await one(db, `SELECT public.claim_dispute_settlement($1,'refund',$2) AS v`, [id, ADMIN])).v;
  const s3 = (await one(db, `SELECT public.claim_dispute_settlement($1,'sweep',NULL) AS v`, [id])).v;
  check("refund holds: the sweep is refused held_by_refund", r2.verdict === "claimed" && s3.verdict === "held_by_refund", JSON.stringify([r2.verdict, s3]));
  await db.query(`DELETE FROM public.jobs WHERE id=$1`, [id]);
}

// ── B. The stale-claim monitor ─────────────────────────────────────────────
const pages = async () => (await one(db, `SELECT count(*)::int AS n FROM net.calls`)).n;
const logs = async (extra = "") =>
  (await one(db, `SELECT count(*)::int AS n FROM public.error_logs WHERE tags->>'source'='dispute-claim-stale' ${extra}`)).n;
const run = async () => (await one(db, `SELECT public.check_stale_dispute_settlement_claims() AS r`)).r;
const reset = () => db.exec(`TRUNCATE net.calls, public.error_logs; DELETE FROM public.dispute_settlement_claims; DELETE FROM public.jobs;`);

{
  await reset();
  const { id } = await one(db, `INSERT INTO public.jobs (status, payment_status) VALUES ('disputed','escrow') RETURNING id`);
  await db.query(`INSERT INTO public.dispute_settlement_claims (job_id, action, claimed_by) VALUES ($1,'release',$2)`, [id, ADMIN]);
  const fresh = await run();
  check("a claim inside its TTL does not page", fresh.stale === 0 && (await pages()) === 0, JSON.stringify(fresh));

  // Stamped: this holder reached its money step (round 4, M2 — only a stamped
  // claim sticks and pages; dispute-round4.pglite.mjs proves the unstamped half).
  await db.query(`UPDATE public.dispute_settlement_claims SET claimed_at = now() - interval '16 minutes', money_step_at = now() - interval '16 minutes' WHERE job_id=$1`, [id]);
  await db.query(`INSERT INTO public.payout_transfers (job_id, status) VALUES ($1,'paid')`, [id]);
  const r1 = await run();
  const call = (await one(db, `SELECT body FROM net.calls ORDER BY id DESC LIMIT 1`))?.body;
  check("a claim past its TTL on a still-disputed job pages CRITICAL once",
    r1.stale === 1 && r1.reported === 1 && (await pages()) === 1 && call?.severity === "critical" && call?.kind === "money_at_risk",
    JSON.stringify({ r1, call }));
  check("the page carries the ledger evidence (1 payout transfer, money already moved)",
    /1 payout transfer\(s\), 0 refund\(s\)/.test(call?.message ?? "") && /ALREADY moved/.test(call?.message ?? ""), call?.message);
  const r2 = await run();
  check("the next tick does not page the same claim again (deduped by token)", r2.stale === 1 && r2.reported === 0 && (await pages()) === 1, JSON.stringify(r2));

  // A dead MONEY holder's claim does not expire into the next caller's hands:
  // it may have moved money with no ledger row. Refused, not re-paged, row kept.
  const retake = (await one(db, `SELECT public.claim_dispute_settlement($1,'refund',$2) AS v`, [id, ADMIN])).v;
  const kept = await one(db, `SELECT count(*)::int AS n FROM public.dispute_settlement_claims WHERE job_id=$1`, [id]);
  check("an expired RELEASE claim is NOT retaken: stuck_release, no second page, row kept for a person to clear",
    retake.verdict === "stuck_release" && (await pages()) === 1 && (await logs()) === 1 && kept.n === 1, JSON.stringify({ retake, kept }));
  const sweepRetake = (await one(db, `SELECT public.claim_dispute_settlement($1,'sweep',NULL) AS v`, [id])).v;
  check("…and the sweep is refused the same way", sweepRetake.verdict === "stuck_release", JSON.stringify(sweepRetake));
  const clearSql = /DELETE FROM public\.dispute_settlement_claims WHERE job_id = '[^']+' AND token = '[^']+';/.exec(call?.message ?? "")?.[0];
  check("the page carries the exact clearing statement", !!clearSql, call?.message);
  if (clearSql) await db.exec(clearSql);
  const afterClear = (await one(db, `SELECT public.claim_dispute_settlement($1,'refund',$2) AS v`, [id, ADMIN])).v;
  check("once a person runs it, the job is claimable again", afterClear.verdict === "claimed", JSON.stringify(afterClear));
  await db.query(`DELETE FROM public.payout_transfers WHERE job_id=$1`, [id]);
}

{
  await reset();
  // Found by a caller BEFORE the monitor ever saw it: the claim function reports it.
  const { id } = await one(db, `INSERT INTO public.jobs (status, payment_status) VALUES ('disputed','escrow') RETURNING id`);
  await db.query(`INSERT INTO public.dispute_settlement_claims (job_id, action, claimed_at, money_step_at) VALUES ($1,'release', now() - interval '20 minutes', now() - interval '20 minutes')`, [id]);
  const v = (await one(db, `SELECT public.claim_dispute_settlement($1,'refund',$2) AS v`, [id, ADMIN])).v;
  const row = await one(db, `SELECT context->>'found_by' AS f FROM public.error_logs WHERE tags->>'source'='dispute-claim-stale'`);
  check("a caller finding a dead holder's claim reports it (pages, found_by=claim_expiry) and is refused",
    v.verdict === "stuck_release" && (await pages()) === 1 && row?.f === "claim_expiry", JSON.stringify({ v, row }));
  await reset();
  // A dead SWEEP holder (no Stripe step) does expire, flagged over_expired.
  const { id: sid } = await one(db, `INSERT INTO public.jobs (status, payment_status) VALUES ('disputed','escrow') RETURNING id`);
  await db.query(`INSERT INTO public.dispute_settlement_claims (job_id, action, claimed_at) VALUES ($1,'sweep', now() - interval '20 minutes')`, [sid]);
  const sv = (await one(db, `SELECT public.claim_dispute_settlement($1,'refund',$2) AS v`, [sid, ADMIN])).v;
  check("an expired SWEEP claim (no money step) is retaken, flagged over_expired", sv.verdict === "claimed" && sv.over_expired === true, JSON.stringify(sv));
}

{
  await reset();
  const { id: settled } = await one(db, `INSERT INTO public.jobs (status, payment_status) VALUES ('completed','released') RETURNING id`);
  const { id: seed } = await one(db, `INSERT INTO public.jobs (status, payment_status, is_seed) VALUES ('disputed','escrow', true) RETURNING id`);
  // Stamped money holders: an unstamped claim is cleared whatever the job
  // (round 4, M2), which would hide what this case is about.
  for (const id of [settled, seed]) {
    await db.query(`INSERT INTO public.dispute_settlement_claims (job_id, action, claimed_at, money_step_at) VALUES ($1,'refund', now() - interval '1 hour', now() - interval '1 hour')`, [id]);
  }
  const r = await run();
  check("a leftover on a SETTLED job and one on an is_seed fixture are logged as warnings, never paged",
    r.stale === 2 && r.reported === 2 && (await pages()) === 0 && (await logs("AND severity='warning'")) === 2, JSON.stringify(r));
  const left = await one(db, `SELECT array_agg(job_id::text) AS ids FROM public.dispute_settlement_claims`);
  check("the settled job's finished lock is cleared; the still-disputed seed one is kept",
    r.cleared === 1 && (left.ids ?? []).length === 1 && left.ids[0] === seed, JSON.stringify({ r, left }));
}

{
  await reset();
  // A client-written row with the same source + token must not suppress the page.
  const { id } = await one(db, `INSERT INTO public.jobs (status, payment_status) VALUES ('disputed','escrow') RETURNING id`);
  const { token } = await one(db,
    `INSERT INTO public.dispute_settlement_claims (job_id, action, claimed_at, money_step_at) VALUES ($1,'refund', now() - interval '19 minutes', now() - interval '19 minutes') RETURNING token`, [id]);
  await db.query(`INSERT INTO public.error_logs (severity, message, tags) VALUES ('error','forged',
    jsonb_build_object('source','dispute-claim-stale','token',$1::text,'origin','client'))`, [token]);
  const r = await run();
  check("a forged client row cannot suppress the page (dedupe reads server rows only)", r.reported === 1 && (await pages()) === 1, JSON.stringify(r));
  // A dead refund holder followed by a WITHDRAWAL: job back to in_progress with
  // the escrow held. Still pages, and the row is kept (round-2 finding).
  await db.exec(`TRUNCATE net.calls, public.error_logs`);
  await db.query(`UPDATE public.jobs SET status='in_progress' WHERE id=$1`, [id]);
  const w = await run();
  const keptW = await one(db, `SELECT count(*)::int AS n FROM public.dispute_settlement_claims WHERE job_id=$1`, [id]);
  check("a dead holder followed by a withdrawal (in_progress/escrow) still pages critical and keeps the row",
    w.reported === 1 && (await pages()) === 1 && w.cleared === 0 && keptW.n === 1, JSON.stringify({ w, keptW }));
}

// ── C. Money states the claim refuses, and the decided split it must admit ─
async function claimOn(dbx, status, payment, action, extra = "") {
  const { id } = await one(dbx, `INSERT INTO public.jobs (status, payment_status) VALUES ($1,$2) RETURNING id`, [status, payment]);
  if (extra) await dbx.query(extra, [id]);
  let v;
  try { v = (await one(dbx, `SELECT public.claim_dispute_settlement($1,$2,NULL) AS v`, [id, action])).v; }
  catch (e) { v = { verdict: `raised: ${e.message.slice(0, 60)}` }; }
  await dbx.query(`DELETE FROM public.dispute_settlement_claims WHERE job_id=$1`, [id]);
  await dbx.query(`DELETE FROM public.jobs WHERE id=$1`, [id]);
  return v;
}
const DECIDED_SPLIT = `INSERT INTO public.disputes (job_id, reason, status, execution_status) VALUES ($1, 'x', 'decided', 'pending')`;
{
  await reset();
  const bad = [];
  for (const payment of ["cancelling", "cancelled", "refunded", "partially_refunded", "released", "chargeback"]) {
    for (const action of ["release", "refund", "sweep"]) {
      const v = await claimOn(db, "disputed", payment, action);
      if (v.verdict !== "not_settleable") bad.push(`${action}@${payment}=${v.verdict}`);
    }
  }
  check("release / refund / sweep refuse a disputed job whose escrow is cancelling, cancelled, refunded or settled", bad.length === 0, bad.join(", "));
  const pp = await claimOn(db, "disputed", "payout_pending", "release");
  check("a dispute re-frozen inside the payout hold (payout_pending) is still claimable", pp.verdict === "claimed", JSON.stringify(pp));
  const split = await claimOn(db, "completed", "escrow", "split", DECIDED_SPLIT);
  check("a DECIDED split on a job rpc_decide_dispute moved to completed is claimable", split.verdict === "claimed", JSON.stringify(split));
  const noSplit = await claimOn(db, "completed", "escrow", "split");
  check("…but a completed job with no pending split is not", noSplit.verdict === "not_disputed", JSON.stringify(noSplit));
  const relOnDecided = await claimOn(db, "completed", "escrow", "release", DECIDED_SPLIT);
  check("…and a Quick Release on that decided job is still refused", relOnDecided.verdict === "not_disputed", JSON.stringify(relOnDecided));
  const badRefile = [];
  for (const action of ["release", "refund", "sweep"]) {
    const v = await claimOn(db, "disputed", "escrow", action, DECIDED_SPLIT);
    if (v.verdict !== "split_pending") badRefile.push(`${action}=${v.verdict}`);
  }
  check("a job RE-DISPUTED over a decided, unexecuted split refuses release / refund / sweep (split_pending)", badRefile.length === 0, badRefile.join(", "));
}

{
  // open_dispute_as refuses a job whose escrow cancel_escrow is refunding.
  const { id } = await one(db, `INSERT INTO public.jobs (title, customer_id, helper_id, status, payment_status)
    VALUES ('cancelling', $1, $2, 'in_progress', 'cancelling') RETURNING id`, [POSTER, HELPER]);
  let code = "none";
  try { await db.query(`SELECT public.open_dispute_as($1, $2, 'the work was never delivered at all', '{}')`, [id, HELPER]); }
  catch (e) { code = e.message; }
  const { n } = await one(db, `SELECT count(*)::int AS n FROM public.disputes WHERE job_id=$1`, [id]);
  check("open_dispute_as refuses payment_status='cancelling' (no dispute row, clean code)",
    /dispute_payment_being_cancelled/.test(code) && n === 0, code);
}

{
  // open_dispute_as refuses a re-file over a decided, unexecuted dispute. On an
  // in_progress job — the prod shape (bb2c3732: decided, then re-filed and
  // withdrawn); a completed job is refused earlier by job_already_completed.
  const { id } = await one(db, `INSERT INTO public.jobs (title, customer_id, helper_id, status, payment_status)
    VALUES ('decided', $1, $2, 'in_progress', 'escrow') RETURNING id`, [POSTER, HELPER]);
  await db.query(DECIDED_SPLIT, [id]);
  let code = "none";
  try { await db.query(`SELECT public.open_dispute_as($1, $2, 'the work was never delivered at all', '{}')`, [id, POSTER]); }
  catch (e) { code = e.message; }
  const j = await one(db, `SELECT status::text AS s FROM public.jobs WHERE id=$1`, [id]);
  check("open_dispute_as refuses a re-file over a decided, unexecuted split (job stays in_progress)",
    /dispute_already_decided/.test(code) && j.s === "in_progress", `${code} / ${j.s}`);
}

if (BEFORE) {
  const dbb = await freshDb(BEFORE);
  {
    const { id } = await one(dbb, `INSERT INTO public.jobs (title, customer_id, helper_id, status, payment_status)
      VALUES ('decided', $1, $2, 'completed', 'escrow') RETURNING id`, [POSTER, HELPER]);
    await dbb.query(DECIDED_SPLIT, [id]);
    let refiled = false;
    try { await dbb.query(`SELECT public.open_dispute_as($1, $2, 'the work was never delivered at all', '{}')`, [id, POSTER]); refiled = true; } catch { /* refused */ }
    check("BEFORE: a party could re-file over a decided split", refiled);
    await dbb.query(`INSERT INTO public.dispute_settlement_claims (job_id, action, claimed_at) VALUES ($1,'release', now() - interval '20 minutes')`, [id]);
    const v = (await one(dbb, `SELECT public.claim_dispute_settlement($1,'refund',$2) AS v`, [id, ADMIN])).v;
    check("BEFORE: a dead Quick Release's claim expired straight into a Quick Refund", v.verdict === "claimed", JSON.stringify(v));
  }
  const split = await claimOn(dbb, "completed", "escrow", "split", DECIDED_SPLIT);
  check("BEFORE: that decided split was refused not_disputed (every split would have failed)", split.verdict === "not_disputed", JSON.stringify(split));
  const canc = await claimOn(dbb, "disputed", "cancelling", "release");
  check("BEFORE: a Quick Release claimed a job whose escrow was being cancelled", canc.verdict === "claimed", JSON.stringify(canc));
  await dbb.close();
}

{
  const grants = await one(db, `SELECT has_function_privilege('anon','public.check_stale_dispute_settlement_claims()','EXECUTE') AS a,
    has_function_privilege('authenticated','public.report_stale_dispute_settlement_claim(uuid,text,uuid,timestamptz,uuid,text,timestamptz)','EXECUTE') AS b`);
  check("anon / authenticated cannot execute the monitor or the reporter", grants.a === false && grants.b === false, JSON.stringify(grants));
  const ttl = await one(db, `SELECT public.dispute_settlement_claim_ttl()::text AS t`);
  check("one TTL definition, ten minutes (past the 400 s edge wall clock)", ttl.t === "00:10:00", ttl.t);
  const exp = await one(db, `SELECT expected_max_gap::text AS g FROM public.cron_work_expectations WHERE jobname='check-stale-dispute-claims'`);
  check("the monitor's own cron has a liveness expectation", exp?.g === "01:00:00", JSON.stringify(exp));
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
await db.close();
process.exit(failures === 0 ? 0 : 1);
