// PROD race probe, TARGET 1: two settlements landing on one dispute at once.
//
//   node scripts/probes/settle-dispute-race.prod.mjs [rounds=20]
//
// BUILT 2026-09-14 alongside 20260915034822; NOT run by the lane that wrote it.
//
// No Stripe object is touched: the fixture carries no payment intent and every
// call is `settle_dispute_record`, which only closes the `disputes` row from the
// job's already-settled money state. Nothing here can move a cent.
//
//   admins   two admins settle the same dispute at the same instant.
//            BAD = both calls return a dispute id (both executed), or the row's
//            decided_by / execution_transfer_id belongs to the loser, or the
//            money fields were overwritten after the first write.
//
//   withdraw the opener withdraws while an admin settles. The two take the same
//            row (`rpc_withdraw_dispute` FOR UPDATE; settle's WHERE status =
//            'open'), and after 20260915034822 settle also holds the JOB row
//            FOR SHARE, so the withdrawal's own `FOR UPDATE` on jobs cannot
//            slip between settle's gate read and its write.
//            BAD = the dispute ends 'decided' while the job is live again
//            (in_progress / disputed) — terminal: rpc_decide_dispute then
//            raises 'already decided' and execute-dispute-split returns 409,
//            with no recovery short of manual SQL.
//
// Per round: one is_seed job + one open disputes row, two calls under
// Promise.allSettled, judge committed state, then delete the dispute, the
// round's notifications, any strike or violation it filed, and the job.
import { rest, session, rpcSr, URL_, ANON } from "./lib/prodEnv.mjs";

const ROUNDS = Number(process.argv[2] ?? 20);
const POSTER = "71c56dfb-b326-4010-b960-b18dd3966e7f";
const HELPER = "437de07d-1bd7-46c8-a451-6b46aa3bcad5";
const posterSess = session("poster-e2e");
const posterTok = posterSess.access_token;
const adminSess = session("admin-e2e");
const ADMIN_A = adminSess.user.id;
// The second "admin" only ever appears in decided_by, so the seed helper's id
// stands in for one: this probe is about which WRITE wins, not about authz
// (settle_dispute_record is service_role-only and takes the id as an argument).
const ADMIN_B = HELPER;
const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString();
const tag = () => Math.random().toString(36).replace(/[0-9.]/g, "").slice(0, 6);

async function fixture(scenario, label) {
  const settled = scenario === "admins";
  const [job] = await rest("jobs", {
    method: "POST", prefer: "return=representation",
    body: {
      customer_id: POSTER, helper_id: HELPER, is_seed: true,
      title: `RACE-SETTLE ${scenario} ${label} ${tag()}`,
      description: "settle_dispute_record race probe fixture",
      category: "yard_work", location: "4412 Highland Rd, Baton Rouge, LA 70808", date_needed: ago(0).slice(0, 10),
      budget: 50,
      // `admins`: the money has already settled and the job's terminal dispute
      // state is written, which is the ONLY state settle_dispute_record accepts.
      // `withdraw`: still live, because the withdrawal has to have something to
      // withdraw — settle is expected to refuse, and the round is judged on
      // whether it refuses cleanly rather than half-writing.
      status: settled ? "completed" : "in_progress",
      payment_status: settled ? "released" : "escrow",
      dispute_status: settled ? "resolved" : "open",
      dispute_resolved_at: settled ? ago(0) : null,
      disputed_at: settled ? ago(2) : ago(1),
      disputed_by: POSTER,
      dispute_reason: "settle race probe fixture",
      helper_confirmed_at: ago(5), poster_confirmed_at: ago(5), accepted_at: ago(6),
      helper_completed_at: ago(2),
    },
  });
  if (!settled) {
    await rest(`jobs?id=eq.${job.id}`, { method: "PATCH", body: { status: "disputed" } });
  }
  const [dispute] = await rest("disputes", {
    method: "POST", prefer: "return=representation",
    body: { job_id: job.id, opener_id: POSTER, reason: "settle race probe fixture", status: "open" },
  });
  return { job, dispute };
}

