/**
 * SETTLE FORWARD — the disposition for a hired-AND-funded E2E leftover.
 *
 * WHY THIS EXISTS
 * ---------------
 * A `02-marketplace` / `prod-lifecycle` run that dies AFTER the hire leaves a
 * job `accepted`/`in_progress` with `payment_status = 'escrow'` and a Helpr on
 * it. There are exactly three things anyone has ever proposed doing with such a
 * row, and two of them are wrong:
 *
 *   create-payment { action: "cancel_escrow" }
 *       CORRECTLY refused, 409 `useCancelJob`. That door is an allowlist of
 *       `status = 'open'` with no `helper_id`: a hired job has a cancellation
 *       fee ladder a direct refund would skip. The teardown used to fire this
 *       and never read the answer, which is how five rows sat in escrow from
 *       2026-09-15 to 2026-09-22 with every nightly log saying OK.
 *
 *   rpc/poster_cancel_job
 *       Works, and is POISON. On a job a Helpr has accepted it records a
 *       `cancel_with_helper` STRIKE against the poster. Three strikes restrict
 *       `poster-e2e` for 7 days, which breaks every nightly journey that signs
 *       in as it. Decided against 2026-09-20 (lh-money-escrow review) and NOT
 *       relitigated here.
 *
 *   settle it FORWARD — this module.
 *       Walk the job the rest of the way down the path the product itself
 *       walks: arrival, the poster's confirmation, proof photos, the Helpr's
 *       Done, the poster's Release. Every leg is a real product door
 *       (`mark_helper_arrival`, `rpc_helper_mark_done`, `create-payment
 *       { action: "release" }`) driven by the seat that owns it, so the row
 *       lands in `payout_pending` the same way a SUCCESSFUL run's row does.
 *       No strike is recorded anywhere on either path.
 *
 * WHAT IT IS NOT ALLOWED TO TOUCH
 * -------------------------------
 * Nothing but a job that is (a) funded into escrow, (b) hired, (c) NOT under
 * dispute, and (d) owned by the caller pair. A disputed job's escrow is the
 * admin's to place — `cancel_escrow` says so itself — and settling one forward
 * behind them would pay out money a dispute was opened to stop. `assertSettleable`
 * refuses it, and the caller reports it rather than acting.
 *
 * IDEMPOTENT BY CONSTRUCTION. Every leg is skipped when its stamp is already
 * there, `mark_helper_arrival` and `rpc_helper_mark_done` both answer
 * "already" without writing, and `create-payment`'s release path answers
 * `alreadyReleased` on a settled job. Running this twice over the same row is a
 * no-op the second time; running it over a row somebody else settled in between
 * returns `alreadySettled`.
 *
 * NEEDS BOTH SEATS. The arrival and the Done belong to the Helpr and cannot be
 * forged from the poster's token (`enforce_helper_jobs_column_whitelist`,
 * `enforce_job_completion_server_owned`) — which is the point. So a caller with
 * only a poster token (prod-lifecycle-sweeper's deliberate posture) cannot use
 * this and must keep deferring.
 */

/** A 1×1 PNG — the same bytes e2e/journeys/fixtures.ts drives through the real picker. */
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** The completion gate's floor, and the margin we back-date past it. */
const MIN_JOB_TIME_MS = 30 * 60 * 1000;
const WORK_BACKDATE_MS = 40 * 60 * 1000;

/**
 * A lane that must keep a marker job alive past one run (a hired or funded
 * fixture held for a later leg, e.g. two-role-lifecycle's
 * PLAYWRIGHT_LIFECYCLE_JOB_ID) puts this in the title beside
 * "[E2E DO NOT ACCEPT]". Nothing here settles it, and prod-lifecycle-sweeper
 * does not touch it at all (lh-money-escrow review M3, 2026-09-25): the 6h age
 * gate bounds CI job timeouts, not a fixture held on purpose.
 */
export const E2E_HOLD_MARKER = "[E2E HOLD]";

/**
 * Why a row is held and must not be touched, or null.
 *
 * The title marker is the opt-in; the id is the fail-closed half. The two-role
 * harness's seeded job (secret PLAYWRIGHT_LIFECYCLE_JOB_ID) is held by id
 * whether or not its live title carries the marker, because nobody could read
 * that title when this was written (re-review of 5a22b3e10, 2026-09-25). Unset
 * or blank env holds nothing extra.
 *
 * @param {{ id?: string, title?: unknown }} job
 * @param {Record<string, string | undefined>} [env]
 */
export function heldReason(job, env = process.env) {
  const lifecycleId = (env.PLAYWRIGHT_LIFECYCLE_JOB_ID || "").trim();
  if (lifecycleId && job?.id === lifecycleId) return "the two-role fixture (PLAYWRIGHT_LIFECYCLE_JOB_ID)";
  if (typeof job?.title === "string" && job.title.includes(E2E_HOLD_MARKER)) return `${E2E_HOLD_MARKER} in the title`;
  return null;
}

