/**
 * The status badge beside an applicant on the poster's applicant list (Q1259).
 *
 * A rejected application carries WHY it closed in applications.closed_reason
 * (the newest applications_closed_reason_check lists the values). The badge
 * used to read "Declined" for every reason except a job cancel, so an offer
 * that expired unanswered (closed_reason 'offer_expired', stamped by the hourly
 * sweep since 20261004184021) told the poster they had declined the Helpr.
 *
 * CLOSED_REASON_BADGE must name every value the constraint allows:
 * src/test/applicantBadgeCoversClosedReasons.test.ts compares the two, both ways.
 */

export type ClosedReason = "job_cancelled" | "party_blocked" | "offer_expired";

/** The badge for each closed_reason; null = no badge (nobody was declined). */
export const CLOSED_REASON_BADGE: Record<ClosedReason, string | null> = {
  // Q274: the poster cancelled the job; they declined nobody.
  job_cancelled: null,
  // A block between the two closed it; unchanged from before Q1259.
  party_blocked: "Declined",
  // The Helpr did not answer the offer in time (the poster's own notice says so).
  offer_expired: "Offer expired",
};

export type ApplicantBadge = { label: string; kind: "selected" | "closed" };

export function posterApplicantBadge(app: { status: string; closed_reason?: string | null }): ApplicantBadge | null {
  if (app.status === "accepted") return { label: "Selected", kind: "selected" };
  if (app.status !== "rejected") return null;
  const reason = app.closed_reason;
  if (reason == null) return { label: "Declined", kind: "closed" };
  const label = (CLOSED_REASON_BADGE as Record<string, string | null>)[reason];
  // An unknown reason (a value newer than this build) still shows a neutral close.
  if (label === undefined) return { label: "Closed", kind: "closed" };
  return label === null ? null : { label, kind: "closed" };
}

/**
 * What the collapsed posted card says when nobody is waiting on the poster but
 * people DID apply (owner, 2026-10-07: "still show the number of applications
 * ... it either needs to be offered, expired or declined"). Each closed
 * application is named by the same badge the applicant list shows, so the two
 * never disagree: "1 applicant · offer expired", "2 applicants · 1 declined,
 * 1 offer expired". null when there is nothing to name (no applications, or
 * only ones closed by a job cancel, which shows no badge).
 */
export function closedApplicantsSummary(apps: ReadonlyArray<{ status: string; closed_reason?: string | null }>): string | null {
  const counts = new Map<string, number>();
  let total = 0;
  for (const a of apps) {
    const badge = posterApplicantBadge(a);
    if (!badge) continue;
    total++;
    const key = badge.label.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (total === 0) return null;
  const head = `${total} applicant${total === 1 ? "" : "s"}`;
  const parts = [...counts.entries()];
  if (parts.length === 1) return `${head} · ${parts[0][0]}`;
  return `${head} · ${parts.map(([k, n]) => `${n} ${k}`).join(", ")}`;
}
