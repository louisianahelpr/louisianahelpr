// PROD race probe, TARGET 2: Quick Release and Quick Refund on the SAME job,
// at the same instant. The last open hole in the dispute money paths
// (docs/OPEN.md, open since 2026-09-14).
//
//   node scripts/probes/admin-release-vs-refund.prod.mjs <pi-ids-file> [--mode=crossed|same|fail|all] [--no-account-helper=<uuid>]
//
// Three modes, one fixture per PI line (so `all` needs 3 lines per round):
//   crossed  Quick Release + Quick Refund together (the original target).
//   same     THE TOKEN FIX under real concurrency. Two Quick Releases fired
//            together, plus a Quick Refund fired a staggered 0-600 ms later
//            (the stagger walks across rounds so some refunds land after the
//            joined loser returned and before the winner's release). Before
//            the token, the joined loser's cleanup deleted the WINNER's claim
//            mid-transfer and that refund walked in. BAD = a transfer AND a
//            refund, >1 transfer, >1 fresh resolution, >1 audit row, a 5xx
//            other than none, or the refund not refused while a release held.
//            Plus a deterministic half: a claim is planted by service role (a
//            "winner" mid-transfer), a Quick Release joins it and must get a
//            409 `inProgress` with NO transfer (round 4, M3: a joiner used to
//            be let through and move money with no claim of its own), and the
//            planted row must STILL be there, token unchanged.
//   fail     INDUCED TRANSFER FAILURE. The fixture's budget is raised far
//            above the PaymentIntent, so `transfers.create` with
//            `source_transaction` is refused by Stripe (amount exceeds the
//            source charge). Or pass --no-account-helper=<uuid> of a test Helpr
//            with no Connect account, and transferToHelper throws before Stripe.
//            Either way the release must fail with NO payout_transfers row,
//            hand its claim back (no dispute_settlement_claims row left), and
//            an immediate Quick Refund must SUCCEED — not 409 held_by_release,
//            not wait five minutes for expiry. If the induced failure does not
//            fail, the round is INVALID, not a pass.
//
// BUILT 2026-09-14 alongside 20260915034822; NOT run by the lane that wrote it.
//
// ── Why the existing guard does not cover this ──────────────────────────────
// Release-vs-release and refund-vs-refund were closed by the conditional
// `UPDATE jobs … WHERE status = 'disputed'` (93237acdf, 0/20 each on prod).
// That cannot close release-vs-REFUND: the Stripe step runs FIRST in both
// handlers, and the two steps are a `transfers.create` and a `refunds.create`
// under DIFFERENT idempotency keys, so neither one's guard can see the other.
// Both moved real money, then one won the flip and the other returned a clean
// `alreadyResolved` — reporting success over a job that had paid the Helpr AND
// refunded the poster.
//
// BAD = both a payout_transfers row AND a payment_refunds row for the same job
// (the double-spend itself), or both calls reporting a fresh resolution, or
// more than one resolution notice to either party, or more than one
// admin_audit_log row, or a 5xx, or a final state that is neither resolution.
// The expected shape after 20260915034822 is one winner plus one 409 carrying
// `heldBy`.
//
// Stripe stays in TEST mode. Each round needs its own succeeded test-mode
// PaymentIntent on the platform account, one per line in <pi-ids-file> as
// "<jobId> <piId>" — the same file format and minting path
// (mint-funded-seed-jobs.prod.mjs) admin-dispute-race.prod.mjs uses.
import { readFileSync } from "node:fs";
import { rest, session, invoke, rpcSr } from "./lib/prodEnv.mjs";

const args = process.argv.slice(2);
const piFile = args.find((a) => !a.startsWith("--"));
const MODE = (args.find((a) => a.startsWith("--mode=")) ?? "--mode=crossed").slice(7);
const NO_ACCOUNT_HELPER = (args.find((a) => a.startsWith("--no-account-helper=")) ?? "").slice(20) || null;
if (!piFile || !["crossed", "same", "fail", "all"].includes(MODE)) {
  console.error("usage: admin-release-vs-refund.prod.mjs <pi-ids-file> [--mode=crossed|same|fail|all] [--no-account-helper=<uuid>]");
  process.exit(2);
}
const PIS = readFileSync(piFile, "utf8").split("\n").filter(Boolean).map((l) => l.trim().split(/\s+/));
const POSTER = "71c56dfb-b326-4010-b960-b18dd3966e7f";
const HELPER = "437de07d-1bd7-46c8-a451-6b46aa3bcad5";
const admin = session("admin-e2e");
const adminTok = admin.access_token;
const ADMIN_ID = admin.user.id;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tag = () => Math.random().toString(36).replace(/[0-9.]/g, "").slice(0, 6);
const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString();

