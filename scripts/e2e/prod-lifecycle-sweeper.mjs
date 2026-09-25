#!/usr/bin/env node
// Unwinds anything a previous prod lifecycle run left behind, BEFORE the next
// one starts.
//
// WHY A PRE-RUN SWEEP AND NOT ONLY A POST-RUN TEARDOWN
// ---------------------------------------------------
// A post-run teardown only runs when the run reaches the end. The rows that
// matter are the ones left by a run that DIDN'T — a timeout at the Stripe
// redirect, a cancelled workflow, a runner that died holding a funded job. Those
// are exactly the rows the seven crons that ignore `is_seed` will act on:
// `auto-expire-jobs`, `auto-resolve-disputes`, `review-nag-cron`,
// `expiring-jobs-push`, `instant-job-match`, `void-cancelled-payments`,
// `charge-recurring-visits`. So the teardown that counts happens at the START of
// the next run, when the leftovers are visible and nothing is racing it.
//
// WHAT IT CAN AND CANNOT UNWIND — verified against the live policy
// ---------------------------------------------------------------
// `Customers can delete their own jobs` is:
//     USING (auth.uid() = customer_id
//            AND status = 'open'
//            AND ((payment_status = 'unpaid' AND stripe_session_id IS NULL)
//                 OR payment_status = 'abandoned'))
// So a job the poster funded CANNOT be deleted by the poster, ever. There are
// exactly two dispositions available to a test account:
//   * unfunded leftover  → DELETE (the policy allows it)
//   * funded leftover    → create-payment { action: "cancel_escrow" }, which
//                          refunds the (test-mode) charge and cancels the job
// A job that reached `released` is a settled ledger row and is deliberately NOT
// touched. Deleting settled money is worse than the accumulation it avoids —
// and the database agrees: `payout_transfers_job_id_fkey` is ON DELETE RESTRICT,
// so a job with a payout row cannot be deleted at all, by anyone, regardless of
// RLS. The listing query below excludes settled rows for that reason, which also
// means the delete path can never collide with that constraint.
//
// The child rows of a job that IS deletable go with it: applications, messages,
// reviews, disputes, job_checkins and tips are all ON DELETE CASCADE.
// `notifications` is ON DELETE SET NULL, so notification rows would survive with
// a null job_id — but an unfunded job produces none, because every notification
// trigger requires payment_status IN ('escrow','payout_pending','released').
//
// This script therefore leaves a bounded, known residue and says so, rather than
// pretending prod can be returned to a pristine state by a test account.
//
// Usage (the workflow passes the poster's session; no service-role key is used
// or wanted — a CI job holding service-role could delete anything in the
// database, which is a far larger risk than the rows it would tidy):
//   SUPABASE_URL=… SUPABASE_ANON_KEY=… POSTER_ACCESS_TOKEN=… \
//     node scripts/e2e/prod-lifecycle-sweeper.mjs [--dry-run]
import { removeJobMediaRest } from "../lib/jobMediaRest.mjs";
import {
  summariseSweep,
  classifyCancelEscrow,
  cancelEscrowAnswerFromColumns,
  createPaymentWindowWaitMs,
} from "./sweepSummary.mjs";
import { settleJobForward, heldReason } from "./settleForward.mjs";

const BASE = (process.env.SUPABASE_URL || "https://fncmgoasalhdgfwzhsqa.supabase.co").replace(/\/$/, "");
const ANON = process.env.SUPABASE_ANON_KEY || "";
const TOKEN = process.env.POSTER_ACCESS_TOKEN || "";
const DRY = process.argv.includes("--dry-run");

/*
 * WHICH SWEEP THIS IS. `pre` runs before a suite and must not block it; a
 * `teardown` is the step that says whether the run left prod clean, so it is
 * the one that fails when the sweep could not do its job (lh-money-escrow
 * review M1, 2026-09-25: a failed helper sign-in or a failed settle used to
 * leave every sweep step green). Unset means a hand run: judged as strictly
 * as a teardown. scripts/e2e/sweep-both-seats.sh requires it.
 */
