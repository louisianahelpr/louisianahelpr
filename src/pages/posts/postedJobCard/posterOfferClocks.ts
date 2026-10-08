import { jobStartTarget, type CountdownClock } from "@/components/job-card/CountdownRows";
// Re-exported so PostedJobCard draws the clocks with one import (component-size budget).
export { CountdownRows } from "@/components/job-card/CountdownRows";
import { posterDeadline } from "@/components/job-card/jobStatusLine";
import { confirmationOpensClock } from "@/components/job-card/confirmationOpensClock";
import type { Job } from "@/components/job-card/activityConstants";

/**
 * AN OFFER IS NOT A HIRE (owner, 2026-10-07, Q1399, on the expanded card of
 * an unanswered offer): until the Helpr accepts (helper_confirmed_at) the
 * tile reads "Offered to <name>", the answer clock is "left for them to
 * accept", and the day-before confirmation box does not show yet. A crew
 * job's acceptance lives on its roster, so it is not judged here.
 *
 * Every clock on the poster's card, in one place, one format, soonest first:
 * before the Helpr accepts, "left for them to accept" and "until the job
 * starts"; after, "until the job starts" and, while the day-before window is
 * shut, "until confirmation opens". Guard: src/test/offerCountdownRows.test.tsx.
 */
export function posterOfferClocks(job: Job) {
  const offerUnanswered = job.status === "accepted" && !!job.helper_id && !job.helper_confirmed_at && !job.is_group_job;
  const answerDeadline = offerUnanswered ? posterDeadline("unconfirmed", job) : null;
  const posterConfirmOpens = offerUnanswered ? null : confirmationOpensClock(job.date_needed, job.status, true);
  const posterClocks: CountdownClock[] = [
    ...(answerDeadline ? [{ id: "answer", at: answerDeadline.at, text: answerDeadline.consequenceText, expiredText: answerDeadline.expiredText }] : []),
    { id: "start", at: jobStartTarget(job.date_needed, job.start_time), text: "until the job starts", expiredText: "Job time has arrived" },
    ...(posterConfirmOpens ? [posterConfirmOpens.clock] : []),
  ];
  return { offerUnanswered, posterClocks, posterConfirmOpens };
}