async function fixture([jobId, pi], label, overrides = {}) {
  // enforce_job_status_transition: walk the real matrix, one hop per write.
  for (const [status, extra] of [["accepted", { helper_id: HELPER, accepted_at: ago(6) }], ["in_progress", {}]]) {
    const [cur] = await rest(`jobs?id=eq.${jobId}&select=status`);
    if (cur.status === status || cur.status === "in_progress" || cur.status === "disputed") continue;
    await rest(`jobs?id=eq.${jobId}`, { method: "PATCH", body: { status, ...extra } });
  }
  const [job] = await rest(`jobs?id=eq.${jobId}&stripe_payment_intent_id=eq.${pi}`, {
    method: "PATCH", prefer: "return=representation",
    body: {
      helper_id: HELPER, title: `RACE-CROSSED ${label} ${tag()}`,
      status: "disputed", payment_status: "escrow",
      helper_confirmed_at: ago(5), poster_confirmed_at: ago(5), accepted_at: ago(6),
      disputed_at: ago(1), disputed_by: POSTER, dispute_reason: "crossed race probe", dispute_status: "open",
      ...overrides,
    },
  });
  return job;
}

async function cleanup(job) {
  await rest(`notifications?link=ilike.*${job.id}*`, { method: "DELETE" });
  await rest(`notifications?message=ilike.*${encodeURIComponent(job.title)}*`, { method: "DELETE" });
  await rest(`notifications?message=ilike.*${job.id}*`, { method: "DELETE" });
  try { await rest(`admin_audit_log?target_id=eq.${job.id}`, { method: "DELETE" }); }
  catch (e) { console.log(`  cleanup audit: ${e.message.slice(0, 120)}`); }
  // A refund lands the job in `cancelled`: drop any strike/violation it filed on
  // the seed poster, or three rounds would restrict the account for 7 days.
  // dispute_settlement_claims is keyed by job_id and cascades with the job, but
  // it is deleted explicitly so a wedged round does not silently protect the
  // next one from the very race this probe is measuring.
  for (const t of ["payout_transfers", "payment_refunds", "disputes", "user_violations", "user_strikes", "dispute_settlement_claims"]) {
    try { await rest(`${t}?job_id=eq.${job.id}`, { method: "DELETE" }); }
    catch (e) { console.log(`  cleanup ${t}: ${e.message.slice(0, 120)}`); }
  }
  await rest(`jobs?id=eq.${job.id}`, { method: "DELETE" });
}

async function judge(job, results) {
  const [row] = await rest(`jobs?id=eq.${job.id}&select=status,payment_status,dispute_status`);
  const notes = await rest(`notifications?select=user_id,title&message=ilike.*${encodeURIComponent(job.title)}*`);
  const audit = await rest(`admin_audit_log?select=id&target_id=eq.${job.id}`);
  const transfers = await rest(`payout_transfers?select=id,stripe_transfer_id&job_id=eq.${job.id}`);
  const refunds = await rest(`payment_refunds?select=id,stripe_refund_id&job_id=eq.${job.id}`);
  const by = (uid) => notes.filter((n) => n.user_id === uid && n.title.startsWith("Dispute resolved")).length;
  return {
    row, poster: by(POSTER), helper: by(HELPER), audit: audit.length,
    transfers: transfers.length, refunds: refunds.length,
    codes: results.map((r) => (r.status === "fulfilled" ? r.value.status : 0)),
    responses: results.map((r) => (r.status === "fulfilled" ? `${r.value.status}:${JSON.stringify(r.value.json)}` : `rejected:${r.reason}`)),
  };
}

const fresh = (results) =>
  results.filter((r) => r.status === "fulfilled" && r.value.json?.success && !r.value.json?.alreadyResolved).length;
const settledOk = (row) =>
  (row.status === "completed" && row.payment_status === "released") ||
  (row.status === "cancelled" && row.payment_status === "refunded");
const log = (kind, i, reasons, j) =>
  console.log(`${kind} #${i}: ${reasons.length ? "BAD " + reasons.join("; ") : "ok"} [transfers=${j.transfers} refunds=${j.refunds} notes p=${j.poster} h=${j.helper} audit=${j.audit}] | ${j.responses.join(" || ")}`);

