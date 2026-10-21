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
}): { action: ViewerAction; status: string | null } {
  if (o.isPoster) return { action: { kind: "manage" }, status: null };
  const them = o.posterFirst || "the poster";
  const mineAssigned = !!o.userId && o.job.helper_id === o.userId;
  if (mineAssigned && !o.job.helper_confirmed_at && o.job.status === "accepted") {
    return { action: { kind: "see_offer" }, status: `${o.posterFirst || "The poster"} offered you this job` };
  }
  if (mineAssigned) return { action: { kind: "open_working" }, status: null };
  const app = o.myApplication;
  if (app === undefined) return { action: { kind: "none" }, status: null };
  if (app) {
    if (app.closed_reason === "job_cancelled") return { action: { kind: "none" }, status: "This job is no longer available" };
    if (app.status === "rejected") return { action: { kind: "none" }, status: "Not selected this time" };
    if (app.status === "pending" && o.job.status === "open") return { action: { kind: "view_application" }, status: `You applied · Waiting on ${them}` };
    return { action: { kind: "none" }, status: "This job is no longer available" };
  }
  if (o.job.status === "open") return { action: { kind: "apply" }, status: null };
  return { action: { kind: "none" }, status: "This job is no longer available" };
}
