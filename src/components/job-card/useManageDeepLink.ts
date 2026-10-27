import { useEffect, useRef, useState } from "react";
import { jobIsUnfundedDraft } from "./activityFilters";

/** On Posted's list: everything but a never-paid draft (jobIsUnfundedDraft, Q1668). */
export const onPostedList = (j: { payment_status?: string | null }): boolean => !jobIsUnfundedDraft(j);

/** What a job-page link to a job not on Posted says, instead of landing silently. */
export function notOnPostedCopy(job: { payment_status?: string | null } | undefined): string {
  return job && jobIsUnfundedDraft(job)
    ? "That job isn't paid yet, so it isn't on Posted. Open it to pay for it."
    : "That job is no longer in Posted.";
}

/**
 * `/posts?highlight=<id>&manage=1` (the job page's "Manage job", board 14):
 * that Posted card opens its live controls in place, once, because the card
 * face itself is a link to the job page now.
 *
 * The id is captured on first render (JobListPage strips both params from the
 * URL right after). Once per link: a toggle is not idempotent, and the effect
 * can run twice before the expand lands (StrictMode / two renders), which shut
 * the card again (measured at 375 on the dev server, 2026-10-20).
 */
/**
 * `/posts?highlight=<id>&applicants=1` (the job page's "Review N applicants"): that Posted job's applicants open
 * at once, the same panel its own "Review" button opens. Before this the link only pulsed the card, so the button
 * named "Review 1 applicant" landed on the list and the poster had to find and tap the card again (boards 22 / 170,
 * audit 2026-10-25). Once per link, as above; a job not on the list (a never-paid draft) opens nothing here and
 * JobListPage says why.
 */
export function useReviewApplicantsDeepLink(
  idFromUrl: string | null,
  postedJobs: ReadonlyArray<{ id: string; payment_status?: string | null }>,
  open: (job: never) => unknown,
  isOnList: (job: { id: string; payment_status?: string | null }) => boolean,
): void {
  const [target, setTarget] = useState(idFromUrl);
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (!target || done.current === target) return;
    const job = postedJobs.find((j) => j.id === target);
    if (!job) return;
    done.current = target;
    setTarget(null);
    if (isOnList(job)) void open(job as never);
  }, [target, postedJobs, open, isOnList]);
}

export function useManageDeepLink(
  idFromUrl: string | null,
  postedJobs: ReadonlyArray<{ id: string }>,
  cards: { expandedJobIds: Set<string>; toggleExpandedJobId: (id: string) => void },
): void {
  const [target, setTarget] = useState(idFromUrl);
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (!target || done.current === target || !postedJobs.some((j) => j.id === target)) return;
    done.current = target;
    if (!cards.expandedJobIds.has(target)) cards.toggleExpandedJobId(target);
    setTarget(null);
  }, [target, postedJobs, cards]);
}
