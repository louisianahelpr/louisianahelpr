/**
 * ONE job tracker (owner, 2026-10-21: "we need 1 tracker"). Chat, the job page and both job cards drew three
 * different trackers for the same job (4 bars twice, an 8-icon stepper on the card). Every job-progress render
 * now goes through `jobProgress` (this file) and `<JobProgress>` (src/components/tracker/JobProgress.tsx):
 * four segments, Posted · Hired · Working · Done, and ONE exact "next step" line naming the real sub-state
 * from the same rules the card's primary follows (offered, the day-before confirm window and its deadline,
 * on the way, arrived, working, marked done).
 * Guard: src/test/oneJobTracker.test.ts.
 */
import { confirmDeadlineMs, confirmOpensMs, jobDayStart } from "@/lib/jobDate";
import { jobStartDateTime } from "@/lib/dateUtils";

export const JOB_PROGRESS_STEPS = ["Posted", "Hired", "Working", "Done"] as const;

export type ProgressJob = {
  status: string | null;
  helper_id: string | null;
  payment_status?: string | null;
  date_needed?: string | null;
  start_time?: string | null;
  helper_confirmed_at?: string | null;
  helper_dayof_confirmed_at?: string | null;
  poster_confirmed_at?: string | null;
  helper_on_the_way_at?: string | null;
  helper_arrived_at?: string | null;
  helper_arrival_verified_at?: string | null;
  poster_confirmed_arrival_at?: string | null;
  poster_confirmed_working_at?: string | null;
  helper_completed_at?: string | null;
  poster_completed_at?: string | null;
  has_active_dispute?: boolean | null;
};

export type JobProgressState = {
  /** 1..4 = how many of JOB_PROGRESS_STEPS are reached; null = off the path (cancelled, under review, not yours). */
  step: 1 | 2 | 3 | 4 | null;
  /** The bold word for the state ("Hired", "Cancelled", ...). */
  word: string;
  /** What happens next, in the viewer's words; "" when nothing is pending. */
  next: string;
  /** True only while the job's payment is held (payment_status 'escrow'). */
  held: boolean;
};

const LIVE = new Set(["accepted", "in_progress", "revision_requested"]);

/** "Wed 9:00 AM" in Louisiana time. */
function when(ms: number): string {
  return new Date(ms).toLocaleString("en-US", { timeZone: "America/Chicago", weekday: "short", hour: "numeric", minute: "2-digit" });
}

/** The job's slot in Louisiana time: "Thu 9:00 AM", or the weekday alone when it has no start time. */
export function slotLabel(dateNeeded: string | null | undefined, startTime: string | null | undefined): string {
  if (!dateNeeded) return "";
  const start = startTime ? jobStartDateTime(dateNeeded, startTime) : null;
  if (start) return when(start.getTime());
  return jobDayStart(dateNeeded).toLocaleString("en-US", { timeZone: "America/Chicago", weekday: "short" });
}