const PHASE = process.env.SWEEP_PHASE || "teardown";
if (PHASE !== "pre" && PHASE !== "teardown") {
  console.error(`FAIL: SWEEP_PHASE must be "pre" or "teardown", got "${PHASE}".`);
  process.exit(1);
}

/*
 * STRIPE MUST BE IN TEST MODE BEFORE THIS SWEEP MOVES MONEY (review L2). The
 * settle-forward walk ends on create-payment's release, which pays the Helpr
 * with whatever key prod holds NOW. CI cannot read that key and must not, so
 * the switch that changes it records the mode as well: stripe-sandbox-on.sh
 * sets the repo variable E2E_STRIPE_MODE=test, stripe-sandbox-off.sh sets it to
 * live BEFORE it swaps the key (launch checklist, docs/OPEN.md). Anything but
 * "test" (unset included) means no settling forward. settleRefusalReason also
 * refuses a row whose Checkout Session is not cs_test_ (the mode it was funded in).
 */
const STRIPE_MODE = process.env.E2E_STRIPE_MODE || "";
const STRIPE_TEST_MODE = STRIPE_MODE === "test";

// Every job this suite creates carries this marker in its title. It is the only
// thing that identifies a run's rows, so it is asserted on write as well as
// read — see e2e/prod-lifecycle.spec.ts.
export const E2E_TITLE_MARKER = "[E2E DO NOT ACCEPT]";

if (!ANON || !TOKEN) {
  console.error(
    "FAIL: SUPABASE_ANON_KEY and POSTER_ACCESS_TOKEN are required.\n" +
      "This sweeper deliberately runs as the test POSTER, not as service-role.",
  );
  process.exit(1);
}

const H = {
  apikey: ANON,
  Authorization: `Bearer ${TOKEN}`,
  "Content-Type": "application/json",
};

/*
 * THE HELPER SEAT IS OPTIONAL AND THAT IS THE POINT.
 *
 * A hired, funded leftover can only be settled FORWARD by both parties: the
 * arrival and the Done belong to the Helpr and cannot be forged from the
 * poster's token (`enforce_helper_jobs_column_whitelist`,
 * `enforce_job_completion_server_owned`). So when only the poster's token is
 * present this sweep keeps doing what it has always done: DEFER, and say so.
 * Give it `HELPER_ACCESS_TOKEN` as well and it settles those rows instead of
 * leaving them to a "settles forward" that, measured 2026-09-22, had not
 * happened for a single one of sixteen rows.
 *
 * Until 2026-09-25 NO CI caller passed the helper token, so the settle-forward
 * branch below never ran in CI and the pile came back: ten hired+funded rows,
 * seven past 48h, in e2e-journeys run 36164148002 (nightly-red #1719). Every
 * workflow step that runs this sweeper now mints both seats
 * (src/test/sweeperHoldsBothSeats.test.ts).
 */
const HELPER_TOKEN = process.env.HELPER_ACCESS_TOKEN || "";

/*
 * NEVER SETTLE A LIVE RUN'S JOB. With both seats, this sweep walks a hired job
 * all the way to release, and several workflows run it. A row younger than
 * this may belong to a run that is still driving it, so it is deferred, not
 * walked. The bound is longer than the longest `timeout-minutes` of any CI job
 * that holds the helper seat (prod-audit, 300 min on 2026-09-25; checked by
 * src/test/sweeperHoldsBothSeats.test.ts). A crashed run's row is settled by
 * the next sweep that finds it old enough; 02-marketplace's afterAll settles
 * its own job directly.
 */
export const SETTLE_FORWARD_MIN_AGE_MS = 6 * 60 * 60 * 1000;

