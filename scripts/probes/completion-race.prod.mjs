// PROD race probe: the job-completion race (20260914215112).
//
//   node scripts/probes/completion-race.prod.mjs [rounds=20] [scenario=all|cancel|block|approve|confirm]
//
// Runs against prod (there is no staging) on is_seed fixtures owned by the
// poster-e2e / helper-e2e seed accounts. No Stripe object is touched: the
// fixture has no payment intent or session, so create-payment's release skips
// the capture check. Every round inserts its own job (completion gates already
// satisfied: arrival verified, both photos, work started 2h ago), fires both
// parties with Promise.allSettled, judges committed state, then deletes what it
// made. Prod cannot HOLD a lock across REST calls, so which side wins each
// round is timing — the CI race runner (scripts/ci/race-runner.mjs, races 3-5)
// forces both orders with two real connections; this probe proves the same
// guarantees hold on the deployed schema and the deployed client write.
//
//   cancel   poster_cancel_job (poster) vs the Helpr's Done as the PRE-FIX
//            client wrote it — PATCH helper_completed_at, id predicate only —
//            so the database guard is what is measured.
//            BAD = a cancelled job carrying helper_completed_at.
//            The fixture has helper_confirmed_at NULL, so a cancel that wins
//            charges no fee and files no strike on the seed poster (cleanup
//            deletes user_violations / user_strikes by job anyway).
//   approve  the Helpr already marked done an hour ago; the poster approves
//            (create-payment release) while the Helpr's Done lands again.
//            BAD = helper_completed_at moved or after completed_at; job not
//            completed/payout_pending; completed_at missing; payout scheduled
//            twice; duplicate "Job completed!" / "marked the job complete".
//   block    poster blocks the Helpr (block_user_and_settle) vs the Helpr's Done
//            (pre-fix client write). BAD = a cancelled job carrying a done
//            stamp. Cleanup also deletes the poster->helper user_blocks row.
//   confirm  neither side done; the poster releases while the Helpr taps Done
//            with the FIXED client (status predicate, poster_completed_at read
//            back, create-payment release when the poster already confirmed).
//            BAD = job left live with both stamps (lost completion), or any
//            of the approve checks.
//
// Every scenario also checks job_messaging_closes_at(job) = completed_at + 24h
// on a completed job (the 24h messaging lockout clock).
import { rest, session, invoke, URL_, ANON } from "./lib/prodEnv.mjs";

const ROUNDS = Number(process.argv[2] ?? 20);
const ONLY = process.argv[3] ?? "all";
const POSTER = "71c56dfb-b326-4010-b960-b18dd3966e7f";
const HELPER = "437de07d-1bd7-46c8-a451-6b46aa3bcad5";
const LIVE = ["accepted", "in_progress", "revision_requested"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tag = () => Math.random().toString(36).replace(/[0-9.]/g, "").slice(0, 6);

const posterTok = session("poster-e2e").access_token;
const helperTok = session("helper-e2e").access_token;

/** PostgREST as an end user (RLS + triggers apply, exactly like the app). */
async function asUser(token, path, { method = "GET", body, prefer } = {}) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    method,
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json };
}

async function fixture(label, { helperDone, helperConfirmed }) {
  const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString();
  const [job] = await rest("jobs", {
    method: "POST", prefer: "return=representation",
    body: {
      customer_id: POSTER, helper_id: HELPER, is_seed: true,
      title: `RACE-COMPLETE ${label} ${tag()}`, description: "completion race probe fixture",
      category: "yard_work", location: "4412 Highland Rd, Baton Rouge, LA 70808", date_needed: ago(0).slice(0, 10),
      budget: 50, status: "in_progress", payment_status: "escrow",
      helper_confirmed_at: helperConfirmed ? ago(5) : null, poster_confirmed_at: ago(5), accepted_at: ago(6),
      helper_on_the_way_at: ago(4), helper_arrived_at: ago(3), helper_arrival_verified_at: ago(3), poster_confirmed_working_at: ago(2),
      proof_before_urls: ["https://example.invalid/b.jpg"], proof_after_urls: ["https://example.invalid/a.jpg"],
      helper_completed_at: helperDone ? ago(1) : null,
    },
  });
  return job;
}

