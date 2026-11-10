/**
 * THE POSTER FINISHES THE JOB AND RELEASES THE MONEY (owner 11-10, her job "Mow and Weed Eat" 7b1da54b).
 *
 * Past the job's day (or its open continue day's) with no done from the Helpr, the poster may mark the job done and
 * release the money themselves: create-payment 'release' with `posterFinishes: true`. The server's rule is
 * public.poster_finish_job_refusal (20261110160451); `posterFinishOpen` below is the job page's mirror of it, for
 * whether to show the button only (the server decides). The release itself is the poster's Approve, unchanged: the
 * same payout math and payout day. Never the "Didn't come back" path (owner 11-08), which goes to the admin queue.
 *
 * Pure (imports only jobLocalStartMs, itself pure), so the app and the edge function share it.
 * Guard: src/test/edge/posterFinishesAndPays.test.ts.
 */
import { jobLocalStartMs } from "./cancellationFee.ts";

/** The button's name and the confirm's commit (F33: "release", never "pay": the poster already paid). */
export const POSTER_FINISH_LABEL = "Mark done and release";

/** Plain words for each refusal code poster_finish_job_refusal returns. */
export function posterFinishRefusalMessage(code: string): string {
  switch (code) {
    case "job_not_found":
      return "We couldn't find this job.";
    case "not_the_poster":
      return "Only the person who posted this job can mark it done and release the payment.";
    case "account_restricted":
      return "Your account is restricted, so this can't be done right now. Contact support.";
    case "not_in_progress":
      return "This job isn't under way any more, so there is nothing to release here.";
    case "not_a_solo_job":
      return "On a crew job, confirm each Helpr's work on its own instead.";
    case "helpr_marked_done":
      return "Your Helpr already marked it done. Use Approve and release instead.";
    case "already_approved":
      return "You already marked this job done.";
    case "money_not_held":
      return "This job's payment isn't held right now, so it can't be released. Nothing was moved.";
    case "dispute_open":
      return "This job has an open case, so our team decides the payment.";
    case "not_started":
    case "day_not_reached":
      return "You can mark it done once the day it was set for has started.";
    default:
      return "We couldn't release this payment right now. Try again in a minute.";
  }
}

export type PosterFinishJob = {
  status?: string | null;
  is_group_job?: boolean | null;
  helper_id?: string | null;
  helper_completed_at?: string | null;
  poster_completed_at?: string | null;
  payment_status?: string | null;
  has_active_dispute?: boolean | null;
  date_needed?: string | null;
  start_time?: string | null;
  helper_arrived_at?: string | null;
};

export type PosterFinishDay = { status: string; new_date: string | null; new_start_time: string | null } | null | undefined;

/**
 * Does the poster get "Mark done and release" now? The job-facts half of poster_finish_job_refusal (who is asking
 * and whether they are restricted are the server's alone). `day` is the job's open continue day ('proposed' or
 * 'set'), if any.
 */
export function posterFinishOpen(job: PosterFinishJob | null | undefined, day: PosterFinishDay, nowMs: number = Date.now()): boolean {
  if (!job) return false;
  if (job.status !== "in_progress" || job.is_group_job || !job.helper_id) return false;
  if (job.helper_completed_at || job.poster_completed_at) return false;
  if (job.payment_status !== "escrow" || job.has_active_dispute) return false;
  const openDay = day && (day.status === "proposed" || day.status === "set") && day.new_date ? day : null;
  const startsMs = openDay
    ? jobLocalStartMs(openDay.new_date!, openDay.new_start_time ?? null)
    : job.date_needed
      ? jobLocalStartMs(job.date_needed, job.start_time ?? null)
      : job.helper_arrived_at
        ? Date.parse(job.helper_arrived_at)
        : Number.NaN;
  return Number.isFinite(startsMs) && nowMs >= startsMs;
}
