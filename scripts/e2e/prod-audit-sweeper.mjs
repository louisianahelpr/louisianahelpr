#!/usr/bin/env node
// Deletes the prod-audit job(s) that interruptions.spec.ts's "post a job" ›
// "double-tap the final Post creates exactly one job" test could not remove
// itself.
//
// GAP (from f35ec2d55, docs/OPEN.md "prod-audit post-job teardown leaves a
// cancelled job every run")
// ------------------------------------------------------------------------
// That test posts a real job through checkout as the shared poster account,
// which mints a Stripe Checkout Session. Its own removeJobs() then tries the
// poster's own DELETE:
//   `Customers can delete their own jobs` requires
//   status = 'open' AND (payment_status = 'unpaid' AND stripe_session_id IS NULL
//                         OR payment_status = 'abandoned')
// A minted session fails `stripe_session_id IS NULL` forever, so the best the
// poster can do is `poster_cancel_job` (status -> 'cancelled'). The row is
// never `released` (no payout_transfers, so nothing here can hit that FK's ON
// DELETE RESTRICT), but it is permanent residue every nightly run adds one of.
// scripts/e2e/prod-lifecycle-sweeper.mjs does the equivalent unwind for
// e2e-journeys / e2e-real-backend, but it (a) matches only its own suite's
// "[E2E DO NOT ACCEPT]" title marker and (b) deliberately runs AS THE POSTER,
// which is exactly the account this residue defeats. This script is the
// service-role equivalent for the prod-audit marker.
//
// WHY THE TITLE FILTER HAS NO BRACKETS
// ------------------------------------------------------------------------
// e2e/prod-audit/harness.ts's MARKER is the bracketed "[E2E-PRODAUDIT]", used
// verbatim in message/application content. But the post-job form treats a
// literal "[...]" as an unfilled template placeholder and refuses to
// advance, so interruptions.spec.ts derives
//   JOB_MARKER = MARKER.replace(/[[\]]/g, "")   // "E2E-PRODAUDIT"
// and titles the job with THAT. A filter on the bracketed string matches zero
// real job rows — the exact reason this gap went uncaught. This script
// matches on the bracket-free substring, which is present in both forms (the
// bracketed marker CONTAINS it), so it is strictly the more inclusive check.
//
// WHY SERVICE ROLE
// ------------------------------------------------------------------------
// The DELETE policy above is what makes the poster's own path a dead end for
// this residue. This script runs in the same CI step group that already
// mints and holds the service-role key for scripts/test-signin-link.mjs
// (prod-audit.yml), immediately before that key is destroyed — it never
// widens who holds it, only reuses the window that already exists.
//
// SAFETY
// ------------------------------------------------------------------------
//  - refuses to run with no service-role key (never falls back to anon or a
//    user token — the whole point is bypassing an RLS policy that is correct
//    for every real user);
//  - --dry-run prints the candidates and does not delete or touch storage;
//  - hard cap of 50 matches: more than that means the filter is the thing
//    that's broken, not that this one test really left 50+ rows, so the
//    script stops and exits 1 without deleting anything;
//  - every row PostgREST returns is re-checked client-side against the same
//    three conditions (matchesFilter) right before it is touched, so a
//    future query change alone can never widen the blast radius;
//  - order mirrors scripts/audit/prod-seed.mjs's teardown(): job media first
//    (nothing should name a file after the row is gone), then applications,
//    then messages, then the job row itself. Reviews, disputes, job_checkins
//    and tips are ON DELETE CASCADE (see prod-lifecycle-sweeper.mjs) and a
//    job this young never has any; notifications go ON DELETE SET NULL.
//
// Usage (service-role key from .env, matching check-test-account-strikes.mjs):
//   node scripts/e2e/prod-audit-sweeper.mjs [--dry-run]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { removeJobMediaRest } from "../lib/jobMediaRest.mjs";

