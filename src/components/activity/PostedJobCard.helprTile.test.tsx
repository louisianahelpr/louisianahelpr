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

// The tracker no longer carries the tile at all (owner, 2026-09-19 — third
// position in five days; see jobCardPerson.tsx). A marker, so the assertions
// below can measure against it rather than against nothing.
vi.mock("@/components/JobTracking", () => ({
  JobTracking: () => <div data-testid="tracker" />,
}));
vi.mock("@/components/JobConfirmation", () => ({ JobConfirmation: () => null }));
vi.mock("@/components/GroupJobHelpers", () => ({ GroupJobHelpers: () => null }));
vi.mock("@/components/activity/SeriesStrip", () => ({ SeriesStrip: () => null }));
vi.mock("@/components/activity/JobCountdown", () => ({ JobCountdown: () => null }));
vi.mock("./JobCardMetaRow", () => ({ JobCardMetaRow: () => <div data-testid="meta" /> }));
vi.mock("./postedJobCard/PostedJobApplicants", () => ({ PostedJobApplicants: () => null }));
// NULL ON PURPOSE, and it is what this file is now testing. With no action row
// on the card nothing claims the Helpr tile, so what renders here is the CARD'S
// FALLBACK — the path that keeps the profile on a cancelled or pending_approval
// post, where PostedJobActions genuinely returns null. The tile's normal
// position (directly above the row) is proved against the real actions in
// src/test/jobCardPersonTileAboveRow.test.tsx.
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
 * 2026-09-19 (owner): the tile MOVED AGAIN — out of the tracker and to directly
 * above the action row ("the helpr or posted by should be right above the
 * buttons"). It is still expanded-only, still exactly one profile link, and
 * still after the description. What this file now pins is the half that is
 * local to the CARD — the V6 collapsed gate, the exactly-one count, the
 * no-toggle tap, and the FALLBACK for a status that draws no action row.
 * Its position relative to the row is pinned in
 * src/test/jobCardPersonTileAboveRow.test.tsx, which renders the real
 * PostedJobActions and asserts with compareDocumentPosition.
 */
describe("Posts card shows the Helpr as a profile tile, expanded only (VN-22)", () => {
  it("collapsed: no Helpr name or profile link anywhere on the card", () => {
    renderCard(false);
    expect(screen.queryByText("Hallie H.")).toBeNull();
    expect(document.querySelector('a[href="/user/helper-1"]')).toBeNull();
  });

  it("expanded: a profile tile linking to /user/:id, exactly one", () => {
    renderCard(true);
    const name = screen.getByText("Hallie H.");
    const link = name.closest("a");
    expect(link).toHaveAttribute("href", "/user/helper-1");
    expect(link).toHaveTextContent("Helpr");
    // Exactly one — the tiny row is gone, not merely hidden, and the body copy
    // does not keep a second one now that the tracker carries it.
    expect(document.querySelectorAll('a[href="/user/helper-1"]')).toHaveLength(1);
    // NOT inside the tracker any more (owner, 2026-09-19). The tracker is a
    // real element in this render, so this assertion can actually fail.
    expect(screen.getByTestId("tracker").contains(link!)).toBe(false);
    // Still after the description.
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
