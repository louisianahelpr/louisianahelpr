/**
 * Human copy for the preconditions our lifecycle RPCs enforce.
 *
 * These RPCs `RAISE EXCEPTION 'job_not_started'` (etc.) — deliberately terse,
 * machine-readable codes. The clients were funnelling every one of them into a
 * single generic "Couldn't do that — please try again", which is wrong twice
 * over: it hides a reason the user could act on, and "try again" is false
 * advice when the answer is "wait until the start time".
 *
 * Owner, 2026-08-25: "I'm trying to file a dispute but it's not letting me" /
 * "Also can't report no show". The guards were doing their job; nothing told
 * them so. (The no-show guards exist to close the R1 ban-abuse path — a poster
 * could otherwise ban any Helpr with two throwaway jobs — so they stay.)
 *
 * Unknown codes fall through to the caller's own fallback string.
 */
import { isWriteRejected } from "./mutationResult";

const LIFECYCLE_REASONS: Record<string, string> = {
  // report_helper_no_show
  job_not_funded:
    "You can report a no-show once the job's payment is secured. This one isn't funded yet.",
  job_not_started:
    "It's not the scheduled start time yet — you can report a no-show once it passes.",
  already_reported: "A no-show has already been reported for this job.",
  no_helper_assigned: "No Helpr has been assigned to this job yet.",
  not_authorized: "Only the person who posted this job can do that.",
  job_not_found: "We couldn't find that job.",
  // dispute paths
  dispute_already_open: "There's already an open dispute on this job.",
  dispute_window_closed:
    "The dispute window for this job has closed. Contact support and we'll take a look.",
  // No RPC raises this today. It used to say a dispute opens once the work is
  // complete, which is the opposite of the rule (owner, 2026-09-14: done is
  // final), so it now says only what the code means.
  job_not_completed: "This job hasn't been marked complete yet.",
  // open_dispute_as, migration 20260915025607: a party filing (or appending
  // to) a dispute on a completed job. Done is final (owner, 2026-09-14).
  job_already_completed: "This job is finished, so it can't be disputed.",
  // rpc_open_dispute, migration 20260907032552. QA filed a dispute with the
  // description box empty on 2026-09-06 and it was accepted: the stored reason
  // was the literal "Other:" and an escrow froze for 72 hours on it. The RPC
  // rejects that now, so the dialog needs a sentence for it — a caller that
  // somehow gets past the client gate should be told what is missing, not
  // handed raw Postgres prose.
  dispute_needs_description:
    "Tell us what happened first — a dispute holds someone's payment, and an admin decides it from your description.",
};

// Sentences more than one RPC needs, written once so they cannot drift.
const JOB_GONE = "This job no longer exists. Refresh and check.";
const NO_LONGER_BOOKED_STATUS = "You're no longer booked on this job, so your status can't be updated.";
const JOB_NOT_ACTIVE_STATUS = "This job isn't active any more, so your status can't be updated.";
const ACCEPT_REASONS = {
  job_not_open: "This job is no longer open — it may already be assigned.",
  application_not_found: "This application no longer exists — the applicant may have withdrawn.",
  application_not_pending: "This applicant can no longer be accepted.",
  not_authorized: "You can only accept applicants on a job you posted.",
} as const;

/**
 * PER-RPC copy for every custom code a client-called RPC raises.
 *
 * WHY PER RPC, NOT PER CODE. One code means different things behind different
 * doors. `job_already_completed` from `rpc_open_dispute` means "you can't
 * dispute a finished job"; the same code surfacing through `helper_abort_job`
 * means "you can't cancel it, it was just marked complete". `not_authorized`
 * is "only the person who posted this job" on a no-show report and "you're no
 * longer booked on this job" on a Helpr's cancel. A single code→copy table
 * says the wrong thing at one of the two.
 *
 * Every entry here is checked against the migrations by
 * `src/test/rpcErrorCopyCoverage.test.ts`: each code a client-called RPC can
 * raise (its latest definition plus the functions it calls) must be mapped
 * here or allowlisted there with a reason, every call site must read this
 * table through `rpcErrorMessage` / `rpcErrorCode`, and an entry for a code
 * the RPC no longer raises fails too.
 *
 * Copy rules: never addressed to one role, "Helpr" spelled so, and done is
 * final — nothing here sends anyone to support about a completed job.
 */
