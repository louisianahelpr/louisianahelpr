#!/usr/bin/env node
/**
 * PGlite proof for the three dispute settlement races, BEFORE and AFTER.
 *
 *   node scripts/probes/dispute-races.pglite.mjs [rounds=20]
 *
 * pglite is deliberately not a dependency (CLAUDE.md):
 *   mkdir -p ~/.lh-pglite-probe && cd ~/.lh-pglite-probe && npm i @electric-sql/pglite
 *
 * ── What this can and cannot prove ─────────────────────────────────────────
 * PGlite is ONE connection. It cannot hold two transactions open at once, so
 * it cannot produce the wall-clock interleaving itself — the same limit
 * scripts/ci/race-runner.mjs was written against a throwaway Postgres for.
 *
 * What it CAN prove, and what these rounds are, is the LOSER'S RESUMPTION:
 * under READ COMMITTED every blocked writer re-evaluates its predicate against
 * the winner's committed state before it proceeds. That re-evaluation is
 * behaviourally identical to running the loser's statement second, which is
 * exactly what each round does. A fix that survives this survives the race for
 * the reason the race is survivable at all; a fix that does not (the BEFORE
 * bodies here) fails it in the same way and by the same count.
 *
 * The genuine two-connection interleaving is proven by the prod probes
 * (scripts/probes/settle-dispute-race.prod.mjs, admin-release-vs-refund.prod.mjs,
 * dispute-open-race.prod.mjs). This lane does not run them.
 *
 * Each target is run ROUNDS times against the PRE-fix body and ROUNDS times
 * against the migration's body, on a fresh fixture per round, and the two
 * counts are printed side by side.
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
const MIG = new URL(
  "../../supabase/migrations/20260915034822_dispute_settlement_claim_and_race_locks.sql",
  import.meta.url,
).pathname;
const migration = readFileSync(MIG, "utf8");

/** Pull one `CREATE OR REPLACE FUNCTION public.<name>(` … `$function$;` block out of the migration. */
const fnBody = (name) => {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if (start < 0) throw new Error(`migration has no ${name}`);
  const end = migration.indexOf("$function$;", start) + "$function$;".length;
  return migration.slice(start, end);
};

const db = new PGlite();
const q = async (sql, params) => (await db.query(sql, params)).rows;
const one = async (sql, params) => (await q(sql, params))[0];

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

// ── Prod-shaped schema, trimmed to what these three functions read ─────────
await db.exec(`
  DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
  END $$;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$
    SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;

  CREATE TYPE job_status AS ENUM (
    'open','accepted','in_progress','revision_requested','completed','cancelled','disputed','expired'
  );

  CREATE TABLE public.jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title text,
    customer_id uuid,
    helper_id uuid,
    status job_status NOT NULL DEFAULT 'open',
    payment_status text,
    dispute_status text,
    dispute_reason text,
    dispute_evidence_urls text[],
    dispute_resolved_at timestamptz,
    disputed_at timestamptz,
    disputed_by uuid,
    poster_completed_at timestamptz,
    payout_scheduled_at timestamptz
  );

  CREATE TABLE public.disputes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
    opener_id uuid,
    reason text,
    evidence_urls text[] NOT NULL DEFAULT '{}'::text[],
    status text NOT NULL DEFAULT 'open',
    decided_at timestamptz,
    decided_by uuid,
    decision_text text,
    payout_split jsonb,
    execution_status text,
    executed_at timestamptz,
    execution_started_at timestamptz,
    execution_helper_cents integer,
    execution_refund_cents integer,
    execution_transfer_id text,
    execution_refund_id text,
    execution_error text,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX disputes_one_open_per_job_idx
    ON public.disputes (job_id) WHERE status = 'open';

  CREATE TABLE public.notifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid, title text, message text, type text, link text,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE public.user_roles (user_id uuid, role text);
  -- The stale-claim monitor (same migration) indexes error_logs and reads the
  -- two money ledgers; present so the migration applies verbatim.
  CREATE TABLE public.error_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    severity text NOT NULL DEFAULT 'error', message text NOT NULL,
    context jsonb NOT NULL DEFAULT '{}', tags jsonb NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.payout_transfers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, status text);
  CREATE TABLE public.payment_refunds (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid);
  CREATE TABLE public.fraud_flags (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid, job_id uuid, flag_type text, details text, resolved boolean NOT NULL DEFAULT false
  );

  -- Stubs for the two helpers open_dispute_as calls that are not under test.
  CREATE FUNCTION public.check_dispute_velocity(_uid uuid) RETURNS boolean
    LANGUAGE sql STABLE AS $f$ SELECT true $f$;
  CREATE FUNCTION public.notify_ops_dispute_filed(uuid, text, text, uuid, boolean) RETURNS void
    LANGUAGE sql AS $f$ SELECT NULL::void $f$;

  -- The transition matrix, trimmed to the -> disputed edges this depends on.
  -- Present so the BEFORE rounds fail the way prod would, not more gently.
  CREATE FUNCTION public.enforce_job_status_transition() RETURNS trigger
  LANGUAGE plpgsql AS $f$
  BEGIN
    IF NEW.status = 'disputed' AND OLD.status <> 'disputed'
       AND OLD.status::text NOT IN ('completed','in_progress','revision_requested','accepted') THEN
      RAISE EXCEPTION 'illegal job status transition % -> disputed', OLD.status;
    END IF;
    RETURN NEW;
  END $f$;
  CREATE TRIGGER trg_enforce_job_status_transition
    BEFORE UPDATE OF status ON public.jobs
    FOR EACH ROW EXECUTE FUNCTION public.enforce_job_status_transition();
`);