async function cleanup(job) {
  await rest(`notifications?link=ilike.*${job.id}*`, { method: "DELETE" });
  await rest(`notifications?message=ilike.*${encodeURIComponent(job.title)}*`, { method: "DELETE" });
  for (const t of ["disputes", "user_violations", "user_strikes", "payout_transfers", "payment_refunds"]) {
    try { await rest(`${t}?job_id=eq.${job.id}`, { method: "DELETE" }); }
    catch (e) { console.log(`  cleanup ${t}: ${e.message.slice(0, 120)}`); }
  }
  try { await rest(`admin_audit_log?target_id=eq.${job.id}`, { method: "DELETE" }); }
  catch (e) { console.log(`  cleanup audit: ${e.message.slice(0, 120)}`); }
  await rest(`jobs?id=eq.${job.id}`, { method: "DELETE" });
}

async function round(scenario, label) {
  const { job } = await fixture(scenario, label);
  try {
    const settle = (admin, transferId) =>
      rpcSr("settle_dispute_record", {
        _job_id: job.id, _outcome: "helper", _decided_by: admin,
        _decision_text: `race probe ${transferId}`, _helper_cents: 5000, _transfer_id: transferId,
      });

    const calls = scenario === "admins"
      ? [settle(ADMIN_A, "tr_probe_a"), settle(ADMIN_B, "tr_probe_b")]
      : [settle(ADMIN_A, "tr_probe_a"), withdrawCall(job.id)];
    const results = await Promise.allSettled(calls);

    const [d] = await rest(`disputes?job_id=eq.${job.id}&select=status,decided_by,execution_status,execution_transfer_id,execution_helper_cents`);
    const [j] = await rest(`jobs?id=eq.${job.id}&select=status,payment_status,dispute_status`);
    const ids = results.map((r) => (r.status === "fulfilled" ? r.value?.json ?? r.value?.status : `rejected:${r.reason}`));

    const reasons = [];
    if (scenario === "admins") {
      const executed = results.filter((r) => r.status === "fulfilled" && r.value.status < 300 && r.value.json).length;
      if (executed > 1) reasons.push(`${executed} calls executed`);
      if (!d) reasons.push("dispute row gone");
      else {
        if (d.status !== "decided" || d.execution_status !== "executed") reasons.push(`dispute ${d.status}/${d.execution_status}`);
        // Exactly one writer's identity may survive, and it must be a whole one:
        // the winner's admin id paired with the winner's transfer id.
        const pairOk =
          (d.decided_by === ADMIN_A && d.execution_transfer_id === "tr_probe_a") ||
          (d.decided_by === ADMIN_B && d.execution_transfer_id === "tr_probe_b");
        if (!pairOk) reasons.push(`mixed writer: decided_by=${d.decided_by} transfer=${d.execution_transfer_id}`);
      }
    } else {
      // The withdrawal restores the job to a live status. A dispute closed as
      // decided+executed on a live job is the terminal state this target exists
      // to prevent.
      const live = j && ["in_progress", "completed", "disputed"].includes(j.status) && j.dispute_status !== "resolved";
      if (d && d.status === "decided" && live) reasons.push(`decided on a live job (${j.status}/${j.dispute_status})`);
      if (d && d.status === "withdrawn" && d.execution_status === "executed") reasons.push("withdrawn AND executed");
      if (!d) reasons.push("dispute row gone");
    }
    if (results.some((r) => r.status === "fulfilled" && r.value?.status >= 500)) reasons.push("5xx");

    console.log(`${scenario} #${label}: ${reasons.length ? "BAD " + reasons.join("; ") : "ok"} | ${JSON.stringify(ids)} | dispute=${JSON.stringify(d)} job=${JSON.stringify(j)}`);
    return reasons.length > 0;
  } finally {
    await cleanup(job);
  }
}

async function withdrawCall(jobId) {
  const res = await fetch(`${URL_}/rest/v1/rpc/rpc_withdraw_dispute`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${posterTok}`, "Content-Type": "application/json" },
    body: JSON.stringify({ _job_id: jobId }),
  });
  let json = null;
  try { json = await res.json(); } catch { /* 204 */ }
  return { status: res.status, json };
}

const tally = { admins: 0, withdraw: 0 };
for (const scenario of ["admins", "withdraw"]) {
  for (let i = 1; i <= ROUNDS; i++) {
    if (await round(scenario, i)) tally[scenario]++;
  }
}
console.log(`\nRESULT admins=${tally.admins}/${ROUNDS} withdraw=${tally.withdraw}/${ROUNDS}`);