export const RPC_ERROR_COPY = {
  // useOfferHandlers — accepting an applicant (single and group).
  accept_application: { ...ACCEPT_REASONS },
  accept_group_application: {
    ...ACCEPT_REASONS,
    roster_full: "Every spot on this job is already filled, so no one else can be added.",
    not_a_group_job: "This job isn't set up as a group job any more. Refresh and try again.",
    invalid_helpers_needed:
      "This job doesn't say how many people it needs. Edit the job to set that, then try again.",
  },
  // useOfferHandlers — responding to a direct offer.
  respond_to_direct_offer: {
    offer_expired: "This offer expired — the job is open to everyone again.",
    offer_not_pending: "This offer isn't yours to respond to any more.",
    not_your_offer: "This offer isn't yours to respond to any more.",
    job_not_open: "This job is no longer open.",
    job_not_found: "This job is no longer available.",
  },
  // useOfferHandlers — declining an accepted offer.
  decline_job_offer: {
    offer_not_active: "This job isn't yours to respond to any more — someone else may have been booked.",
    application_not_found: "This offer no longer exists — the job may have been removed.",
    not_authorized: "This offer isn't yours to respond to.",
  },
  // useApplyFlow — the apply rate limits.
  apply_to_job: {
    rate_limit_minute: "Slow down — you can apply again in a minute.",
    rate_limit_hour: "You've applied to a lot of jobs this hour — try again in a bit.",
    rate_limit_day: "You've hit today's application limit — check back tomorrow.",
  },
  // CancellationDialog.
  poster_cancel_job: {
    not_cancellable:
      "This job couldn't be cancelled — it may have already been cancelled, finished, or opened as a dispute. Refresh and check.",
    not_authorized: "Only the person who posted this job can cancel it.",
    job_not_found: JOB_GONE,
    not_authenticated: "Please sign in again to cancel this job.",
  },
  // ConfirmedSection — cancelling a booking before the start.
  helper_cancel_booking: {
    job_already_started: "The start time has passed — message the poster or contact support instead.",
    not_cancellable:
      "This booking can't be cancelled any more — the job has already moved on. Refresh to see where it stands.",
    job_not_found: JOB_GONE,
    not_authorized: "You're no longer booked on this job, so there's nothing to cancel.",
  },
  // ActiveJobSection — Cancel Job once work is underway.
  helper_abort_job: {
    not_abortable: "This job has already moved on — pull to refresh and take another look.",
    // Raised by open_dispute_as (via rpc_open_dispute) when the job was
    // marked complete in the moment before this Cancel Job landed. Done is
    // final (owner, 2026-09-14): say what happened, no support detour.
    job_already_completed: "This job was just marked complete, so it can't be cancelled.",
    // Also open_dispute_as: a reason that ends in a colon reads as empty.
    dispute_needs_description: "Add a little more about why you can't finish, then try again.",
    job_not_found: JOB_GONE,
    not_authorized: "You're no longer booked on this job, so it can't be cancelled from here.",
  },
  // JobTracking — "I'm On My Way" and arrival check-in.
  helper_mark_on_the_way: {
    job_not_found: JOB_GONE,
    not_the_assigned_helper: NO_LONGER_BOOKED_STATUS,
    job_not_active: JOB_NOT_ACTIVE_STATUS,
    helper_not_confirmed: "Confirm this booking first, then mark yourself on the way.",
  },
  mark_helper_arrival: {
    job_not_found: JOB_GONE,
    not_the_assigned_helper: NO_LONGER_BOOKED_STATUS,
    job_not_active: JOB_NOT_ACTIVE_STATUS,
  },
  // userBlocks — block and settle shared jobs.
  block_user_and_settle: {
    invalid_target: "You can't block this account.",
  },
  // RecipientPicker — gift-card recipient name search.
  search_profiles_by_name: {
    rate_limit_minute: "Too many searches in a row. Wait a minute, or type their email address instead.",
    rate_limit_day: "You've reached today's search limit. Type their email address instead, or try again tomorrow.",
  },
  // UserAuditLog (admin).
  admin_reverse_violation: {
    not_authorized: "You don't have permission to reverse this.",
    violation_not_found: "That strike no longer exists — it may already have been reversed. Refresh the log.",
  },
  // useLifecycleHandlers — the shared lifecycle sentences, unchanged.
  report_helper_no_show: {
    job_not_found: LIFECYCLE_REASONS.job_not_found,
    not_authorized: LIFECYCLE_REASONS.not_authorized,
    no_helper_assigned: LIFECYCLE_REASONS.no_helper_assigned,
    job_not_funded: LIFECYCLE_REASONS.job_not_funded,
    job_not_started: LIFECYCLE_REASONS.job_not_started,
    already_reported: LIFECYCLE_REASONS.already_reported,
  },
  // DisputeDialog.
  rpc_open_dispute: {
    dispute_needs_description: LIFECYCLE_REASONS.dispute_needs_description,
    job_already_completed: LIFECYCLE_REASONS.job_already_completed,
  },
} satisfies Record<string, Record<string, string>>;

