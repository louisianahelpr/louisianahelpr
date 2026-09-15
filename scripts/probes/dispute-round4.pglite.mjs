#!/usr/bin/env node
/**
 * PGlite proof for the SQL half of the dispute-races round-4 closes
 * (lh-money-escrow round 3: H1, M1, M2, LOW stuck_split).
 *
 *   node scripts/probes/dispute-round4.pglite.mjs <migration.sql>
 *
 * Run it twice: once against the migration as it stood at 8b4ea6ad0 (every
 * check below is RED there), once against the working tree (GREEN):
 *   git show 8b4ea6ad0:supabase/migrations/20260914194614_dispute_settlement_claim_and_race_locks.sql > /tmp/before.sql
 *   node scripts/probes/dispute-round4.pglite.mjs /tmp/before.sql            # red
 *   node scripts/probes/dispute-round4.pglite.mjs supabase/migrations/20260915034822_dispute_settlement_claim_and_race_locks.sql
 *
 * pglite is not a dependency (CLAUDE.md):
 *   mkdir -p ~/.lh-pglite-probe && cd ~/.lh-pglite-probe && npm i @electric-sql/pglite
 *
 * The schema stub carries the LIVE prod rpc_withdraw_dispute (pg_get_functiondef,
 * 2026-09-14) so the BEFORE run exercises the function prod runs today. The
 * migration is applied three times (replay-safety) before any check.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${process.env.HOME}/.lh-pglite-probe`;
let PGlite;
try {
  ({ PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`));
} catch {
  console.error(`Could not load pglite from ${PGLITE_DIR} (npm i @electric-sql/pglite there).`);
  process.exit(2);
}

const MIGRATION_FILE = process.argv[2];
if (!MIGRATION_FILE) {
  console.error("usage: dispute-round4.pglite.mjs <migration.sql>");
  process.exit(2);
}
const MIGRATION = readFileSync(resolve(MIGRATION_FILE), "utf8");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const POSTER = "11111111-1111-1111-1111-111111111111";
const HELPER = "22222222-2222-2222-2222-222222222222";
const ADMIN = "33333333-3333-3333-3333-333333333333";

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
  CREATE TYPE app_role AS ENUM ('admin','moderator','user');
  CREATE TABLE public.user_roles (user_id uuid, role app_role);
  CREATE FUNCTION public.has_role(_user_id uuid, _role app_role) RETURNS boolean LANGUAGE sql STABLE AS $f$
    SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $f$;
  CREATE TABLE public.jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text, customer_id uuid, helper_id uuid,
    status job_status NOT NULL DEFAULT 'open', payment_status text, dispute_status text,
    dispute_reason text, dispute_evidence_urls text[], dispute_resolved_at timestamptz,
    disputed_at timestamptz, disputed_by uuid, payout_scheduled_at timestamptz,
    poster_completed_at timestamptz, is_seed boolean NOT NULL DEFAULT false);
  CREATE TABLE public.disputes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE, opener_id uuid, reason text,
    evidence_urls text[] NOT NULL DEFAULT '{}', status text NOT NULL DEFAULT 'open',
    decided_at timestamptz, decided_by uuid, decision_text text, payout_split jsonb,
    execution_status text CHECK (execution_status IS NULL OR execution_status IN ('pending','executing','executed','failed')),
    executed_at timestamptz, execution_started_at timestamptz,
    execution_helper_cents integer, execution_refund_cents integer, execution_transfer_id text,
    execution_refund_id text, execution_error text, created_at timestamptz NOT NULL DEFAULT now());
  ALTER TABLE public.disputes ADD CONSTRAINT disputes_status_check CHECK (status IN ('open','decided','withdrawn'));
  CREATE UNIQUE INDEX disputes_one_open_per_job_idx ON public.disputes (job_id) WHERE status = 'open';
  CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid, title text, message text, type text, link text, read boolean NOT NULL DEFAULT false);
  CREATE TABLE public.admin_audit_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), admin_id uuid,
    action text NOT NULL, target_type text, target_id uuid, details jsonb, created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.gift_cards (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, restored_from_job_id uuid, status text);
  CREATE TABLE public.fraud_flags (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid, job_id uuid, flag_type text, details text, resolved boolean NOT NULL DEFAULT false);
  CREATE FUNCTION public.check_dispute_velocity(_uid uuid) RETURNS boolean LANGUAGE sql AS $f$ SELECT true $f$;
  CREATE FUNCTION public.notify_ops_dispute_filed(uuid, text, text, uuid, boolean) RETURNS void
    LANGUAGE sql AS $f$ SELECT NULL::void $f$;
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

  -- LIVE prod rpc_decide_dispute, pg_get_functiondef 2026-09-14 (= 20260907194838).
CREATE OR REPLACE FUNCTION public.rpc_decide_dispute(_dispute_id uuid, _decision_text text, _payout_split jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _job_id uuid;
  _customer_id uuid;
  _helper_id uuid;
  _job_title text;
  _existing_status text;
  _poster_share numeric;
  _helper_share numeric;
  _new_job_status text;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT public.has_role(_uid, 'admin') THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  IF _decision_text IS NULL OR length(trim(_decision_text)) = 0 THEN
    RAISE EXCEPTION 'decision_text required';
  END IF;

  SELECT job_id, status INTO _job_id, _existing_status
    FROM public.disputes
   WHERE id = _dispute_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'dispute not found';
  END IF;

  IF _existing_status <> 'open' THEN
    RAISE EXCEPTION 'dispute already %', _existing_status;
  END IF;

  SELECT customer_id, helper_id, title
    INTO _customer_id, _helper_id, _job_title
    FROM public.jobs
   WHERE id = _job_id;

  _poster_share := COALESCE((_payout_split->>'poster')::numeric, 0.5);
  _helper_share := COALESCE((_payout_split->>'helper')::numeric, 0.5);
  IF _poster_share > 1 OR _helper_share > 1 THEN
    _poster_share := _poster_share / 100.0;
    _helper_share := _helper_share / 100.0;
  END IF;

  IF _poster_share >= 1 AND _helper_share <= 0 THEN
    _new_job_status := 'cancelled';
  ELSE
    _new_job_status := 'completed';
  END IF;

  UPDATE public.disputes
     SET status = 'decided',
         decided_at = now(),
         decided_by = _uid,
         decision_text = _decision_text,
         payout_split = jsonb_build_object(
           'poster', _poster_share,
           'helper', _helper_share
         ),
         -- The decision is on record; the money is not. Until
         -- execute-dispute-split flips this to 'executed', this dispute is
         -- UNSETTLED and stays in the admin's open work.
         execution_status = COALESCE(disputes.execution_status, 'pending')
   WHERE id = _dispute_id;

  UPDATE public.jobs
     SET status = _new_job_status::public.job_status,
         dispute_resolved_at = now(),
         dispute_status = 'resolved'
   WHERE id = _job_id;

  IF _customer_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, message, link, read)
    VALUES (
      _customer_id,
      'info',
      'Dispute resolved',
      'A decision has been made on "' || COALESCE(_job_title, 'your job') || '": ' || _decision_text,
      '/my-posts?job=' || _job_id::text,
      false
    );
  END IF;

  IF _helper_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, message, link, read)
    VALUES (
      _helper_id,
      'info',
      'Dispute resolved',
      'A decision has been made on "' || COALESCE(_job_title, 'a job you worked') || '": ' || _decision_text,
      '/my-jobs?job=' || _job_id::text,
      false
    );
  END IF;

  -- Audit-log entry so this admin action shows up alongside every other
  -- admin mutation in AdminAuditLog. Non-fatal — the decision itself has
  -- already committed; a failed audit write shouldn't roll it back.
  BEGIN
    INSERT INTO public.admin_audit_log (admin_id, action, target_id, target_type, details)
    VALUES (
      _uid,
      'decide_dispute',
      _dispute_id,
      'dispute',
      jsonb_build_object(
        'job_id', _job_id,
        'poster_share', _poster_share,
        'helper_share', _helper_share,
        'new_job_status', _new_job_status,
        'decision_preview', left(_decision_text, 200)
      )
    );
  EXCEPTION WHEN others THEN
    NULL;
  END;
END;
$function$;

  -- LIVE prod rpc_withdraw_dispute, pg_get_functiondef 2026-09-14 (= 20260908024937).
  CREATE OR REPLACE FUNCTION public.rpc_withdraw_dispute(_job_id uuid)
   RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
  AS $function$
  DECLARE
    _uid uuid := auth.uid();
    _opener uuid;
    _dispute_id uuid;
    _restored text;
  BEGIN
    IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
    SELECT id, opener_id INTO _dispute_id, _opener FROM public.disputes
     WHERE job_id = _job_id AND status = 'open' ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
    IF _dispute_id IS NULL THEN RAISE EXCEPTION 'no open dispute for this job'; END IF;
    IF _opener IS DISTINCT FROM _uid THEN
      RAISE EXCEPTION 'only the party who opened this dispute may withdraw it';
    END IF;
    SELECT CASE WHEN j.poster_completed_at IS NOT NULL OR j.payout_scheduled_at IS NOT NULL
                  OR COALESCE(j.payment_status, '') IN ('payout_pending', 'released')
                THEN 'completed' ELSE 'in_progress' END
      INTO _restored FROM public.jobs j WHERE j.id = _job_id FOR UPDATE;
    UPDATE public.disputes SET status = 'withdrawn', decided_at = now() WHERE id = _dispute_id;
    PERFORM set_config('app.dispute_withdraw_rpc', '1', true);
    UPDATE public.jobs SET status = _restored::job_status, dispute_status = 'resolved', dispute_resolved_at = now()
     WHERE id = _job_id;
    PERFORM set_config('app.dispute_withdraw_rpc', '0', true);
  END;
  $function$;
`;

const db = new PGlite();
await db.exec(SCHEMA);
await db.exec(MIGRATION);
await db.exec(MIGRATION);
await db.exec(MIGRATION);
console.log(`migration applied 3× (${MIGRATION_FILE})`);
await db.query(`INSERT INTO public.user_roles VALUES ($1, 'admin')`, [ADMIN]);

const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const as = (uid) => db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [uid ?? ""]);
const attempt = async (sql, p) => {
  try { await db.query(sql, p); return "ok"; } catch (e) { return e.message; }
};
const hasFn = async (sig) => (await one(`SELECT to_regprocedure($1) IS NOT NULL AS ok`, [sig])).ok;
const newJob = async (status, payment, extra = {}) =>
  (await one(
    `INSERT INTO public.jobs (title, customer_id, helper_id, status, payment_status, dispute_status, is_seed)
     VALUES ('r4', $1, $2, $3, $4, $5, $6) RETURNING id`,
    [POSTER, HELPER, status, payment, extra.dispute_status ?? null, extra.is_seed ?? false],
  )).id;
const claim = async (jobId, action) => {
  try { return (await one(`SELECT public.claim_dispute_settlement($1, $2, NULL) AS v`, [jobId, action])).v; }
  catch (e) { return { verdict: `raised: ${e.message.slice(0, 80)}` }; }
};
const hasStampColumn = async () =>
  (await one(`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dispute_settlement_claims' AND column_name='money_step_at') AS ok`)).ok;
/** A claim row, backdated past the TTL, optionally stamped as having reached its money step. */
const deadClaim = async (jobId, action, stamped) => {
  const { token } = await one(
    `INSERT INTO public.dispute_settlement_claims (job_id, action, claimed_at) VALUES ($1, $2, now() - interval '30 minutes') RETURNING token`,
    [jobId, action],
  );
  if (stamped && (await hasStampColumn())) {
    await db.query(`UPDATE public.dispute_settlement_claims SET money_step_at = now() - interval '29 minutes' WHERE token = $1`, [token]);
  }
  return token;
};

