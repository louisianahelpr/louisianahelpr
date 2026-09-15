#!/usr/bin/env node
/**
 * Two-connection race runner for the job-row races.
 *
 * Races 1-2 were proven on prod 2026-09-12 and fixed in
 * 20260913014328_lock_job_row_on_apply_and_confirm.sql (d0471d07f). Races 3-5
 * are the job-completion race (the Helpr's Done against the poster's cancel or
 * release), measured in PGlite and fixed in
 * 20260914215112_completion_lands_on_live_job_only.sql.
 *
 * PGlite could not prove lock ordering — it has one connection, and a lock
 * race needs two. This runs against the throwaway Supabase Postgres that
 * .github/workflows/race-runner.yml boots and replays migrations into. It
 * NEVER touches prod: it refuses to run unless PGHOST is localhost.
 *
 * Each round forces the worst interleaving instead of hoping for it:
 *   A  BEGIN; the lock holder's write              <- holds the job row
 *   B  starts its write while A holds the lock; the runner confirms via
 *      pg_stat_activity that B is WAITING ON A LOCK
 *   A  pg_sleep, COMMIT
 *   B  resumes, commits or is refused
 * Then the round is judged from committed state.
 *
 *   race 1  apply vs cancel. A = poster_cancel_job; B = INSERT INTO
 *           applications (trigger enforce_application_job_state judges the job).
 *           BAD = a pending application on a cancelled job.
 *   race 2  confirm vs cancel. A = poster_cancel_job; B = the PRE-FIX client
 *           write: UPDATE jobs SET helper_confirmed_at WHERE id AND
 *           helper_confirmed_at IS NULL — no status predicate, deliberately, so
 *           the database guarantee (trg_confirm_on_live_job) is under test.
 *           BAD = a cancelled job with helper_confirmed_at stamped.
 *   race 3  Done vs cancel (cancel first). A = poster_cancel_job; B = the
 *           PRE-FIX JobTracking stamp: UPDATE jobs SET helper_completed_at WHERE
 *           id — no status predicate (trg_completion_on_live_job under test).
 *           BAD = a cancelled job carrying a done stamp.
 *   race 4  Done vs cancel (Done first). A = the Helpr's stamp; B =
 *           poster_cancel_job, queued behind it.
 *           BAD = a cancelled job carrying a done stamp (finished work cancelled).
 *   race 6  Done vs block. A = the Helpr's stamp; B = the poster's
 *           block_user_and_settle, queued behind it (review follow-up).
 *           BAD = a cancelled job carrying a done stamp.
 *   race 5  Done again vs release. The Helpr already marked done; A = the
 *           service-role release write completing the job; B = the Helpr's
 *           second Done (pre-fix client write).
 *           BAD = helper_completed_at moved (or landed after completed_at), or
 *           completed_at not stamped.
 *
 * A pass must be a pass for the right reason, so the runner fails when:
 *   - the CONTROL fails: B's write, with no concurrent A, must land;
 *   - B never waited on A's lock (the round did not race);
 *   - B was refused for anything but the guard's own error.
 *
 * End-user writes run as role `authenticated` with a JWT claim, as PostgREST
 * would; service writes as `service_role` with no uid.
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

async function asService(client) {
  await client.query("BEGIN");
  await client.query(
    "SELECT set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claim.role', 'service_role', true)",
    [JSON.stringify({ role: "service_role" })],
  );
  await client.query("SET LOCAL ROLE service_role");
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
  if (race <= 2) {
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
  // Races 3-5: a job underway whose completion gates (arrival verified, both
  // photos, 30-minute floor) are all satisfied, so the only thing that can
  // refuse the Helpr's Done is the guard under test.
  const { rows } = await admin.query(
    `INSERT INTO public.jobs (title, description, category, budget, location, parish, status,
                              customer_id, helper_id, date_needed, created_at, payment_status,
                              helper_confirmed_at, poster_confirmed_at, accepted_at,
                              helper_on_the_way_at, helper_arrived_at, helper_arrival_verified_at,
                              poster_confirmed_working_at, proof_before_urls, proof_after_urls, helper_completed_at)
     VALUES ('[CI race] completion', 'race-runner.mjs fixture', 'cleaning', 100, 'Test Address', 'Orleans',
             'in_progress', $1, $2, CURRENT_DATE, now() - interval '30 days', 'escrow',
             now() - interval '5 hours', now() - interval '5 hours', now() - interval '6 hours',
             now() - interval '4 hours', now() - interval '3 hours', now() - interval '3 hours',
             now() - interval '2 hours', ARRAY['https://example.invalid/b.jpg'], ARRAY['https://example.invalid/a.jpg'],
             CASE WHEN $3 THEN now() - interval '1 hour' END)
     RETURNING id, helper_completed_at::text AS hc`,
    [poster, helper, race === 5],
  );
  return { poster, helper, job: rows[0].id, hc: rows[0].hc };
}

// ── the writes ────────────────────────────────────────────────────────────
const CANCEL = { as: "poster", run: (c, f) => c.query("SELECT public.poster_cancel_job($1, 'race-runner')", [f.job]) };
/** The PRE-FIX JobTracking Done stamp: id predicate only. */
const DONE = { as: "helper", run: (c, f) => c.query("UPDATE public.jobs SET helper_completed_at = now() WHERE id = $1", [f.job]) };
/** create-payment release completing a job both sides confirmed (service role, conditional as in index.ts). */
const RELEASE = {
  as: "service",
  run: (c, f) =>
    c.query(
      `UPDATE public.jobs SET poster_completed_at = now(), status = 'completed', payment_status = 'payout_pending',
              payout_scheduled_at = now() + interval '24 hours'
        WHERE id = $1 AND status = 'in_progress' AND poster_completed_at IS NULL`,
      [f.job],
    ),
};

