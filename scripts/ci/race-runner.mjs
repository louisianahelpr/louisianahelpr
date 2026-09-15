#!/usr/bin/env node
/**
 * Two-connection race runner for the job-row races proven on prod 2026-09-12
 * (fixed in 20260913014328_lock_job_row_on_apply_and_confirm.sql, d0471d07f),
 * plus race 3, added 2026-09-14 with
 * 20260915034822_dispute_settlement_claim_and_race_locks.sql.
 *
 * PGlite could not prove these — it has one connection, and a lock race needs
 * two. This runs against the throwaway Supabase Postgres that
 * .github/workflows/race-runner.yml boots and replays migrations into. It
 * NEVER touches prod: it refuses to run unless PGHOST is localhost.
 *
 * Each round forces the worst interleaving instead of hoping for it:
 *   A (poster)  BEGIN; SELECT poster_cancel_job(job)   <- holds the row FOR UPDATE
 *   B (helper)  starts its write while A holds the lock; the runner confirms
 *               via pg_stat_activity that B is WAITING ON A LOCK
 *   A           pg_sleep, COMMIT
 *   B           resumes, commits or is refused
 * Then the round is judged from committed state.
 *
 *   race 1  apply vs cancel. B = INSERT INTO applications (trigger
 *           enforce_application_job_state judges the job).
 *           BAD = a pending application on a cancelled job.
 *   race 2  confirm vs cancel. B = the PRE-FIX client write: UPDATE jobs SET
 *           helper_confirmed_at WHERE id AND helper_confirmed_at IS NULL — no
 *           status predicate, deliberately, so the database guarantee
 *           (trg_confirm_on_live_job) is what is under test.
 *           BAD = a cancelled job with helper_confirmed_at stamped.
 *   race 3  settle_dispute_record vs open_dispute_as's re-freeze. A holds the
 *           job FOR UPDATE while re-freezing a settled job back to disputed;
 *           B settles the dispute record. Before 20260915034822 B read `jobs`
 *           unlocked, so it decided from a snapshot A had already invalidated.
 *           BAD = the dispute row ends 'decided' on a job that is live again.
 *           This race has its OWN driver below (A re-freezes rather than
 *           cancels), not the shared `round()`.
 *
 * A pass must be a pass for the right reason, so the runner fails when:
 *   - the CONTROL fails: B's write, with no concurrent cancel, must land;
 *   - B never waited on A's lock (the round did not race);
 *   - B was refused for anything but the guard's own error.
 *
 * B runs as role `authenticated` with a JWT claim, as PostgREST would.
 * Env: PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE, ROUNDS (default 20).
 */

import pg from "pg";
import { randomUUID } from "node:crypto";

const ROUNDS = Number(process.env.ROUNDS ?? 20);
const HOLD_MS = Number(process.env.HOLD_MS ?? 300);

