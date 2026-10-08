/**
 * Owner, 2026-10-08 (Q1567): "on all post or job cards, when the card is
 * expanded, the timer goes above the helpr and the description goes above the
 * tracker ... nothing ever below the button when expanded".
 *
 * The class, on the poster's card: description, then tracker, then timer and
 * the date/time request, then the actions (person tile + the one row); nothing
 * of the card's body after the row.
 *
 * @mutate src/pages/posts/PostedJobCard.tsx |               <div className="pt-3" data-job-card-tracker-gap="">{trackerBlock}</div> |
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Job } from "../../components/job-card/activityConstants";

// The tracker no longer carries the tile at all (owner, 2026-09-19 — third
// position in five days; see jobCardPerson.tsx). A marker, so the assertions
// below can measure against it rather than against nothing.
/* PARTIAL MOCK, not a replacement. Only the <JobTracking> COMPONENT is stubbed
   (it opens a realtime channel and runs queries). Its pure exports —
   `deriveCurrentStatusIdx`, `railStepLabels`, `railDisplayIdx` — are the real
   ones, because the collapsed card's compact rail (owner, 2026-09-19) computes
   its dots from them. A mock that dropped them made every card throw, which is
   a truthful failure: the card genuinely needs that derivation now. */
// Q344: the cards read unsettled decided disputes through React Query; none here.
// Q1461: the Access & Parking note is a network read once a card opens; none here.
vi.mock("@/hooks/useJobAccessNote", () => ({ useJobAccessNote: () => null, fetchJobAccessNote: async () => null }));
vi.mock("@/hooks/useUnsettledDisputeJobIds", () => ({ useUnsettledDisputeJobIds: () => undefined }));
// The card reads the poster's instant-release flag; these tests render without a QueryClient.
vi.mock("@/hooks/useCurrentUser", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useCurrentUser")>()),
  useCurrentUser: () => ({ profile: null }),
}));
vi.mock("@/components/JobTracking", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/JobTracking")>()),
  JobTracking: () => <div data-testid="tracker" />,
}));
vi.mock("@/components/JobConfirmation", () => ({ JobConfirmation: () => null }));
vi.mock("@/components/GroupJobHelpers", () => ({ GroupJobHelpers: () => null }));
vi.mock("@/pages/posts/SeriesStrip", () => ({ SeriesStrip: () => null }));
vi.mock("@/components/job-card/JobCountdown", () => ({ JobCountdown: () => null }));
vi.mock("@/components/job-card/CountdownRows", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/job-card/CountdownRows")>()),
  CountdownRows: () => <div data-testid="clocks" />,
}));
vi.mock("@/components/series/JobSeriesCardControls", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/series/JobSeriesCardControls")>()),
  ScheduleChangeForJob: () => <div data-testid="schedule-change" />,
}));
vi.mock("../../components/job-card/JobCardMetaRow", () => ({ JobCardMetaRow: () => <div data-testid="meta" /> }));
vi.mock("./postedJobCard/PostedJobApplicants", () => ({ PostedJobApplicants: () => null }));
// NULL ON PURPOSE, and it is what this file is now testing. With no action row
// on the card nothing claims the Helpr tile, so what renders here is the CARD'S
// FALLBACK — the path that keeps the profile on a cancelled or pending_approval
// post, where PostedJobActions genuinely returns null. The tile's normal
// position (directly above the row) is proved against the real actions in
// src/test/jobCardPersonTileAboveRow.test.tsx.
vi.mock("./postedJobCard/PostedJobActions", () => ({ PostedJobActions: () => <div data-testid="actions-row" /> }));
vi.mock("../../components/job-card/useHighlightPulse", () => ({ useHighlightPulse: () => {} }));

import { PostedJobCard } from "./PostedJobCard";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";


const job = {
  id: "job-1", title: "Pressure wash the driveway", description: "Front driveway and the walk to the porch.",
  category: "cleaning", budget: 120, status: "accepted", customer_id: "poster-1", helper_id: "helper-1",
  helper_confirmed_at: "2026-01-01T00:00:00Z", location: "Lafayette, LA", date_needed: jobLocalDateISO(3),
  start_time: "14:00:00", payment_status: "escrow",
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

const before = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe("the expanded poster card reads top to bottom in the contract's order (Q1567)", () => {
  it("description -> tracker -> timer -> request -> actions, nothing after the actions", () => {
    renderCard(true);
    const desc = screen.getByText("Front driveway and the walk to the porch.");
    const tracker = screen.getByTestId("tracker");
    const clocks = screen.getByTestId("clocks");
    const request = screen.getByTestId("schedule-change");
    const row = screen.getByTestId("actions-row");
    expect(before(desc, tracker), "description above the tracker").toBe(true);
    expect(before(tracker, clocks), "the timer below the tracker").toBe(true);
    expect(before(clocks, row) && before(request, row), "timer and request above the row").toBe(true);
    const body = row.closest("[data-job-card-body]") ?? row.parentElement!.parentElement!;
    const after = [...body.querySelectorAll("*")].filter((el) => before(row, el) && !row.contains(el) && el.textContent?.trim());
    expect(after.map((el) => el.outerHTML.slice(0, 80)), "nothing with content after the row").toEqual([]);
  });
});