async function cleanup(job) {
  await rest(`notifications?link=ilike.*${job.id}*`, { method: "DELETE" });
  const since = new Date(Date.now() - 15 * 60e3).toISOString();
  for (const uid of [POSTER, HELPER]) {
    await rest(`notifications?user_id=eq.${uid}&created_at=gte.${since}&message=ilike.*${encodeURIComponent("RACE-COMPLETE")}*`, { method: "DELETE" });
  }
  for (const t of ["user_violations", "user_strikes", "notification_logs"]) {
    try { await rest(`${t}?job_id=eq.${job.id}`, { method: "DELETE" }); } catch (e) { console.log(`  cleanup ${t}: ${e.message.slice(0, 120)}`); }
  }
  try { await rest(`job_tracking?job_id=eq.${job.id}`, { method: "DELETE" }); } catch { /* none */ }
  // The block scenario: never leave the seed accounts blocking each other.
  await rest(`user_blocks?blocker_id=eq.${POSTER}&blocked_id=eq.${HELPER}`, { method: "DELETE" });
  await rest(`jobs?id=eq.${job.id}`, { method: "DELETE" });
  const left = await rest(`jobs?id=eq.${job.id}&select=id`);
  if (left.length) throw new Error(`cleanup left job ${job.id}`);
}

// ── the parties ───────────────────────────────────────────────────────────
const cancel = (job) => invokeRpc(posterTok, "poster_cancel_job", { p_job_id: job.id, p_reason: "completion race probe" });
async function invokeRpc(token, fn, args) {
  return asUser(token, `rpc/${fn}`, { method: "POST", body: args });
}
/** JobTracking's Done as origin/main wrote it before 20260914215112 (no status predicate). */
const doneLegacy = (job) =>
  asUser(helperTok, `jobs?id=eq.${job.id}&select=id`, { method: "PATCH", prefer: "return=representation", body: { helper_completed_at: new Date().toISOString() } });
/** JobTracking's Done as fixed: live-status predicate, poster_completed_at read back, finish the release. */
async function doneFixed(job) {
  const r = await asUser(helperTok, `jobs?id=eq.${job.id}&status=in.(${LIVE.join(",")})&select=id,poster_completed_at`, {
    method: "PATCH", prefer: "return=representation", body: { helper_completed_at: new Date().toISOString() },
  });
  if (r.status < 300 && Array.isArray(r.json) && r.json[0]?.poster_completed_at) {
    const rel = await invoke("create-payment", helperTok, { action: "release", jobId: job.id });
    return { ...r, release: rel };
  }
  return r;
}
const block = () => invokeRpc(posterTok, "block_user_and_settle", { p_blocked: HELPER, p_reason: "completion race probe" });
const release = (job) => invoke("create-payment", posterTok, { action: "release", jobId: job.id });

async function judge(job, results) {
  const [row] = await rest(`jobs?id=eq.${job.id}&select=status,payment_status,helper_completed_at,poster_completed_at,completed_at,cancelled_at`);
  const [closes] = await rest("rpc/job_messaging_closes_at", { method: "POST", body: { _job_id: job.id } }).then((v) => [v]).catch(() => [undefined]);
  const notes = await rest(`notifications?select=user_id,title&message=ilike.*${encodeURIComponent(job.title)}*`);
  const count = (uid, pred) => notes.filter((n) => n.user_id === uid && pred(n.title)).length;
  const bad = [];
  if (row.status === "cancelled" && row.helper_completed_at) bad.push("cancelled job carries a done stamp");
  if (row.status === "cancelled" && (row.poster_completed_at || row.completed_at)) bad.push("cancel after release");
  if (LIVE.includes(row.status) && row.helper_completed_at && row.poster_completed_at) bad.push("both confirmed, job left live");
  if (job.helper_completed_at && row.helper_completed_at && Date.parse(row.helper_completed_at) !== Date.parse(job.helper_completed_at)) bad.push("helper_completed_at moved");
  if (row.status === "completed" && !row.completed_at) bad.push("completed without completed_at");
  if (row.status === "completed" && row.completed_at && row.helper_completed_at && Date.parse(row.helper_completed_at) > Date.parse(row.completed_at)) bad.push("done stamp after completion");
  if (row.status !== "completed" && row.completed_at) bad.push("completed_at on a non-completed job");
  if (row.status === "completed" && closes !== undefined && Date.parse(closes) !== Date.parse(row.completed_at) + 24 * 3600e3) bad.push(`lockout clock ${closes} != completed_at+24h`);
  if (count(POSTER, (t) => t.endsWith("marked the job complete")) > 1) bad.push("poster told 'marked complete' twice");
  if (count(POSTER, (t) => t === "Job completed!") > 1 || count(HELPER, (t) => t === "Job completed!") > 1) bad.push("duplicate 'Job completed!'");
  const fresh = results.flatMap((r) => (r.status === "fulfilled" ? [r.value, r.value.release].filter(Boolean) : []))
    .filter((v) => v.json?.success && v.json?.bothDone && !v.json?.alreadyReleased).length;
  if (fresh > 1) bad.push(`${fresh} calls scheduled the payout`);
  return { row, bad };
}

