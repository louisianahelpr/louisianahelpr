import { jobStartDateTime } from "@/lib/dateUtils";

/**
 * A JOB WITH NO START TIME IS "ANY TIME THAT DAY" (Jobs audit 1102b row 2, Q2588).
 *
 * Post a job and Edit job both say it: "Any time that day works" (LogisticsSection, EditJobDialog), and the
 * listing's own rules already read it that way (jobExpiry: 11:59 PM; offerDeadline: the end of its day). The tracker
 * did not: it counted from jobStartDateTime(date, null), which is 12:00 AM, so at 3 AM a poster read "your Helpr is
 * 3 h 2 min late" and the Helpr "It's time — tap I'm on my way". 368 of the 535 jobs posted in the 60 days to
 * 2026-11-02 have no start time (auditor's prod SELECT).
 *
 * The rule, one place:
 *  - never late on its day: no "N min late", no "Start time passed" (once the day is over, the overdue lines take over);
 *  - never "It's time": the Helpr's line all day is TODAY_ANY_TIME_LINE;
 *  - the face's "I'm on my way" button shows from 8:00 AM Central on the day (ANY_TIME_FACE_FROM, the owner's
 *    morning-of reminder hour, Q2483), never from 9 PM the night before (3 hours before a midnight start). The open
 *    card's tracker still offers the step at any hour, as for a timed job.
 */
const ANY_TIME_FACE_FROM = "08:00";

export const TODAY_ANY_TIME_LINE = "Today, any time — tap I'm on my way when you leave";

/** True when the job has a start time the clock can be held to. */
export function hasStartTime(job: { start_time?: string | null }): boolean {
  return !!job.start_time;
}

/** When a no-start-time job's face offers "I'm on my way" (8:00 AM Central on its day), or null without a date. */
export function anyTimeFaceOpensAt(dateNeeded: string | null | undefined): Date | null {
  return jobStartDateTime(dateNeeded ?? null, ANY_TIME_FACE_FROM);
}

/**
 * A crew member's "It's time" (Jobs audit 1102b row 16, A3-33 seen again, Q2602): their I'm on my way is on the crew
 * roster, behind the page's "See your crew steps", so the line names that button, never one the page does not have.
 */
export const CREW_TODAY_LINE = "It's time — tap See your crew steps to set out";