// ── H1: rpc_withdraw_dispute refuses while a settlement claim exists ───────
{
  const jobId = await newJob("disputed", "escrow", { dispute_status: "open" });
  await db.query(`INSERT INTO public.disputes (job_id, opener_id, reason) VALUES ($1, $2, 'the work was never delivered')`, [jobId, POSTER]);
  await db.query(`INSERT INTO public.dispute_settlement_claims (job_id, action) VALUES ($1, 'release')`, [jobId]);
  await as(POSTER);
  const res = await attempt(`SELECT public.rpc_withdraw_dispute($1)`, [jobId]);
  await as(null);
  const j = await one(`SELECT status::text AS s FROM public.jobs WHERE id = $1`, [jobId]);
  check("H1: a withdrawal under a live Quick Release claim is refused (dispute_settlement_in_progress), job stays disputed",
    /dispute_settlement_in_progress/.test(res) && j.s === "disputed", `${res} / ${j.s}`);

  // Control: a DEAD SWEEP's claim (no money step exists for a sweep) never blocks.
  const jobB = await newJob("disputed", "escrow", { dispute_status: "open" });
  await db.query(`INSERT INTO public.disputes (job_id, opener_id, reason) VALUES ($1, $2, 'the work was never delivered')`, [jobB, POSTER]);
  await deadClaim(jobB, "sweep", false);
  await as(POSTER);
  const resB = await attempt(`SELECT public.rpc_withdraw_dispute($1)`, [jobB]);
  await as(null);
  const jB = await one(`SELECT status::text AS s FROM public.jobs WHERE id = $1`, [jobB]);
  check("H1 control: an expired SWEEP claim does not block the withdrawal", resB === "ok" && jB.s === "in_progress", `${resB} / ${jB.s}`);

  const acl = await one(`SELECT has_function_privilege('anon','public.rpc_withdraw_dispute(uuid)','EXECUTE') AS a`);
  check("H1: anon cannot execute rpc_withdraw_dispute", acl.a === false, JSON.stringify(acl));
}

