/**
 * statusLabels — the single source of truth for human-readable labels of
 * the `job_status` and `application_status` enums.
 *
 * Why this exists: the same state must read the same way everywhere
 * (chips, filters, headers, admin tables). Before this module, "in_progress"
 * rendered as "In Progress" in StatusBadge / JobHistory / activity filters,
 * but as "Awarded" or "Done" in the messages list and chat header — same
 * state, three different labels. Closes #46.
 *
 * House voice: sentence case (we capitalize only the first word). Match the
 * canonical labels below exactly; do NOT introduce synonyms ("Awarded",
 * "Done", "Selected", etc.) for an existing enum value.
 *
 * Usage:
 *   import { jobStatusLabel, applicationStatusLabel } from "@/lib/statusLabels";
 *   jobStatusLabel("in_progress")         // → "In progress"
 *   applicationStatusLabel("rejected")    // → "Declined"
 */

import type { Database } from "@/integrations/supabase/types";

export type JobStatus = Database["public"]["Enums"]["job_status"];
/**
 * The DB enum is `pending | accepted | rejected`, but the UI flow surfaces
 * a `withdrawn` state for applications the helper has retracted (see the
 * "Withdraw application" button in `AppliedJobCard`). The wider type keeps
 * the label table covering every value the UI may render.
 */
export type ApplicationStatus =
  | Database["public"]["Enums"]["application_status"]
  | "withdrawn";

/**
 * Canonical labels for the `job_status` Postgres enum. Sentence case.
 * Keys MUST match the enum values exactly — they are the source of truth
 * for what every chip/filter/badge displays for that state.
 */
export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  open: "Open",
  accepted: "Accepted",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
  revision_requested: "Revision requested",
  disputed: "Disputed",
  pending_approval: "Awaiting approval",
};

/**
 * Canonical labels for the `application_status` enum. Note the deliberate
 * rename: the DB value `rejected` reads as "Declined" — softer language
 * for a sensitive moment, matching the house voice already used in
 * PostedJobsTab / useActivityActions.
 */
export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  pending: "Pending",
  accepted: "Accepted",
  rejected: "Declined",
  withdrawn: "Withdrawn",
};

/** Format an unknown enum value as a fallback ("foo_bar" → "Foo bar"). */
function humanize(value: string): string {
  if (!value) return "";
  const spaced = value.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/**
 * Look up the canonical label for a job status. Unknown values fall back
 * to a humanized form rather than throwing — chip rendering must never
 * crash the page if a new enum value lands ahead of a client deploy.
 */
export function jobStatusLabel(status: string | null | undefined): string {
  if (!status) return "";
  return JOB_STATUS_LABELS[status as JobStatus] ?? humanize(status);
}

/**
 * Look up the canonical label for an application status. Same fallback
 * semantics as `jobStatusLabel`.
 */
export function applicationStatusLabel(status: string | null | undefined): string {
  if (!status) return "";
  return APPLICATION_STATUS_LABELS[status as ApplicationStatus] ?? humanize(status);
}

/**
 * Canonical labels for Stripe payout statuses and the `payout_transfers`
 * ledger status column. "in_transit" must never leak as "In_transit" via
 * CSS `capitalize` — route all payout-status rendering through here.
 */
export const PAYOUT_STATUS_LABELS: Record<string, string> = {
  paid: "Paid",
  in_transit: "In transit",
  pending: "Pending",
  failed: "Failed",
  canceled: "Canceled",
  reversed: "Reversed",
};

export function payoutStatusLabel(status: string | null | undefined): string {
  if (!status) return "";
  return PAYOUT_STATUS_LABELS[status] ?? humanize(status);
}

/**
 * Canonical labels for the `jobs.payment_status` column.
 * "payout_pending" and "escrow" must never render raw in UI.
 */
export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  unpaid: "Unpaid",
  escrow: "In escrow",
  payout_pending: "Payout pending",
  released: "Released",
  refunded: "Refunded",
  cancelled: "Cancelled",
};

export function paymentStatusLabel(status: string | null | undefined): string {
  if (!status) return "";
  return PAYMENT_STATUS_LABELS[status] ?? humanize(status);
}
