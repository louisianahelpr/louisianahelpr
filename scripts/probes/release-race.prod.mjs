// PROD race probe: create-payment `release` fired concurrently.
//
//   node scripts/probes/release-race.prod.mjs [rounds=20]
//
// Runs against prod (there is no staging) on is_seed fixtures owned by the
// poster-e2e / helper-e2e seed accounts. No Stripe object is touched: the
// fixture has no payment intent or session, so the release path skips the
// capture check and goes straight to the status write. Every round inserts
// its own job, fires two calls with Promise.allSettled, judges committed
// state, then deletes its notifications and the job.
//
//   double   helper already done; the POSTER releases twice at once
//            (double tap / two devices). BAD = more than one "Job completed!"
//            notification to either party, or both calls reporting a fresh
//            completion (payout scheduled twice).
//   crossed  neither party done; poster and helper release at the same
//            instant. BAD = job not completed at the end (each read the other
//            as not done and the completion was lost), or duplicate notices.
//
// The fixture has no Stripe PI and no poster strike path (nothing cancels),
// so there is nothing to clean up beyond notifications + the job row.
import { rest, session, invoke } from "./lib/prodEnv.mjs";

const ROUNDS = Number(process.argv[2] ?? 20);
const POSTER = "71c56dfb-b326-4010-b960-b18dd3966e7f";
const HELPER = "437de07d-1bd7-46c8-a451-6b46aa3bcad5";

const posterTok = session("poster-e2e").access_token;
const helperTok = session("helper-e2e").access_token;

async function fixture(label, helperDone) {
  const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString();
  const [job] = await rest("jobs", {
    method: "POST", prefer: "return=representation",
    body: {
      customer_id: POSTER, helper_id: HELPER, is_seed: true,
      title: `RACE-RELEASE ${label} ${Math.random().toString(36).replace(/[0-9.]/g, "").slice(0, 6)}`, description: "release race probe fixture",
      category: "yard_work", location: "Baton Rouge, LA", date_needed: ago(0).slice(0, 10),
      budget: 50, status: "in_progress", payment_status: "escrow",
      helper_confirmed_at: ago(5), poster_confirmed_at: ago(5), accepted_at: ago(6),
      helper_arrived_at: ago(3), helper_arrival_verified_at: ago(3), poster_confirmed_working_at: ago(2),
      proof_before_urls: ["https://example.invalid/b.jpg"], proof_after_urls: ["https://example.invalid/a.jpg"],
      helper_completed_at: helperDone ? ago(1) : null,
    },
  });
  return job;
}

async function cleanup(jobId) {
  await rest(`notifications?link=ilike.*${jobId}*`, { method: "DELETE" });
  // "Job completed!" to the helper links /earnings: scope by user + title + recency.
  const since = new Date(Date.now() - 10 * 60e3).toISOString();
  for (const uid of [POSTER, HELPER]) {
    await rest(`notifications?user_id=eq.${uid}&created_at=gte.${since}&message=ilike.*${encodeURIComponent("RACE-RELEASE")}*`, { method: "DELETE" });
  }
  await rest(`jobs?id=eq.${jobId}`, { method: "DELETE" });
}

async function judge(job, results) {
  const [row] = await rest(`jobs?id=eq.${job.id}&select=status,payment_status,poster_completed_at,helper_completed_at,payout_scheduled_at`);
  const notes = await rest(`notifications?select=user_id,title&message=ilike.*${encodeURIComponent(job.title)}*`);
  const count = (uid, title) => notes.filter((n) => n.user_id === uid && n.title === title).length;
  const fresh = results.filter((r) => r.status === "fulfilled" && r.value.json?.success && r.value.json?.bothDone && !r.value.json?.alreadyReleased).length;
  return {
    row, fresh,
    completedNotes: { poster: count(POSTER, "Job completed!"), helper: count(HELPER, "Job completed!") },
    markedNotes: notes.filter((n) => n.title.endsWith("marked the job complete")).length,
    responses: results.map((r) => (r.status === "fulfilled" ? `${r.value.status}:${JSON.stringify(r.value.json)}` : `rejected:${r.reason}`)),
  };
}

await new Promise((r) => setTimeout(r, 61_000)); // drain the per-user throttle window
// CONTROL first: one release, no race, must produce exactly the expected
// notices — otherwise the counts below are judged against the wrong baseline.
{
  const job = await fixture("control", true);
  try {
    const r = await Promise.allSettled([invoke("create-payment", posterTok, { action: "release", jobId: job.id })]);
    const j = await judge(job, r);
    console.log(`control: ${JSON.stringify(j.completedNotes)} final ${j.row.status}/${j.row.payment_status} | ${j.responses}`);
    if (j.row.status !== "completed") { console.error("CONTROL FAILED — probe is not measuring the race"); process.exit(2); }
    globalThis.EXPECT = j.completedNotes;
  } finally { await cleanup(job.id); }
}

const tally = { double: 0, crossed: 0 };
for (const scenario of ["double", "crossed"]) {
  for (let i = 1; i <= ROUNDS; i++) {
    // create-payment allows 10 calls/user/min; two per round → pace at 16s so a
    // 429 never stands in for a race outcome. A throttled round is re-run.
    await new Promise((r) => setTimeout(r, 16_000));
    const job = await fixture(`${scenario}-${i}`, scenario === "double");
    try {
      const calls = scenario === "double"
        ? [invoke("create-payment", posterTok, { action: "release", jobId: job.id }), invoke("create-payment", posterTok, { action: "release", jobId: job.id })]
        : [invoke("create-payment", posterTok, { action: "release", jobId: job.id }), invoke("create-payment", helperTok, { action: "release", jobId: job.id })];
      const results = await Promise.allSettled(calls);
      if (results.some((r) => r.status === "fulfilled" && r.value.status === 429)) {
        console.log(`${scenario} #${i}: throttled (429), re-running round`);
        i--;
        continue;
      }
      const j = await judge(job, results);
      const reasons = [];
      if (j.completedNotes.poster > EXPECT.poster || j.completedNotes.helper > EXPECT.helper) reasons.push(`dup completed notes ${JSON.stringify(j.completedNotes)}`);
      if (j.fresh > 1) reasons.push(`${j.fresh} calls scheduled the payout`);
      if (j.row.status !== "completed" || j.row.payment_status !== "payout_pending") reasons.push(`final ${j.row.status}/${j.row.payment_status}`);
      if (j.completedNotes.poster !== EXPECT.poster || j.completedNotes.helper !== EXPECT.helper) if (!reasons.length) reasons.push(`completed notes ${JSON.stringify(j.completedNotes)}`);
      if (reasons.length) tally[scenario]++;
      console.log(`${scenario} #${i}: ${reasons.length ? "BAD " + reasons.join("; ") : "ok"} | ${j.responses.join(" || ")}`);
    } finally {
      await cleanup(job.id);
    }
  }
}
console.log(`\nRESULT double=${tally.double}/${ROUNDS} crossed=${tally.crossed}/${ROUNDS}`);