const SCENARIOS = {
  cancel: { fixture: { helperDone: false, helperConfirmed: false }, fire: (j) => [cancel(j), doneLegacy(j)], edgeCalls: 0 },
  block: { fixture: { helperDone: false, helperConfirmed: false }, fire: (j) => [block(j), doneLegacy(j)], edgeCalls: 0 },
  approve: { fixture: { helperDone: true, helperConfirmed: true }, fire: (j) => [release(j), doneLegacy(j)], edgeCalls: 1 },
  confirm: { fixture: { helperDone: false, helperConfirmed: true }, fire: (j) => [release(j), doneFixed(j)], edgeCalls: 2 },
};

// CONTROL: each party alone must do its job, or no round measures anything.
{
  const c1 = await fixture("control-done", SCENARIOS.cancel.fixture);
  try {
    const r = await doneLegacy(c1);
    const ok = r.status < 300 && r.json?.length === 1;
    console.log(`control done-alone: ${ok ? "ok" : "FAILED"} ${r.status} ${JSON.stringify(r.json)}`);
    if (!ok) process.exit(2);
  } finally { await cleanup(c1); }
  const c2 = await fixture("control-cancel", SCENARIOS.cancel.fixture);
  try {
    const r = await cancel(c2);
    const ok = r.status < 300;
    console.log(`control cancel-alone: ${ok ? "ok" : "FAILED"} ${r.status} ${JSON.stringify(r.json)}`);
    if (!ok) process.exit(2);
  } finally { await cleanup(c2); }
}

await sleep(61_000); // drain create-payment's per-user throttle window (10 calls/min)
const tally = {};
for (const [name, sc] of Object.entries(SCENARIOS)) {
  if (ONLY !== "all" && ONLY !== name) continue;
  tally[name] = 0;
  for (let i = 1; i <= ROUNDS; i++) {
    // block_user_and_settle settles EVERY live job between the two seed
    // accounts. Refuse to run while any job but our own exists between them —
    // it could be another harness's fixture mid-run.
    if (name === "block") {
      const others = await rest(`jobs?select=id,title&status=in.(${LIVE.join(",")})&or=(and(customer_id.eq.${POSTER},helper_id.eq.${HELPER}),and(customer_id.eq.${HELPER},helper_id.eq.${POSTER}))`);
      if (others.length) {
        console.log(`block: SKIPPED — ${others.length} other live job(s) between the seed accounts (${others.map((o) => o.title).join(", ")}); a block would cancel them`);
        tally[name] = "skipped";
        break;
      }
    }
    if (sc.edgeCalls) await sleep(16_000);
    const job = await fixture(`${name}-${i}`, sc.fixture);
    try {
      const results = await Promise.allSettled(sc.fire(job));
      const codes = results.flatMap((r) => (r.status === "fulfilled" ? [r.value.status, r.value.release?.status].filter(Boolean) : [0]));
      // A 429 or a 5xx raced nothing: re-run the round rather than score it.
      if (codes.some((c) => c === 429 || c >= 500 || c === 0)) {
        console.log(`${name} #${i}: invalid round (${codes}), re-running`);
        i--;
        continue;
      }
      const j = await judge(job, results);
      if (j.bad.length) tally[name]++;
      const resp = results.map((r) => (r.status === "fulfilled" ? `${r.value.status}:${JSON.stringify(r.value.json).slice(0, 160)}${r.value.release ? ` +release ${r.value.release.status}:${JSON.stringify(r.value.release.json).slice(0, 120)}` : ""}` : `rejected:${r.reason}`));
      console.log(`${name} #${i}: ${j.bad.length ? "BAD " + j.bad.join("; ") : "ok"} | final ${j.row.status}/${j.row.payment_status} | ${resp.join(" || ")}`);
    } finally {
      await cleanup(job);
    }
  }
}
console.log(`\nRESULT ${Object.entries(tally).map(([k, v]) => `${k}=${v}/${ROUNDS}`).join(" ")}`);