// ── Rebase guard: DONE IS FINAL survives this migration (20260915025607) ──
{
  const jobId = await newJob("completed", "escrow");
  const first = await attempt(`SELECT public.open_dispute_as($1, $2, 'the work was never delivered at all', '{}')`, [jobId, POSTER]);
  await db.query(`INSERT INTO public.disputes (job_id, opener_id, reason) SELECT $1, $2, 'stale open row'
    WHERE NOT EXISTS (SELECT 1 FROM public.disputes WHERE job_id = $1 AND status = 'open')`, [jobId, HELPER]);
  const refile = await attempt(`SELECT public.open_dispute_as($1, $2, 'the work was never delivered at all', '{}')`, [jobId, HELPER]);
  const j = await one(`SELECT status::text AS s FROM public.jobs WHERE id = $1`, [jobId]);
  check("rebase: a person disputing a COMPLETED job still gets job_already_completed after this migration (new filing and re-freeze)",
    /job_already_completed/.test(first) && /job_already_completed/.test(refile) && j.s === "completed", `${first} / ${refile} / ${j.s}`);
}

// ── M2: only a claim STAMPED at its money step sticks ─────────────────────
{
  check("M2: dispute_settlement_claims.money_step_at exists", await hasStampColumn());
  check("M2: stamp_dispute_settlement_claim(uuid, uuid) exists", await hasFn("public.stamp_dispute_settlement_claim(uuid,uuid)"));

  const unstamped = await newJob("disputed", "escrow");
  await deadClaim(unstamped, "release", false);
  const v1 = await claim(unstamped, "refund");
  check("M2: a dead Quick Release that never reached its money step expires into a Quick Refund (claimed, not stuck_release)",
    v1.verdict === "claimed", JSON.stringify(v1));
  const page1 = await one(`SELECT count(*)::int AS n FROM net.calls`);
  const log1 = await one(`SELECT severity FROM public.error_logs WHERE tags->>'job' = $1`, [unstamped]);
  check("M2: …reported as a warning, never a critical page (nothing could have moved)",
    page1.n === 0 && log1?.severity === "warning", JSON.stringify({ page1, log1 }));

  const stamped = await newJob("disputed", "escrow");
  await deadClaim(stamped, "release", true);
  const v2 = await claim(stamped, "refund");
  check("M2 control: a dead Quick Release STAMPED at its money step still sticks (stuck_release)", v2.verdict === "stuck_release", JSON.stringify(v2));

  if (await hasFn("public.stamp_dispute_settlement_claim(uuid,uuid)")) {
    const live = await newJob("disputed", "escrow");
    const c = await claim(live, "release");
    const wrong = await one(`SELECT public.stamp_dispute_settlement_claim($1, gen_random_uuid()) AS ok`, [live]);
    const right = await one(`SELECT public.stamp_dispute_settlement_claim($1, $2) AS ok`, [live, c.token]);
    check("M2: the stamp is by TOKEN — a wrong token stamps nothing, the holder's token stamps its row",
      wrong.ok === false && right.ok === true, JSON.stringify({ wrong, right }));
    await db.query(`DELETE FROM public.dispute_settlement_claims WHERE job_id = $1`, [live]);
    const gone = await one(`SELECT public.stamp_dispute_settlement_claim($1, $2) AS ok`, [live, c.token]);
    check("M2: a holder whose claim is gone cannot stamp (so it must not move money)", gone.ok === false, JSON.stringify(gone));
    const acl = await one(`SELECT has_function_privilege('authenticated','public.stamp_dispute_settlement_claim(uuid,uuid)','EXECUTE') AS a,
      has_function_privilege('anon','public.stamp_dispute_settlement_claim(uuid,uuid)','EXECUTE') AS b`);
    check("M2: anon / authenticated cannot stamp a claim", acl.a === false && acl.b === false, JSON.stringify(acl));
  } else {
    check("M2: stamp by token (function missing)", false);
  }

  // The monitor: an unstamped dead claim on a still-disputed job pages nothing and is cleared.
  await db.exec(`TRUNCATE net.calls, public.error_logs; DELETE FROM public.dispute_settlement_claims;`);
  const mon = await newJob("disputed", "escrow");
  await deadClaim(mon, "refund", false);
  const r = (await one(`SELECT public.check_stale_dispute_settlement_claims() AS r`)).r;
  const left = await one(`SELECT count(*)::int AS n FROM public.dispute_settlement_claims WHERE job_id = $1`, [mon]);
  const pages = await one(`SELECT count(*)::int AS n FROM net.calls`);
  check("M2: the monitor clears an unstamped dead claim on a disputed job with no page",
    left.n === 0 && pages.n === 0, JSON.stringify({ r, left, pages }));

  const monS = await newJob("disputed", "escrow");
  await deadClaim(monS, "refund", true);
  await db.exec(`TRUNCATE net.calls`);
  await one(`SELECT public.check_stale_dispute_settlement_claims() AS r`);
  const call = (await one(`SELECT body FROM net.calls ORDER BY id DESC LIMIT 1`))?.body;
  const keptS = await one(`SELECT count(*)::int AS n FROM public.dispute_settlement_claims WHERE job_id = $1`, [monS]);
  check("M2 control: a STAMPED dead claim on a disputed job pages critical and is kept", call?.severity === "critical" && keptS.n === 1, JSON.stringify({ call, keptS }));
  check("H3: the stale-claim page says not to Retry settlement until the ledger matches Stripe",
    /Do not Retry settlement until the ledger matches Stripe/.test(call?.message ?? ""), call?.message);
}

