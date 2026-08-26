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
  job_not_completed: "You can open a dispute once the work has been marked complete.",
};

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