export type MappedRpc = keyof typeof RPC_ERROR_COPY;
export type RpcErrorCode<R extends MappedRpc> = Extract<keyof (typeof RPC_ERROR_COPY)[R], string>;

function rawMessage(error: unknown): string {
  if (typeof error === "string") return error;
  const m = (error as { message?: unknown } | null)?.message;
  return typeof m === "string" ? m : "";
}

/**
 * The code `rpc` raised, when it is one we have copy for; `null` otherwise.
 * Matched as a whole token so `not_authorized` never fires on a longer code
 * that happens to contain it.
 */
export function rpcErrorCode<R extends MappedRpc>(rpc: R, error: unknown): RpcErrorCode<R> | null {
  const raw = rawMessage(error);
  if (!raw) return null;
  for (const code of Object.keys(RPC_ERROR_COPY[rpc])) {
    if (new RegExp(`(^|[^a-z0-9_])${code}($|[^a-z0-9_])`).test(raw)) return code as RpcErrorCode<R>;
  }
  return null;
}

/**
 * Human copy for an error `rpc` returned, or `null` when it is not a code we
 * have wording for (so the caller keeps its own fallback).
 */
export function rpcErrorMessage(rpc: MappedRpc, error: unknown): string | null {
  const code = rpcErrorCode(rpc, error);
  return code ? (RPC_ERROR_COPY[rpc] as Record<string, string>)[code] : null;
}

/**
 * Map a Postgres/PostgREST error onto human copy, or `null` when the code is
 * not one we have specific wording for (so the caller keeps its own fallback).
 */
export function lifecycleErrorMessage(error: unknown): string | null {
  // A write that matched zero rows carries its own human sentence (see
  // mutationResult.ts). It never has a Postgres code to match on, so it has to
  // be handled before the code table.
  if (isWriteRejected(error)) return error.userMessage;

  const raw =
    typeof error === "string"
      ? error
      : ((error as { message?: string } | null)?.message ?? "");
  if (!raw) return null;
  for (const [code, copy] of Object.entries(LIFECYCLE_REASONS)) {
    // Postgres wraps the code in its own prose, so match on containment
    // rather than equality.
    if (raw.includes(code)) return copy;
  }
  return null;
}
