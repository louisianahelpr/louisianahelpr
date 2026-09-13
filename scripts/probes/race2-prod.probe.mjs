#!/usr/bin/env node
/**
 * race2-prod — the SECOND wave of job-row races, proven against PROD.
 *
 * Wave one (apply-vs-cancel 14/20, confirm-vs-cancel 5/20) is closed by
 * 20260913014328 and re-measured 0/20. The three races here are the ones the
 * class guard left marked "candidate" in scripts/race-class-baseline.json:
 *
 *   settle      settle_dispute_record() reads public.jobs with NO row lock,
 *               decides "this job's money has settled", and then writes the
 *               dispute row TERMINAL (status='decided', execution_status=
 *               'executed'). A re-file landing inside that window — which
 *               takes the job row FOR UPDATE and flips it back to
 *               status='disputed' / dispute_status='open' — is closed and
 *               executed by the settle that read the pre-re-file snapshot.
 *               There is no recovery: rpc_decide_dispute then raises
 *               'dispute already decided' and execute-dispute-split 409s.
 *               BAD = a LIVE dispute (job disputed, dispute_status open)
 *               carrying a dispute row marked decided+executed.
 *
 *   dispute     DisputeDialog fires rpc_open_dispute from a click handler
 *               whose only guard is React state (`setSubmitting(true)`), which
 *               does not land until the next render. Two clicks in one JS task
 *               send two RPCs. open_dispute_as's existing-dispute branch then
 *               APPENDS the same evidence array a second time and re-pages ops.
 *               BAD = the same evidence url stored twice on the job, or two
 *               'A dispute was opened' notifications for one filing.
 *
 *   complete    JobTracking's Done step writes
 *               `.from("jobs").update({ helper_completed_at })` with an id
 *               predicate and NOTHING else, and enforce_helper_completion_gates
 *               judges arrival/photos/30-minutes but never the job's STATUS.
 *               Queued behind poster_cancel_job()'s FOR UPDATE it stamps a
 *               CANCELLED job — and void-cancelled-payments recomputes
 *               "committed" from the completion stamps, so the poster is
 *               charged a cancellation fee on a job the cancel priced at $0.
 *               BAD = status='cancelled' AND helper_completed_at IS NOT NULL.
 *
 * METHOD (docs: memory "prove races on prod with xmin")
 * ------
 * Per round: one fresh service-role fixture job marked `is_seed`, both sides
 * fired with Promise.allSettled from real end-user sessions (PostgREST, user
 * JWT — the same door the app uses), committed state read back through the
 * service-role client, then the round's rows deleted. Rounds run
 * SEQUENTIALLY: poster_cancel_job files a strike on the poster when the helper
 * was committed, and the third strike restricts the account for 7 days, so
 * every round deletes its own violation/strike rows.
 *
 * Every row this writes is `is_seed = true` and owned by the two 0902 seed
 * accounts. It never touches a real user's job.
 *
 *   node scripts/probes/race2-prod.probe.mjs [settle|dispute|complete|all] [rounds]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
for (const line of fs.readFileSync(path.join(REPO, ".env"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const URL = process.env.VITE_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!URL || !SERVICE || !ANON) throw new Error("missing .env (VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / VITE_SUPABASE_PUBLISHABLE_KEY)");

const POSTER = "71c56dfb-b326-4010-b960-b18dd3966e7f"; // helpr-e2e-poster-0902
const HELPER = "437de07d-1bd7-46c8-a451-6b46aa3bcad5"; // helpr-e2e-helper-0902

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

/** A PostgREST client that speaks as a seeded test user, exactly as the app does. */
function userClient(which) {
  const out = execFileSync("node", [path.join(REPO, "scripts/test-signin-link.mjs"), which, "--session", "--json"], {
    cwd: REPO,
    encoding: "utf8",
  });
  const token = JSON.parse(JSON.parse(out).value).access_token;
  return createClient(URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

const ago = (ms) => new Date(Date.now() - ms).toISOString();
const H = 3600_000;

/** One fixture job. `over` sets the race-specific columns. */
async function makeJob(tag, over) {
  const { data, error } = await admin
    .from("jobs")
    .insert({
      title: `${tag} race probe`,
      description: "race2-prod.probe.mjs fixture — deleted at the end of the round.",
      category: "cleaning",
      budget: 100,
      location: "Test Address",
      parish: "Orleans",
      customer_id: POSTER,
      date_needed: new Date(Date.now() + 7 * 24 * H).toISOString().slice(0, 10),
      created_at: ago(30 * 24 * H),
      payment_status: "escrow",
      is_seed: true,
      ...over,
    })
    .select("id")
    .single();
  if (error) throw new Error(`fixture insert: ${error.message}`);
  return data.id;
}

/** Delete everything a round wrote, strikes first — the cap is what breaks round 3 onward. */
async function cleanup(jobId) {
  await admin.from("user_violations").delete().eq("job_id", jobId);
  await admin.from("user_strikes").delete().eq("job_id", jobId);
  await admin.from("notifications").delete().or(`job_id.eq.${jobId},link.ilike.%${jobId}%`);
  await admin.from("disputes").delete().eq("job_id", jobId);
  await admin.from("job_tracking").delete().eq("job_id", jobId);
  await admin.from("jobs").delete().eq("id", jobId);
}

const say = (e) => (e ? `${e.code ?? ""} ${e.message ?? e}`.trim() : "ok");

// ── settle_dispute_record vs a re-file ───────────────────────────────────
async function settleRound(clients) {
  const jobId = await makeJob("[settle]", {
    status: "completed",
    helper_id: HELPER,
    helper_confirmed_at: ago(48 * H),
    helper_completed_at: ago(26 * H),
    poster_completed_at: ago(25 * H),
    payment_status: "released",
    dispute_status: "resolved",
    disputed_by: HELPER,
    disputed_at: ago(72 * H),
    dispute_reason: "Seed fixture: the original dispute this record belongs to.",
    dispute_resolved_at: ago(2 * H),
  });
  const { error: dErr } = await admin
    .from("disputes")
    .insert({ job_id: jobId, opener_id: HELPER, reason: "Seed fixture: open record left behind by a settled job.", status: "open" });
  if (dErr) throw new Error(`fixture dispute: ${dErr.message}`);

  const [a, b] = await Promise.allSettled([
    admin.rpc("settle_dispute_record", {
      _job_id: jobId,
      _outcome: "helper",
      _decided_by: null,
      _decision_text: "Record closed to match the job (race probe).",
      _helper_cents: null,
      _refund_cents: null,
      _transfer_id: null,
      _refund_id: null,
    }),
    clients.helper.rpc("rpc_open_dispute", {
      _job_id: jobId,
      _reason: "Re-filing: the work was never finished and I am contesting this again.",
      _evidence_urls: [],
    }),
  ]);

  const { data: job } = await admin.from("jobs").select("status, dispute_status").eq("id", jobId).single();
  const { data: disps, error: dispErr } = await admin.from("disputes").select("status, execution_status").eq("job_id", jobId);
  if (dispErr) throw new Error(`dispute read-back: ${dispErr.message}`);
  const disp = disps?.[0];
  // THE INVARIANT: a job the database says is live-disputed must still have an
  // OPEN record. That record is the admin queue's only reader and the only row
  // rpc_decide_dispute will act on — without one, the escrow is frozen on a
  // dispute nobody can decide, and settle_dispute_record's own 'executed' makes
  // it terminal. (A settle that lands entirely BEFORE the re-file is fine: the
  // re-file then inserts its own fresh open row, which this allows.)
  const live = job?.status === "disputed" && job?.dispute_status === "open";
  const bad = live && !(disps ?? []).some((d) => d.status === "open");
  await cleanup(jobId);
  return {
    bad,
    detail: `job=${job?.status}/${job?.dispute_status} rows=${disps?.length} dispute=${disp?.status}/${disp?.execution_status} settle=${say(a.value?.error ?? a.reason)} refile=${say(b.value?.error ?? b.reason)}`,
  };
}

// ── DisputeDialog double submit ──────────────────────────────────────────
async function disputeRound(clients) {
  const jobId = await makeJob("[dispute]", {
    status: "in_progress",
    helper_id: HELPER,
    helper_confirmed_at: ago(48 * H),
    helper_arrived_at: ago(3 * H),
    helper_arrival_verified_at: ago(3 * H),
  });
  const url = `https://example.invalid/evidence/${jobId}.jpg`;
  const args = {
    _job_id: jobId,
    _reason: "The work was left unfinished and I am filing this dispute about it.",
    _evidence_urls: [url],
  };
  // ONE JS task, two dispatches — the same-frame double click the dialog's
  // React-state guard cannot see.
  const [a, b] = await Promise.allSettled([
    clients.helper.rpc("rpc_open_dispute", args),
    clients.helper.rpc("rpc_open_dispute", args),
  ]);

  const { data: job } = await admin.from("jobs").select("status, dispute_evidence_urls").eq("id", jobId).single();
  const { data: disputes } = await admin.from("disputes").select("id, evidence_urls").eq("job_id", jobId);
  const { data: notifs } = await admin.from("notifications").select("id").eq("user_id", POSTER).ilike("link", `%${jobId}%`);
  const dupOnJob = (job?.dispute_evidence_urls ?? []).filter((u) => u === url).length;
  const dupOnRecord = (disputes?.[0]?.evidence_urls ?? []).filter((u) => u === url).length;
  const bad = dupOnJob > 1 || dupOnRecord > 1 || (disputes?.length ?? 0) > 1 || (notifs?.length ?? 0) > 1;
  await cleanup(jobId);
  return {
    bad,
    detail: `status=${job?.status} rows=${disputes?.length} evidence job×${dupOnJob} record×${dupOnRecord} counterparty-notifs=${notifs?.length} A=${say(a.value?.error ?? a.reason)} B=${say(b.value?.error ?? b.reason)}`,
  };
}

// ── helper_completed_at vs the poster's cancel ───────────────────────────
async function completeRound(clients) {
  const jobId = await makeJob("[complete]", {
    status: "in_progress",
    helper_id: HELPER,
    helper_confirmed_at: ago(48 * H),
    helper_on_the_way_at: ago(4 * H),
    helper_arrived_at: ago(3 * H),
    helper_arrival_verified_at: ago(3 * H),
    poster_confirmed_working_at: ago(3 * H),
    // The completion trigger's photo gate is the poster's per-job call; this
    // race is about STATUS, so the photo gate is satisfied rather than dodged.
    require_photo_proof: true,
    proof_before_urls: ["https://example.invalid/before.jpg"],
    proof_after_urls: ["https://example.invalid/after.jpg"],
  });

  const [a, b] = await Promise.allSettled([
    clients.poster.rpc("poster_cancel_job", { p_job_id: jobId, p_reason: "race probe" }),
    // VERBATIM the client write under test (JobTracking.tsx "done" step).
    clients.helper.from("jobs").update({ helper_completed_at: new Date().toISOString() }).eq("id", jobId).select("id"),
  ]);

  const { data: job } = await admin
    .from("jobs")
    .select("status, helper_completed_at, cancellation_fee, cancellation_fee_status")
    .eq("id", jobId)
    .single();
  const bad = job?.status === "cancelled" && job?.helper_completed_at !== null;
  await cleanup(jobId);
  return {
    bad,
    detail: `status=${job?.status} completed_at=${job?.helper_completed_at ? "STAMPED" : "null"} fee=${job?.cancellation_fee}/${job?.cancellation_fee_status} cancel=${say(a.value?.error ?? a.reason)} done=${say(b.value?.error ?? b.reason)}`,
  };
}

const RACES = { settle: settleRound, dispute: disputeRound, complete: completeRound };

const which = process.argv[2] ?? "all";
const ROUNDS = Number(process.argv[3] ?? 20);
const names = which === "all" ? Object.keys(RACES) : [which];
const clients = { poster: userClient("poster-e2e"), helper: userClient("helper-e2e") };

for (const name of names) {
  let bad = 0;
  for (let i = 1; i <= ROUNDS; i++) {
    const r = await RACES[name](clients);
    if (r.bad) bad++;
    console.log(`${name} round ${String(i).padStart(2)}: ${r.bad ? "BAD" : "ok "} ${r.detail}`);
  }
  console.log(`\n== ${name}: BAD ${bad}/${ROUNDS}\n`);
}
