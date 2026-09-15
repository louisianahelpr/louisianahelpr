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
import type { Job } from "./activityConstants";

vi.mock("@/components/JobTracking", () => ({ JobTracking: () => <div data-testid="tracker" /> }));
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

describe("Posts card shows the Helpr as a profile tile, expanded only (VN-22)", () => {
  it("collapsed: no Helpr name or profile link anywhere on the card", () => {
    renderCard(false);
    expect(screen.queryByText("Hallie H.")).toBeNull();
    expect(document.querySelector('a[href="/user/helper-1"]')).toBeNull();
  });

  it("expanded: a profile tile under the description, linking to /user/:id", () => {
    renderCard(true);
    const name = screen.getByText("Hallie H.");
    const link = name.closest("a");
    expect(link).toHaveAttribute("href", "/user/helper-1");
    expect(link).toHaveTextContent("Helpr");
    // Exactly one — the tiny row is gone, not merely hidden.
    expect(document.querySelectorAll('a[href="/user/helper-1"]')).toHaveLength(1);
    // Under the description.
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