// ── LOW: a split resumes over its own dead split ──────────────────────────
{
  const jobId = await newJob("completed", "escrow");
  await db.query(`INSERT INTO public.disputes (job_id, reason, status, execution_status) VALUES ($1, 'x', 'decided', 'executing')`, [jobId]);
  await deadClaim(jobId, "split", true);
  const v = await claim(jobId, "split");
  check("LOW: a split retry takes over its own dead split's claim (the split reconciles its own legs)", v.verdict === "claimed", JSON.stringify(v));
  const jobR = await newJob("disputed", "escrow");
  await deadClaim(jobR, "split", true);
  const vr = await claim(jobR, "release");
  check("LOW control: a Quick Release over a dead, stamped split is still stuck_split", vr.verdict === "stuck_split", JSON.stringify(vr));
}

// ── M1: rpc_supersede_dispute_decision ────────────────────────────────────
{
  const exists = await hasFn("public.rpc_supersede_dispute_decision(uuid,text)");
  check("M1: rpc_supersede_dispute_decision(uuid, text) exists", exists);
  if (exists) {
    const acl = await one(`SELECT has_function_privilege('anon','public.rpc_supersede_dispute_decision(uuid,text)','EXECUTE') AS a,
      has_function_privilege('authenticated','public.rpc_supersede_dispute_decision(uuid,text)','EXECUTE') AS b`);
    check("M1: anon cannot execute it; authenticated can reach the admin check", acl.a === false && acl.b === true, JSON.stringify(acl));

    const decided = async (status = "completed", payment = "escrow", exec = "pending") => {
      const jobId = await newJob(status, payment, { dispute_status: "resolved" });
      const { id } = await one(
        `INSERT INTO public.disputes (job_id, opener_id, reason, status, decided_at, decided_by, decision_text, payout_split, execution_status)
         VALUES ($1, $2, 'the work was never delivered', 'decided', now(), $3, 'half each', '{"poster":0.5,"helper":0.5}', $4) RETURNING id`,
        [jobId, POSTER, ADMIN, exec],
      );
      return { jobId, disputeId: id };
    };
    const REASON = "Helpr account was deleted, the split can never transfer";

    {
      const { disputeId } = await decided();
      await as(POSTER);
      const res = await attempt(`SELECT public.rpc_supersede_dispute_decision($1, $2)`, [disputeId, REASON]);
      await as(null);
      const res2 = await attempt(`SELECT public.rpc_supersede_dispute_decision($1, $2)`, [disputeId, REASON]);
      check("M1: a non-admin is refused, and a call with no user (service role) is refused",
        /admin only/.test(res) && /not authenticated/.test(res2), `${res} / ${res2}`);
    }
    {
      const { jobId, disputeId } = await decided();
      await as(ADMIN);
      const res = await attempt(`SELECT public.rpc_supersede_dispute_decision($1, $2)`, [disputeId, REASON]);
      await as(null);
      const d = await one(`SELECT status, execution_status, payout_split, decided_at FROM public.disputes WHERE id = $1`, [disputeId]);
      const fresh = await one(`SELECT id, status, opener_id, execution_status, payout_split, reason FROM public.disputes WHERE job_id = $1 AND id <> $2`, [jobId, disputeId]);
      const j = await one(`SELECT status::text AS s, payment_status, dispute_status, dispute_resolved_at FROM public.jobs WHERE id = $1`, [jobId]);
      const audit = await one(`SELECT details FROM public.admin_audit_log WHERE action = 'supersede_dispute_decision' AND target_id = $1`, [disputeId]);
      check("M1 (r5): the ruled row is RETIRED as superseded with its decision kept, never re-opened in place",
        res === "ok" && d.status === "superseded" && d.payout_split?.helper === 0.5 && d.decided_at !== null, `${res} / ${JSON.stringify(d)}`);
      check("M1 (r5): a NEW open dispute row carries the job — no opener, no decision, its own id (so its Stripe keys and metadata differ)",
        fresh?.status === "open" && fresh.opener_id === null && fresh.execution_status === null && fresh.payout_split === null, JSON.stringify(fresh));
      await as(POSTER);
      const wd = await attempt(`SELECT public.rpc_withdraw_dispute($1)`, [jobId]);
      await as(null);
      check("M1 (r5): the original opener cannot withdraw the re-opened (ruled) dispute", /only the party who opened/.test(wd), wd);
      check("M1: …the job is back to disputed + escalated with the escrow still held (the 72h sweep will not pay it out)",
        j.s === "disputed" && j.payment_status === "escrow" && j.dispute_status === "escalated" && j.dispute_resolved_at === null, JSON.stringify(j));
      check("M1: …and the superseded decision is in the audit log", audit?.details?.payout_split?.helper === 0.5 && audit?.details?.reason === REASON, JSON.stringify(audit));
      const v = await claim(jobId, "refund");
      check("M1: …after which a Quick Refund can claim it (no split_pending)", v.verdict === "claimed", JSON.stringify(v));
    }
    {
      // A poster-wins decision moved the job to cancelled; supersede still reopens it.
      const { jobId, disputeId } = await decided("cancelled", "escrow", "failed");
      await as(ADMIN);
      const res = await attempt(`SELECT public.rpc_supersede_dispute_decision($1, $2)`, [disputeId, REASON]);
      await as(null);
      const j = await one(`SELECT status::text AS s FROM public.jobs WHERE id = $1`, [jobId]);
      check("M1: a failed (never-moved) decision on a cancelled job is superseded too", res === "ok" && j.s === "disputed", `${res} / ${j.s}`);
    }
    const refusals = [
      ["already executed", async () => (await decided("completed", "released", "executed")), /supersede_not_supersedable|executed/],
      ["a payout transfer is on the ledger", async () => {
        const x = await decided(); await db.query(`INSERT INTO public.payout_transfers (job_id, status) VALUES ($1, 'paid')`, [x.jobId]); return x;
      }, /supersede_money_moved/],
      ["a refund is on the ledger", async () => {
        const x = await decided(); await db.query(`INSERT INTO public.payment_refunds (job_id, stripe_refund_id) VALUES ($1, 're_' || gen_random_uuid())`, [x.jobId]); return x;
      }, /supersede_money_moved/],
      ["a leg id is stamped on the dispute", async () => {
        const x = await decided("completed", "escrow", "failed"); await db.query(`UPDATE public.disputes SET execution_transfer_id = 'tr_x' WHERE id = $1`, [x.disputeId]); return x;
      }, /supersede_money_moved/],
      ["a gift was restored for the job", async () => {
        const x = await decided(); await db.query(`INSERT INTO public.gift_cards (restored_from_job_id, status) VALUES ($1, 'active')`, [x.jobId]); return x;
      }, /supersede_money_moved/],
      ["a settlement claim is held", async () => {
        const x = await decided(); await db.query(`INSERT INTO public.dispute_settlement_claims (job_id, action) VALUES ($1, 'split')`, [x.jobId]); return x;
      }, /dispute_settlement_in_progress/],
      ["the escrow is no longer held", async () => (await decided("completed", "refunded", "failed")), /supersede_escrow_not_held/],
      ["the reason is too short", async () => (await decided()), /supersede_needs_reason/, "nope"],
    ];
    for (const [label, seed, expected, reason] of refusals) {
      const { jobId, disputeId } = await seed();
      await as(ADMIN);
      const res = await attempt(`SELECT public.rpc_supersede_dispute_decision($1, $2)`, [disputeId, reason ?? REASON]);
      await as(null);
      const d = await one(`SELECT status FROM public.disputes WHERE id = $1`, [disputeId]);
      const j = await one(`SELECT status::text AS s FROM public.jobs WHERE id = $1`, [jobId]);
      check(`M1: refused when ${label} (nothing changes)`, expected.test(res) && d.status === "decided" && j.s !== "disputed", `${res} / ${d.status} / ${j.s}`);
    }

    // ── Round 5 refusals and allowances ──
    const r5 = [
      ["a split is executing right now (execution_started_at inside the TTL)", async () => {
        const x = await decided("completed", "escrow", "executing");
        await db.query(`UPDATE public.disputes SET execution_started_at = now() WHERE id = $1`, [x.disputeId]); return x;
      }, /dispute_settlement_in_progress/, false],
      ["a money step is stamped on an EXPIRED claim", async () => {
        const x = await decided(); await deadClaim(x.jobId, "split", true); return x;
      }, /dispute_settlement_in_progress/, false],
      ["the admin is a party to the job", async () => {
        const x = await decided(); await db.query(`UPDATE public.jobs SET helper_id = $2 WHERE id = $1`, [x.jobId, ADMIN]); return x;
      }, /admin_is_party/, false],
      ["an executing split that died long ago with nothing moved", async () => {
        const x = await decided("completed", "escrow", "executing");
        await db.query(`UPDATE public.disputes SET execution_started_at = now() - interval '2 hours' WHERE id = $1`, [x.disputeId]); return x;
      }, /^ok$/, true],
      ["an EXPIRED UNSTAMPED claim (its holder moved nothing)", async () => {
        const x = await decided(); await deadClaim(x.jobId, "split", false); return x;
      }, /^ok$/, true],
    ];
    for (const [label, seed, expected, allowed] of r5) {
      const { disputeId } = await seed();
      await as(ADMIN);
      const res = await attempt(`SELECT public.rpc_supersede_dispute_decision($1, $2)`, [disputeId, REASON]);
      await as(null);
      const d = await one(`SELECT status FROM public.disputes WHERE id = $1`, [disputeId]);
      check(`M1 (r5): ${allowed ? "ALLOWED" : "refused"} when ${label}`,
        expected.test(res) && d.status === (allowed ? "superseded" : "decided"), `${res} / ${d.status}`);
    }
  }
}

