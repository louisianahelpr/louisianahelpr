/**
 * Moving sale, step "Moving day" (audit 1d, D4-6, 2026-10-29): "Hire a Helpr for moving day" opened a blank Post a
 * job. It now opens a moving job pre-filled from the sale: the Moving help category, a title, a short description to
 * fill in, and the move-out date when it is still ahead. An ordinary job the poster prices and pays like any other.
 * Pure words and links only, so the Declutter screen and Post a Job can both import it without pulling either's code.
 */
import type { JobCategory } from "@/lib/jobCategories";

/** The Post a Job query param that asks for the pre-filled moving-day job (its value: the move-out date, or 1). */
export const MOVING_DAY_PARAM = "movingDay";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Post a Job, pre-filled for help on moving day; the move-out date rides along when there is one. */
export function movingDayPostJobPath(moveOutYmd: string | null): string {
  return `/post-job?${MOVING_DAY_PARAM}=${moveOutYmd && YMD.test(moveOutYmd) ? moveOutYmd : "1"}`;
}

/** public.jobs caps a title at 32 characters (Q782). */
const MOVING_DAY_TITLE = "Help on moving day";

const MOVING_DAY_DESCRIPTION = [
  "I'm moving out and need a hand on moving day.",
  "",
  "What needs moving (rooms or big pieces): ",
  "Stairs or an elevator: ",
  "Truck needed (yes or no): ",
].join("\n");

export interface MovingDayPrefill {
  category: JobCategory;
  title: string;
  description: string;
  /** The move-out date (YYYY-MM-DD) when the link carries one that is today or later, else null. */
  dateNeeded: string | null;
}

/** What Post a Job fills in for `?movingDay=<date|1>`. `today` is YYYY-MM-DD; a past date is never pre-filled. */
export function buildMovingDayPrefill(param: string, today: string): MovingDayPrefill {
  const date = YMD.test(param) && param >= today ? param : null;
  return { category: "moving", title: MOVING_DAY_TITLE, description: MOVING_DAY_DESCRIPTION, dateNeeded: date };
}