export function jobProgress(
  job: ProgressJob,
  o: {
    /** Who is looking: the poster, the Helpr on the job, or (chat) a Helpr in a thread. */
    viewer: "poster" | "helpr";
    /** The other person's first name; a neutral word is used when unknown. */
    otherFirst?: string | null;
    /** Chat only: the Helpr in this thread, so a job filled by someone else says so. */
    threadHelprId?: string | null;
    /** The thread Helpr's application status, when they have applied (chat, an open job). */
    application?: string | null;
    /** The date or time was moved by an accepted change (useJobRescheduled): both sides confirm the NEW slot. */
    rescheduled?: boolean;
    now?: Date;
  },
): JobProgressState {
  const poster = o.viewer === "poster";
  const other = (o.otherFirst ?? "").trim() || (poster ? "Your Helpr" : "The person who posted it");
  const otherLow = (o.otherFirst ?? "").trim() || (poster ? "your Helpr" : "the person who posted it");
  const held = job.payment_status === "escrow";
  const status = job.status ?? "";
  const now = (o.now ?? new Date()).getTime();

  if (status === "cancelled" || status === "expired") return { step: null, word: "Cancelled", next: "This job was cancelled", held };
  if (job.has_active_dispute || status === "disputed") {
    return { step: null, word: "Under review", next: "A real person at Helpr is looking at the problem. The money stays held", held };
  }

  if (status === "open" && !job.helper_id) {
    if (o.application === "pending") return { step: 1, word: "Posted", next: poster ? `${other} applied` : `You applied. Waiting on ${otherLow}`, held };
    if (o.application === "rejected") return { step: null, word: "Not picked", next: poster ? "You passed on this one" : "Not picked this time", held: false };
    return { step: 1, word: "Posted", next: poster ? "Pick your Helpr" : "Open for Helprs", held };
  }

  if (job.helper_id && o.threadHelprId && job.helper_id !== o.threadHelprId) {
    return { step: 1, word: "Filled", next: poster ? "You hired someone else" : `${other} hired someone else`, held: false };
  }

  if (status === "completed" || job.poster_completed_at) return { step: 4, word: "Done", next: "", held };
  if (!LIVE.has(status) || !job.helper_id) return { step: null, word: "", next: "", held };

  // An offer is not a booking: until the Helpr accepts, nobody is hired.
  if (!job.helper_confirmed_at) {
    return { step: 1, word: "Offered", next: poster ? `Waiting on ${otherLow} to accept the offer` : `${other} offered you this job`, held };
  }

  if (job.helper_completed_at) {
    return { step: 3, word: "Working", next: poster ? `${other} marked it done. Check the work and approve` : `You marked it done. Waiting on ${otherLow}`, held };
  }
  const working =
    status === "in_progress" &&
    !!(job.poster_confirmed_working_at || job.poster_confirmed_arrival_at || job.helper_arrival_verified_at);
  // "is working" only once the poster has vouched for it; arrival evidence alone says where they are, not what
  // they are doing (the Helpr's Start working is not on the job row; the card's line says when it comes).
  if (working) return { step: 3, word: "Working", next: poster ? (job.poster_confirmed_working_at ? `${other} is working` : `${other} is at the job`) : "Mark it done when you finish", held };
  if (job.helper_arrived_at) {
    return { step: 2, word: "Hired", next: poster ? `${other} arrived. Confirm they've arrived` : `You've arrived. Waiting on ${otherLow} to confirm`, held };
  }
  if (job.helper_on_the_way_at) return { step: 2, word: "Hired", next: poster ? `${other} is on the way` : "You're on the way", held };

  // Booked, before setting out: the day-before confirm (the server's rule, _shared/confirmDeadline.ts:
  // opens at midnight the day before, owed until 2 hours before the start).
  if (job.date_needed) {
    const opens = confirmOpensMs(job.date_needed);
    const due = confirmDeadlineMs(job.date_needed, job.start_time ?? null);
    // Moved by an accepted change (owner, 2026-10-21): the line names the NEW slot.
    const slot = o.rescheduled ? slotLabel(job.date_needed, job.start_time) : "";
    if (!Number.isNaN(opens) && now < opens) {
      const wait = poster ? `${other} confirms the day before. Opens ${when(opens)}` : `Confirm the day before. Opens ${when(opens)}`;
      return { step: 2, word: "Hired", next: slot ? `New time ${slot}. ${wait}` : wait, held };
    }
    const helprIn = !!job.helper_dayof_confirmed_at;
    const posterIn = !!job.poster_confirmed_at;
    if (!helprIn || !posterIn) {
      if (slot) {
        const mine = poster ? !posterIn : !helprIn;
        return { step: 2, word: "Hired", next: mine ? (poster ? `Confirm the new time, ${slot}` : `Confirm you'll be there ${slot}`) : `Waiting for ${otherLow} to confirm ${slot}`, held };
      }
      if (poster) {
        return { step: 2, word: "Hired", next: !posterIn ? "Tap I'm still on to confirm" : `Waiting on ${otherLow} to confirm by ${when(due)}`, held };
      }
      return { step: 2, word: "Hired", next: !helprIn ? `Confirm you'll be at the job by ${when(due)}` : `Waiting on ${otherLow} to confirm`, held };
    }
  }
  return { step: 2, word: "Hired", next: poster ? `You're both confirmed. ${other} taps On my way when they leave` : "Tap I'm on my way when you leave", held };
}