// ── Round 5: the rest of the round-4 review ───────────────────────────────
{
  const con = await one(`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'disputes_status_check'`);
  check("r5: disputes_status_check admits 'superseded'", /superseded/.test(con?.d ?? ""), con?.d);

  const ttl = await one(`SELECT extract(epoch FROM public.dispute_settlement_claim_ttl())::int AS s`);
  check("r5: the claim TTL outlives the 400 s edge wall clock", ttl.s > 400, `${ttl.s}s`);

  const noDecision = await newJob("disputed", "escrow");
  const v = await claim(noDecision, "split");
  check("r5: a split cannot claim a disputed job that has no decided, unexecuted dispute", v.verdict !== "claimed", JSON.stringify(v));

  // rpc_decide_dispute refuses under a live claim, and when the admin is a party.
  const decideOn = async (setup) => {
    const jobId = await newJob("disputed", "escrow", { dispute_status: "open" });
    const { id } = await one(`INSERT INTO public.disputes (job_id, opener_id, reason) VALUES ($1, $2, 'the work was never delivered') RETURNING id`, [jobId, POSTER]);
    if (setup) await setup(jobId);
    await as(ADMIN);
    const res = await attempt(`SELECT public.rpc_decide_dispute($1, 'half each', '{"poster":0.5,"helper":0.5}'::jsonb)`, [id]);
    await as(null);
    const d = await one(`SELECT status FROM public.disputes WHERE id = $1`, [id]);
    return { res, status: d.status };
  };
  const underClaim = await decideOn((jobId) => db.query(`INSERT INTO public.dispute_settlement_claims (job_id, action) VALUES ($1, 'release')`, [jobId]));
  check("r5: rpc_decide_dispute refuses while a Quick Release holds the claim", /dispute_settlement_in_progress/.test(underClaim.res) && underClaim.status === "open", JSON.stringify(underClaim));
  const party = await decideOn((jobId) => db.query(`UPDATE public.jobs SET customer_id = $2 WHERE id = $1`, [jobId, ADMIN]));
  check("r5: rpc_decide_dispute refuses an admin who is a party to the job", /admin_is_party/.test(party.res) && party.status === "open", JSON.stringify(party));
  const fine = await decideOn(null);
  check("r5 control: rpc_decide_dispute still decides with no claim and a non-party admin", fine.res === "ok" && fine.status === "decided", JSON.stringify(fine));

  // MEDIUM-2: the locked re-read is guarded. A dispute that does not exist (the
  // deleted-under-us shape, reachable single-connection by deleting before the
  // call) must RAISE, never fall through `NULL <> 'open'` and UPDATE the job.
  {
    const jobId = await newJob("disputed", "escrow", { dispute_status: "open" });
    const { id } = await one(`INSERT INTO public.disputes (job_id, opener_id, reason) VALUES ($1, $2, 'gone') RETURNING id`, [jobId, POSTER]);
    await db.query(`DELETE FROM public.disputes WHERE id = $1`, [id]);
    await as(ADMIN);
    const res = await attempt(`SELECT public.rpc_decide_dispute($1, 'half each', '{"poster":0.5,"helper":0.5}'::jsonb)`, [id]);
    await as(null);
    const j = await one(`SELECT status::text AS s, dispute_resolved_at FROM public.jobs WHERE id = $1`, [jobId]);
    check("MEDIUM-2: rpc_decide_dispute on a deleted dispute RAISES and leaves the job untouched",
      /dispute not found/.test(res) && j.s === "disputed" && j.dispute_resolved_at === null, `${res} / ${j.s}`);
  }
  {
    const jobId = await newJob("completed", "escrow", { dispute_status: "resolved" });
    const { id } = await one(
      `INSERT INTO public.disputes (job_id, opener_id, reason, status, decided_at, decided_by, decision_text, payout_split, execution_status)
       VALUES ($1, $2, 'x', 'decided', now(), $3, 'half', '{"poster":0.5,"helper":0.5}', 'pending') RETURNING id`,
      [jobId, POSTER, ADMIN]);
    await db.query(`DELETE FROM public.disputes WHERE id = $1`, [id]);
    await as(ADMIN);
    const res = await attempt(`SELECT public.rpc_supersede_dispute_decision($1, 'the helpr account was deleted for good')`, [id]);
    await as(null);
    const j = await one(`SELECT status::text AS s FROM public.jobs WHERE id = $1`, [jobId]);
    const n = await one(`SELECT count(*)::int AS n FROM public.disputes WHERE job_id = $1`, [jobId]);
    check("MEDIUM-2: rpc_supersede_dispute_decision on a deleted dispute RAISES, opens no new dispute, leaves the job",
      /dispute not found/.test(res) && j.s === "completed" && n.n === 0, `${res} / ${j.s} / ${n.n}`);
  }

  // Withdraw: an expired UNSTAMPED claim (any action) never blocks; a stamped one does.
  const withdrawWith = async (action, stamped) => {
    const jobId = await newJob("disputed", "escrow", { dispute_status: "open" });
    await db.query(`INSERT INTO public.disputes (job_id, opener_id, reason) VALUES ($1, $2, 'the work was never delivered')`, [jobId, POSTER]);
    await deadClaim(jobId, action, stamped);
    await as(POSTER);
    const res = await attempt(`SELECT public.rpc_withdraw_dispute($1)`, [jobId]);
    await as(null);
    return res;
  };
  const wu = await withdrawWith("release", false);
  check("r5: an expired UNSTAMPED release claim does not block the withdrawal", wu === "ok", wu);
  const ws = await withdrawWith("release", true);
  check("r5 control: an expired STAMPED release claim still blocks it", /dispute_settlement_in_progress/.test(ws), ws);

  // The split's stale page says the split resumes its own legs, not "every settlement is refused".
  await db.exec(`TRUNCATE net.calls, public.error_logs; DELETE FROM public.dispute_settlement_claims;`);
  const sj = await newJob("completed", "escrow");
  await db.query(`INSERT INTO public.disputes (job_id, reason, status, execution_status) VALUES ($1, 'x', 'decided', 'executing')`, [sj]);
  await deadClaim(sj, "split", true);
  await one(`SELECT public.check_stale_dispute_settlement_claims() AS r`);
  const sp = (await one(`SELECT body FROM net.calls ORDER BY id DESC LIMIT 1`))?.body;
  check("r5: a dead split's page says a Retry of the split resumes its own legs",
    /resumes its own legs/.test(sp?.message ?? "") && !/Every settlement of this job is refused/.test(sp?.message ?? ""), sp?.message);
}

