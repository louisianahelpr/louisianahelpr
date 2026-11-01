/**
 * AN OPEN JOB THAT HAD APPLICANTS NEVER SAYS "No applicants yet" (audit 2026-10-29 A2-B15, second half).
 *
 * The bug (AA9 chunk 1a, aa9-ns-pafter-card-375.png): after a no-show report the poster's card read "No applicants
 * yet" right above its own "Applicants (1)" button. The collapsed strip already swaps that line for what happened
 * to the applications (withClosedApplicants), and the open card's tracker (<JobTracking>) built its own line knowing
 * no applicants at all, so with someone waiting it still said "Pick your Helpr" instead of the card's "Applicants are
 * waiting".
 *
 * The fix: the card's one line carries the closed-applicants swap, and an OPEN card hands that line to its tracker
 * (`progressCard`), so the face, the bar and the open tracker say one thing. (The swap on `cardLine` itself has no
 * mutation here: on the Posted step jobProgress keeps its own sentence, so no render reads that detail today; b32
 * proved a mutation of it stays green, so none is registered.)
 *
 * @mutate src/pages/posts/PostedJobCard.tsx | progressCard={job.status === "open" ? { line: cardLine, face: faceAction } : undefined} | progressCard={undefined}
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Job } from "../../components/job-card/activityConstants";

vi.mock("@/hooks/useJobRescheduled", () => ({ useJobRescheduled: () => false }));
vi.mock("@/hooks/useJobAccessNote", () => ({ useJobAccessNote: () => null, fetchJobAccessNote: async () => null }));
vi.mock("@/hooks/useUnsettledDisputeJobIds", () => ({ useUnsettledDisputeJobIds: () => undefined }));
vi.mock("@/hooks/useCurrentUser", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useCurrentUser")>()),
  useCurrentUser: () => ({ profile: null }),
}));
/* <JobTracking> opens a realtime channel and runs queries, so only its component is stubbed; the stub prints the line
   the real one prints: jobProgress over the same job fields and the same `card` option the real component passes. */
vi.mock("@/components/JobTracking", async (importOriginal) => {
  const { jobProgress } = await import("@/components/tracker/jobProgressState");
  return {
    ...(await importOriginal<typeof import("@/components/JobTracking")>()),
    JobTracking: (p: { jobId: string; jobStatus: string; helperId: string | null; jobDateNeeded: string; progressCard?: Parameters<typeof jobProgress>[1]["card"] }) => {
      const progress = jobProgress(
        { id: p.jobId, status: p.jobStatus, helper_id: p.helperId, date_needed: p.jobDateNeeded, start_time: null } as Parameters<typeof jobProgress>[0],
        { viewer: "poster", card: p.progressCard },
      );
      return <div data-testid="tracker">{progress.next}</div>;
    },
  };
});
vi.mock("@/components/schedule/ScheduleChangeControl", () => ({ ScheduleChangeControl: () => null, ScheduleChangeAskDialog: () => null, usePendingScheduleChange: () => ({ data: null }) }));
vi.mock("@/components/series/SeriesDatesPanel", () => ({ SeriesDatesPanel: () => null }));
vi.mock("@/components/JobConfirmation", () => ({ JobConfirmation: () => null }));
vi.mock("@/components/GroupJobHelpers", () => ({ GroupJobHelpers: () => null }));
vi.mock("@/pages/posts/SeriesStrip", () => ({ SeriesStrip: () => null }));
vi.mock("@/components/job-card/JobCountdown", () => ({ JobCountdown: () => null }));
vi.mock("../../components/job-card/JobCardMetaRow", () => ({ JobCardMetaRow: () => <div data-testid="meta" /> }));
vi.mock("./postedJobCard/PostedJobApplicants", () => ({ PostedJobApplicants: () => null }));
vi.mock("./postedJobCard/PostedJobActions", () => ({ PostedJobActions: () => null }));
vi.mock("../../components/job-card/useHighlightPulse", () => ({ useHighlightPulse: () => {} }));

import { PostedJobCard } from "./PostedJobCard";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";

const job = {
  id: "job-1",
  title: "Rake the yard",
  description: "Front and back.",
  category: "yard",
  budget: 40,
  customer_id: "poster-1",
  helper_id: null,
  status: "open",
  location: "Baton Rouge, LA",
  date_needed: jobLocalDateISO(3),
  payment_status: "escrow",
} as unknown as Job;

const noop = () => {};
function renderCard(expanded: boolean, counts: { pending?: number; closed?: string }) {
  return render(
    <MemoryRouter>
      <PostedJobCard
        job={job}
        applicantCounts={{ "job-1": 1 }}
        pendingApplicantCounts={counts.pending ? { "job-1": counts.pending } : {}}
        closedApplicantSummaries={counts.closed ? { "job-1": counts.closed } : {}}
        expandedJobIds={new Set(expanded ? [job.id] : [])}
        toggleExpandedJobId={vi.fn()}
        helperNames={{}}
        completedJobMeta={{}}
        userId="poster-1"
        onBoost={noop} onEdit={noop} onCancel={noop} onComplete={noop} completingJobId={null}
        onNoShow={noop} onTip={noop} onReview={noop} onDispute={noop} onReport={noop}
        onViewDispute={noop} onConfirmArrival={noop} confirmingArrivalJobId={null}
        onConfirmWorking={noop} confirmingWorkingJobId={null}
        onLoadApplications={noop} onLoadInlineApplicants={noop}
        inlineApplicants={{}} loadingApplicants={{}} applicantErrors={{}}
        onActionComplete={noop}
      />
    </MemoryRouter>,
  );
}

describe("an open job that had applicants never says 'No applicants yet' (A2-B15)", () => {
  it("the inventory is real: with nobody ever applying, the card does say it and the open tracker says its own step", () => {
    const { container, unmount } = renderCard(false, {});
    expect(container.textContent).toContain("No applicants yet");
    unmount();
    // Same step as the card (Posted, nobody's move): the tracker keeps its own sentence (jobProgress `sameStep`).
    const { getByTestId } = renderCard(true, {});
    expect(getByTestId("tracker").textContent).toBe("Pick your Helpr");
  });

  it("collapsed, after the only applicant's application closed: the card names it, nowhere 'No applicants yet'", () => {
    const { container } = renderCard(false, { closed: "1 applicant · declined" });
    expect(container.textContent).toContain("1 applicant · declined");
    expect(container.textContent).not.toContain("No applicants yet");
  });

  it("open, after the only applicant's application closed: nowhere on the card 'No applicants yet'", () => {
    const { container, getByTestId } = renderCard(true, { closed: "1 applicant · declined" });
    expect(container.textContent).not.toContain("No applicants yet");
    expect(getByTestId("tracker").textContent).not.toContain("No applicants yet");
  });

  it("open, with someone waiting: the tracker reads the card's line, not a line that knows no applicants", () => {
    const { getByTestId } = renderCard(true, { pending: 1 });
    expect(getByTestId("tracker").textContent).toBe("Applicants are waiting");
  });
});
