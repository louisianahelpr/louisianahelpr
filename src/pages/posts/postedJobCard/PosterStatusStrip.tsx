import { collapsedClocks } from "@/components/job-card/collapsedClocks";
import { JobStatusStrip } from "@/components/job-card/JobStatusStrip";
import { posterStatusLine } from "@/components/job-card/jobStatusLine";
import { useCurrentUser } from "@/hooks/useCurrentUser";

type Args = Parameters<typeof posterStatusLine>;
type Line = ReturnType<typeof posterStatusLine>;

/** "No applicants yet" is wrong once someone applied: name what happened instead. */
export function withClosedApplicants(line: Line, closedApplicants: string | null): Line {
  return line.id === "no_applicants" && closedApplicants ? { ...line, detail: closedApplicants } : line;
}

/**
 * The collapsed poster card's status line. Lives here, not in PostedJobCard,
 * so the card stays inside its component-size budget.
 *
 * The completion meta is passed so the strip can tell a finished job from one
 * with a loose end: a card cannot be both "Done" and "Reviewed — tip still
 * open" (owner, 2026-09-21: "it should also only have 1 check at the bottom").
 */
export function PosterStatusStrip({
  job,
  pendingApplicantCount,
  completedMeta,
  showStartClock = false,
  closedApplicants = null,
}: {
  job: Args[0];
  pendingApplicantCount: number;
  completedMeta: Args[3];
  /** "Job starts in" on the collapsed card too (owner, 2026-10-05). */
  showStartClock?: boolean;
  /** What happened to applications nobody is waiting on (owner, 2026-10-07):
   *  replaces "No applicants yet" when people did apply. */
  closedApplicants?: string | null;
}) {
  // The poster's instant-release setting: with it on there is no auto-complete
  // clock, so the collapsed line must not show one (InProgressStep agrees).
  const { profile } = useCurrentUser();
  const instantRelease = !!(profile as { auto_release_on_complete?: boolean } | null)?.auto_release_on_complete;
  const line = withClosedApplicants(posterStatusLine(job, pendingApplicantCount, undefined, completedMeta, instantRelease), closedApplicants);
  // EVERY TIME AT THE BOTTOM (owner, 2026-10-07, Q1399): the start (and, once
  // the Helpr has accepted, "until confirmation opens") go under the status
  // line in the strip, with its own clock ("left to accept", inline on the sentence),
  // soonest first, one format, instead of a pill above the strip.
  // Guard: src/test/offerCountdownRows.test.tsx.
  const clocks = showStartClock ? collapsedClocks(job, true) : [];
  return <JobStatusStrip line={line} extraClocks={clocks} />;
}