/** The `sub` claim of an already-gateway-verified token; a read, not an act of trust. */
function subjectOf(jwt) {
  try {
    return JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString()).sub ?? null;
  } catch {
    return null;
  }
}
const POSTER_ID = subjectOf(TOKEN);
const HELPER_ID = HELPER_TOKEN ? subjectOf(HELPER_TOKEN) : null;
if (!POSTER_ID) {
  console.error("FAIL: POSTER_ACCESS_TOKEN has no readable `sub`; the listing is scoped to the poster and cannot run.");
  process.exit(1);
}
if (HELPER_TOKEN && !HELPER_ID) {
  // A helper token was handed over and is unreadable: the caller meant this
  // sweep to settle forward, and silently falling back to deferring is the
  // green-on-nothing this replaces (review M1).
  console.error("FAIL: HELPER_ACCESS_TOKEN is set but its `sub` cannot be read; refusing to sweep as if only the poster seat were held.");
  process.exit(1);
}
const HOLDS_BOTH_SEATS = Boolean(POSTER_ID && HELPER_ID);
const CAN_SETTLE_FORWARD = HOLDS_BOTH_SEATS && STRIPE_TEST_MODE;
if (HOLDS_BOTH_SEATS && !STRIPE_TEST_MODE) {
  console.log(
    `::warning title=Sweep will not settle forward::E2E_STRIPE_MODE is "${STRIPE_MODE || "(unset)"}", not "test". ` +
      `Hired+funded leftovers are deferred until the repo variable says Stripe is in test mode (stripe-sandbox-on.sh sets it).`,
  );
}

/**
 * Jobs this suite created that are not settled. Scoped to THIS poster's seed
 * rows (review L3): the marker alone is a title anyone can type, and the
 * poster can read other accounts' open jobs through browse.
 */
async function strandedJobs() {
  const url =
    `${BASE}/rest/v1/jobs?select=id,title,status,payment_status,stripe_session_id,created_at,customer_id,helper_id,disputed_at` +
    `&title=like.*${encodeURIComponent(E2E_TITLE_MARKER)}*` +
    `&customer_id=eq.${POSTER_ID}&is_seed=is.true` +
    `&payment_status=not.in.(released,refunded,cancelled)` +
    `&order=created_at.asc`;
  const r = await fetch(url, { headers: H });
  if (!r.ok) throw new Error(`listing stranded jobs failed: HTTP ${r.status} ${await r.text()}`);
  return r.json();
}

/** When this sweep last called create-payment (its rate-limit window is the money loop's too). */
let lastCreatePaymentAt = null;

async function cancelEscrow(jobId) {
  lastCreatePaymentAt = Date.now(); // before the call: a refusal counts against the window too
  const r = await fetch(`${BASE}/functions/v1/create-payment`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ action: "cancel_escrow", jobId }),
  });
  return { ok: r.ok, status: r.status, body: (await r.text()).slice(0, 300) };
}

/**
 * The DELETE policy requires `status = 'open'`, but a run that got as far as
 * hiring or completing leaves the job in `accepted` / `completed`. The poster's
 * UPDATE policy is just `auth.uid() = customer_id` with no WITH CHECK and no
 * payment condition, so the status can be walked back first. Without this, every
 * degraded (live-key) run would strand an undeletable row.
 */
async function reopenJob(jobId) {
  // `select=id` with the representation: bare `*` is refused since
  // 20260915045110 (no table-level SELECT on jobs for authenticated).
  const r = await fetch(`${BASE}/rest/v1/jobs?id=eq.${jobId}&select=id`, {
    method: "PATCH",
    headers: { ...H, Prefer: "return=representation" },
    body: JSON.stringify({ status: "open", helper_id: null }),
  });
  // A PATCH that matches zero rows is 200 with [] (review L3): only one row
  // back is a reopen.
  if (!r.ok) return false;
  try {
    const rows = JSON.parse(await r.text());
    return Array.isArray(rows) && rows.length === 1;
  } catch {
    return false; // a non-array body is not proof of a write
  }
}