const RACES = {
  1: {
    name: "apply vs cancel",
    A: CANCEL,
    B: { as: "helper", run: (c, f) => c.query("INSERT INTO public.applications (job_id, helper_id, status) VALUES ($1, $2, 'pending')", [f.job, f.helper]) },
    refusal: /job_not_open/,
    bad: (s) => s.status === "cancelled" && s.apps > 0,
  },
  2: {
    name: "helper confirm vs cancel",
    A: CANCEL,
    B: { as: "helper", run: (c, f) => c.query("UPDATE public.jobs SET helper_confirmed_at = now(), response_deadline = NULL WHERE id = $1 AND helper_confirmed_at IS NULL", [f.job]) },
    refusal: /job_not_confirmable/,
    bad: (s) => s.status === "cancelled" && s.confirmed,
  },
  3: {
    name: "helper Done vs cancel (cancel holds the lock)",
    A: CANCEL,
    B: DONE,
    refusal: /job_not_completable/,
    bad: (s) => s.status === "cancelled" && s.done,
  },
  4: {
    name: "helper Done vs cancel (Done holds the lock)",
    A: DONE,
    B: CANCEL,
    refusal: /not_cancellable/,
    bad: (s) => s.status === "cancelled" && s.done,
  },
  6: {
    name: "helper Done vs poster block (Done holds the lock)",
    A: DONE,
    B: { as: "poster", run: (c, f) => c.query("SELECT public.block_user_and_settle($1, 'race-runner')", [f.helper]) },
    refusal: /^$/, // the block itself must land; it just must not settle a done job
    bad: (s) => s.status === "cancelled" && s.done,
  },
  5: {
    name: "helper Done again vs release",
    A: RELEASE,
    B: DONE,
    refusal: /^$/, // nothing may refuse it: the re-stamp is a no-op, not an error
    bad: (s, f) => s.hc !== f.hc || s.status !== "completed" || !s.completed_at || s.done_after_completion,
  },
};

async function begin(client, who, f) {
  if (who === "service") return asService(client);
  return asUser(client, who === "poster" ? f.poster : f.helper);
}

/** With NO concurrent A, B's write must succeed and land exactly one row. */
async function control(admin, race) {
  const R = RACES[race];
  const f = await fixture(admin, race);
  const B = await connect();
  try {
    await begin(B, R.B.as, f);
    const r = await R.B.run(B, f);
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
  const R = RACES[race];
  const f = await fixture(admin, race);
  const A = await connect();
  const B = await connect();
  let bOutcome = "committed";
  try {
    await begin(A, R.A.as, f);
    await R.A.run(A, f); // row held

    await begin(B, R.B.as, f);
    const bDone = R.B.run(B, f).then(
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
              j.helper_completed_at IS NOT NULL AS done, j.helper_completed_at::text AS hc,
              j.completed_at::text AS completed_at,
              (j.completed_at IS NOT NULL AND j.helper_completed_at > j.completed_at) AS done_after_completion,
              (SELECT count(*)::int FROM public.applications a WHERE a.job_id = j.id) AS apps
         FROM public.jobs j WHERE j.id = $1`,
      [f.job],
    );
    const s = rows[0];
    const bad = R.bad(s, f);
    const wrongRefusal = bOutcome.startsWith("refused") && !(R.refusal.source !== "^$" && R.refusal.test(bOutcome));
    return { bad, waiting, wrongRefusal, s, b: bOutcome };
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
let failed = false;
for (const race of Object.keys(RACES).map(Number)) {
  const { name } = RACES[race];
  try {
    await control(admin, race);
    console.log(`race ${race} (${name}) CONTROL ok: with no concurrent writer, B's write lands`);
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
      `race ${race} (${name}) round ${String(i).padStart(2)}: ${r.bad ? "BAD" : "ok "} status=${r.s.status} apps=${r.s.apps} confirmed=${r.s.confirmed} done=${r.s.done} B-waited-on-lock=${r.waiting} B=${r.b}`,
    );
  }
  console.log(`\n== race ${race} (${name}): BAD ${bad}/${ROUNDS}; not-raced ${notRaced}; wrong-reason refusals ${wrongRefusals}\n`);
  if (bad > 0) {
    console.error(`::error::race ${race} (${name}) reached the bad state in ${bad}/${ROUNDS} rounds`);
    failed = true;
  }
  if (wrongRefusals > 0) {
    console.error(`::error::race ${race}: ${wrongRefusals} round(s) refused for a reason other than ${RACES[race].refusal} — not a race result`);
    failed = true;
  }
  if (notRaced > 0) {
    console.error(`::error::race ${race}: ${notRaced} round(s) never blocked on the lock holder's row lock — the race was not exercised`);
    failed = true;
  }
}
await admin.end();
process.exit(failed ? 1 : 0);