/**
 * The refusal for a funded row with NO Checkout Session: create-payment's
 * gift-card path (redeem_gift_card) moves a job to escrow without one. Its
 * Stripe mode cannot be proven from the row, so it is never settled here, and
 * a sweep reports it as held rather than counting it as a failed settle.
 */
export const NO_CHECKOUT_SESSION = "no Checkout Session (funded another way, e.g. a gift card) — mode unprovable, never settled here";

/** Statuses a hired, funded job can still be settled forward from. */
export const SETTLEABLE_STATUSES = ["accepted", "in_progress", "revision_requested"];
/** Statuses that mean the money already moved — nothing left to settle. */
export const SETTLED_PAYMENT_STATUSES = ["payout_pending", "released", "refunded"];

/**
 * Does this `cancel_escrow` answer mean "hired and funded, settle it forward"?
 *
 * Deliberately the same predicate as `classifyCancelEscrow`'s "settle-forward"
 * arm in ./sweepSummary.mjs, so the teardown and the sweeper agree on what the
 * 409 means. Kept as its own export because the teardown needs the boolean
 * without the other three verdicts.
 *
 * @param {number} status
 * @param {string} body
 */
export function isSettleForwardRefusal(status, body = "") {
  return status === 409 && /"useCancelJob"\s*:\s*true/.test(body);
}

const JOB_COLUMNS = [
  "id",
  "title",
  "stripe_session_id",
  "status",
  "payment_status",
  "customer_id",
  "helper_id",
  "is_seed",
  "disputed_at",
  "has_active_dispute",
  "latitude",
  "longitude",
  "require_photo_proof",
  "proof_before_urls",
  "proof_after_urls",
  "helper_arrived_at",
  "poster_confirmed_arrival_at",
  "poster_confirmed_working_at",
  "helper_completed_at",
  "poster_completed_at",
].join(",");