/**
 * Cancel through the same RPC the poster's own Cancel button uses.
 *
 * This is the unwind for a job that reached checkout and was never paid for:
 * `cancel_escrow` refuses it (nothing was ever held) and the DELETE policy
 * refuses it too (it requires `stripe_session_id IS NULL`). Cancelling is not a
 * workaround for that — it is what the product itself does, verified by driving
 * the card's Cancel control on exactly this state and watching the row go
 * open -> cancelled. It also takes the row out of `status = 'open'`, which is
 * what stops these accumulating against `enforce_open_job_limit` and bricking
 * every future run once five have piled up.
 */
async function cancelJob(jobId) {
  const r = await fetch(`${BASE}/rest/v1/rpc/poster_cancel_job`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ p_job_id: jobId, p_reason: "E2E teardown" }),
  });
  return { ok: r.ok, status: r.status, body: await r.text() };
}

async function deleteJob(jobId) {
  // `select=id`: the row count below is the proof a delete landed, and a
  // bare representation would be RETURNING * — refused since 20260915045110.
  const r = await fetch(`${BASE}/rest/v1/jobs?id=eq.${jobId}&select=id`, {
    method: "DELETE",
    headers: { ...H, Prefer: "return=representation" },
  });
  const body = await r.text();
  let removed = null;
  try {
    const parsed = JSON.parse(body);
    if (Array.isArray(parsed)) removed = parsed.length;
  } catch { /* non-array body */ }
  // A DELETE that matches zero rows returns 200 with []. That is the silent
  // failure this repo has been bitten by repeatedly, so it is reported as a
  // non-deletion rather than counted as success.
  return { ok: r.ok && removed === 1, status: r.status, removed, body: body.slice(0, 200) };
}

const jobs = await strandedJobs();
console.log(`Prod lifecycle sweeper — ${BASE}`);
console.log(`Stranded jobs matching "${E2E_TITLE_MARKER}": ${jobs.length}${DRY ? "  (DRY RUN)" : ""}\n`);

const failures = [];
/* Rows this run deliberately did NOT unwind: hired AND funded, where
   cancel_escrow answers 409 useCancelJob and poster_cancel_job would record a
   cancel_with_helper strike on poster-e2e. They are left to settle forward.
   They are tracked because the closing line used to say "all stranded rows
   unwound" no matter how many were left here — 2026-09-20 prod held five such
   rows in escrow, the oldest from 2026-09-15, none of which had settled
   forward in five days, and every nightly log had reported OK. */
const deferred = [];
const disputed = [];
/* Rows this sweep must leave alone, each with why: a lane holding it
   (E2E_HOLD_MARKER in the title, or the two-role fixture's id), or a funded row
   with no Checkout Session whose mode it cannot prove. Never settled,
   cancelled, reopened or deleted, and never counted as a failed settle. */
