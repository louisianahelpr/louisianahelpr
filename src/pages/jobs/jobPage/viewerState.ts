/**
 * What the job page offers the person looking at it (owner bug 2026-10-21: a member who had ALREADY applied
 * still saw the big "Apply"). One table, every viewer state, the same truth the Home card uses
 * ("Waiting on Lexi · You applied"). Pinned by viewerState.test.ts.
 */
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
  job: { status: string | null; helper_id: string | null; helper_confirmed_at?: string | null };
  /** The viewer's own application, when they applied; undefined while it loads. */
  myApplication: { status: string; closed_reason: string | null } | null | undefined;
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
  if (app) {
    if (app.closed_reason === "job_cancelled") return { action: { kind: "none" }, status: "This job is no longer available" };
    if (app.closed_reason === "no_show") return { action: { kind: "none" }, status: "This job was reported as a no-show" };
    if (app.status === "rejected" && app.closed_reason === "helper_cancelled") return { action: { kind: "none" }, status: "You cancelled this job" };
    if (app.status === "rejected") return { action: { kind: "none" }, status: "Not selected this time" };
    if (app.status === "pending" && o.job.status === "open") return { action: { kind: "view_application" }, status: `You applied · Waiting on ${them}` };
    return { action: { kind: "none" }, status: "This job is no longer available" };
  }
  if (o.job.status === "open") return { action: { kind: "apply" }, status: null };
  return { action: { kind: "none" }, status: "This job is no longer available" };
}
