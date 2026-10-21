/**
 * Where a job stands, as the deal-room chat's pinned card shows it (board 2;
 * the chat halves of boards 59, 61, 62 and 63).
 *
 * Pure, so the rules are testable without Supabase. The card never acts on its
 * own: its one button opens the job's own card, where the tracker's real
 * controls (and every gate they carry) decide what can happen. So this module
 * only NAMES the stage, from the same stamps the tracker reads, and it never
 * runs ahead of them: "Working" needs arrival evidence beyond the Helpr's own
 * claim (a verified arrival or the poster's confirmation), the same evidence
 * the tracker's working inference asks for.
 *
 * Four steps, both sides (boards 61/63): Posted, Hired, Working, Done.
 */
export type DealJob = {
  status: string | null;
  helper_id: string | null;
  payment_status: string | null;
  helper_on_the_way_at?: string | null;
  helper_arrived_at?: string | null;
  helper_arrival_verified_at?: string | null;
  poster_confirmed_arrival_at?: string | null;
  poster_confirmed_working_at?: string | null;
  helper_completed_at?: string | null;
  has_active_dispute?: boolean | null;
};

export const DEAL_STEPS = ["Posted", "Hired", "Working", "Done"] as const;

type DealStage = {
  /** 1..4 = how many of DEAL_STEPS are reached; null hides the bar. */
  step: 1 | 2 | 3 | 4 | null;
  /** The bold word before the line ("Working", "Filled", ...). */
  word: string;
  /** What is happening now, in the viewer's words. */
  label: string;
  /** True only while the job's payment is held (payment_status 'escrow'). */
  held: boolean;
};

const LIVE = new Set(["accepted", "in_progress", "revision_requested"]);

/**
 * @param viewerIsPoster   the signed-in member posted this job
 * @param otherId          the person on the other side of this thread
 * @param viewerId         the signed-in member
 * @param helprApplication the application status of the Helpr in this thread
 *                         (the other person when the viewer posted, the viewer
 *                         otherwise); null when they have not applied
 * @param otherFirst       the other person's first name
 */
export function dealStage(
  job: DealJob,
  viewerIsPoster: boolean,
  otherId: string | null,
  viewerId: string,
  helprApplication: string | null,
  otherFirst: string,
): DealStage {
  const held = job.payment_status === "escrow";
  const helprInThread = viewerIsPoster ? otherId : viewerId;
  const status = job.status ?? "";

  if (status === "cancelled") {
    return { step: null, word: "Cancelled", label: "This job was cancelled", held };
  }
  if (job.has_active_dispute || status === "disputed") {
    return { step: null, word: "Under review", label: "Helpr is looking at the problem", held };
  }

  if (job.helper_id) {
    if (job.helper_id !== helprInThread) {
      return {
        step: 1,
        word: "Filled",
        label: viewerIsPoster ? "You hired someone else" : `${otherFirst} hired someone else`,
        held: false,
      };
    }
    if (status === "completed") return { step: 4, word: "Done", label: "", held };
    if (LIVE.has(status)) {
      if (job.helper_completed_at) {
        return {
          step: 3,
          word: "Working",
          label: viewerIsPoster ? `${otherFirst} marked it done. Check the work` : `You marked it done. Waiting for ${otherFirst}`,
          held,
        };
      }
      const working =
        status === "in_progress" &&
        !!(job.poster_confirmed_working_at || job.poster_confirmed_arrival_at || job.helper_arrival_verified_at);
      if (working) {
        return { step: 3, word: "Working", label: viewerIsPoster ? `${otherFirst} will mark it done` : "Mark it done when you finish", held };
      }
      // A claim, not the verified arrival: "has arrived" says no more than the stamp does.
      if (job.helper_arrived_at) {
        return { step: 2, word: "Hired", label: viewerIsPoster ? `${otherFirst} has arrived` : "You've arrived", held };
      }
      if (job.helper_on_the_way_at) {
        return { step: 2, word: "Hired", label: viewerIsPoster ? `${otherFirst} is on the way` : "You're on the way", held };
      }
      return { step: 2, word: "Hired", label: viewerIsPoster ? `You hired ${otherFirst}` : "You're hired", held };
    }
  }

  if (status === "open") {
    if (helprApplication === "pending") {
      return { step: 1, word: "Posted", label: viewerIsPoster ? `${otherFirst} applied` : "You applied. Waiting to hear back", held };
    }
    if (helprApplication === "rejected") {
      return { step: null, word: "Not picked", label: viewerIsPoster ? "You passed on this one" : "Not picked this time", held: false };
    }
    return { step: 1, word: "Posted", label: "Open for Helprs", held };
  }

  return { step: null, word: "", label: "", held };
}