if (!["localhost", "127.0.0.1", "::1"].includes(process.env.PGHOST ?? "")) {
  console.error(`::error::race-runner refuses PGHOST=${process.env.PGHOST} — it only runs against a local throwaway Postgres.`);
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const connect = async () => {
  const c = new pg.Client();
  await c.connect();
  return c;
};
const describeError = (e) => [e.message, e.detail, e.hint, e.where].filter(Boolean).join(" | ");

async function asUser(client, uid) {
  await client.query("BEGIN");
  // Both claim spellings: auth.uid() may read the JSON `request.jwt.claims`
  // or the legacy per-claim `request.jwt.claim.sub`, depending on image.
  await client.query(
    "SELECT set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true), set_config('request.jwt.claim.role', 'authenticated', true)",
    [JSON.stringify({ sub: uid, role: "authenticated" }), uid],
  );
  await client.query("SET LOCAL ROLE authenticated");
}

/** Superuser fixture: poster + helper and one job. auth.uid() is NULL here, so the state triggers stand aside. */
async function fixture(admin, race) {
  const poster = randomUUID();
  const helper = randomUUID();
  for (const [id, who] of [[poster, "poster"], [helper, "helper"]]) {
    await admin.query("INSERT INTO auth.users (id, email) VALUES ($1, $2)", [id, `race-${who}-${id}@helpr.test`]);
    // Approved and payout-ready, so onboarding gates stand aside: the runner
    // tests the lock, not onboarding.
    await admin.query(
      `UPDATE public.profiles
          SET full_name = $2, approval_status = 'approved',
              stripe_account_id = 'acct_ci_race', stripe_payouts_enabled = true,
              stripe_identity_verified = true
        WHERE user_id = $1`,
      [id, `Race ${who}`],
    );
  }
  const { rows } = await admin.query(
    // Funded (escrow): an award or confirmation on an unfunded job is refused
    // by enforce_job_funded_before_award(), which is not the guard under test.
    `INSERT INTO public.jobs (title, description, category, budget, location, parish, status,
                              customer_id, helper_id, date_needed, created_at, payment_status)
     VALUES ('[CI race] job', 'race-runner.mjs fixture', 'cleaning', 100, 'Test Address', 'Orleans',
             $1::job_status, $2, $3, CURRENT_DATE + 7, now() - interval '30 days', 'escrow')
     RETURNING id`,
    race === 1 ? ["open", poster, null] : ["accepted", poster, helper],
  );
  return { poster, helper, job: rows[0].id };
}

/** B's write: race 1 = apply, race 2 = the pre-fix client confirm (no status predicate). */
function helperWrite(client, race, f) {
  return race === 1
    ? client.query("INSERT INTO public.applications (job_id, helper_id, status) VALUES ($1, $2, 'pending')", [f.job, f.helper])
    : client.query(
        "UPDATE public.jobs SET helper_confirmed_at = now(), response_deadline = NULL WHERE id = $1 AND helper_confirmed_at IS NULL",
        [f.job],
      );
}

// The ONLY refusals that count as the guard doing its job.
const EXPECTED_REFUSAL = { 1: /job_not_open/, 2: /job_not_confirmable/ };

/** With NO concurrent cancel, B's write must succeed and land exactly one row. */
async function control(admin, race) {
  const f = await fixture(admin, race);
  const B = await connect();
  try {
    await asUser(B, f.helper);
    const r = await helperWrite(B, race, f);
    await B.query("COMMIT");
    if (r.rowCount !== 1) throw new Error(`control write affected ${r.rowCount} rows, expected 1`);
  } catch (e) {
    await B.query("ROLLBACK").catch(() => {});
    // Diagnostics, so a bad fixture names its own cause in the log.
    try {
      await asUser(B, f.helper);
      const who = await B.query(
        "SELECT auth.uid() AS uid, current_user AS role, public.get_job_customer_id($1) AS owner, public.are_users_blocked($2, public.get_job_customer_id($1)) AS blocked",
        [f.job, f.helper],
      );
      console.log("control diagnostics:", JSON.stringify({ expectedHelper: f.helper, ...who.rows[0] }));
      await B.query("ROLLBACK");
      const pol = await admin.query(
        "SELECT policyname, permissive, roles::text, cmd, with_check FROM pg_policies WHERE schemaname='public' AND tablename=$1",
        [race === 1 ? "applications" : "jobs"],
      );
      for (const p of pol.rows) if (["INSERT", "ALL", "UPDATE"].includes(p.cmd)) console.log("policy:", JSON.stringify(p));
    } catch (d) {
      console.log("control diagnostics failed:", describeError(d));
      await B.query("ROLLBACK").catch(() => {});
    }
    throw new Error(`CONTROL FAILED for race ${race} — fixture invalid, no round can prove anything: ${describeError(e)}`);
  } finally {
    await B.end().catch(() => {});
  }
}

async function round(admin, race) {
  const f = await fixture(admin, race);
  const A = await connect();
  const B = await connect();
  let bOutcome = "committed";
  try {
    await asUser(A, f.poster);
    await A.query("SELECT public.poster_cancel_job($1, 'race-runner')", [f.job]); // row held FOR UPDATE

    await asUser(B, f.helper);
    const bDone = helperWrite(B, race, f).then(
      async (r) => {
        bOutcome = `committed (${r.rowCount} row)`;
        await B.query("COMMIT");
      },
      async (e) => {
        bOutcome = `refused: ${describeError(e)}`;
        await B.query("ROLLBACK");
      },
    );

    let waiting = false;
    for (let i = 0; i < 50 && !waiting; i++) {
      const { rows } = await admin.query("SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1", [B.processID]);
      waiting = rows[0]?.wait_event_type === "Lock";
      if (!waiting) await sleep(10);
    }
    await sleep(HOLD_MS);
    await A.query("COMMIT");
    await bDone;

    const { rows } = await admin.query(
      `SELECT j.status::text AS status, j.helper_confirmed_at IS NOT NULL AS confirmed,
              (SELECT count(*)::int FROM public.applications a WHERE a.job_id = j.id) AS apps
         FROM public.jobs j WHERE j.id = $1`,
      [f.job],
    );
    const s = rows[0];
    const bad = race === 1 ? s.status === "cancelled" && s.apps > 0 : s.status === "cancelled" && s.confirmed;
    const wrongRefusal = bOutcome.startsWith("refused") && !EXPECTED_REFUSAL[race].test(bOutcome);
    return { bad, waiting, wrongRefusal, status: s.status, apps: s.apps, confirmed: s.confirmed, b: bOutcome };
  } finally {
    await A.end().catch(() => {});
    await B.end().catch(() => {});
  }
}

const admin = await connect();
// Notification triggers enqueue pg_net requests to vault's supabase_url; an
// empty vault makes url NULL and the INSERT fails for a reason unrelated to
// the race. Point them at a dead local port — the queue is never drained.
for (const [name, value] of [["supabase_url", "http://127.0.0.1:9"], ["service_role_key", "ci-race-runner-not-a-key"]]) {
  await admin.query(
    "SELECT vault.create_secret($2, $1) WHERE NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = $1)",
    [name, value],
  );
}
/**
 * Race 3 — settle_dispute_record vs open_dispute_as's re-freeze.
 * Added 2026-09-14 with 20260915034822; the one thing PGlite cannot prove,
 * because it needs two connections holding conflicting locks.
 *
 *   A  BEGIN; SELECT open_dispute_as(job, …)   <- takes the job FOR UPDATE and
 *      re-freezes a settled job back to disputed / dispute_status='open'
 *   B  SELECT settle_dispute_record(job, 'helper')
 *
 * Before the migration B took NO lock at all, so it read the SETTLED row,
 * passed every gate on that snapshot, and then wrote 'decided' + 'executed'
 * onto a dispute A had just made live again. That is terminal:
 * rpc_decide_dispute raises 'already decided' and execute-dispute-split returns
 * 409, with no recovery short of manual SQL.
 *
 * B now locks its own `disputes` row FOR UPDATE first and nothing else (the
 * other dispute RPCs take jobs -> disputes, so holding one row keeps B out of
 * every cycle). A's re-freeze
 * branch must write that same dispute row before it touches `jobs`, so it
 * blocks, and B reads the job state A left. The round asserts BOTH halves: B
 * waited on a lock (or it proved nothing), and the dispute did not end decided.
 *
 * BAD = the dispute row is 'decided' while the job is disputed / its
 * dispute_status is 'open'.
 */
async function disputeFixture(admin) {
  const poster = randomUUID();
  const helper = randomUUID();
  for (const [id, who] of [[poster, "poster"], [helper, "helper"]]) {
    await admin.query("INSERT INTO auth.users (id, email) VALUES ($1, $2)", [id, `race-${who}-${id}@helpr.test`]);
    await admin.query(
      `UPDATE public.profiles
          SET full_name = $2, approval_status = 'approved',
              stripe_account_id = 'acct_ci_race', stripe_payouts_enabled = true,
              stripe_identity_verified = true
        WHERE user_id = $1`,
      [id, `Race ${who}`],
    );
  }
  // Walk the transition matrix to `completed`, then settle the money and write
  // the terminal dispute state — the only shape settle_dispute_record accepts.
  const { rows } = await admin.query(
    `INSERT INTO public.jobs (title, description, category, budget, location, parish, status,
                              customer_id, helper_id, date_needed, created_at, payment_status)
     VALUES ('[CI race] dispute', 'race-runner.mjs fixture', 'cleaning', 100, 'Test Address', 'Orleans',
             'in_progress'::job_status, $1, $2, CURRENT_DATE + 7, now() - interval '30 days', 'escrow')
     RETURNING id`,
    [poster, helper],
  );
  const job = rows[0].id;
  await admin.query(
    `UPDATE public.jobs
        SET status = 'completed'::job_status, payment_status = 'released',
            helper_completed_at = now() - interval '2 hours',
            poster_completed_at = now() - interval '1 hour',
            dispute_status = 'resolved', dispute_resolved_at = now(),
            disputed_at = now() - interval '3 hours', disputed_by = $2
      WHERE id = $1`,
    [job, poster],
  );
  // The open record A will re-freeze and B will try to close.
  await admin.query(
    "INSERT INTO public.disputes (job_id, opener_id, reason, status) VALUES ($1, $2, 'race-runner fixture, work not delivered', 'open')",
    [job, poster],
  );
  return { poster, helper, job };
}

/** With no concurrent re-freeze, B's settle must close the record — else the round proves nothing. */
async function disputeControl(admin) {
  const f = await disputeFixture(admin);
  const { rows } = await admin.query("SELECT public.settle_dispute_record($1, 'helper') AS id", [f.job]);
  if (!rows[0].id) throw new Error("CONTROL FAILED for race 3 — settle_dispute_record closed nothing on a clean fixture");
}

async function disputeRound(admin) {
  const f = await disputeFixture(admin);
  const A = await connect();
  const B = await connect();
  let bOutcome = "committed";
  try {
    await asUser(A, f.poster);
    // Re-freeze: an existing open dispute + a job that is not `disputed` takes
    // open_dispute_as's re-freeze branch, which holds the job FOR UPDATE. Filed
    // as the PLATFORM (opener NULL): since 20260915025607 a person cannot touch
    // a completed job at all (job_already_completed), and the platform's
    // re-file is the one caller that still reaches this branch from completed.
    await A.query(
      "SELECT public.open_dispute_as($1, NULL, 'race-runner platform re-file, revision still not delivered', ARRAY[]::text[])",
      [f.job],
    );

    await B.query("BEGIN");
    const bDone = B.query("SELECT public.settle_dispute_record($1, 'helper') AS id", [f.job]).then(
      async (r) => { bOutcome = `committed (id=${r.rows[0].id})`; await B.query("COMMIT"); },
      async (e) => { bOutcome = `refused: ${describeError(e)}`; await B.query("ROLLBACK"); },
    );

    let waiting = false;
    for (let i = 0; i < 50 && !waiting; i++) {
      const { rows } = await admin.query("SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1", [B.processID]);
      waiting = rows[0]?.wait_event_type === "Lock";
      if (!waiting) await sleep(10);
    }
    await sleep(HOLD_MS);
    await A.query("COMMIT");
    await bDone;

    const { rows } = await admin.query(
      `SELECT j.status::text AS status, j.dispute_status,
              d.status AS dispute, d.execution_status
         FROM public.jobs j
         JOIN public.disputes d ON d.job_id = j.id
        WHERE j.id = $1`,
      [f.job],
    );
    const s = rows[0];
    const live = s.status === "disputed" || s.dispute_status === "open";
    const bad = live && s.dispute === "decided";
    // The only refusal that counts as the guard working.
    const wrongRefusal = bOutcome.startsWith("refused") && !/is not settled|has not settled its money/.test(bOutcome);
    return { bad, waiting, wrongRefusal, status: s.status, disputeStatus: s.dispute_status, dispute: s.dispute, b: bOutcome };
  } finally {
    await A.end().catch(() => {});
    await B.end().catch(() => {});
  }
}

let failed = false;
for (const [race, name] of [[1, "apply vs cancel"], [2, "helper confirm vs cancel"]]) {
  try {
    await control(admin, race);
    console.log(`race ${race} (${name}) CONTROL ok: with no concurrent cancel, B's write lands`);
  } catch (e) {
    console.error(`::error::${e.message}`);
    failed = true;
    continue;
  }
  let bad = 0;
  let notRaced = 0;
  let wrongRefusals = 0;
  for (let i = 1; i <= ROUNDS; i++) {
    let r;
    try {
      r = await round(admin, race);
    } catch (e) {
      console.error(`::error::race ${race} round ${i}: driver error — ${describeError(e)}`);
      failed = true;
      break;
    }
    if (r.bad) bad++;
    if (!r.waiting) notRaced++;
    if (r.wrongRefusal) wrongRefusals++;
    console.log(
      `race ${race} (${name}) round ${String(i).padStart(2)}: ${r.bad ? "BAD" : "ok "} status=${r.status} apps=${r.apps} confirmed=${r.confirmed} B-waited-on-lock=${r.waiting} B=${r.b}`,
    );
  }
  console.log(`\n== race ${race} (${name}): BAD ${bad}/${ROUNDS}; not-raced ${notRaced}; wrong-reason refusals ${wrongRefusals}\n`);
  if (bad > 0) {
    console.error(`::error::race ${race} (${name}) reached the bad state in ${bad}/${ROUNDS} rounds`);
    failed = true;
  }
  if (wrongRefusals > 0) {
    console.error(`::error::race ${race}: ${wrongRefusals} round(s) refused for a reason other than ${EXPECTED_REFUSAL[race]} — not a race result`);
    failed = true;
  }
  if (notRaced > 0) {
    console.error(`::error::race ${race}: ${notRaced} round(s) never blocked on the cancel's row lock — the race was not exercised`);
    failed = true;
  }
}
// ── race 3, run through its own driver (different shape: A re-freezes, B settles) ──
try {
  await disputeControl(admin);
  console.log("race 3 (settle vs dispute re-freeze) CONTROL ok: with no concurrent re-file, settle closes the record");
  let bad = 0;
  let notRaced = 0;
  let wrongRefusals = 0;
  for (let i = 1; i <= ROUNDS; i++) {
    const r = await disputeRound(admin);
    if (r.bad) bad++;
    if (!r.waiting) notRaced++;
    if (r.wrongRefusal) wrongRefusals++;
    console.log(
      `race 3 (settle vs dispute re-freeze) round ${String(i).padStart(2)}: ${r.bad ? "BAD" : "ok "} job=${r.status}/${r.disputeStatus} dispute=${r.dispute} B-waited-on-lock=${r.waiting} B=${r.b}`,
    );
  }
  console.log(`\n== race 3 (settle vs dispute re-freeze): BAD ${bad}/${ROUNDS}; not-raced ${notRaced}; wrong-reason refusals ${wrongRefusals}\n`);
  if (bad > 0) { console.error(`::error::race 3 reached the bad state in ${bad}/${ROUNDS} rounds`); failed = true; }
  if (wrongRefusals > 0) { console.error(`::error::race 3: ${wrongRefusals} round(s) refused for a reason other than the settle gate — not a race result`); failed = true; }
  if (notRaced > 0) { console.error(`::error::race 3: ${notRaced} round(s) never blocked on the re-freeze's row lock — the race was not exercised`); failed = true; }
} catch (e) {
  console.error(`::error::race 3: ${describeError(e)}`);
  failed = true;
}

await admin.end();
process.exit(failed ? 1 : 0);
