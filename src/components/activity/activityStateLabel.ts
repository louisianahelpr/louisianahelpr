/**
 * activityStateLabel — the one-line "where does this stand?" answer shown on
 * every card in the Active view.
 *
 * Active is a BUCKET: it deliberately folds several statuses into one list so
 * it degrades gracefully as items settle (see defaultStatusFilterFor). The
 * cost of that is a flat list where a job awaiting a reply, a job whose offer
 * was just declined, and a job already underway all look alike. These labels
 * pay that cost back.
 *
 * The two tabs answer different questions, so they get different vocabularies:
 *
 *   My Posts (poster)  — "what is happening to my job?"  A declined offer is
 *                        NOT a dead end: the job is still open and still needs
 *                        someone, so it says so rather than just reverting to
 *                        a neutral "open".
 *   My Jobs (helper)   — "where do I stand on this?"  Whose move is it — am I
 *                        waiting on them, or are they waiting on me?
 *
 * `tone` drives colour only. "action" means the label is about something the
 * USER must do next; it is the one tone that should stand out, and it is used
 * sparingly so it keeps meaning something.
 */

export type StateTone = "action" | "waiting" | "live" | "neutral";

export interface ActivityState {
  label: string;
  tone: StateTone;
}

/** The subset of a posted job this module reads. */
export interface PostedJobStateInput {
  status: string;
  helper_id?: string | null;
  helper_confirmed_at?: string | null;
  offered_to_helper_id?: string | null;
  direct_offer_status?: string | null;
  applicantCount?: number;
}

/** The subset of an application (+ its job) this module reads. */
export interface AppliedStateInput {
  status: string;
  job?: {
    status: string;
    helper_confirmed_at?: string | null;
    offered_to_helper_id?: string | null;
    direct_offer_status?: string | null;
  } | null;
}

/**
 * Poster-side state for a job in the Active bucket.
 *
 * Returns null for statuses Active never contains (completed / cancelled /
 * disputed) — those live in their own sections and already carry their own
 * treatment on the card, so labelling them here would just say it twice.
 */
export function postedActiveState(job: PostedJobStateInput): ActivityState | null {
  switch (job.status) {
    case "completed":
    case "cancelled":
    case "disputed":
      return null;

    case "in_progress":
      return { label: "In progress", tone: "live" };

    case "revision_requested":
      return { label: "Revision requested", tone: "action" };

    case "accepted":
      // "accepted" covers two genuinely different moments, and conflating them
      // was the confusing part: the helpr has been chosen but has not yet
      // confirmed, versus both sides locked in and waiting for the day.
      return job.helper_confirmed_at
        ? { label: "Booked", tone: "live" }
        : { label: "Offer sent · awaiting reply", tone: "waiting" };

    case "pending_approval":
      return { label: "Pending approval", tone: "waiting" };

    case "open":
    default: {
      // A direct offer that was turned down does NOT end the job — it goes
      // back on the market. Saying "still open" out loud is the whole reason
      // the owner asked for these labels: without it a declined offer looks
      // identical to a job nobody has looked at.
      if (job.direct_offer_status === "declined") {
        return { label: "Offer declined · still open", tone: "action" };
      }
      if (job.offered_to_helper_id && job.direct_offer_status === "pending") {
        return { label: "Offer sent · awaiting reply", tone: "waiting" };
      }
      const applicants = job.applicantCount ?? 0;
      if (applicants > 0) {
        // No count here, deliberately. The card already carries the number on
        // its primary "Applicants (N)" button, and it used to ALSO carry it in
        // a "N applicants" meta chip — the same figure stated three times
        // within ~120px. The pill's job is the state ("your move"), not the
        // tally; the button owns the tally.
        return { label: "Pick someone", tone: "action" };
      }
      return { label: "Open · no applicants yet", tone: "neutral" };
    }
  }
}

/**
 * Helper-side state for an application in the Active bucket.
 *
 * Returns null once the helper's involvement has ended (rejected, or the job
 * was cancelled/completed) — Active never contains those, by the owner's
 * decision that Active means "is my standing still live".
 */
export function appliedActiveState(app: AppliedStateInput): ActivityState | null {
  const job = app.job;
  if (!job) return null;
  if (app.status === "rejected") return null;
  if (job.status === "cancelled" || job.status === "completed") return null;

  if (job.status === "in_progress") return { label: "In progress", tone: "live" };
  if (job.status === "revision_requested") return { label: "Revision requested", tone: "action" };
  if (job.status === "disputed") return null;

  if (job.status === "accepted") {
    // Whose move is it? Unconfirmed means the ball is with the helper — this
    // is the one card in the list that needs a tap, so it gets the loud tone.
    return job.helper_confirmed_at
      ? { label: "Booked", tone: "live" }
      : { label: "Offered to you · respond", tone: "action" };
  }

  // Job still open: either they invited this helper directly, or the helper
  // applied and is waiting to hear back.
  if (job.direct_offer_status === "pending" && job.offered_to_helper_id) {
    return { label: "Offered to you · respond", tone: "action" };
  }
  return { label: "Applied · awaiting decision", tone: "waiting" };
}

/** Foreground / background pair for a tone. Values are brand tokens. */
export function stateToneColors(tone: StateTone): { fg: string; bg: string } {
  switch (tone) {
    case "action":
      return { fg: "hsl(var(--burnt-sienna))", bg: "hsl(var(--burnt-sienna) / 0.10)" };
    case "live":
      return { fg: "hsl(var(--bark))", bg: "hsl(var(--bark) / 0.10)" };
    case "waiting":
      return { fg: "hsl(var(--olivewood))", bg: "hsl(var(--olivewood) / 0.10)" };
    case "neutral":
    default:
      return { fg: "hsl(var(--olivewood) / 0.85)", bg: "hsl(var(--olivewood) / 0.06)" };
  }
}
