import { useEffect, useRef, useState, useMemo } from "react";
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

/**
 * `/jobs?tab=working&job=<id>&open=1` (the job page's Open in working / See the offer / View application, and the
 * chat card's Open job; audit 2026-10-28 F10): that Working card opens in place, not just pulsed in its bucket.
 * On Working `?highlight=` names an APPLICATION, so links name the JOB with `?job=`. The Working cards expand by
 * JOB id (AppliedJobCard: toggleExpandedJobId(app.job_id)). Pass null params off the Working tab.
 * Lives here, not in JobListPage, so that oversized page doesn't grow (componentSizeRatchet).
 */
export function useOpenWorkingDeepLink(
  params: URLSearchParams | null,
  appliedApps: ReadonlyArray<{ job_id: string }>,
  cards: { expandedJobIds: Set<string>; toggleExpandedJobId: (id: string) => void },
): void {
  const jobId = params?.get("open") === "1" ? params.get("job") : null;
  const refs = useMemo(() => appliedApps.map((a) => ({ id: a.job_id })), [appliedApps]);
  useManageDeepLink(jobId, refs, cards);
}

/**
 * THE MANAGE JOB SCREEN IS GONE (owner 2026-10-31, LEAD-JOBPAGE-LAYOUT): its actions are on the job page, so an old
 * `/posts?highlight=<id>&manage=1` link (a chat card, an email, a notification already on a phone) opens /jobs/<id>.
 * Every one: the job page runs the card's approve, cancel, edit and steps itself now (usePosterPageFlows), so no
 * link is left that needs the card. JobsSection redirects BEFORE the Posted
 * list mounts: redirecting from inside the list raced its own deep-link URL writes, which put the list back
 * (measured in a browser, 2026-10-31).
 */
export function manageLinkOpensJobPage(params: URLSearchParams): string | null {
  const id = params.get("manage") === "1" ? params.get("highlight") : null;
  return id ? `/jobs/${encodeURIComponent(id)}` : null;
}
