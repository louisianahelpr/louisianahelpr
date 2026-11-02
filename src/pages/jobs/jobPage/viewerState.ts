/**
 * What the job page offers the person looking at it (owner bug 2026-10-21: a member who had ALREADY applied
 * still saw the big "Apply"). One table, every viewer state, the same truth the Home card uses
 * ("Waiting on Lexi · You applied"). Pinned by viewerState.test.ts.
 */
import { isExpiredListing } from "@/lib/expiredListing";
import { jobStartDateTime } from "@/lib/dateUtils";

/** What an applicant (or anyone not on the job) reads on a listing that expired with nobody hired (Q2595). */
const EXPIRED_BEFORE_HIRE = "This job expired before anyone was hired.";

export type ViewerAction =
  | { kind: "apply" }
  | { kind: "view_application" }
  | { kind: "see_offer" }
  | { kind: "open_working" }
  | { kind: "manage" }
  | { kind: "none" };

export function jobPageViewerState(o: {
  isPoster: boolean;
  userId: string | null;
  job: { status: string | null; helper_id: string | null; helper_confirmed_at?: string | null; cancellation_reason?: string | null; cancelled_by?: string | null; date_needed?: string | null; start_time?: string | null };
  /** The viewer's own application, when they applied; undefined while it loads. updated_at: when it closed (Q2673). */
  myApplication: { status: string; closed_reason: string | null; updated_at?: string | null } | null | undefined;
  /** The poster's first name, for "Waiting on Lexi". */
  posterFirst: string | null;
  /** On this crew job's roster (group_job_helpers): hired, though a crew job's helper_id is null (A2-B8). */
  onCrew?: boolean;
  /** A pending direct offer to this viewer (JOBS-18): they never applied, so no application says so. */
  offeredToMe?: boolean;
}): { action: ViewerAction; status: string | null } {
  if (o.isPoster) return { action: { kind: "manage" }, status: null };
  // A crew member is hired the moment they are on the roster: their Working card, never "no longer available".
  if (o.onCrew) return { action: { kind: "open_working" }, status: null };
  const them = o.posterFirst || "the person who posted it";
  const mineAssigned = !!o.userId && o.job.helper_id === o.userId;
  // JA-16 (audit 11-01): the hired-but-not-accepted Helpr's tracker already says "<Name> offered you this job"; no
  // second bold line saying it again under it.
  if (mineAssigned && !o.job.helper_confirmed_at && o.job.status === "accepted") {
    return { action: { kind: "see_offer" }, status: null };
  }
  if (mineAssigned) return { action: { kind: "open_working" }, status: null };
  if (o.offeredToMe && o.job.status === "open") {
    return { action: { kind: "see_offer" }, status: `${o.posterFirst || "The person who posted it"} offered you this job` };
  }
  const app = o.myApplication;
  if (app === undefined) return { action: { kind: "none" }, status: null };
  // Q2595 (Jobs audit 1102b row 9): a listing that expired with nobody hired was never cancelled (owner 10-31), and
  // its applicants were never hired: they read that, not "no longer available".
  if (isExpiredListing(o.job)) return { action: { kind: "none" }, status: EXPIRED_BEFORE_HIRE };
  if (app) {
    if (app.closed_reason === "job_cancelled") return { action: { kind: "none" }, status: "This job is no longer available" };
    if (app.closed_reason === "no_show") return { action: { kind: "none" }, status: "This job was reported as a no-show" };
    if (app.status === "rejected" && app.closed_reason === "helper_cancelled") return { action: { kind: "none" }, status: helprCancelledStatus(app.updated_at, o.job) };
    if (app.status === "rejected" && app.closed_reason === "offer_withdrawn") return { action: { kind: "none" }, status: "The offer was withdrawn" };
    if (app.status === "rejected") return { action: { kind: "none" }, status: "Not selected this time" };
    if (app.status === "pending" && o.job.status === "open") return { action: { kind: "view_application" }, status: `You applied · Waiting on ${them}` };
    return { action: { kind: "none" }, status: "This job is no longer available" };
  }
  if (o.job.status === "open") return { action: { kind: "apply" }, status: null };
  return { action: { kind: "none" }, status: "This job is no longer available" };
}

/**
 * Q2673 (audit 1102e row 5): the Helpr's own page after they cancelled said only "You cancelled this job". It says
 * when, and whether it counts as a strike: helper_cancel_booking strikes a cancel under 24 hours before the start
 * (is_late_cancellation: hours until the start < 24; owner Q407). The time is their application's close
 * (helper_cancel_booking closes it in the same transaction). Without a start time no strike is claimed.
 * Guard: src/test/helprOwnCancelView.test.tsx.
 */
function helprCancelledStatus(closedAt: string | null | undefined, job: { date_needed?: string | null; start_time?: string | null }): string {
  const atMs = Date.parse(closedAt ?? "");
  if (Number.isNaN(atMs)) return "You cancelled this job";
  const when = new Date(atMs).toLocaleString("en-US", { timeZone: "America/Chicago", weekday: "short", hour: "numeric", minute: "2-digit" });
  const start = job.date_needed && job.start_time ? jobStartDateTime(job.date_needed, job.start_time) : null;
  const late = !!start && start.getTime() - atMs < 24 * 3_600_000;
  return late ? `You cancelled ${when}, under 24 hours before the start, so it counts as a strike` : `You cancelled ${when}`;
}