// ── The three PRE-fix bodies, exactly as prod holds them today ─────────────
// settle_dispute_record without FOR SHARE, and open_dispute_as without the
// disputable gate and with the bare `||` append. Taken from the migration's
// own AFTER bodies and reversed, so the two sides differ ONLY by the fix.
const settleAfter = fnBody("settle_dispute_record");
// BEFORE: no dispute-row lock and no early idempotent return — the job read
// came first, unlocked, exactly as prod holds it today.
const settleBefore = settleAfter
  // 1. drop the dispute-row lock and the comment block that introduces it,
  //    leaving the job read where it used to be: first, and unlocked.
  .replace(
    /\n  -- ── Lock the DISPUTE ROW[\s\S]*?\n  -- Read AFTER the lock[^\n]*\n(\s*--[^\n]*\n)*/,
    "\n",
  )
  // 2. drop the "nothing to close" guard — `_dispute_id` is only assigned by
  //    the RETURNING clause in the pre-fix body, so a guard above the UPDATE
  //    would short-circuit every call and the BEFORE rounds would fail for a
  //    reason that has nothing to do with the race.
  .replace(/\n  -- Nothing to close \(already decided[\s\S]*?END IF;\n/, "\n")
  // 3. put the UPDATE's predicate back to matching on job_id.
  .replace(
    /  -- By id, on the row locked at the top;[\s\S]*?WHERE id = _dispute_id\n     AND status = 'open'/,
    "   WHERE job_id = _job_id\n     AND status = 'open'",
  );
for (const [what, marker] of [
  ["dispute-row lock", "FROM public.disputes\n   WHERE job_id = _job_id AND status = 'open'"],
  ["nothing-to-close guard", "Nothing to close (already decided"],
  ["id-scoped update", "WHERE id = _dispute_id"],
]) {
  if (settleBefore.includes(marker)) throw new Error(`could not strip the ${what} for the BEFORE body`);
}
if (settleBefore === settleAfter) throw new Error("could not build the BEFORE settle body");

const openAfter = fnBody("open_dispute_as");
let openBefore = openAfter
  // drop the IF … dispute_job_not_disputable gate before the INSERT
  .replace(
    /\n  -- ── The job must still be disputable[\s\S]*?END IF;\n\n(  INSERT INTO public\.disputes)/,
    "\n$1",
  )
  // drop the status predicate + NOT FOUND raise on the freeze UPDATE
  .replace(
    /\n   -- Belt and braces[\s\S]*?WHERE id = _job_id\n     AND status::text IN \([^)]*\);\n\n  IF NOT FOUND THEN\n    RAISE EXCEPTION 'dispute_job_not_disputable'\n      USING HINT = '[^']*';\n  END IF;/,
    "\n   WHERE id = _job_id;",
  )
  // restore the bare `||` appends on the re-file branch
  .replace(
    /    -- Set-like append[\s\S]*?    UPDATE public\.disputes\n    SET evidence_urls = \([\s\S]*?\n        \)\n    WHERE id = _existing_id;/,
    "    UPDATE public.disputes\n    SET evidence_urls = evidence_urls || COALESCE(_evidence_urls, '{}'::text[])\n    WHERE id = _existing_id;",
  )
  .replace(
    /    UPDATE public\.jobs\n       SET dispute_evidence_urls = \(\n             SELECT[\s\S]*?\n           \)\n     WHERE id = _job_id;/,
    "    UPDATE public.jobs\n       SET dispute_evidence_urls =\n             COALESCE(dispute_evidence_urls, '{}'::text[]) || COALESCE(_evidence_urls, '{}'::text[])\n     WHERE id = _job_id;",
  );