const held = [];
const throttled = [];
for (const job of jobs) {
  /* A Checkout Session id proves a session was MINTED, not that it was paid —
     it is set by create-payment before the poster ever sees the card form. This
     line used to fold it into `funded`, so a job the poster abandoned at
     checkout was sent to cancel_escrow, which correctly answered 409 ("never
     held in escrow"), and the sweeper then reported it as a stranded funded job
     and failed the whole workflow. It is the same discriminator
     UnfundedJobNotice uses, read the opposite way round: session + unpaid means
     abandoned, which is the one thing it is NOT.

     `payment_status` alone is the funded test. */
  const funded = job.payment_status !== "unpaid";
  /* An unpaid job that DID reach checkout is the awkward case, and it needs a
     third route rather than either of the two above. `cancel_escrow` refuses it
     because nothing was ever held, and the poster's DELETE policy refuses it
     too — that policy requires `payment_status = 'unpaid' AND stripe_session_id
     IS NULL`, or 'abandoned', and a poster cannot set payment_status (it sits in
     enforce_poster_jobs_money_lock's locked_always).

     What DOES work is cancelling, which is not a workaround: it is what the
     product does. Driven on exactly this state on 2026-09-07 — the card's own
     Cancel control took the row open -> cancelled and toasted a confirmation.
     So these are unwound with poster_cancel_job, the same RPC that button
     calls. Cancelling also moves the row out of `status = 'open'`, which is what
     stops abandoned rows accumulating against enforce_open_job_limit: five of
     them and no future run can post at all. */
  /* Already cancelled means already unwound — there is nothing left to do, and
     poster_cancel_job correctly refuses it with P0001 not_cancellable ("This job
     is already finished, cancelled, or under dispute"). `strandedJobs()` filters
     on payment_status, which stays 'unpaid' after a cancellation, so these keep
     appearing in the list; without this they made the PRE-sweep fail, and a
     failed pre-sweep skips the entire money loop. One stale row was therefore
     enough to stop the suite running at all. */
  /* Terminal in either direction: cancelled (already unwound) or SETTLED. A
     settled job — payout_pending or released — is the residue this suite's
     README already calls permanent: the money has moved, cancel_escrow rightly
     refuses it with 409 ("already been released, refunded, or was never held"),
     and payout_transfers_job_id_fkey is ON DELETE RESTRICT so nobody can delete
     it either. It is not stranded; it is finished, and a successful run is
     exactly what produces one.

     strandedJobs() excludes released/refunded/cancelled by payment_status but
     NOT payout_pending, so a completed run left a row the next pre-sweep tried
     to cancel and died on — and a failed PRE-sweep skips the whole money loop.
     So one SUCCESSFUL run would block every run after it. */
  const settled = ["payout_pending", "released", "refunded"].includes(job.payment_status);
  /* HELD ON PURPOSE. A lane that needs a hired+funded (or hired) marker job to
     outlive one run puts E2E_HOLD_MARKER in its title, and this sweep leaves
     it exactly as it is: the 6h age gate only bounds CI job timeouts, not a
     fixture someone is keeping on purpose (review M3). Listed, never touched. */
  const holdWhy = heldReason(job);
  if (holdWhy) {
    console.log(`  ${job.id}  status=${job.status} payment=${job.payment_status} → held (${holdWhy}) — not touched`);
    held.push({ ...job, why: holdWhy });
    continue;
  }
  const alreadyUnwound = job.status === "cancelled" || settled;
  const abandonedCheckout =
    !alreadyUnwound &&
    !funded &&
    job.stripe_session_id !== null &&
    job.payment_status === "unpaid";
  const plan = alreadyUnwound
    ? settled
      ? "settled — nothing to unwind (a completed run leaves this)"
      : "already cancelled — nothing to do"
    : funded
    ? "cancel_escrow"
    : abandonedCheckout
      ? "poster_cancel_job (reached checkout, never paid)"
      : job.status === "open"
        ? "delete"
        : "reopen + delete";
  console.log(`  ${job.id}  status=${job.status} payment=${job.payment_status} → ${plan}`);
  if (DRY) continue;

  if (alreadyUnwound) {
    // Nothing to do, and saying so is better than a silent skip: the row IS
    // still listed, and a reader should see why it was passed over.
  } else if (abandonedCheckout) {
    const r = await cancelJob(job.id);
    if (!r.ok) failures.push(`cancel ${job.id}: HTTP ${r.status} ${r.body}`);
  } else if (funded) {
    /* A row whose columns already decide the answer is not asked: create-payment
       refuses every hired, started or disputed job, and each refusal still
       spends one of the poster's 10 create-payment calls a minute, the same
       window the money loop's escrow and release need next (nine refusals
       here left the loop one call, and its release came back 429). Only an
       open, unhired row is asked. Retried on 429 with backoff before any
       verdict is drawn. The limiter answers per-caller, so a queue of
       stranded rows trips it on the rows themselves — waiting is the whole
       remedy. */
    const known = cancelEscrowAnswerFromColumns(job);
    let r = known ? null : await cancelEscrow(job.id);
    let verdict = known ?? classifyCancelEscrow(r.status, r.body);
    for (let attempt = 0; verdict === "throttled" && attempt < 3; attempt++) {
      const waitMs = 2000 * 2 ** attempt;
      console.log(`    throttled on ${job.id}; waiting ${waitMs}ms before asking again`);
      await new Promise((res) => setTimeout(res, waitMs));
      r = await cancelEscrow(job.id);
      verdict = classifyCancelEscrow(r.status, r.body);
    }
    if (verdict === "settle-forward" && job.stripe_session_id == null) {
      /* Hired and funded with NO Checkout Session: create-payment's gift-card
         path funds escrow without one (re-review of 5a22b3e10). Its Stripe
         mode cannot be proven, so settleForward refuses it forever; deferring
         it would fail every teardown once it is 48h old for a row no sweep may
         settle. Held, with a warning naming it for a human. */
      console.log(`    held (no Checkout Session): ${job.id} is hired and funded without one; its mode is unprovable, not settled`);
      console.log(
        `::warning title=Funded test job with no Checkout Session::${job.id} is hired+funded in escrow with no ` +
          `stripe_session_id (gift card?); the sweep will not settle it. Unwind it by hand.`,
      );
      held.push({ ...job, why: "no Checkout Session" });
    } else if (verdict === "settle-forward") {
      /* cancel_escrow only refunds an OPEN job with no Helpr since the
         dispute-races branch (a hired job has a cancellation-fee ladder the
         direct refund skipped). It is deliberately NOT cancelled here instead:
         poster_cancel_job on a job a Helpr accepted records a
         cancel_with_helper strike, and three of those restrict poster-e2e for
         7 days and break every nightly journey (lh-money-escrow review). A
         hired, funded leftover settles FORWARD (auto-release, or the next
         run's release) — reported, never a failure. */
      /* …and since 2026-09-22 this sweep can DO the settling when it holds the
         Helpr's seat too, rather than trusting a forward settle that measurably
         never came: sixteen rows in escrow, the oldest from 2026-09-15, none of
         them with a `helper_completed_at` for `auto-release-payment` to find.
         The walk is every real product door in order (arrival → the poster's
         confirmation → proof photos → the Helpr's Done → the poster's Release),
         so the row lands in `payout_pending` exactly as a SUCCESSFUL run's
         does, and no strike is recorded on any leg. Without the helper token it
         is still deferred and still reported. */
      const ageMs = Date.now() - Date.parse(job.created_at);
      const oldEnough = Number.isFinite(ageMs) && ageMs >= SETTLE_FORWARD_MIN_AGE_MS;
      if (CAN_SETTLE_FORWARD && !oldEnough) {
        console.log(`    too young to settle forward: ${job.id} (${Math.round(ageMs / 60000)} min) may be a live run's job`);
      }
      if (CAN_SETTLE_FORWARD && oldEnough) {
        // Every exit from this walk (settled, refused, thrown) may have spent
        // create-payment calls, so the window is stamped in the finally (review
        // L1) — unless settleJobForward refused the row before its first leg
        // (steps: []), which makes no call at all.
        let refusedUnwalked = false;
        try {
          const out = await settleJobForward({
            base: BASE,
            anon: ANON,
            posterToken: TOKEN,
            helperToken: HELPER_TOKEN,
            posterId: POSTER_ID,
            helperId: HELPER_ID,
            jobId: job.id,
            log: (line) => console.log(line),
          });
          refusedUnwalked = out.steps.length === 0;
          if (out.settled) continue;
          console.log(`    could not settle ${job.id} forward: ${out.reason}`);
        } catch (err) {
          // Not fatal for THIS row on its own: it joins `deferred`, and a
          // deferred row past 48h fails a teardown sweep below (review M1).
          console.log(`    could not settle ${job.id} forward: ${String(err).slice(0, 200)}`);
        } finally {
          // The forward walk ends on create-payment's release, in the same window.
          if (!refusedUnwalked) lastCreatePaymentAt = Date.now();
        }
      }
      console.log(
        `    left to settle forward: ${job.id} is hired and funded (cancel_escrow ${known ? "refuses a hired or started job; not asked" : "409 useCancelJob"})`,
      );
      deferred.push(job);
    } else if (verdict === "disputed") {
      /* A DISPUTED JOB IS NOT A STRANDED ROW, and treating it as one turned
         ONE fixture into a nightly red.
         Measured 2026-09-21: job e7e09075 ("[E2E DO NOT ACCEPT] automated
         lifecycle", is_seed, the shared poster-e2e/helper-e2e pair) went into
         dispute on 2026-09-19 and was never resolved. Every scheduled money
         loop since died here, because `cancel_escrow` answered 409 "This job
         is under dispute, so its payment can't be cancelled or refunded here.
         An admin will decide where the payment goes." — which is CORRECT.
         The escrow of a disputed job is exactly what must not be unwound
         behind an admin's back.
         So the sweeper was failing on the one answer that proves the product
         is behaving. The cost is out of all proportion: the nightly real-money
         journey is the highest-stakes check in this repo, and it was red for
         two days over a test row awaiting a decision nobody had made.
         Reported with its age, never a failure — the same treatment as the
         useCancelJob case above. An OLD one is still worth a human's
         attention, so the age is printed rather than swallowed. */
      const disputedFor = job.disputed_at
        ? `${Math.floor((Date.now() - Date.parse(job.disputed_at)) / 86_400_000)}d`
        : "unknown age";
      console.log(
        `    awaiting an admin decision: ${job.id} is under dispute (${disputedFor}) — ` +
          `escrow deliberately left alone`,
      );
      disputed.push(job);
    } else if (verdict === "throttled") {
      // Still throttled after three backoffs. NOT residue — the sweep could not
      // ask. Reported so the number is visible and the log does not claim a
      // defect in the cancel path that nothing has evidence for.
      console.log(`    could not ask: ${job.id} still rate-limited after 3 retries`);
      throttled.push(job);
    } else if (verdict === "failure") failures.push(`cancel_escrow ${job.id}: HTTP ${r.status} ${r.body}`);
  } else {
    // Walk the status back to 'open' first when the run got as far as hiring or
    // completing — the DELETE policy will not touch anything else.
    if (job.status !== "open" && !(await reopenJob(job.id))) {
      failures.push(`reopen ${job.id}: could not reset status from "${job.status}" before delete`);
      continue;
    }
    // The job's files go first: storage RLS checks the job still exists, and
    // after the delete nothing names them (2026-09-14 audit: 7 proof photos of
    // deleted E2E jobs). As the poster this reaches the poster's own uploads;
    // the helper's are left to the weekly storage-orphan-sweep. Never blocks.
    await removeJobMediaRest({ base: BASE, headers: H, jobs: [job], source: "prod-lifecycle-sweeper" });
    const r = await deleteJob(job.id);
    if (!r.ok) failures.push(`delete ${job.id}: HTTP ${r.status} removed=${r.removed} ${r.body}`);
  }
}