// ── Round 5 LOW-1: evidence on an admin re-opened dispute ─────────────────
{
  const exists = await hasFn("public.rpc_add_dispute_evidence(uuid,text[])");
  check("LOW-1: rpc_add_dispute_evidence(uuid, text[]) exists", exists);
  if (exists) {
    const acl = await one(`SELECT has_function_privilege('anon','public.rpc_add_dispute_evidence(uuid,text[])','EXECUTE') AS a,
      has_function_privilege('authenticated','public.rpc_add_dispute_evidence(uuid,text[])','EXECUTE') AS b`);
    check("LOW-1: anon cannot execute it; authenticated can reach its party check", acl.a === false && acl.b === true, JSON.stringify(acl));

    const jobId = await newJob("disputed", "escrow", { dispute_status: "escalated" });
    await db.query(`UPDATE public.jobs SET dispute_evidence_urls = '{}' WHERE id = $1`, [jobId]);
    const { id: reopened } = await one(`INSERT INTO public.disputes (job_id, opener_id, reason) VALUES ($1, NULL, 'Re-opened by an admin after the earlier decision could not be carried out: x') RETURNING id`, [jobId]);
    const url = (uid) => `https://fncmgoasalhdgfwzhsqa.supabase.co/storage/v1/object/sign/proof-photos/${uid}/disputes/${jobId}/a.jpg?token=t`;
    const add = async (uid, disputeId, urls) => {
      await as(uid);
      const r = await attempt(`SELECT public.rpc_add_dispute_evidence($1, $2::text[])`, [disputeId, urls]);
      await as(null);
      return r;
    };
    const ok1 = await add(HELPER, reopened, [url(HELPER)]);
    const ok2 = await add(POSTER, reopened, [url(POSTER), url(POSTER)]);
    const again = await add(HELPER, reopened, [url(HELPER)]);
    const d = await one(`SELECT evidence_urls FROM public.disputes WHERE id = $1`, [reopened]);
    const j = await one(`SELECT dispute_evidence_urls FROM public.jobs WHERE id = $1`, [jobId]);
    check("LOW-1: BOTH parties can add evidence to a dispute an admin re-opened, set-like, mirrored onto the job",
      ok1 === "ok" && ok2 === "ok" && again === "ok" && d.evidence_urls.length === 2 && j.dispute_evidence_urls.length === 2,
      JSON.stringify({ ok1, ok2, again, d, j }));

    const stranger = await add(ADMIN, reopened, [url(ADMIN)]);
    check("LOW-1: a non-party is refused", /not authorized for this job/.test(stranger), stranger);
    const foreignPath = await add(HELPER, reopened, [url(POSTER)]);
    const external = await add(HELPER, reopened, ["https://evil.example/a.jpg"]);
    check("LOW-1: only the caller's own uploads for THIS job are accepted (no one else's path, no external link)",
      /dispute_evidence_invalid_url/.test(foreignPath) && /dispute_evidence_invalid_url/.test(external), `${foreignPath} / ${external}`);
    // Anchored (round-5 review, LOW-1): the proof-photos path must BE the URL's
    // path, not appear somewhere inside it, and no `..` segment.
    const inQuery = await add(HELPER, reopened, [`https://evil.example/x?u=/storage/v1/object/sign/proof-photos/${HELPER}/disputes/${jobId}/a.jpg`]);
    const dotdot = await add(HELPER, reopened, [`https://fncmgoasalhdgfwzhsqa.supabase.co/storage/v1/object/sign/proof-photos/${HELPER}/disputes/${jobId}/../../${POSTER}/a.jpg`]);
    check("LOW-1 (r5): the path is anchored — embedded in a foreign URL or climbing with .. is refused",
      /dispute_evidence_invalid_url/.test(inQuery) && /dispute_evidence_invalid_url/.test(dotdot), `${inQuery} / ${dotdot}`);
    const many = Array.from({ length: 60 }, (_, i) => `https://fncmgoasalhdgfwzhsqa.supabase.co/storage/v1/object/sign/proof-photos/${HELPER}/disputes/${jobId}/f${i}.jpg`);
    let capped = "ok";
    for (let i = 0; i < 6 && capped === "ok"; i++) capped = await add(HELPER, reopened, many.slice(i * 10, i * 10 + 10));
    check("LOW-1 (r5): the dispute's evidence is capped in total, not just per call", /dispute_evidence_limit/.test(capped), capped);
    // A dispute whose opener simply deleted their account is NOT an admin re-open.
    const jobAnon = await newJob("disputed", "escrow", { dispute_status: "open" });
    const { id: anonOpener } = await one(`INSERT INTO public.disputes (job_id, opener_id, reason) VALUES ($1, NULL, 'the work was never delivered') RETURNING id`, [jobAnon]);
    const anonAdd = await add(HELPER, anonOpener, [`https://fncmgoasalhdgfwzhsqa.supabase.co/storage/v1/object/sign/proof-photos/${HELPER}/disputes/${jobAnon}/a.jpg`]);
    check("LOW-2 (r5): a dispute with no opener because the opener was deleted is not an admin re-open (refused)", /dispute_evidence_not_allowed/.test(anonAdd), anonAdd);
    // authz review of the rebase: host pinned, `sign` only.
    const otherHost = await add(HELPER, reopened, [`https://attacker.example/storage/v1/object/sign/proof-photos/${HELPER}/disputes/${jobId}/a.jpg`]);
    const publicRoute = await add(HELPER, reopened, [`https://fncmgoasalhdgfwzhsqa.supabase.co/storage/v1/object/public/proof-photos/${HELPER}/disputes/${jobId}/a.jpg`]);
    check("authz (rebase): the evidence host is pinned to this project and only signed object URLs pass",
      /dispute_evidence_invalid_url/.test(otherHost) && /dispute_evidence_invalid_url/.test(publicRoute), `${otherHost} / ${publicRoute}`);
    const empty = await add(HELPER, reopened, []);
    check("LOW-1: an empty evidence list is refused", /dispute_evidence_invalid_url|dispute_evidence_empty/.test(empty), empty);

    const jobO = await newJob("disputed", "escrow", { dispute_status: "open" });
    const { id: openerOwned } = await one(`INSERT INTO public.disputes (job_id, opener_id, reason) VALUES ($1, $2, 'filed by the poster') RETURNING id`, [jobO, POSTER]);
    const notReopened = await add(HELPER, openerOwned, [`https://fncmgoasalhdgfwzhsqa.supabase.co/storage/v1/object/sign/proof-photos/${HELPER}/disputes/${jobO}/a.jpg`]);
    check("LOW-1: a party-filed dispute keeps its opener-only evidence rule (this RPC refuses it)", /dispute_evidence_not_allowed/.test(notReopened), notReopened);
    await db.query(`UPDATE public.disputes SET status = 'decided' WHERE id = $1`, [reopened]);
    const decidedAdd = await add(HELPER, reopened, [url(HELPER)]);
    check("LOW-1: no evidence once the re-opened dispute is decided", /dispute_evidence_not_allowed/.test(decidedAdd), decidedAdd);
  }
}