for (const [what, marker] of [
  ["disputable gate", "dispute_job_not_disputable"],
  ["set-like append", "array_agg(u ORDER BY ord)"],
]) {
  if (openBefore.includes(marker)) throw new Error(`could not strip the ${what} for the BEFORE body`);
}

const CLAIM_FNS = [fnBody("claim_dispute_settlement"), fnBody("release_dispute_settlement_claim")].join("\n");
const CLAIM_TABLE = `
  CREATE TABLE IF NOT EXISTS public.dispute_settlement_claims (
    job_id uuid PRIMARY KEY REFERENCES public.jobs(id) ON DELETE CASCADE,
    action text NOT NULL,
    claimed_by uuid,
    claimed_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT dispute_settlement_claims_action_check
      CHECK (action = ANY (ARRAY['release'::text, 'refund'::text]))
  );`;

const POSTER = "11111111-1111-1111-1111-111111111111";
const HELPER = "22222222-2222-2222-2222-222222222222";
const ADMIN_A = "33333333-3333-3333-3333-333333333333";
const ADMIN_B = "44444444-4444-4444-4444-444444444444";
for (const id of [POSTER, HELPER, ADMIN_A, ADMIN_B]) {
  await db.query("INSERT INTO auth.users (id, email) VALUES ($1, $2)", [id, `${id}@helpr.test`]);
}

const asUser = (uid) => db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [uid]);

// ═══════════════════════════════════════════════════════════════════════════
// Target 1 — two settlers on one dispute. Exactly one may win.
// ═══════════════════════════════════════════════════════════════════════════
//
// Two admins, or an admin and the opener withdrawing, settling at the same
// moment. The loser's resumption is the second call here: under READ COMMITTED
// it re-evaluates `WHERE status = 'open'` against the winner's committed row.
//
// BAD = the second call also returns a dispute id (it executed too), or the
// row's decided_by / execution ids were overwritten by the loser.
//
// This half is EXPECTED to be clean before the migration as well as after —
// `settle_dispute_record` has carried that predicate since it was written, and
// the honest reading of a 0/N here is "already safe", not "the fix worked".
// It is measured anyway because the target names it, and because a future edit
// that drops the predicate must show up as red.
//
// What this round does NOT prove is the dispute-row lock the migration adds.
// That closes a different window — open_dispute_as's re-freeze branch landing
// between settle's gate read and its write — and a lock race needs TWO
// connections. PGlite has one. It is proven by the two-connection runner
// (scripts/ci/race-runner.mjs, race 3) and by the prod probe
// (scripts/probes/settle-dispute-race.prod.mjs); static assertions that the
// lock is present, and that it is NOT on `jobs` (which would create an ABBA
// cycle with rpc_withdraw_dispute and rpc_decide_dispute), are at the bottom
// of this file.
async function settleRound() {
  const { id: jobId } = await one(
    `INSERT INTO public.jobs (title, customer_id, helper_id, status, payment_status,
                              dispute_status, dispute_resolved_at)
     VALUES ('settle race', $1, $2, 'completed', 'released', 'resolved', now())
     RETURNING id`,
    [POSTER, HELPER],
  );
  await db.query(
    `INSERT INTO public.disputes (job_id, opener_id, reason, status) VALUES ($1, $2, 'x', 'open')`,
    [jobId, POSTER],
  );
  const settle = async (admin, transferId) => {
    try {
      const r = await one(
        `SELECT public.settle_dispute_record($1, 'helper', $2, NULL, 5000, NULL, $3) AS id`,
        [jobId, admin, transferId],
      );
      return r.id;
    } catch {
      return "refused";
    }
  };
  const first = await settle(ADMIN_A, "tr_first");
  const second = await settle(ADMIN_B, "tr_second");
  const row = await one(
    `SELECT decided_by, execution_transfer_id FROM public.disputes WHERE job_id = $1`, [jobId]);
  const bad =
    (first !== null && first !== "refused" && second !== null && second !== "refused") ||
    row.decided_by !== ADMIN_A ||
    row.execution_transfer_id !== "tr_first";
  await db.query(`DELETE FROM public.jobs WHERE id = $1`, [jobId]);
  return bad;
}