async function crossedRound(job, i) {
  // The whole point: two DIFFERENT actions, fired together.
  const results = await Promise.allSettled([
    invoke("create-payment", adminTok, { action: "admin_release_dispute", jobId: job.id }),
    invoke("create-payment", adminTok, { action: "admin_refund_dispute", jobId: job.id }),
  ]);
  const j = await judge(job, results);
  const reasons = [];
  if (j.codes.includes(429)) reasons.push("THROTTLED (invalid round)");
  // THE finding: the escrow paid out and was refunded.
  if (j.transfers > 0 && j.refunds > 0) reasons.push(`DOUBLE SPEND — ${j.transfers} transfer(s) AND ${j.refunds} refund(s)`);
  if (j.transfers > 1 || j.refunds > 1) reasons.push(`dup ledger transfers=${j.transfers} refunds=${j.refunds}`);
  if (fresh(results) > 1) reasons.push(`${fresh(results)} calls ran the full resolution`);
  if (j.poster > 1 || j.helper > 1) reasons.push(`dup resolution notes poster=${j.poster} helper=${j.helper}`);
  if (j.audit > 1) reasons.push(`${j.audit} audit rows`);
  if (j.codes.some((c) => c >= 500 || c === 0)) reasons.push(`codes ${j.codes}`);
  if (!settledOk(j.row)) reasons.push(`final ${j.row.status}/${j.row.payment_status}`);
  // The expected AFTER shape, stated so a pass for the wrong reason is loud:
  // one resolution, one 409 naming the holder.
  // A loser that arrived while the winner held the claim gets heldBy; one that
  // arrived after the winner's flip gets settledOtherWay. Both are clean.
  const refused = results.filter((r) => r.status === "fulfilled" && r.value.status === 409 && (r.value.json?.heldBy || r.value.json?.settledOtherWay)).length;
  if (!reasons.length && refused !== 1) reasons.push(`no clean 409 refusal (codes ${j.codes}) — the loser did not learn it lost`);
  log("crossed", i, reasons, j);
  return reasons.length > 0;
}

async function sameRound(job, i) {
  const stagger = ((i - 1) % 7) * 100; // 0..600 ms, walked across rounds
  const results = await Promise.allSettled([
    invoke("create-payment", adminTok, { action: "admin_release_dispute", jobId: job.id }),
    invoke("create-payment", adminTok, { action: "admin_release_dispute", jobId: job.id }),
    sleep(stagger).then(() => invoke("create-payment", adminTok, { action: "admin_refund_dispute", jobId: job.id })),
  ]);
  const j = await judge(job, results);
  const reasons = [];
  if (j.codes.includes(429)) reasons.push("THROTTLED (invalid round)");
  if (j.transfers > 0 && j.refunds > 0) reasons.push(`DOUBLE SPEND — ${j.transfers} transfer(s) AND ${j.refunds} refund(s) (the joined loser freed the winner's claim)`);
  if (j.transfers > 1) reasons.push(`${j.transfers} transfers from two same-action releases`);
  if (fresh(results) > 1) reasons.push(`${fresh(results)} calls ran the full resolution`);
  if (j.audit > 1) reasons.push(`${j.audit} audit rows`);
  if (j.poster > 1 || j.helper > 1) reasons.push(`dup resolution notes poster=${j.poster} helper=${j.helper}`);
  if (j.codes.some((c) => c >= 500 || c === 0)) reasons.push(`codes ${j.codes}`);
  if (!settledOk(j.row)) reasons.push(`final ${j.row.status}/${j.row.payment_status}`);
  // The refund must never have run: either refused while a release held the
  // claim (409 heldBy=release) or refused after (job no longer disputed).
  const refund = results[2];
  if (refund.status === "fulfilled" && refund.value.json?.success && !refund.value.json?.alreadyResolved) {
    reasons.push("the staggered Quick Refund ran a fresh resolution");
  }
  const leftover = await rest(`dispute_settlement_claims?job_id=eq.${job.id}&select=action,token`);
  if (leftover.length) reasons.push(`claim left behind: ${JSON.stringify(leftover)}`);
  log(`same(+${stagger}ms)`, i, reasons, j);
  return reasons.length > 0;
}

/** Deterministic half of the token proof: a joined caller must not free a planted claim. */
async function plantedRound(job, i) {
  const planted = await rpcSr("claim_dispute_settlement", { _job_id: job.id, _action: "release", _admin_id: ADMIN_ID });
  const reasons = [];
  if (planted.status !== 200 || planted.json?.verdict !== "claimed" || !planted.json?.token) {
    console.log(`planted #${i}: INVALID — could not plant a claim: ${planted.status} ${JSON.stringify(planted.json)}`);
    return true;
  }
  const res = await invoke("create-payment", adminTok, { action: "admin_release_dispute", jobId: job.id });
  const rows = await rest(`dispute_settlement_claims?job_id=eq.${job.id}&select=action,token`);
  const joinedTransfers = await rest(`payout_transfers?select=id&job_id=eq.${job.id}`);
  if (!(res.status === 409 && res.json?.inProgress === true)) reasons.push(`the joined release was not refused 409 inProgress: ${res.status}`);
  if (joinedTransfers.length > 0) reasons.push(`the joined release moved money: ${joinedTransfers.length} transfer row(s)`);
  if (!(rows.length === 1 && rows[0].token === planted.json.token)) {
    reasons.push(`the joined release freed or replaced the planted claim: ${JSON.stringify(rows)}`);
  }
  if (res.status >= 500) reasons.push(`joined release ${res.status}`);
  const freed = await rpcSr("release_dispute_settlement_claim", { _job_id: job.id, _token: planted.json.token });
  if (freed.json !== true) reasons.push(`the planted token could not release its own claim: ${JSON.stringify(freed.json)}`);
  console.log(`planted #${i}: ${reasons.length ? "BAD " + reasons.join("; ") : "ok"} | release ${res.status}:${JSON.stringify(res.json)}`);
  return reasons.length > 0;
}