const summary = summariseSweep({ listed: jobs.length, deferred });
/*
 * A ROW PAST 48H THAT THIS SWEEP COULD HAVE SETTLED IS A FAILURE (review M1).
 * With both seats and test-mode Stripe, a deferred row that old is not waiting
 * on anything but a settle that keeps failing, and a warning is how seven of
 * them sat unread for days (nightly-red #1719). Only a teardown fails on it: a
 * pre-sweep must not block the suite, and the same job's teardown runs
 * `if: always()`, so the run still goes red.
 */
/* Only rows the sweep could LEGALLY settle count: a test-mode Checkout Session
   (a cs_live_ row is refused by settleRefusalReason and reported in the
   warning below, not failed on). Held rows never reach `deferred`. */
const sessionOf = new Map(deferred.map((j) => [j.id, j.stripe_session_id]));
const staleSettleable = summary.stale.filter((r) => String(sessionOf.get(r.id) ?? "").startsWith("cs_test_"));
if (!DRY && CAN_SETTLE_FORWARD && staleSettleable.length) {
  const msg =
    `${staleSettleable.length} hired+funded test job(s) past 48h were NOT settled forward although this sweep ` +
    `held both seats in Stripe test mode: ${staleSettleable.map((r) => r.id).join(", ")}`;
  if (PHASE === "teardown") failures.push(`settle forward: ${msg}`);
  else console.log(`::warning title=Stale escrow rows did not settle (the teardown sweep will fail on them)::${msg}`);
}