// ═══════════════════════════════════════════════════════════════════════════
// Target 2 — Quick Release and Quick Refund claiming the same job.
// ═══════════════════════════════════════════════════════════════════════════
//
// BEFORE there is no claim at all: both handlers read status='disputed', both
// run their Stripe step, and only the flip picks a winner. Modelled here as
// "how many callers believe they may move money", which BEFORE is 2 (the
// read-time check both pass) and AFTER is 1.
async function claimRound(hasClaim) {
  const { id: jobId } = await one(
    `INSERT INTO public.jobs (title, customer_id, helper_id, status, payment_status)
     VALUES ('claim race', $1, $2, 'disputed', 'escrow') RETURNING id`,
    [POSTER, HELPER],
  );
  const mayMove = [];
  for (const [action, admin] of [["release", ADMIN_A], ["refund", ADMIN_B]]) {
    if (!hasClaim) {
      // The pre-fix handler's whole gate: a read-time status check.
      const j = await one(`SELECT status::text AS s FROM public.jobs WHERE id = $1`, [jobId]);
      if (j.s === "disputed") mayMove.push(action);
    } else {
      const r = await one(`SELECT public.claim_dispute_settlement($1, $2, $3) AS verdict`, [jobId, action, admin]);
      if (r.verdict?.verdict === "claimed") mayMove.push(action);
    }
  }
  await db.query(`DELETE FROM public.jobs WHERE id = $1`, [jobId]);
  return mayMove.length > 1; // BAD: both a transfer and a refund were allowed
}

// ═══════════════════════════════════════════════════════════════════════════
// Target 3 — a filing racing a job state change, and a double submit.
// ═══════════════════════════════════════════════════════════════════════════
//
// Fixtures file on an in_progress job: a completed job is not disputable by a
// person at all since 20260915025607 (job_already_completed).
// 3a: the job is cancelled under the filing. BAD = a dispute row exists, or
//     the caller got raw transition prose instead of a code the dialog can
//     translate.
// 3b: the same evidence url submitted twice. BAD = it is stored twice.
async function openRaceRound() {
  const { id: jobId } = await one(
    `INSERT INTO public.jobs (title, customer_id, helper_id, status, payment_status)
     VALUES ('open race', $1, $2, 'in_progress', 'escrow') RETURNING id`,
    [POSTER, HELPER],
  );
  await db.query(`UPDATE public.jobs SET status = 'cancelled' WHERE id = $1`, [jobId]);
  await asUser(POSTER);
  let code = "none";
  try {
    await db.query(`SELECT public.open_dispute_as($1, $2, 'the work was never delivered at all', $3)`,
      [jobId, POSTER, ["https://example.invalid/a.jpg"]]);
  } catch (e) {
    code = /dispute_job_not_disputable/.test(e.message) ? "clean" : "raw";
  }
  const [{ n }] = await q(`SELECT count(*)::int AS n FROM public.disputes WHERE job_id = $1`, [jobId]);
  await db.query(`DELETE FROM public.jobs WHERE id = $1`, [jobId]);
  return n > 0 || code !== "clean";
}

