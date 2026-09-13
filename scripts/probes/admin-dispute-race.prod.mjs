// PROD race probe: create-payment admin_release_dispute / admin_refund_dispute
// (the AdminDisputes "Quick Release" / "Quick Refund" buttons) fired twice at once.
//
//   node scripts/probes/admin-dispute-race.prod.mjs <release|refund> <pi-ids-file>
//
// Stripe stays in TEST mode. Each round needs its own succeeded test-mode
// PaymentIntent on the platform account (one refund / one transfer per PI);
// pass them one per line in <pi-ids-file> (created with pm_card_visa,
// confirm=true — see docs/OPEN.md line for this probe). Rounds = line count.
//
// Per round: service-role INSERT one is_seed job (poster-e2e / helper-e2e,
// status=disputed, the PI attached), fire the admin action twice from the
// admin-e2e seed session with Promise.allSettled, judge, then delete the
// round's notifications, admin_audit_log, payout_transfers, payment_refunds
// and the job.
//
// BAD = any of: more than one resolution notice to either party, more than one
// admin_audit_log row, more than one ledger row (payout_transfers /
// payment_refunds), an admin "Transfer failed" notice, a 5xx, or a final state
// that is not the resolved one.
import { readFileSync } from "node:fs";
import { rest, session, invoke } from "./lib/prodEnv.mjs";

const [kind, piFile] = process.argv.slice(2);
if (!["release", "refund"].includes(kind) || !piFile) {
  console.error("usage: admin-dispute-race.prod.mjs <release|refund> <pi-ids-file>");
  process.exit(2);
}
const PIS = readFileSync(piFile, "utf8").split("\n").filter(Boolean).map((l) => l.trim().split(/\s+/));
const POSTER = "71c56dfb-b326-4010-b960-b18dd3966e7f";
const HELPER = "437de07d-1bd7-46c8-a451-6b46aa3bcad5";
const admin = session("admin-e2e");
const adminTok = admin.access_token;
const ADMIN_ID = admin.user.id;
const action = kind === "release" ? "admin_release_dispute" : "admin_refund_dispute";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tag = () => Math.random().toString(36).replace(/[0-9.]/g, "").slice(0, 6);

// The job was funded for real by mint-funded-seed-jobs.prod.mjs; here it is
// moved (service role) to a hired-then-disputed state.
async function fixture([jobId, pi], label) {
  const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString();
  // enforce_job_status_transition: walk the real matrix, one hop per write.
  for (const [status, extra] of [["accepted", { helper_id: HELPER, accepted_at: ago(6) }], ["in_progress", {}]]) {
    const [cur] = await rest(`jobs?id=eq.${jobId}&select=status`);
    if (cur.status === status || cur.status === "in_progress" || cur.status === "disputed") continue;
    await rest(`jobs?id=eq.${jobId}`, { method: "PATCH", body: { status, ...extra } });
  }
  const [job] = await rest(`jobs?id=eq.${jobId}&stripe_payment_intent_id=eq.${pi}`, {
    method: "PATCH", prefer: "return=representation",
    body: {
      helper_id: HELPER, title: `RACE-ADMIN ${kind} ${label} ${tag()}`,
      status: "disputed", payment_status: "escrow",
      helper_confirmed_at: ago(5), poster_confirmed_at: ago(5), accepted_at: ago(6),
      disputed_at: ago(1), disputed_by: POSTER, dispute_reason: "race probe", dispute_status: "open",
    },
  });
  return job;
}

async function cleanup(job) {
  await rest(`notifications?link=ilike.*${job.id}*`, { method: "DELETE" });
  await rest(`notifications?message=ilike.*${encodeURIComponent(job.title)}*`, { method: "DELETE" });
  await rest(`notifications?message=ilike.*${job.id}*`, { method: "DELETE" });
  try { await rest(`admin_audit_log?target_id=eq.${job.id}`, { method: "DELETE" }); } catch (e) { console.log(`  cleanup audit: ${e.message.slice(0, 120)}`); }
  for (const t of ["payout_transfers", "payment_refunds", "disputes"]) {
    try { await rest(`${t}?job_id=eq.${job.id}`, { method: "DELETE" }); } catch (e) { console.log(`  cleanup ${t}: ${e.message.slice(0, 120)}`); }
  }
  await rest(`jobs?id=eq.${job.id}`, { method: "DELETE" });
}

async function judge(job, results) {
  const [row] = await rest(`jobs?id=eq.${job.id}&select=status,payment_status,dispute_status`);
  const notes = await rest(`notifications?select=user_id,title&message=ilike.*${encodeURIComponent(job.title)}*`);
  const failNotes = await rest(`notifications?select=id&title=eq.Transfer%20failed&message=ilike.*${job.id}*`);
  const audit = await rest(`admin_audit_log?select=id&target_id=eq.${job.id}`);
  const ledger = await rest(`${kind === "release" ? "payout_transfers" : "payment_refunds"}?select=id&job_id=eq.${job.id}`);
  const by = (uid) => notes.filter((n) => n.user_id === uid && n.title.startsWith("Dispute resolved")).length;
  return {
    row, poster: by(POSTER), helper: by(HELPER), transferFailed: failNotes.length, audit: audit.length, ledger: ledger.length,
    codes: results.map((r) => (r.status === "fulfilled" ? r.value.status : 0)),
    responses: results.map((r) => (r.status === "fulfilled" ? `${r.value.status}:${JSON.stringify(r.value.json)}` : `rejected:${r.reason}`)),
  };
}

await sleep(61_000); // drain the per-user throttle window (10 calls/min)
let bad = 0;
let i = 0;
for (const pi of PIS) {
  i++;
  await sleep(14_000);
  const job = await fixture(pi, `#${i}`);
  try {
    const results = await Promise.allSettled([
      invoke("create-payment", adminTok, { action, jobId: job.id }),
      invoke("create-payment", adminTok, { action, jobId: job.id }),
    ]);
    const j = await judge(job, results);
    const want = kind === "release" ? ["completed", "released"] : ["cancelled", "refunded"];
    const reasons = [];
    if (j.codes.includes(429)) reasons.push("THROTTLED (invalid round)");
    if (j.poster > 1 || j.helper > 1) reasons.push(`dup resolution notes poster=${j.poster} helper=${j.helper}`);
    const fresh = results.filter((r) => r.status === "fulfilled" && r.value.json?.success && !r.value.json?.alreadyResolved).length;
    if (fresh > 1) reasons.push(`${fresh} calls ran the full resolution`);
    if (j.audit > 1) reasons.push(`${j.audit} audit rows`);
    if (j.ledger > 1) reasons.push(`${j.ledger} ledger rows`);
    if (j.transferFailed) reasons.push(`${j.transferFailed} "Transfer failed" admin notices`);
    if (j.codes.some((c) => c >= 500 || c === 0)) reasons.push(`codes ${j.codes}`);
    if (j.row.status !== want[0] || j.row.payment_status !== want[1]) reasons.push(`final ${j.row.status}/${j.row.payment_status}`);
    if (reasons.length) bad++;
    console.log(`${kind} #${i}: ${reasons.length ? "BAD " + reasons.join("; ") : "ok"} [notes p=${j.poster} h=${j.helper} audit=${j.audit} ledger=${j.ledger}] | ${j.responses.join(" || ")}`);
  } finally {
    await cleanup(job);
  }
}
console.log(`\nRESULT ${kind}=${bad}/${PIS.length} (admin ${ADMIN_ID})`);