if (failures.length) {
  console.error(`\nFAIL (${failures.length}):\n  ${failures.join("\n  ")}`);
  console.error(
    "\nStranded rows the poster could not unwind. A funded job that cancel_escrow " +
      "refuses is a real defect in the cancel path, not a sweeper problem — do not " +
      "paper over it by widening the DELETE policy.",
  );
  process.exit(1);
}
console.log(`\n${summary.line}`);
if (held.length) {
  console.log(`Held, not touched: ${held.map((j) => `${j.id} (${j.why}; ${j.status}/${j.payment_status}, created ${j.created_at})`).join(", ")}`);
}
if (!summary.ok) {
  // A warning, never an exit code: the rows are real residue, but the sweeper
  // is deliberately not allowed to unwind them (a poster_cancel_job here
  // strikes poster-e2e), so failing would red a nightly for something this
  // script cannot fix. It must still be VISIBLE — that is the whole defect
  // this replaces.
  console.log(
    `::warning title=Stranded funded test jobs are not settling forward::${summary.stale.length} ` +
      `test-owned job(s) have sat in escrow past 48h: ${summary.stale.map((r) => r.id).join(", ")}`,
  );
}

/*
 * Disputed rows, on the same terms as the deferred ones above: VISIBLE, never
 * an exit code. The sweeper must not unwind a disputed escrow — that decision
 * is an admin's — but a dispute nobody resolves quietly blocks every later
 * cleanup of that job, so it cannot be swallowed either.
 */