function headers(anon, token, extra = {}) {
  return {
    apikey: anon,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function readBody(res) {
  const text = await res.text();
  return text.slice(0, 400);
}

/** Read the job as the poster. Throws with the HTTP answer rather than returning undefined. */
export async function readJobRow({ base, anon, posterToken, jobId }) {
  const res = await fetch(`${base}/rest/v1/jobs?id=eq.${jobId}&select=${JOB_COLUMNS}`, {
    headers: headers(anon, posterToken),
  });
  if (!res.ok) throw new Error(`reading job ${jobId}: HTTP ${res.status} ${await readBody(res)}`);
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error(`job ${jobId} not readable as the poster`);
  return rows[0];
}

/**
 * The blast-radius gate. Returns a reason string when the row must NOT be
 * settled, or null when it may be. Separate from the walk so a caller (and a
 * test) can ask the question without doing anything.
 *
 * @param {Record<string, any>} job
 * @param {{ posterId: string, helperId: string }} seats
 */
export function settleRefusalReason(job, seats) {
  if (!job) return "no job row";
  if (job.is_seed !== true) return "not an is_seed row — refusing to touch real money";
  if (job.customer_id !== seats.posterId) return `customer_id ${job.customer_id} is not the calling poster`;
  if (job.helper_id !== seats.helperId) return `helper_id ${job.helper_id} is not the calling helper`;
  // A disputed job's escrow belongs to the admin who will decide where it goes.
  // `cancel_escrow` refuses it for this reason and so does this.
  if (job.disputed_at || job.has_active_dispute) return "under dispute — the escrow is an admin's to place";
  if (SETTLED_PAYMENT_STATUSES.includes(job.payment_status)) return "already settled";
  const held = heldReason(job);
  if (held) return `held on purpose (${held})`;
  // Funded in Stripe TEST mode, proven by the row's own Checkout Session id
  // (lh-money-escrow review L2). A cs_live_ row is real money; a row funded
  // without a session (a gift card) is unprovable: neither is released here.
  if (job.stripe_session_id == null) return NO_CHECKOUT_SESSION;
  if (typeof job.stripe_session_id !== "string" || !job.stripe_session_id.startsWith("cs_test_")) {
    return `not funded through a test-mode Checkout Session (stripe_session_id ${String(job.stripe_session_id).slice(0, 8)}…)`;
  }
  if (job.payment_status !== "escrow") return `payment_status is ${job.payment_status}, not escrow`;
  if (!SETTLEABLE_STATUSES.includes(job.status)) return `status is ${job.status}`;
  return null;
}

async function post(base, path, hdrs, body) {
  const res = await fetch(`${base}${path}`, { method: "POST", headers: hdrs, body: JSON.stringify(body) });
  return {
    ok: res.ok,
    status: res.status,
    retryAfter: Number(res.headers.get("retry-after")) || null,
    body: await readBody(res),
  };
}

/**
 * 429 IS BACKPRESSURE, NOT A REFUSAL — the same lesson `classifyCancelEscrow`
 * carries. `create-payment` answers per-caller, so a queue of stranded rows
 * trips the limiter on the rows themselves and the remedy is entirely to wait.
 * Measured here on the first live run: the very first release came back
 * `{"error":"Too many requests. Please try again later."}` and the walk
 * reported it as a failed settlement.
 *
 * A RETRY POISONS THE WINDOW IT IS WAITING ON, so the wait is the WHOLE window
 * and not the server's `Retry-After`. `create-payment` allows 10 calls per 60s
 * and the limiter records the refused call too, so every impatient retry pushes
 * the window's expiry out by its own timestamp. Measured here: honouring the
 * 2-8s `Retry-After` produced six consecutive refusals, while one call per
 * minute went through first time. Back off for a full window plus slack, and
 * ask rarely.
 */
const RATE_WINDOW_MS = 65_000;

async function postWithBackoff(base, path, hdrs, body, { attempts = 3, log = () => {} } = {}) {
  let r = await post(base, path, hdrs, body);
  for (let attempt = 0; r.status === 429 && attempt < attempts; attempt++) {
    const waitMs = Math.max((r.retryAfter ?? 0) * 1000, RATE_WINDOW_MS);
    log(`    throttled on ${path}; waiting out the whole ${Math.round(waitMs / 1000)}s window`);
    await new Promise((res) => setTimeout(res, waitMs));
    r = await post(base, path, hdrs, body);
  }
  return r;
}

async function patchJob(base, anon, token, jobId, patch) {
  // Named column with the representation: bare `*` is refused since 20260915045110.
  const res = await fetch(`${base}/rest/v1/jobs?id=eq.${jobId}&select=id`, {
    method: "PATCH",
    headers: headers(anon, token, { Prefer: "return=representation" }),
    body: JSON.stringify(patch),
  });
  return { ok: res.ok, status: res.status, body: await readBody(res) };
}

/** Upload one 1×1 proof photo as the helper and return its signed URL. */
async function uploadProof({ base, anon, helperToken, jobId, type }) {
  const path = `${jobId}/${type}-${Date.now()}-${Math.random().toString(36).slice(2)}.png`;
  const up = await fetch(`${base}/storage/v1/object/proof-photos/${path}`, {
    method: "POST",
    headers: { apikey: anon, Authorization: `Bearer ${helperToken}`, "Content-Type": "image/png" },
    body: PNG_1PX,
  });
  if (!up.ok) throw new Error(`uploading ${type} proof: HTTP ${up.status} ${await readBody(up)}`);
  const signed = await fetch(`${base}/storage/v1/object/sign/proof-photos/${path}`, {
    method: "POST",
    headers: headers(anon, helperToken),
    body: JSON.stringify({ expiresIn: 60 * 60 * 24 * 365 }),
  });
  if (!signed.ok) throw new Error(`signing ${type} proof: HTTP ${signed.status} ${await readBody(signed)}`);
  const { signedURL, signedUrl } = await signed.json();
  const rel = signedURL ?? signedUrl;
  if (!rel) throw new Error(`signing ${type} proof returned no url`);
  return `${base}/storage/v1${rel}`;
}

/**
 * Walk one hired, funded leftover the rest of the way to `payout_pending`.
 *
 * @param {{
 *   base: string, anon: string,
 *   posterToken: string, helperToken: string,
 *   posterId: string, helperId: string,
 *   jobId: string,
 *   log?: (line: string) => void,
 * }} input
 * @returns {Promise<{ settled: boolean, reason: string, steps: string[], paymentStatus: string|null, status: string|null }>}
 */
export async function settleJobForward({ base, anon, posterToken, helperToken, posterId, helperId, jobId, log = () => {} }) {
  const steps = [];
  let job = await readJobRow({ base, anon, posterToken, jobId });

  const refusal = settleRefusalReason(job, { posterId, helperId });
  if (refusal) {
    const alreadySettled = refusal === "already settled";
    log(`    ${jobId}: ${alreadySettled ? "nothing to settle" : `NOT settling — ${refusal}`}`);
    return { settled: alreadySettled, reason: refusal, steps, paymentStatus: job.payment_status, status: job.status };
  }

  // 1. ARRIVAL — the Helpr's own RPC. It records the arrival on every path
  //    (verified when a fix is close enough or the job never geocoded, a bare
  //    claim otherwise) and never raises on distance, so this leg does not care
  //    where the runner is. It also walks accepted → in_progress.
  if (!job.helper_arrived_at) {
    const r = await post(base, "/rest/v1/rpc/mark_helper_arrival", headers(anon, helperToken), {
      p_job_id: jobId,
      p_lat: job.latitude,
      p_lng: job.longitude,
    });
    if (!r.ok) throw new Error(`mark_helper_arrival ${jobId}: HTTP ${r.status} ${r.body}`);
    steps.push("arrival");
  }

  // 2. THE POSTER CONFIRMS IT. `enforce_jobs_arrival_integrity` refuses this
  //    while `helper_arrived_at` is NULL, which is why it follows step 1 and
  //    never leads it.
  if (!job.poster_confirmed_arrival_at) {
    const r = await patchJob(base, anon, posterToken, jobId, {
      poster_confirmed_arrival_at: new Date().toISOString(),
    });
    if (!r.ok) throw new Error(`confirming arrival on ${jobId}: HTTP ${r.status} ${r.body}`);
    steps.push("poster-confirmed-arrival");
  }

  // 3. PROOF PHOTOS — before AND after, on every job whose poster asked for
  //    them (the default). Real objects in the real bucket under the job's own
  //    folder, uploaded by the Helpr, exactly as PhotoProof.tsx does it: a
  //    URL pointing at nothing would satisfy the trigger and leave the poster's
  //    own timeline broken.
  const needsProof = job.require_photo_proof !== false;
  if (needsProof) {
    for (const type of ["before", "after"]) {
      const column = type === "before" ? "proof_before_urls" : "proof_after_urls";
      if (Array.isArray(job[column]) && job[column].length > 0) continue;
      const url = await uploadProof({ base, anon, helperToken, jobId, type });
      const r = await patchJob(base, anon, helperToken, jobId, { [column]: [url] });
      if (!r.ok) throw new Error(`attaching the ${type} proof to ${jobId}: HTTP ${r.status} ${r.body}`);
      steps.push(`${type}-proof`);
    }
  }

  // 4. THE 30-MINUTE FLOOR. `rpc_helper_mark_done` measures it from
  //    COALESCE(poster_confirmed_working_at, helper_arrived_at), and step 1 may
  //    have stamped an arrival seconds ago. The poster owns the working stamp
  //    (it is not in either lock list for them), so back-date it past the floor
  //    rather than sleeping half an hour in a teardown. Same concession the
  //    journey itself makes, and the only one here.
  job = await readJobRow({ base, anon, posterToken, jobId });
  const anchor = job.poster_confirmed_working_at ?? job.helper_arrived_at;
  if (!job.helper_completed_at && anchor && Date.now() - Date.parse(anchor) < MIN_JOB_TIME_MS) {
    const r = await patchJob(base, anon, posterToken, jobId, {
      poster_confirmed_working_at: new Date(Date.now() - WORK_BACKDATE_MS).toISOString(),
    });
    if (!r.ok) throw new Error(`back-dating the work start on ${jobId}: HTTP ${r.status} ${r.body}`);
    steps.push("work-start-backdated");
  }

  // 5. THE HELPR'S DONE. Server clock, server gates, and `already_done` rather
  //    than an error on a second call.
  if (!job.helper_completed_at) {
    const r = await post(base, "/rest/v1/rpc/rpc_helper_mark_done", headers(anon, helperToken), { _job_id: jobId });
    if (!r.ok) throw new Error(`rpc_helper_mark_done ${jobId}: HTTP ${r.status} ${r.body}`);
    steps.push("helper-done");
  }

  // 6. THE POSTER'S RELEASE — the same call the Approve control makes. It
  //    stamps poster_completed_at, captures the (test-mode) charge and schedules
  //    the payout; payment_status lands on payout_pending.
  const released = await postWithBackoff(
    base,
    "/functions/v1/create-payment",
    headers(anon, posterToken),
    { action: "release", jobId },
    { log },
  );
  if (!released.ok) throw new Error(`release ${jobId}: HTTP ${released.status} ${released.body}`);
  steps.push("release");

  // 7. VERIFY BY THE ROW, NOT BY THE 200. The capture is asynchronous enough
  //    that an immediate read can still say 'escrow'.
  let final = job;
  for (let attempt = 0; attempt < 10; attempt++) {
    final = await readJobRow({ base, anon, posterToken, jobId });
    if (SETTLED_PAYMENT_STATUSES.includes(final.payment_status)) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  const settled = SETTLED_PAYMENT_STATUSES.includes(final.payment_status);
  log(
    `    ${jobId}: ${settled ? "settled forward" : "RELEASE ACCEPTED BUT NOT SETTLED"} ` +
      `(status=${final.status} payment=${final.payment_status}) via ${steps.join(" > ")}`,
  );
  return {
    settled,
    reason: settled ? "settled forward" : `payment_status stayed ${final.payment_status} after release`,
    steps,
    paymentStatus: final.payment_status,
    status: final.status,
  };
}
