/**
 * When the poster's "Open a dispute" path shows on a card: the predicate
 * InProgressStep's dispute chip and the Help Center copy read.
 *
 * Q904 (2026-10-04): the `<DisputeLink>` component that used to live here was
 * rendered nowhere in app source (only its own test rendered it since
 * 2026-10-01; the poster's Dispute is a JobActionChip keyed "dispute"), so it
 * was deleted with its render tests. The predicate stays: it is live.
 *
 * Visibility rules (see `shouldShowDisputeLink` for the truth table):
 *   - Customer side: visible only on `revision_requested` once the helpr's
 *     revision window has run out.
 *   - Helper side: never from the predicate (the live card's Report a
 *     Problem chip is its own path).
 *   - NEVER on a `completed` job, either side (owner rule, 2026-09-14,
 *     VN-28: "they can't report a job once it's done"). This replaces the
 *     issue-#113 7-day post-completion window. Client-only: the server
 *     dispute RPC is not changed here.
 *   - Always hidden once `status === 'disputed'` (dispute already
 *     filed: we never want to encourage double-filing) or
 *     `disputed_at` is set.
 */

/** The minimal slice of `jobs` row this component cares about. */
export interface DisputeLinkJob {
  status: string;
  /** Set when the customer approves & releases — our canonical "done" moment. */
  poster_completed_at: string | null;
  /** Helper-side completion timestamp — fallback if poster_completed_at isn't set yet. */
  helper_completed_at: string | null;
  /** Set the moment any party files a dispute — hide unconditionally. */
  disputed_at: string | null;
  /** Set when the customer asks for a fix — keeps the link visible for the customer side. */
  revision_requested_at: string | null;
  /** When the helpr's window to fix it runs out. Dispute waits for this. */
  revision_deadline?: string | null;
}

export type DisputeLinkSide = "customer" | "helper";

/**
 * Pure visibility predicate, exported so the test suite can drive every
 * branch without rendering JSX. Keep the rules here, not in the JSX.
 */
export function shouldShowDisputeLink(
  job: DisputeLinkJob,
  side: DisputeLinkSide,
  now: Date = new Date(),
): boolean {
  // Already filed → never show; we don't want a double-file path.
  if (job.disputed_at) return false;
  if (job.status === "disputed") return false;

  // ESCALATION, IN ORDER. A dispute is only reachable once a revision has been
  // asked for AND the helpr's window to answer it has run out (owner: "I don't
  // want a dispute to be [available] until revision is requested", and "once
  // the time is up for that then move to dispute").
  //
  // Offering both at once — which is what returning true for the whole
  // `revision_requested` state did — put "open a dispute" in front of a poster
  // whose helpr was still actively fixing the thing, which is the one moment
  // the flow exists to avoid.
  //
  // No deadline stamped means no clock to wait on, so the window is treated as
  // open rather than expired: an unstamped row must not unlock a dispute the
  // helpr never had a chance to pre-empt.
  if (side === "customer" && job.status === "revision_requested") {
    if (!job.revision_deadline) return false;
    return new Date(job.revision_deadline).getTime() <= now.getTime();
  }

  // Everything else — including `completed` — is "no". The issue-#113 7-day
  // post-completion window is gone: owner rule, 2026-09-14 (VN-28), no
  // report or dispute once a job is done.
  return false;
}