if (throttled.length) {
  console.log(
    `::warning title=Sweep could not ask about every stranded row::${throttled.length} ` +
      `cancel_escrow call(s) were still rate-limited after three backoffs. These are NOT stranded ` +
      `rows — the sweep never got an answer about them. Re-run when the limiter has reset.`,
  );
}
if (disputed.length) {
  const ages = disputed.map((j) => ({
    id: j.id,
    days: j.disputed_at ? (Date.now() - Date.parse(j.disputed_at)) / 86_400_000 : NaN,
  }));
  const oldest = ages.reduce((a, b) => ((b.days || 0) > (a.days || 0) ? b : a));
  console.log(
    `::warning title=Test jobs awaiting an admin dispute decision::${disputed.length} ` +
      `test-owned job(s) are under dispute and their escrow is deliberately untouched; ` +
      `oldest ${oldest.id} at ${Number.isFinite(oldest.days) ? oldest.days.toFixed(1) : "?"} day(s). ` +
      `Resolve it in the admin console — until then this job cannot be cleaned up.`,
  );
}

/*
 * The money loop runs next, as the same poster, and needs create-payment for
 * its escrow and its release. The limiter counts this sweep's calls (refusals
 * included) for a full window, so the sweep ends only once its last call has
 * aged out of it.
 */
const windowWait = createPaymentWindowWaitMs(lastCreatePaymentAt);
if (windowWait > 0) {
  console.log(`Waiting ${Math.ceil(windowWait / 1000)}s so the next step starts with the poster's whole create-payment window.`);
  await new Promise((res) => setTimeout(res, windowWait));
}
