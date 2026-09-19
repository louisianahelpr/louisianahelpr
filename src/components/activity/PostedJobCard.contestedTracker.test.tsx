/**
 * ITEM 13, remainder (owner, 2026-09-19): "the tracker should not go away for a
 * dispute or revision."
 *
 * 9a39abbea fixed the half INSIDE the tracker — the map vanished on a
 * submitted-then-contested job, because `markedDone` covers a submitted job and
 * the tracking row's status reads `done`. This file covers the other half: the
 * whole tracker sat behind the Posts card's expand, so a COLLAPSED disputed job
 * showed no tracker at all — which is where a poster scanning their list would
 * have seen it "go away".
 *
 * SCOPE IS THE WHOLE POINT. Only `disputed` and `revision_requested` get the
 * tracker while collapsed; every other status keeps its collapsed height
 * exactly, and nothing else from the expanded body is un-gated.
 *
 * AND THE PERSON BOX STAYS BEHIND THE EXPAND. The Helpr's PersonTile is passed
 * INTO the tracker (item 3), so un-gating the tracker would otherwise have put
 * the Helpr's name on a collapsed card — the same V6 rule the owner reaffirmed
 * on the helper side the same day. The tile's gate is `isExpanded`,
 * independently of the tracker's own gate.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import type { Job } from "./activityConstants";

vi.mock("@/components/JobTracking", () => ({
  JobTracking: ({ personTile }: { personTile?: ReactNode }) => (
    <div data-testid="tracker">{personTile}</div>
  ),
}));
vi.mock("@/components/JobConfirmation", () => ({ JobConfirmation: () => null }));
vi.mock("@/components/GroupJobHelpers", () => ({ GroupJobHelpers: () => null }));
vi.mock("@/components/activity/SeriesStrip", () => ({ SeriesStrip: () => null }));
vi.mock("@/components/activity/JobCountdown", () => ({ JobCountdown: () => null }));
vi.mock("./JobCardMetaRow", () => ({ JobCardMetaRow: () => <div data-testid="meta" /> }));
vi.mock("./postedJobCard/PostedJobApplicants", () => ({ PostedJobApplicants: () => null }));
vi.mock("./postedJobCard/PostedJobActions", () => ({ PostedJobActions: () => null }));
vi.mock("@/hooks/useFundExistingJob", () => ({ useFundExistingJob: () => ({ fundJob: vi.fn(), fundingJobId: null }) }));
vi.mock("./useHighlightPulse", () => ({ useHighlightPulse: () => {} }));

import { PostedJobCard } from "./PostedJobCard";

const baseJob = {
  id: "job-1",
  title: "Pressure wash the driveway",
  description: "Front driveway and the walk to the porch.",
  category: "cleaning",
  budget: 120,
  customer_id: "poster-1",
  helper_id: "helper-1",
  location: "Lafayette, LA",
  date_needed: "2026-09-20",
  payment_status: "escrow",
} as unknown as Job;

const noop = () => {};
function renderCard(status: string, expanded: boolean) {
  const job = { ...baseJob, status } as unknown as Job;
  return render(
    <MemoryRouter>
      <PostedJobCard
        job={job}
        applicantCounts={{}}
        expandedJobIds={new Set(expanded ? [job.id] : [])}
        toggleExpandedJobId={vi.fn()}
        helperNames={{ "helper-1": "Hallie H." }}
        helperAvatars={{ "helper-1": null }}
        completedJobMeta={{}}
        userId="poster-1"
        onBoost={noop} onEdit={noop} onCancel={noop} onComplete={noop} completingJobId={null}
        onRevision={noop} onNoShow={noop} onTip={noop} onReview={noop} onDispute={noop} onReport={noop}
        onViewDispute={noop} onConfirmArrival={noop} confirmingArrivalJobId={null}
        onConfirmWorking={noop} confirmingWorkingJobId={null}
        onLoadApplications={noop} onLoadInlineApplicants={noop}
        inlineApplicants={{}} loadingApplicants={{}} applicantErrors={{}}
        onActionComplete={noop}
      />
    </MemoryRouter>,
  );
}

describe("a COLLAPSED contested Posts card still shows the tracker (item 13)", () => {
  it.each(["disputed", "revision_requested"])("%s: tracker present while collapsed", (status) => {
    renderCard(status, false);
    expect(screen.getByTestId("tracker")).toBeInTheDocument();
  });

  it.each(["disputed", "revision_requested"])(
    "%s: collapsed shows the tracker WITHOUT the Helpr's person box (V6)",
    (status) => {
      renderCard(status, false);
      expect(screen.getByTestId("tracker")).toBeInTheDocument();
      expect(screen.queryByText("Hallie H.")).toBeNull();
      expect(document.querySelector('a[href="/user/helper-1"]')).toBeNull();
    },
  );

  it.each(["disputed", "revision_requested"])(
    "%s: expanded shows the tracker AND the person box, the box inside the tracker",
    (status) => {
      renderCard(status, true);
      const tracker = screen.getByTestId("tracker");
      const link = screen.getByText("Hallie H.").closest("a");
      expect(link).toHaveAttribute("href", "/user/helper-1");
      expect(tracker.contains(link!)).toBe(true);
      expect(document.querySelectorAll('a[href="/user/helper-1"]')).toHaveLength(1);
    },
  );

  // THE SCOPE. Every ordinary status collapses to exactly what it did before —
  // the un-gate is `contested` and nothing wider. Without this the test above
  // would pass just as happily on a card that always draws its tracker.
  it.each(["accepted", "in_progress", "completed", "open"])(
    "%s: no tracker while collapsed (unchanged)",
    (status) => {
      renderCard(status, false);
      expect(screen.queryByTestId("tracker")).toBeNull();
    },
  );

  it.each(["accepted", "in_progress", "completed", "open"])(
    "%s: tracker still there when expanded (the un-gate took nothing away)",
    (status) => {
      renderCard(status, true);
      expect(screen.getByTestId("tracker")).toBeInTheDocument();
    },
  );
});
