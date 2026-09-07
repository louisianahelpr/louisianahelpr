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
const BASE = (process.env.SUPABASE_URL || "https://fncmgoasalhdgfwzhsqa.supabase.co").replace(/\/$/, "");
const ANON = process.env.SUPABASE_ANON_KEY || "";
const TOKEN = process.env.POSTER_ACCESS_TOKEN || "";
const DRY = process.argv.includes("--dry-run");

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

/** Jobs this suite created that are not settled. */
async function strandedJobs() {
  const url =
    `${BASE}/rest/v1/jobs?select=id,title,status,payment_status,stripe_session_id,created_at` +
    `&title=like.*${encodeURIComponent(E2E_TITLE_MARKER)}*` +
    `&payment_status=not.in.(released,refunded,cancelled)` +
    `&order=created_at.asc`;
  const r = await fetch(url, { headers: H });
  if (!r.ok) throw new Error(`listing stranded jobs failed: HTTP ${r.status} ${await r.text()}`);
  return r.json();
}

async function cancelEscrow(jobId) {
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
  const r = await fetch(`${BASE}/rest/v1/jobs?id=eq.${jobId}`, {
    method: "PATCH",
    headers: { ...H, Prefer: "return=representation" },
    body: JSON.stringify({ status: "open", helper_id: null }),
  });
  return r.ok;
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
  const r = await fetch(`${BASE}/rest/v1/jobs?id=eq.${jobId}`, {
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
  const abandonedCheckout =
    !funded && job.stripe_session_id !== null && job.payment_status === "unpaid";
  const plan = funded
    ? "cancel_escrow"
    : abandonedCheckout
      ? "poster_cancel_job (reached checkout, never paid)"
      : job.status === "open"
        ? "delete"
        : "reopen + delete";
  console.log(`  ${job.id}  status=${job.status} payment=${job.payment_status} → ${plan}`);
  if (DRY) continue;

  if (abandonedCheckout) {
    const r = await cancelJob(job.id);
    if (!r.ok) failures.push(`cancel ${job.id}: HTTP ${r.status} ${r.body}`);
  } else if (funded) {
    const r = await cancelEscrow(job.id);
    if (!r.ok) failures.push(`cancel_escrow ${job.id}: HTTP ${r.status} ${r.body}`);
  } else {
    // Walk the status back to 'open' first when the run got as far as hiring or
    // completing — the DELETE policy will not touch anything else.
    if (job.status !== "open" && !(await reopenJob(job.id))) {
      failures.push(`reopen ${job.id}: could not reset status from "${job.status}" before delete`);
      continue;
    }
    const r = await deleteJob(job.id);
    if (!r.ok) failures.push(`delete ${job.id}: HTTP ${r.status} removed=${r.removed} ${r.body}`);
  }
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
console.log(jobs.length ? "\nOK — all stranded rows unwound." : "\nOK — nothing stranded.");
