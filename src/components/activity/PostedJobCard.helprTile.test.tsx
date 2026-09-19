/**
 * VN-22 (owner, 2026-09-14): "the profile for who's working the job should be
 * shown when the job is expanded under the job description, not in that little
 * area" — and REMOVE the small "H Hallie H." line from the collapsed card.
 *
 * Before: a collapsed Posts card printed a 16px monogram + name link in its
 * meta block, and an expanded card with a tracker showed no profile at all.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import type { Job } from "./activityConstants";

// The tracker now carries the Helpr tile in its `personTile` slot (owner,
// 2026-09-16), so the double has to render what it is handed — a stub that
// drops the slot would "prove" the tile is missing.
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

const job = {
  id: "job-1",
  title: "Pressure wash the driveway",
  description: "Front driveway and the walk to the porch.",
  category: "cleaning",
  budget: 120,
  status: "in_progress",
  customer_id: "poster-1",
  helper_id: "helper-1",
  location: "Lafayette, LA",
  date_needed: "2026-09-20",
  payment_status: "escrow",
} as unknown as Job;

const noop = () => {};
function renderCard(expanded: boolean, toggle = vi.fn()) {
  return render(
    <MemoryRouter>
      <PostedJobCard
        job={job}
        applicantCounts={{}}
        expandedJobIds={new Set(expanded ? [job.id] : [])}
        toggleExpandedJobId={toggle}
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

/**
 * 2026-09-16 (owner): the tile MOVED again — out of the card body and INTO the
 * tracker, between the step rail and the map ("the profile should be under the
 * tracker and above the map"). It is still expanded-only, still exactly one
 * profile link, and still after the description; what changed is that the
 * tracker is now its parent, which is what puts it above the map.
 */
describe("Posts card shows the Helpr as a profile tile, expanded only (VN-22)", () => {
  it("collapsed: no Helpr name or profile link anywhere on the card", () => {
    renderCard(false);
    expect(screen.queryByText("Hallie H.")).toBeNull();
    expect(document.querySelector('a[href="/user/helper-1"]')).toBeNull();
  });

  it("expanded: a profile tile inside the tracker, linking to /user/:id", () => {
    renderCard(true);
    const name = screen.getByText("Hallie H.");
    const link = name.closest("a");
    expect(link).toHaveAttribute("href", "/user/helper-1");
    expect(link).toHaveTextContent("Helpr");
    // Exactly one — the tiny row is gone, not merely hidden, and the body copy
    // does not keep a second one now that the tracker carries it.
    expect(document.querySelectorAll('a[href="/user/helper-1"]')).toHaveLength(1);
    // INSIDE the tracker (owner, 2026-09-16): that is what puts it under the
    // step rail and above the map, which the tracker renders below this slot.
    const tracker = screen.getByTestId("tracker");
    expect(tracker.contains(link!)).toBe(true);
    // Still after the description — the tracker itself sits below it.
    const description = screen.getByText(/Front driveway/);
    expect(description.compareDocumentPosition(link!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("tapping the tile does not also toggle the card", () => {
    const toggle = vi.fn();
    renderCard(true, toggle);
    fireEvent.click(screen.getByText("Hallie H."));
    expect(toggle).not.toHaveBeenCalled();
  });
});
