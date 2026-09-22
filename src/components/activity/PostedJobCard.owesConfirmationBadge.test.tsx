/**
 * ITEM 6e (owner, 2026-09-19): "on poster i see no button to confirm they
 * arrived, are working, confirmed offered."
 *
 * The controls WERE rendering — behind the expand. A poster who never opens the
 * card never learns they are the one holding the job up, which is the most
 * likely reason the owner reported them as missing entirely. Decision: the
 * controls stay inside the expanded card, and the COLLAPSED card gains a signal
 * that one is waiting.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM posterConfirmationBadge.test.tsx: that
 * file proves the BADGE behaves (silent unless a rung is actually enabled).
 * It renders the badge directly, so deleting the one line that mounts the badge
 * inside PostedJobCard left it green — the wiring was unproven, and a fix
 * nothing can fail on is not a fix. This file asserts the INTEGRATION: that the
 * collapsed real card renders it, and the expanded one does not.
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Job } from "./activityConstants";
import { posterOwesConfirmation } from "./postedJobCard/steps/posterStepContract";

/* PARTIAL MOCK, not a replacement. Only the <JobTracking> COMPONENT is stubbed
   (it opens a realtime channel and runs queries). Its pure exports —
   `deriveCurrentStatusIdx`, `railStepLabels`, `railDisplayIdx` — are the real
   ones, because the collapsed card's compact rail (owner, 2026-09-19) computes
   its dots from them. A mock that dropped them made every card throw, which is
   a truthful failure: the card genuinely needs that derivation now. */
vi.mock("@/components/JobTracking", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/JobTracking")>()), JobTracking: () => <div data-testid="tracker" /> }));
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
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";

const noop = () => {};

/** in_progress + Helpr arrived + poster has NOT vouched = a rung is enabled. */
const owingJob = {
  id: "job-1",
  title: "Pressure wash the driveway",
  description: "Front driveway and the walk to the porch.",
  category: "cleaning",
  budget: 120,
  customer_id: "poster-1",
  helper_id: "helper-1",
  location: "Lafayette, LA",
  date_needed: jobLocalDateISO(0),
  payment_status: "escrow",
  status: "in_progress",
  helper_confirmed_at: "2026-09-19T12:00:00Z",
  helper_arrived_at: "2026-09-19T14:00:00Z",
  poster_confirmed_arrival_at: null,
  poster_confirmed_working_at: null,
  helper_completed_at: null,
} as unknown as Job;

function renderCard(job: Job, expanded: boolean) {
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

describe("the COLLAPSED Posts card signals an owed confirmation (item 6e)", () => {
  it("the fixture really does owe one — otherwise this whole file is vacuous", () => {
    expect(posterOwesConfirmation(owingJob)).toBe(true);
  });

  it("collapsed: the card mounts the badge", () => {
    renderCard(owingJob, false);
    expect(document.querySelector("[data-poster-owes-confirmation]")).not.toBeNull();
  });

  it("expanded: no badge — the real control is in the row instead", () => {
    renderCard(owingJob, true);
    expect(document.querySelector("[data-poster-owes-confirmation]")).toBeNull();
  });

  it("collapsed but nothing owed: silent", () => {
    const settled = { ...owingJob, poster_confirmed_arrival_at: "2026-09-19T14:05:00Z", poster_confirmed_working_at: "2026-09-19T14:10:00Z" } as unknown as Job;
    expect(posterOwesConfirmation(settled)).toBe(false);
    renderCard(settled, false);
    expect(document.querySelector("[data-poster-owes-confirmation]")).toBeNull();
  });
});
// The point of this file is the WIRING, not the badge: posterConfirmationBadge
// .test.tsx renders the badge directly and stayed green with the mount deleted.
// Unmount the strip and the collapsed card goes silent about the one move only
// the poster can make.
// @mutate src/components/activity/PostedJobCard.tsx | {!isExpanded && ( | {false && (
