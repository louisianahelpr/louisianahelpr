/**
 * The reasons each side of a job may give for opening a dispute, and the floor
 * on the description that goes with them.
 *
 * Pure data + one selector, in its own module for the same reason
 * `shouldShowDisputeLink` lives beside its component: the rules are what the
 * test needs, and importing DisputeDialog.tsx to reach them would drag in the
 * Supabase client, sonner and the haptics bridge for a string comparison.
 */

/**
 * Which side of the job is filing. A dispute is not a symmetric object: the
 * poster is contesting the WORK, the helper is contesting the JOB or the
 * poster's conduct, and until 2026-09-06 both were handed the poster's five
 * reasons.
 *
 * External QA, on the helper's completed job: "Work was not done · Poor quality
 * work · Helpr didn't show up · Work was left incomplete · Other". Every one is
 * an accusation against the helper, offered to the helper. A helper with a real
 * problem — wrong address, unsafe site, poster refusing to confirm, scope
 * doubled on arrival — could only pick "Other", which is exactly the value that
 * carries no information, on the one field an admin decides the case from.
 * Production still holds the row that produced: `disputes.reason = 'Other:'`
 * on job 8133a907-f36f-4278-96c4-41d4ce1d56c8, filed by the helper.
 */
export type DisputeSide = "poster" | "helper";

export interface DisputeReason {
  value: string;
  label: string;
}

const POSTER_REASONS: readonly DisputeReason[] = [
  { value: "work_not_done", label: "Work was not done" },
  { value: "poor_quality", label: "Poor quality work" },
  { value: "no_show", label: "Helpr didn't show up" },
  { value: "incomplete", label: "Work was left incomplete" },
  { value: "other", label: "Other" },
];

/**
 * The helper's side. Each entry is a situation that had no option but "Other"
 * before 2026-09-06; "Other" survives as the genuine catch-all, not as the
 * only honest answer.
 */
const HELPER_REASONS: readonly DisputeReason[] = [
  { value: "poster_wont_confirm", label: "Poster won't confirm the work is done" },
  { value: "job_not_as_described", label: "Job wasn't what was described" },
  { value: "scope_changed", label: "Asked to do work outside the job" },
  { value: "no_access", label: "Couldn't get access to the property" },
  { value: "unsafe_site", label: "Site was unsafe or unsuitable" },
  { value: "poster_no_show", label: "Poster wasn't there or wouldn't respond" },
  { value: "other", label: "Other" },
];

export const disputeReasonsFor = (side: DisputeSide): readonly DisputeReason[] =>
  side === "helper" ? HELPER_REASONS : POSTER_REASONS;

/**
 * The floor on "What happened?".
 *
 * QA filed a dispute with the box empty and it was accepted: `disputes.reason`
 * came out as the literal string "Other:" — label, colon, nothing — and that is
 * what the counterparty, the timeline, the admin queue and the Slack ops page
 * were all shown, while a 72-hour escrow freeze ran on the strength of it. The
 * RESPONSE side of the same flow was already gated (DisputedSection's Submit
 * stays disabled until you type); only the filing half, the half that moves
 * money, was open.
 *
 * Enforced on EVERY reason, not just "Other" — "Poor quality work" on its own
 * is no more decidable than "Other" is. `rpc_open_dispute` enforces its own,
 * looser, label-agnostic floor server-side (migration 20260907032552); this is
 * the product bar, that one is the control.
 */
export const DISPUTE_DETAILS_MIN = 10;

/** Composed exactly as it is stored in `disputes.reason` / `jobs.dispute_reason`. */
export const composeDisputeReason = (
  side: DisputeSide,
  value: string,
  details: string,
): string => {
  const label = disputeReasonsFor(side).find((r) => r.value === value)?.label;
  return `${label}: ${details.trim()}`.trim();
};