/** Bracket-free: see "WHY THE TITLE FILTER HAS NO BRACKETS" above. */
export const JOB_TITLE_MARKER = "E2E-PRODAUDIT";
/**
 * The press harness leaves the SAME residue, for the same reason, and could
 * not be cleaned by any of the poster-run sweepers either.
 *
 * scripts/audit/pressProdSafety.mjs titles its fixture jobs
 * "[PRESS DO NOT ACCEPT] …" and cancels what it cannot delete. `cancelled` is
 * terminal (never a SOURCE in enforce_job_status_transition, verified live
 * 2026-09-19) and the poster DELETE policy requires `status = 'open'`, so the
 * poster's own teardown can NEVER remove those rows — 26 of them had piled up
 * by 2026-09-19, one per shard per night. This is the service-role path that
 * can. Bracket-free for the same reason as above: the marker with brackets
 * still CONTAINS this substring, so matching on it is strictly more inclusive.
 */
export const PRESS_TITLE_MARKER = "PRESS DO NOT ACCEPT";
/** Every marker this sweeper owns. main() runs one pass per marker. */
export const JOB_TITLE_MARKERS = [JOB_TITLE_MARKER, PRESS_TITLE_MARKER];
/** e2e/prod-audit/harness.ts POSTER_ID / HELPER_ID — the only two accounts that suite signs in as. */
export const POSTER_ID = "71c56dfb-b326-4010-b960-b18dd3966e7f";
export const HELPER_ID = "437de07d-1bd7-46c8-a451-6b46aa3bcad5";
/**
 * "customer_id is one of the shared test poster accounts": today only
 * POSTER_ID ever posts a job in this suite (interruptions.spec.ts's
 * `posterPage()` is the only job-creation path), HELPER_ID is included so a
 * future job posted while signed in as the helper account is still covered.
 */
export const TEST_POSTER_IDS = [POSTER_ID, HELPER_ID];
/** More than this many matches means the filter is wrong, not that this test really left this many rows. */
export const MATCH_CAP = 50;

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DRY = process.argv.includes("--dry-run");