// ── authz review of the rebase: every evidence writer validates, append-only ─
{
  const exists = await hasFn("public.dispute_evidence_url_ok(text,uuid,uuid)");
  check("authz (rebase): one shared evidence validator, dispute_evidence_url_ok(text, uuid, uuid)", exists);
  const jobId = await newJob("in_progress", "escrow");
  const url = (uid) => `https://fncmgoasalhdgfwzhsqa.supabase.co/storage/v1/object/sign/proof-photos/${uid}/disputes/${jobId}/a.jpg?token=t`;
  const viaOpen = await attempt(`SELECT public.open_dispute_as($1, $2, 'the work was never delivered at all', $3::text[])`,
    [jobId, POSTER, ["javascript:alert(document.domain)"]]);
  check("authz (rebase): open_dispute_as refuses evidence that is not the filer's own signed upload for this job",
    /dispute_evidence_invalid_url/.test(viaOpen), viaOpen);
  const okOpen = await attempt(`SELECT public.open_dispute_as($1, $2, 'the work was never delivered at all', $3::text[])`, [jobId, POSTER, [url(POSTER)]]);
  const refileBad = await attempt(`SELECT public.open_dispute_as($1, $2, 'the work was never delivered at all', $3::text[])`,
    [jobId, HELPER, ["https://attacker.example/pixel.png"]]);
  check("authz (rebase): a valid filing works, and the re-file branch validates too",
    okOpen === "ok" && /dispute_evidence_invalid_url/.test(refileBad), `${okOpen} / ${refileBad}`);

  const { id: disputeId } = await one(`SELECT id FROM public.disputes WHERE job_id = $1 AND status = 'open'`, [jobId]);
  await as(POSTER);
  const replace = await attempt(`UPDATE public.disputes SET evidence_urls = ARRAY['https://attacker.example/pixel.png'] WHERE id = $1`, [disputeId]);
  const drop = await attempt(`UPDATE public.disputes SET evidence_urls = '{}' WHERE id = $1`, [disputeId]);
  const appendBad = await attempt(`UPDATE public.disputes SET evidence_urls = evidence_urls || ARRAY['https://attacker.example/pixel.png'] WHERE id = $1`, [disputeId]);
  const appendOk = await attempt(`UPDATE public.disputes SET evidence_urls = evidence_urls || ARRAY[$2] WHERE id = $1`, [disputeId, url(POSTER).replace("a.jpg", "b.jpg")]);
  await as(null);
  check("authz (rebase): a party's direct UPDATE of evidence is append-only and validated (no replace, no delete, no foreign URL; a real upload still appends)",
    /dispute_evidence_append_only/.test(replace) && /dispute_evidence_append_only/.test(drop) && /dispute_evidence_invalid_url/.test(appendBad) && appendOk === "ok",
    `${replace} / ${drop} / ${appendBad} / ${appendOk}`);
  await as(ADMIN);
  const adminEdit = await attempt(`UPDATE public.disputes SET evidence_urls = '{}' WHERE id = $1`, [disputeId]);
  await as(null);
  check("authz (rebase): an admin can still curate evidence", adminEdit === "ok", adminEdit);
  const svc = await attempt(`UPDATE public.disputes SET evidence_urls = evidence_urls || ARRAY['legacy'] WHERE id = $1`, [disputeId]);
  check("authz (rebase): service-role writers (no JWT) are not affected", svc === "ok", svc);

  // Lock order: every dispute RPC takes jobs before disputes (as open_dispute_as
  // and claim_dispute_settlement do), so no pairing can cycle.
  const bodyOf = async (sig) => (await one(`SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure($1)`, [sig]))?.prosrc ?? "";
  const bad = [];
  for (const sig of ["public.rpc_withdraw_dispute(uuid)", "public.rpc_decide_dispute(uuid,text,jsonb)",
                     "public.rpc_supersede_dispute_decision(uuid,text)", "public.rpc_add_dispute_evidence(uuid,text[])"]) {
    const b = await bodyOf(sig);
    const jobsLock = b.search(/FROM public\.jobs[^;]*FOR UPDATE/);
    const disputesLock = b.search(/FROM public\.disputes[^;]*FOR UPDATE/);
    if (!(jobsLock >= 0 && disputesLock >= 0 && jobsLock < disputesLock)) bad.push(`${sig} jobs@${jobsLock} disputes@${disputesLock}`);
  }
  check("authz (rebase): lock order is jobs -> disputes in every dispute RPC", bad.length === 0, bad.join("; "));
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
await db.close();
process.exit(failures === 0 ? 0 : 1);