async function doubleSubmitRound() {
  const { id: jobId } = await one(
    `INSERT INTO public.jobs (title, customer_id, helper_id, status, payment_status)
     VALUES ('double submit', $1, $2, 'in_progress', 'escrow') RETURNING id`,
    [POSTER, HELPER],
  );
  await asUser(POSTER);
  const url = ["https://example.invalid/evidence.jpg"];
  const reason = "the work was never delivered at all";
  for (let k = 0; k < 2; k++) {
    await db.query(`SELECT public.open_dispute_as($1, $2, $3, $4)`, [jobId, POSTER, reason, url]);
  }
  const d = await one(`SELECT evidence_urls FROM public.disputes WHERE job_id = $1`, [jobId]);
  const j = await one(`SELECT dispute_evidence_urls FROM public.jobs WHERE id = $1`, [jobId]);
  await db.query(`DELETE FROM public.jobs WHERE id = $1`, [jobId]);
  return d.evidence_urls.length > 1 || (j.dispute_evidence_urls ?? []).length > 1;
}

// ── Run BEFORE, then apply the migration, then run AFTER ───────────────────
const tally = async (label, fn) => {
  let bad = 0;
  for (let i = 0; i < ROUNDS; i++) if (await fn()) bad++;
  console.log(`  ${label}: ${bad}/${ROUNDS}`);
  return bad;
};

console.log(`\n── BEFORE (prod bodies as they stand today) ──`);
await db.exec(settleBefore);
await db.exec(openBefore);
await db.exec(CLAIM_TABLE); // table only; the BEFORE handlers never call the RPC
const before = {
  settle: await tally("1  a second settler also executes", settleRound),
  claim: await tally("2  Quick Release + Quick Refund both allowed to move money", () => claimRound(false)),
  openRace: await tally("3a a filing lands on a job that moved on", openRaceRound),
  doubleSubmit: await tally("3b a double submit stores its evidence twice", doubleSubmitRound),
};

console.log(`\n── Applying ${MIG.split("/").pop()} ──`);
await db.exec(migration);
console.log("  applied 1×");
await db.exec(migration);
await db.exec(migration);
console.log("  applied 3× (replay-safe)");

console.log(`\n── AFTER ──`);
const after = {
  settle: await tally("1  a second settler also executes", settleRound),
  claim: await tally("2  Quick Release + Quick Refund both allowed to move money", () => claimRound(true)),
  openRace: await tally("3a a filing lands on a job that moved on", openRaceRound),
  doubleSubmit: await tally("3b a double submit stores its evidence twice", doubleSubmitRound),
};

console.log("");
// `settle` is the one round expected clean on BOTH sides (see its header); the
// other three must be red before and green after, or the round is not
// measuring the bug it claims to.
check(`settle: ${before.settle}/${ROUNDS} -> ${after.settle}/${ROUNDS}`,
  before.settle === 0 && after.settle === 0,
  "the WHERE status='open' predicate was already load-bearing; the dispute-row lock is proven by the static assertions below and by race-runner race 3");
for (const k of ["claim", "openRace", "doubleSubmit"]) {
  check(`${k}: ${before[k]}/${ROUNDS} -> ${after[k]}/${ROUNDS}`, before[k] > 0 && after[k] === 0,
    before[k] === 0 ? "BEFORE was already clean — the round does not exercise the bug" : "");
}

// ── Static assertion for the one thing a single connection cannot race ─────
// The lock must be on the `jobs` read inside settle_dispute_record, and the
// two writers it has to conflict with must still take the row exclusively —
// otherwise FOR SHARE conflicts with nothing and is decoration.
{
  const [{ def }] = await q(
    `SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'settle_dispute_record'`);
  check("settle_dispute_record locks its own disputes row FOR UPDATE",
    /FROM public\.disputes[\s\S]{0,200}FOR UPDATE/.test(def));
  // The cure for the window must not be an ABBA cycle: rpc_withdraw_dispute and
  // rpc_decide_dispute both take disputes -> jobs, so this function must never
  // hold a jobs lock while waiting on a disputes row.
  const jobsRead = def.slice(def.indexOf("FROM public.jobs"));
  check("settle_dispute_record takes NO lock on public.jobs (no deadlock cycle)",
    !/FROM public\.jobs[\s\S]{0,200}FOR (SHARE|UPDATE)/.test(jobsRead));
  const [{ def: openDef }] = await q(
    `SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'open_dispute_as'`);
  check("open_dispute_as still takes the job FOR UPDATE (so it conflicts)",
    /FROM public\.jobs WHERE id = _job_id FOR UPDATE/.test(openDef));
}

