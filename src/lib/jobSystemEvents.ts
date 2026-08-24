/**
 * jobSystemEvents — derive in-thread system messages from a job's
 * status-transition timestamps.
 *
 * The Messages page renders these as styled, centered `<div>` rows
 * (NOT real message bubbles) interleaved chronologically with the
 * real `messages` rows. They give both participants shared, in-thread
 * context for what happened on the job ("Helper marked on the way",
 * "Poster confirmed the job complete", "Job cancelled by poster") so
 * they don't have to jump to /my-jobs to see state changes.
 *
 * This is a pure derivation — no schema changes, no separate audit
 * table. The `jobs` table already records each transition's timestamp
 * (helper_on_the_way_at, helper_completed_at, cancelled_at, …); we
 * surface them in the thread.
 */

export type JobSystemEventKind =
  | "helper_on_the_way"
  | "helper_arrived"
  | "helper_completed"
  | "poster_confirmed_completed"
  | "revision_requested"
  | "cancelled"
  | "disputed";

export interface JobSystemEvent {
  /** Stable id so the thread render can key on it (system-<kind>-<jobId>). */
  id: string;
  kind: JobSystemEventKind;
  at: string;
  /** Pre-rendered, voice-checked copy — kept here so the renderer stays
   *  a thin <div> with no branching on event kind. */
  label: string;
}

/**
 * The subset of `public.jobs` fields needed to derive system events.
 * Kept narrow so callers (Messages.tsx openConvo) can hand-pick the
 * select list rather than dragging in every job column.
 */
export interface JobTimestamps {
  cancelled_at: string | null;
  cancelled_by: string | null;
  customer_id: string;
  helper_arrived_at: string | null;
  helper_completed_at: string | null;
  helper_id: string | null;
  helper_on_the_way_at: string | null;
  poster_completed_at: string | null;
  revision_requested_at: string | null;
  disputed_at: string | null;
  disputed_by: string | null;
}

/**
 * Produce one short, sentence-case label per non-null transition.
 * Cancellation copy adapts to who cancelled (poster vs helper) using
 * `cancelled_by`; dispute copy uses `disputed_by` the same way.
 */
export function deriveJobSystemEvents(
  job: JobTimestamps | null | undefined,
  jobId: string,
): JobSystemEvent[] {
  if (!job) return [];
  const out: JobSystemEvent[] = [];

  if (job.helper_on_the_way_at) {
    out.push({
      id: `system-helper_on_the_way-${jobId}`,
      kind: "helper_on_the_way",
      at: job.helper_on_the_way_at,
      label: "Helpr marked on the way.",
    });
  }
  if (job.helper_arrived_at) {
    out.push({
      id: `system-helper_arrived-${jobId}`,
      kind: "helper_arrived",
      at: job.helper_arrived_at,
      label: "Helpr arrived at the location.",
    });
  }
  if (job.helper_completed_at) {
    out.push({
      id: `system-helper_completed-${jobId}`,
      kind: "helper_completed",
      at: job.helper_completed_at,
      label: "Helpr marked the job complete.",
    });
  }
  if (job.poster_completed_at) {
    out.push({
      id: `system-poster_confirmed_completed-${jobId}`,
      kind: "poster_confirmed_completed",
      at: job.poster_completed_at,
      label: "Poster confirmed the job complete.",
    });
  }
  if (job.revision_requested_at) {
    out.push({
      id: `system-revision_requested-${jobId}`,
      kind: "revision_requested",
      at: job.revision_requested_at,
      label: "Poster requested a revision.",
    });
  }
  if (job.cancelled_at) {
    const who =
      job.cancelled_by === job.customer_id
        ? "poster"
        : job.cancelled_by === job.helper_id
          ? "helper"
          : null;
    out.push({
      id: `system-cancelled-${jobId}`,
      kind: "cancelled",
      at: job.cancelled_at,
      label: who
        ? `Job cancelled by ${who === "poster" ? "poster" : "Helpr"}.`
        : "Job was cancelled.",
    });
  }
  if (job.disputed_at) {
    const who =
      job.disputed_by === job.customer_id
        ? "poster"
        : job.disputed_by === job.helper_id
          ? "helper"
          : null;
    out.push({
      id: `system-disputed-${jobId}`,
      kind: "disputed",
      at: job.disputed_at,
      label: who
        ? `${who === "poster" ? "Poster" : "Helpr"} opened a dispute.`
        : "A dispute was opened.",
    });
  }

  return out;
}
