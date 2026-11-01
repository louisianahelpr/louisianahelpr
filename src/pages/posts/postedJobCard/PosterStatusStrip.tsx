import { collapsedClocks } from "@/components/job-card/collapsedClocks";
import { JobStatusStrip } from "@/components/job-card/JobStatusStrip";
import { posterStatusLine } from "@/components/job-card/jobStatusLine";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { CountdownRows } from "@/components/job-card/CountdownRows";
import { jobNextStep } from "@/components/tracker/jobNextStep";
import type { JobProgressState } from "@/components/tracker/jobProgressState";
import { NextStep } from "@/components/ui/NextStep";
import { APPROVAL_WINDOW_HOURS, hoursToMs } from "../../../../supabase/functions/_shared/escrowTiming";

/** Lines that carry the offer's LIVE accept clock (DeadlineCountdown): they keep the strip (A3-15). */
const LIVE_ACCEPT_CLOCK: ReadonlySet<string> = new Set(["offer_out", "unconfirmed"]);

/** The card's review window in the line: "23h 49m left" (the job page's line adds who steps in after). */
function approveLeftShort(deadlineMs: number, now = Date.now()): string {
  const mins = Math.floor((deadlineMs - now) / 60_000);
  if (mins <= 0) return "time's up, Helpr support steps in";
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m left` : `${mins}m left`;
}

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
  helperName = null,
  variant = "band",
  progress = null,
  otherFirst = null,
}: {
  job: Args[0];
  pendingApplicantCount: number;
  completedMeta: Args[3];
  /** "Job starts in" on the collapsed card too (owner, 2026-10-05). */
  showStartClock?: boolean;
  /** What happened to applications nobody is waiting on (owner, 2026-10-07):
   *  replaces "No applicants yet" when people did apply. */
  closedApplicants?: string | null;
  /** The hired Helpr's name, for "Lexi accepted" (Q1552). */
  helperName?: string | null;
  /** `line` on the mine-card face (boards 14/21). */
  variant?: "band" | "line";
  /** The card's tracker state (jobProgress, the same the face's bar draws). With it, the face line is the shared
   *  next step (A3-15, owner 11-01 "next step everywhere"): jobNextStep, the words the job page prints. */
  progress?: JobProgressState | null;
  /** The hired Helpr's first name, for "Approve Yusef's work". */
  otherFirst?: string | null;
}) {
  // The poster's instant-release setting: with it on there is no auto-complete
  // clock, so the collapsed line must not show one (InProgressStep agrees).
  const { profile } = useCurrentUser();
  const instantRelease = !!(profile as { auto_release_on_complete?: boolean } | null)?.auto_release_on_complete;
  const line = withClosedApplicants(posterStatusLine(job, pendingApplicantCount, undefined, completedMeta, instantRelease, job.helper_id ? helperName : null), closedApplicants);
  // EVERY TIME AT THE BOTTOM (owner, 2026-10-07, Q1399): the start (and, once
  // the Helpr has accepted, "until confirmation opens") go under the status
  // line in the strip, with its own clock ("left to accept", inline on the sentence),
  // soonest first, one format, instead of a pill above the strip.
  // Guard: src/test/offerCountdownRows.test.tsx.
  const clocks = showStartClock ? collapsedClocks(job, true) : [];
  // A3-15: on the face, on the path, the line is the job page's next step ("Next: confirm the job is still on · by Mon
  // 10:00 AM", "Waiting on Yusef to confirm · ...", "Next: approve Yusef's work · 23h 49m left"). A dispute keeps its
  // alarm line, a job off the path (cancelled, expired) keeps its own words, and an OPEN job (stage 0) keeps its line:
  // it names the applicants and what happened to closed applications. An offer out keeps its line too: it carries the
  // offer's live clock ("Nm left to accept"), which the next-step line has no way to draw; so does a hire the Helpr
  // has not accepted yet ("Offer sent — Yusef hasn't accepted yet · 42m left to accept").
  // Any other line with its own LIVE deadline clock (a confirm window, owner 2026-10-23 card critique item 7) keeps it
  // too, except the approval: there the job page and the chat card already say the window as words ("23h 49m left").
  const completedAt = (job as { helper_completed_at?: string | null }).helper_completed_at ?? null;
  const step = variant === "line" && progress && progress.stage !== null && progress.stage > 0 && line.tone !== "alarm" && !LIVE_ACCEPT_CLOCK.has(line.id) && (!line.deadline || progress.stage === 7)
    ? jobNextStep(progress, {
        side: "poster",
        otherFirst,
        pendingApplicants: pendingApplicantCount,
        approveLeft: progress.stage === 7 && progress.waitingOnYou && completedAt && !instantRelease
          ? approveLeftShort(Date.parse(completedAt) + hoursToMs(APPROVAL_WINDOW_HOURS))
          : null,
      })
    : null;
  if (step) {
    return (
      <span className="block" data-job-status-strip={line.id} data-job-status-variant="line" data-job-status-tone={line.tone} data-card-next-step="" {...(line.owesConfirmation ? { "data-poster-owes-confirmation": "" } : {})}>
        <NextStep value={step} className="!text-ds-13" />
        {clocks.length > 0 && <CountdownRows clocks={clocks} variant="bare" />}
      </span>
    );
  }
  return <JobStatusStrip line={line} extraClocks={clocks} variant={variant} />;
}
