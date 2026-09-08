/**
 * The write that stands between a paid helper and a job that still looks payable.
 *
 * Both payout paths — `release-payout` (admin button / auto-release Phase 2)
 * and `process-scheduled-payouts` (the cron) — end the same way: Stripe has
 * already moved the money, and one UPDATE has to say so. A failure there is not
 * "the request failed", it is a SPLIT STATE: real dollars out of the platform
 * balance against a job that every other reader still treats as payable.
 *
 * ─── TC-008, the incident this module exists for ────────────────────────────
 *
 * Transfer `tr_3UDDZQKp2H4b7tEC13IlnQEy` ($22.00) settled for job 0021b7d3 and
 * `payout_transfers` recorded it `paid`. The follow-up flip came back
 * `57014 canceling statement due to statement timeout`, so the function
 * returned 500 and the job kept reading 'payout_pending'.
 *
 * Nothing was wrong with the statement. Measured against prod in a rolled-back
 * block it completes in ~22ms. The project was simply saturated in that window
 * — `postgres_logs` shows a 57014 roughly every 15 seconds across it — and
 * PostgREST connects as `authenticator`, which carries `statement_timeout=8s`.
 * One unlucky wait was enough to strand a real payout.
 *
 * So the TRANSIENT class is retried instead of alarmed on. 57014 (statement
 * timeout), 55P03 (lock not available), 40001 (serialization failure) and
 * 40P01 (deadlock) all mean "try again in a moment".
 *
 * Everything else fails LOUDLY on the first attempt, unretried — above all the
 * zero-row match, which is a null `error` with an empty array and means the row
 * legitimately left the releasable set (a refund or chargeback moved it out
 * from under us). Retrying that would only delay the alert on the one case an
 * operator must see immediately, and hammering it could not change the answer.
 */

/**
 * Job payment states a payout path may legitimately walk forward to 'released'.
 *
 * 'payout_pending' is the normal one. 'released' stays in the set so a resumed
 * run — the transfer already settled, the flip already happened, and the whole
 * thing is being retried — is a clean no-op rather than a false alarm. That is
 * also what makes this helper safe to call on the HEALING path. Every other
 * state ('chargeback', 'refunded', 'escrow') means something else owns this
 * job's money now, and the flip must NOT happen.
 */
export const RELEASABLE_PAYMENT_STATES = ["payout_pending", "released"] as const;

/** Postgres error codes worth another attempt. Everything else is a real refusal. */
export const TRANSIENT_PG_CODES = new Set(["57014", "55P03", "40001", "40P01"]);

/** Backoff between flip attempts. Four attempts total, ~5.9s worst case. */
const FLIP_RETRY_DELAYS_MS = [400, 1500, 4000];

export type FlipResult =
  | { ok: true }
  | { ok: false; zeroRow: boolean; message: string; attempts: number };

/**
 * Flip a paid-out job to 'released', retrying only a transient database fault.
 *
 * `extraFields` carries whatever else that path stamps alongside the status —
 * the tier-resolved commission, usually. It is deliberately caller-supplied and
 * may be empty: a HEALING call (the transfer was sent by an earlier run, and
 * this one never recomputed the tier) must NOT guess those numbers, because
 * writing a guess would overwrite the values the paid transfer was actually
 * built from. `process-scheduled-payouts` omits them on group jobs for a
 * related reason — they are per-helper values on a row shared by N helpers.
 */
export async function flipJobToReleased(
  supabaseAdmin: { from: (t: string) => any },
  jobId: string,
  extraFields: Record<string, unknown> = {},
): Promise<FlipResult> {
  let lastMessage = "zero rows matched";
  let lastZeroRow = true;
  for (let attempt = 0; attempt <= FLIP_RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, FLIP_RETRY_DELAYS_MS[attempt - 1]));
    }
    const { data, error } = await supabaseAdmin
      .from("jobs")
      .update({ payment_status: "released", ...extraFields })
      .eq("id", jobId)
      .in("payment_status", [...RELEASABLE_PAYMENT_STATES])
      .select("id");
    if (!error && data && data.length > 0) return { ok: true };
    // A null `error` with an empty array is the zero-row match, NOT a success.
    lastZeroRow = !error;
    lastMessage = (error as { message?: string } | null)?.message ?? "zero rows matched";
    if (lastZeroRow) break;
    if (!TRANSIENT_PG_CODES.has(String((error as { code?: string }).code ?? ""))) break;
    console.warn(
      `[releaseFlip] jobs flip to released hit transient ${(error as { code?: string }).code} for job ${jobId} (attempt ${attempt + 1}); retrying`,
    );
  }
  return {
    ok: false,
    zeroRow: lastZeroRow,
    message: lastMessage,
    attempts: FLIP_RETRY_DELAYS_MS.length + 1,
  };
}
