/**
 * Board 141 (docs/OPEN.md Q2272): the plain words for every code the two
 * refund-request RPCs can raise (migration 20261021102943), at their call
 * sites. Kept OUT of src/lib/lifecycleErrors.ts on purpose: that table sits in
 * the signed-in-shared chunk on /posts' critical path (Q178), and this copy is
 * read only by the refund dialogs, which load on demand.
 *
 * EXACT, both ways: src/test/rpcErrorCopyCoverage.test.ts reads each RPC's
 * codes (its newest definition and every function it calls) against this
 * table, and needs each call site to read its copy through
 * `rpcErrorMessage("<rpc>", e)` (this file's, the same whole-token match as
 * lifecycleErrors' one).
 */

const SCHEDULE = {
  not_authorized: "Only the two people on this job can ask to change its date or time.",
  job_not_found: "This job no longer exists. Refresh to see your jobs as they are.",
  schedule_change_not_one_time: "A recurring series keeps its schedule, so coming back to finish can't be offered this way.",
  schedule_change_not_booked: "The job is already under way, so a new time can't be offered. Agree to the refund or say you don't agree.",
  schedule_change_too_late: "The job has already started, so a new time can't be offered. Agree to the refund or say you don't agree.",
  schedule_change_in_past: "Pick a date and time that are still ahead.",
  schedule_change_too_soon: "Pick a time at least an hour from now, so they have time to answer.",
  schedule_change_same: "That's the date and time the job already has. Pick a new time to come back.",
  schedule_change_invalid: "Pick a date to come back.",
  schedule_change_clash: "You already have another booked job at that time. Pick a different time.",
} as const;

const JOB = {
  refund_request_job_not_found: "This job no longer exists. Refresh to see your jobs as they are.",
  refund_request_crew_job: "A crew job's money is decided member by member, so ask for help with Something's not right instead.",
  refund_request_not_one_time: "A repeating job's visits are paid one by one, so ask for help with Something's not right instead.",
  refund_request_no_helpr: "Nobody is booked on this job, so there's no one to ask.",
  refund_request_job_not_active: "This job has moved on, so a refund can't be asked or answered here any more. Refresh to see it as it is.",
  refund_request_not_held: "The money for this job isn't being held any more, so there's nothing to give back from here.",
  refund_request_dispute_open: "Helpr is already deciding a problem on this job, so the money waits for that decision.",
} as const;

const COMMON = {
  feature_disabled: "Refund requests aren't open to your account yet.",
  not_authenticated: "Please sign in again.",
  account_restricted: "Your account is restricted, so you can't do this right now.",
  refund_request_invalid: "Something was missing from that request. Close it and try again.",
} as const;

export const REFUND_RPC_ERROR_COPY = {
  rpc_open_refund_request: {
    ...COMMON,
    ...JOB,
    refund_request_not_poster: "Only the person who posted and paid for this job can ask for money back.",
    refund_request_helpr_not_enabled: "Refund requests can't be sent to this Helpr yet. Use Something's not right instead.",
    refund_request_already_open: "You've already asked for money back on this job. Wait for their answer.",
    refund_request_limit: "You've asked for a refund on this job 3 times. Use Something's not right if it still isn't sorted.",
    refund_request_no_price: "This job has no price to give back from.",
    refund_request_amount_invalid: "Ask for at least $1 and less than the whole price, or pick All of it.",
    refund_request_needs_reason: "Tell them what happened in a sentence or two.",
    refund_request_reason_too_long: "Keep what happened to 1,000 characters.",
  },
  rpc_answer_refund_request: {
    ...COMMON,
    ...JOB,
    ...SCHEDULE,
    refund_request_not_found: "That request no longer exists. Refresh to see the job as it is.",
    refund_request_not_yours: "Only the Helpr who was asked can answer this request.",
    refund_request_answered: "This request has already been answered. Refresh to see the job as it is.",
    refund_request_poster_gone: "The person who asked is no longer on Louisiana Helpr, so there's nothing to answer.",
    refund_request_expired: "The 2 days to answer have passed, so Helpr will decide this one.",
    refund_request_stale: "The job's price changed after they asked, so this request can't be agreed. Refresh and check.",
    refund_request_needs_time: "Pick a day and time to come back and finish.",
  },
  rpc_withdraw_refund_request: {
    feature_disabled: COMMON.feature_disabled,
    not_authenticated: COMMON.not_authenticated,
    refund_request_invalid: COMMON.refund_request_invalid,
    refund_request_not_found: "That request no longer exists. Refresh to see the job as it is.",
    refund_request_not_poster: "Only the person who asked can withdraw this request.",
    refund_request_answered: "This request has already been answered or settled, so it can't be withdrawn. Refresh to see the job as it is.",
  },
} satisfies Record<string, Record<string, string>>;

export type RefundRpc = keyof typeof REFUND_RPC_ERROR_COPY;

/**
 * Words for an error a refund-request RPC returned, or null when it is not a
 * code we have words for. Matched as a whole token, as lifecycleErrors does.
 */
export function rpcErrorMessage(rpc: RefundRpc, error: unknown): string | null {
  const m = typeof error === "string" ? error : (error as { message?: unknown } | null)?.message;
  const raw = typeof m === "string" ? m : "";
  if (!raw) return null;
  const table: Record<string, string> = REFUND_RPC_ERROR_COPY[rpc];
  // Longest code first, so a code that contains another (job_not_found inside
  // refund_request_job_not_found) is matched as itself.
  for (const code of Object.keys(table).sort((a, b) => b.length - a.length)) {
    if (new RegExp(`(^|[^a-z0-9_])${code}($|[^a-z0-9_])`).test(raw)) return table[code];
  }
  return null;
}