function readEnv() {
  const env = { ...process.env };
  const p = path.join(REPO, ".env");
  if (fs.existsSync(p)) {
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
  return env;
}

/**
 * The REST query for candidate jobs. Pure and exported so the filter shape is
 * unit-tested without a network call — this is the query a bug in this file
 * would silently break (as the bracketed marker did for the sweeper it
 * replaces).
 */
export function candidateJobsQuery(marker = JOB_TITLE_MARKER) {
  const titleLike = encodeURIComponent(`*${marker}*`);
  const custIn = encodeURIComponent(`(${TEST_POSTER_IDS.join(",")})`);
  return (
    "jobs?select=id,title,customer_id,helper_id,is_seed,status,payment_status,created_at" +
    `&title=ilike.${titleLike}` +
    `&customer_id=in.${custIn}` +
    "&is_seed=is.true" +
    "&order=created_at.asc" +
    // Belt-and-suspenders on the network call itself; MATCH_CAP is the real
    // gate and is enforced client-side regardless of this ceiling.
    "&limit=500"
  );
}

/**
 * Re-check a single row against the same three conditions the query above
 * encodes. Exported and unit-tested directly against the bracket-free vs.
 * bracketed title shapes, since that mismatch is the exact defect this file
 * exists to fix.
 */
export function matchesFilter(job, marker = JOB_TITLE_MARKER) {
  return (
    !!job &&
    typeof job.title === "string" &&
    job.title.includes(marker) &&
    TEST_POSTER_IDS.includes(job.customer_id) &&
    job.is_seed === true
  );
}

/** Throws rather than returns false: the caller is expected to let this abort the run. Exported for the unit test. */
export function checkCap(jobs, cap = MATCH_CAP) {
  if (jobs.length > cap) {
    throw new Error(
      `${jobs.length} jobs matched title contains "${JOB_TITLE_MARKER}" AND customer_id in shared test ` +
        `accounts AND is_seed=true — more than the ${cap} hard cap. That almost certainly means the filter ` +
        "is wrong, not that this one test really left this many rows. Refusing to delete anything.",
    );
  }
  return jobs;
}

async function main() {
  const env = readEnv();
  const base = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) {
    console.error("[prod-audit-sweeper] missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — refusing to run (no anon/poster fallback).");
    process.exit(2);
  }
  const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  const get = async (q) => {
    const r = await fetch(`${base}/rest/v1/${q}`, { headers, signal: AbortSignal.timeout(20_000) });
    if (!r.ok) throw new Error(`GET ${q.split("?")[0]} → ${r.status} ${await r.text()}`);
    return r.json();
  };
  const del = async (table, q) => {
    // Never `RETURNING *` on a caller-supplied path: see the note in
    // e2e/prod-audit/harness.ts restAs. Service role is not subject to the
    // column grant that broke the press teardown, but the rule is uniform so
    // the next forwarder cannot quietly reintroduce it.
    const query = /(^|&)select=/.test(q) ? q : `${q}&select=id`;
    const r = await fetch(`${base}/rest/v1/${table}?${query}`, {
      method: "DELETE",
      headers: { ...headers, Prefer: "return=representation" },
      signal: AbortSignal.timeout(20_000),
    });
    const body = await r.text();
    let rows = null;
    try {
      const parsed = JSON.parse(body);
      if (Array.isArray(parsed)) rows = parsed;
    } catch {
      /* non-array body */
    }
    return { ok: r.ok, status: r.status, removed: rows?.length ?? null, body: body.slice(0, 200) };
  };

  // One pass per marker, de-duplicated by id: a title could in principle carry
  // both, and deleting the same row twice would report a false failure
  // (removed=0 on the second pass).
  console.log(`[prod-audit-sweeper] ${base}`);
  const byId = new Map();
  for (const marker of JOB_TITLE_MARKERS) {
    let candidates;
    try {
      candidates = await get(candidateJobsQuery(marker));
    } catch (e) {
      console.error(`[prod-audit-sweeper] could not list candidate jobs for "${marker}": ${e.message}`);
      process.exit(2);
    }
    const passed = candidates.filter((j) => matchesFilter(j, marker));
    if (passed.length !== candidates.length) {
      console.warn(`[prod-audit-sweeper] "${marker}": PostgREST returned ${candidates.length} row(s) but only ${passed.length} passed the client-side re-check — the query and matchesFilter have drifted. Investigate before trusting either.`);
    }
    console.log(`[prod-audit-sweeper] "${marker}": ${passed.length} matching job(s)${DRY ? "  (DRY RUN)" : ""}`);
    for (const j of passed) byId.set(j.id, j);
  }
  const jobs = [...byId.values()];
  for (const j of jobs) console.log(`  ${j.id}  status=${j.status} payment=${j.payment_status} title="${j.title}"`);

  try {
    // The cap is over the UNION: the whole point is "this filter is wrong",
    // and a per-marker cap would let two markers quietly pass 2x the ceiling.
    checkCap(jobs);
  } catch (e) {
    console.error(`[prod-audit-sweeper] ${e.message}`);
    process.exit(1);
  }

  if (jobs.length === 0) {
    console.log("[prod-audit-sweeper] OK — nothing to remove.");
    return;
  }
  if (DRY) {
    console.log("[prod-audit-sweeper] dry run — nothing deleted.");
    return;
  }

  const failures = [];
  const media = await removeJobMediaRest({ base, headers, jobs, source: "prod-audit-sweeper" });
  if (media.failures.length) failures.push(...media.failures.map((f) => `storage: ${f}`));

  for (const j of jobs) {
    const apps = await del("applications", `job_id=eq.${j.id}`);
    if (!apps.ok) failures.push(`applications for ${j.id}: HTTP ${apps.status} ${apps.body}`);
    const msgs = await del("messages", `job_id=eq.${j.id}`);
    if (!msgs.ok) failures.push(`messages for ${j.id}: HTTP ${msgs.status} ${msgs.body}`);
    const job = await del("jobs", `id=eq.${j.id}`);
    // A DELETE matching zero rows returns 200 with []: that is a silent
    // non-deletion, not success, so it is reported as a failure.
    if (!job.ok || job.removed !== 1) failures.push(`jobs/${j.id}: HTTP ${job.status} removed=${job.removed} ${job.body}`);
  }

  if (failures.length) {
    console.error(`[prod-audit-sweeper] FAIL (${failures.length}):\n  ${failures.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`[prod-audit-sweeper] OK — removed ${jobs.length} job(s), storage ${media.removed} object(s).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`[prod-audit-sweeper] could not run: ${e.message}`);
    process.exit(2);
  });
}