// The claim must also release, or a wedged handler locks the dispute out of
// both actions forever.
{
  const { id: jobId } = await one(
    `INSERT INTO public.jobs (title, customer_id, status, payment_status)
     VALUES ('claim release', $1, 'disputed', 'escrow') RETURNING id`, [POSTER]);
  const first = await one(`SELECT public.claim_dispute_settlement($1, 'release', $2) AS v`, [jobId, ADMIN_A]);
  const held = await one(`SELECT public.claim_dispute_settlement($1, 'refund', $2) AS v`, [jobId, ADMIN_B]);
  const freed = await one(`SELECT public.release_dispute_settlement_claim($1, $2) AS v`, [jobId, first.v.token]);
  const retaken = await one(`SELECT public.claim_dispute_settlement($1, 'refund', $2) AS v`, [jobId, ADMIN_B]);
  check("claim refuses the other action, then releases by token and can be retaken",
    held.v.verdict === "held_by_release" && freed.v === true && retaken.v.verdict === "claimed",
    `${JSON.stringify(held.v)} / ${freed.v} / ${JSON.stringify(retaken.v)}`);
  const same = await one(`SELECT public.claim_dispute_settlement($1, 'refund', $2) AS v`, [jobId, ADMIN_B]);
  check("a retry of the SAME action joins rather than conflicting", same.v.verdict === "joined", JSON.stringify(same.v));
  check("a joined caller holds NO token, so its cleanup frees nothing", !same.v.token, JSON.stringify(same.v));
  // THE defect the authz + money reviews both found in the first draft: the
  // release deleted by job_id alone, so a re-entrant loser's `finally` freed
  // the winner's claim while its Stripe call was still in flight.
  const freedByStranger = await one(
    `SELECT public.release_dispute_settlement_claim($1, gen_random_uuid()) AS v`, [jobId]);
  const stillHeld = await one(`SELECT public.claim_dispute_settlement($1, 'release', $2) AS v`, [jobId, ADMIN_A]);
  check("a stranger's token cannot free a live claim",
    freedByStranger.v === false && stillHeld.v.verdict === "held_by_refund",
    `${freedByStranger.v} / ${JSON.stringify(stillHeld.v)}`);
  const noToken = await one(`SELECT public.release_dispute_settlement_claim($1, NULL) AS v`, [jobId]);
  check("a caller with no token frees nothing", noToken.v === false, String(noToken.v));
  // A split claims only a job carrying a decided, unexecuted dispute (round 5);
  // with one on the job it is a claimable action refused by the live holder.
  await db.query(`INSERT INTO public.disputes (job_id, reason, status, execution_status) VALUES ($1, 'x', 'decided', 'pending')`, [jobId]);
  check("'split' is a claimable action (execute-dispute-split shares this lock)",
    (await one(`SELECT public.claim_dispute_settlement($1, 'split', NULL) AS v`, [jobId])).v.verdict === "held_by_refund");
  await db.query(`DELETE FROM public.disputes WHERE job_id = $1 AND status = 'decided'`, [jobId]);
  await db.query(`UPDATE public.jobs SET status = 'cancelled' WHERE id = $1`, [jobId]);
  const notDisputed = await one(`SELECT public.claim_dispute_settlement($1, 'release', $2) AS v`, [jobId, ADMIN_A]);
  check("a job that is no longer disputed cannot be claimed", notDisputed.v.verdict === "not_disputed", JSON.stringify(notDisputed.v));
  await db.query(`DELETE FROM public.jobs WHERE id = $1`, [jobId]);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
await db.close();
process.exit(failures === 0 ? 0 : 1);