async function failRound([jobId, pi], i) {
  const overrides = NO_ACCOUNT_HELPER
    ? { helper_id: NO_ACCOUNT_HELPER }
    // A budget far above any minted PI: the transfer exceeds its source charge.
    : { budget: 50_000 };
  const [{ budget: originalBudget }] = await rest(`jobs?id=eq.${jobId}&select=budget`);
  const job = await fixture([jobId, pi], `FAIL#${i}`, overrides);
  try {
    const release = await invoke("create-payment", adminTok, { action: "admin_release_dispute", jobId: job.id });
    const transfers = await rest(`payout_transfers?select=id&job_id=eq.${job.id}`);
    const claimsAfterFail = await rest(`dispute_settlement_claims?job_id=eq.${job.id}&select=action,token`);
    if (release.status < 400 || transfers.length > 0) {
      console.log(`fail #${i}: INVALID — the induced transfer failure did not fail (release ${release.status}, transfers=${transfers.length}). Not scored as a pass.`);
      return true;
    }
    // Restore a sane budget so the refund computes against the real capture.
    if (!NO_ACCOUNT_HELPER) await rest(`jobs?id=eq.${job.id}`, { method: "PATCH", body: { budget: originalBudget } });
    const refund = await invoke("create-payment", adminTok, { action: "admin_refund_dispute", jobId: job.id });
    const reasons = [];
    if (claimsAfterFail.length) reasons.push(`the failed release kept its claim: ${JSON.stringify(claimsAfterFail)}`);
    if (refund.status === 409 && refund.json?.heldBy) reasons.push(`the follow-up refund was locked out (heldBy=${refund.json.heldBy})`);
    if (!(refund.status === 200 && refund.json?.success)) reasons.push(`follow-up refund ${refund.status}:${JSON.stringify(refund.json)}`);
    const j = await judge(job, [{ status: "fulfilled", value: release }, { status: "fulfilled", value: refund }]);
    if (j.transfers > 0) reasons.push(`${j.transfers} transfer row(s) after a failed transfer`);
    if (j.refunds !== 1) reasons.push(`${j.refunds} refund rows`);
    if (!(j.row.status === "cancelled" && j.row.payment_status === "refunded")) reasons.push(`final ${j.row.status}/${j.row.payment_status}`);
    log("fail", i, reasons, j);
    return reasons.length > 0;
  } finally {
    await cleanup(job);
  }
}

await sleep(61_000); // drain the per-user throttle window (10 calls/min)
const tallies = { crossed: 0, same: 0, planted: 0, fail: 0 };
const counts = { crossed: 0, same: 0, planted: 0, fail: 0 };
const modes = MODE === "all" ? ["crossed", "same", "fail"] : [MODE];
let i = 0;
for (let k = 0; k < PIS.length; k++) {
  const mode = modes[k % modes.length];
  i++;
  await sleep(mode === "same" ? 21_000 : 14_000); // `same` makes 3-4 calls
  if (mode === "fail") {
    counts.fail++;
    if (await failRound(PIS[k], i)) tallies.fail++;
    continue;
  }
  const job = await fixture(PIS[k], `#${i}`);
  try {
    if (mode === "crossed") { counts.crossed++; if (await crossedRound(job, i)) tallies.crossed++; }
    else {
      // Odd rounds race for real; even rounds run the deterministic plant.
      if (counts.same <= counts.planted) { counts.same++; if (await sameRound(job, i)) tallies.same++; }
      else { counts.planted++; if (await plantedRound(job, i)) tallies.planted++; }
    }
  } finally {
    await cleanup(job);
  }
}
console.log(
  `\nRESULT ${Object.keys(counts).filter((m) => counts[m]).map((m) => `${m}=${tallies[m]}/${counts[m]}`).join(" ")} (admin ${ADMIN_ID})`,
);
