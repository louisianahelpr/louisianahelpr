// PROD race probe, TARGET 3: filing a dispute twice at once, and filing one
// into a job state change.
//
//   node scripts/probes/dispute-open-race.prod.mjs [rounds=20]
//
// BUILT 2026-09-14 alongside 20260915034822; NOT run by the lane that wrote it.
//
// No Stripe object is touched: every call is `rpc_open_dispute`, which freezes
// the escrow but never moves it. The fixture carries no payment intent.
//
//   double   the SAME party files twice in one instant (the dialog's two-clicks
//            -in-one-task, reproduced at the RPC so the fix is measured at the
//            database and not at the browser guard in front of it). The loser
//            blocks on the RPC's FOR UPDATE and then takes its existing-dispute
//            branch. BAD = two disputes rows, or the single row's evidence_urls
//            holding the same url twice, or the job's dispute_evidence_urls
//            mirror holding it twice.
//
//   cancel   a filing races a cancellation. The poster cancels while the helper
//            files. BAD = a disputes row on a job that is not disputed (an
//            escrow frozen on a job already refunded), or `disputed` stamped on
//            a cancelled job, or the filer getting raw
//            `enforce_job_status_transition` prose instead of the
//            `dispute_job_not_disputable` code the dialog can translate.
//
// Per round: one is_seed job, two calls under Promise.allSettled, judge
// committed state, then delete the dispute, the round's notifications and fraud
// flags, any strike the cancellation filed, and the job.
import { rest, session, URL_, ANON } from "./lib/prodEnv.mjs";

const ROUNDS = Number(process.argv[2] ?? 20);
const POSTER = "71c56dfb-b326-4010-b960-b18dd3966e7f";
const HELPER = "437de07d-1bd7-46c8-a451-6b46aa3bcad5";
const posterTok = session("poster-e2e").access_token;
const helperTok = session("helper-e2e").access_token;
const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString();
const tag = () => Math.random().toString(36).replace(/[0-9.]/g, "").slice(0, 6);
const EVIDENCE = ["https://example.invalid/dispute-race-evidence.jpg"];
const REASON = "Work not completed: the probe fixture was never delivered.";

async function rpcAs(token, fn, args) {
  const res = await fetch(`${URL_}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  let json = null;
  try { json = await res.json(); } catch { /* 204 */ }
  return { status: res.status, json };
}

async function fixture(scenario, label) {
  const [job] = await rest("jobs", {
    method: "POST", prefer: "return=representation",
    body: {
      customer_id: POSTER, helper_id: HELPER, is_seed: true,
      title: `RACE-OPEN ${scenario} ${label} ${tag()}`,
      description: "rpc_open_dispute race probe fixture",
      category: "yard_work", location: "Baton Rouge, LA", date_needed: ago(0).slice(0, 10),
      budget: 50, status: "in_progress", payment_status: "escrow",
      helper_confirmed_at: ago(5), poster_confirmed_at: ago(5), accepted_at: ago(6),
      helper_completed_at: ago(1),
    },
  });
  return job;
}

async function cleanup(job) {
  await rest(`notifications?link=ilike.*${job.id}*`, { method: "DELETE" });
  await rest(`notifications?message=ilike.*${encodeURIComponent(job.title)}*`, { method: "DELETE" });
  for (const t of ["disputes", "fraud_flags", "user_violations", "user_strikes"]) {
    try { await rest(`${t}?job_id=eq.${job.id}`, { method: "DELETE" }); }
    catch (e) { console.log(`  cleanup ${t}: ${e.message.slice(0, 120)}`); }
  }
  await rest(`jobs?id=eq.${job.id}`, { method: "DELETE" });
}

async function round(scenario, label) {
  const job = await fixture(scenario, label);
  try {
    const file = (tok) => rpcAs(tok, "rpc_open_dispute", { _job_id: job.id, _reason: REASON, _evidence_urls: EVIDENCE });
    const calls = scenario === "double"
      ? [file(posterTok), file(posterTok)]
      // The cancellation goes through the RPC the poster's own button calls, so
      // the transition trigger and the strike path behave exactly as they do
      // for a real cancel.
      : [file(helperTok), rpcAs(posterTok, "poster_cancel_job", { p_job_id: job.id, p_reason: "race probe cancel" })];
    const results = await Promise.allSettled(calls);

    const disputes = await rest(`disputes?job_id=eq.${job.id}&select=id,evidence_urls,status`);
    const [j] = await rest(`jobs?id=eq.${job.id}&select=status,dispute_status,dispute_evidence_urls`);
    const bodies = results.map((r) => (r.status === "fulfilled" ? `${r.value.status}:${JSON.stringify(r.value.json)}` : `rejected:${r.reason}`));
    const dup = (arr) => (arr ?? []).length !== new Set(arr ?? []).size;

    const reasons = [];
    if (results.some((r) => r.status === "fulfilled" && r.value.status >= 500)) reasons.push("5xx");
    if (scenario === "double") {
      if (disputes.length !== 1) reasons.push(`${disputes.length} disputes rows`);
      if (disputes[0] && dup(disputes[0].evidence_urls)) reasons.push(`duplicate evidence_urls ${JSON.stringify(disputes[0].evidence_urls)}`);
      if (dup(j?.dispute_evidence_urls)) reasons.push(`duplicate jobs.dispute_evidence_urls ${JSON.stringify(j.dispute_evidence_urls)}`);
      if (j?.status !== "disputed") reasons.push(`final ${j?.status}`);
    } else {
      // Whichever order they land in, the pair must agree: a dispute row exists
      // only on a job that is disputed, and never on a cancelled one.
      if (j?.status === "cancelled" && disputes.length > 0) reasons.push("dispute row on a CANCELLED job — escrow frozen on a refunded job");
      if (j?.status === "disputed" && disputes.length !== 1) reasons.push(`disputed job with ${disputes.length} disputes rows`);
      const raw = results.some((r) =>
        r.status === "fulfilled" && r.value.status >= 400 &&
        /illegal job status transition|enforce_job_status_transition/i.test(JSON.stringify(r.value.json ?? "")));
      if (raw) reasons.push("filer got raw transition prose, not dispute_job_not_disputable");
    }

    console.log(`${scenario} #${label}: ${reasons.length ? "BAD " + reasons.join("; ") : "ok"} | job=${j?.status}/${j?.dispute_status} disputes=${disputes.length} | ${bodies.join(" || ")}`);
    return reasons.length > 0;
  } finally {
    await cleanup(job);
  }
}

const tally = { double: 0, cancel: 0 };
for (const scenario of ["double", "cancel"]) {
  for (let i = 1; i <= ROUNDS; i++) {
    if (await round(scenario, i)) tally[scenario]++;
  }
}
console.log(`\nRESULT double=${tally.double}/${ROUNDS} cancel=${tally.cancel}/${ROUNDS}`);
