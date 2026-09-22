/**
 * NO TRACKER ON A COLLAPSED CARD — CONTESTED INCLUDED. THE STRIP SAYS IT.
 *
 * ── THIS FILE REVERSED ITS OWN CONTRACT ON 2026-09-19, BY THE OWNER ───────
 * Read this before "fixing" it back.
 *
 * MORNING (item 13): "the tracker should not go away for a dispute or
 * revision." `187f61c3f` un-gated the whole tracker on a COLLAPSED Posts card
 * for `disputed` and `revision_requested` only, and this file pinned exactly
 * that carve-out.
 *
 * SAME DAY, with the result on screen: "similar to how dispute open displays.
 * but the live tracker should also be collapsed for disputes unless its
 * clicked to expand it."
 *
 * Both instructions are about the same thing and the second is not a
 * contradiction of the first — it is a better answer to it. What the owner
 * wanted was for a collapsed contested card to SAY SOMETHING; what item 13
 * bought was an eight-step rail and a map jammed under the title. The
 * `JobStatusStrip` says it in one sentence ("Dispute open · Payment on hold",
 * "Waiting · They're making the fix"), and the tracker goes back behind the
 * expand where every other card's detail lives.
 *
 * SO THE CLAIM IS INVERTED AND KEPT, NOT DELETED: a collapsed contested card
 * shows NO tracker AND a strip that names the dispute. Asserting the absence
 * alone would pass on a card that renders nothing at all — which is the
 * defect item 13 existed to fix, and the one this must never reintroduce.
 *
 * AND THE PERSON BOX IS UNCHANGED (V6): never on a collapsed card, exactly
 * once on an expanded one, outside the tracker. That half of this file
 * survived both rulings untouched.
 *
 * @mutate src/components/activity/PostedJobCard.tsx | {!isExpanded && (\n              <JobStatusStrip | {false && (\n              <JobStatusStrip
 * @mutate src/components/activity/PostedJobCard.tsx | <div className="pt-3" data-job-card-tracker-gap="">{trackerBlock}</div> | <div className="pt-3" data-job-card-tracker-gap="">{null}</div>
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import type { Job } from "./activityConstants";

/* PARTIAL MOCK, not a replacement. Only the <JobTracking> COMPONENT is stubbed
   (it opens a realtime channel and runs queries). Its pure exports —
   `deriveCurrentStatusIdx`, `railStepLabels`, `railDisplayIdx` — are the real
   ones, because the collapsed card's compact rail (owner, 2026-09-19) computes
   its dots from them. A mock that dropped them made every card throw, which is
   a truthful failure: the card genuinely needs that derivation now. */
vi.mock("@/components/JobTracking", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/JobTracking")>()),
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
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";

const baseJob = {
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

describe("a COLLAPSED contested Posts card says it in the STRIP, not the tracker", () => {
  it.each(["disputed", "revision_requested"])("%s: no tracker while collapsed", (status) => {
    renderCard(status, false);
    expect(
      screen.queryByTestId("tracker"),
      "the collapsed card mounts <JobTracking> — its eight-step rail, its map and a realtime " +
        "channel, on every row of the list",
    ).toBeNull();
  });

  it.each(["disputed", "revision_requested"])(
    "%s: but it is NOT silent — the strip names what the card is waiting on",
    (status) => {
      // The half that makes the absence above safe. Item 13's report was a
      // collapsed disputed card that said nothing; this is what replaced it.
      renderCard(status, false);
      const strip = document.querySelector("[data-job-status-strip]");
      expect(strip, `${status}: no tracker AND no strip — the card says nothing at all`).not.toBeNull();
      expect(strip!.textContent!.trim().length).toBeGreaterThan(8);
    },
  );

  it("disputed: the strip carries the dispute's own words and its consequence", () => {
    renderCard("disputed", false);
    const strip = document.querySelector("[data-job-status-strip]")!;
    expect(strip.textContent).toContain("Dispute open");
    expect(strip.textContent, "the money claim is gone — 'Dispute open' alone does not say " +
      "that a 72-hour clock is running on the poster's escrow").toContain("Payment on hold");
    expect(strip.getAttribute("data-dispute-open-badge"), "the shared dispute hook is gone").not.toBeNull();
  });

  it.each(["disputed", "revision_requested"])(
    "%s: collapsed shows NO Helpr person box (V6, unchanged through both rulings)",
    (status) => {
      renderCard(status, false);
      expect(screen.queryByText("Hallie H.")).toBeNull();
      expect(document.querySelector('a[href="/user/helper-1"]')).toBeNull();
    },
  );

  /* WHAT CHANGED HERE, 2026-09-19, and why it is not a weakening.
     This case read "…the box inside the tracker", because on 2026-09-16 the
     owner had put the Helpr tile in <JobTracking>'s `personTile` slot. Hours
     later they moved it again — "the helpr or posted by should be right above
     the buttons" — so the slot no longer exists and `contains` would now be
     asserting a position the owner has ruled against. The half that belongs to
     THIS file is unchanged and still asserted: on a contested card the tile
     appears when expanded, exactly once, and never while collapsed (the case
     above). Its position is asserted, by document order rather than by
     containment, in src/test/jobCardPersonTileAboveRow.test.tsx. */
  it.each(["disputed", "revision_requested"])(
    "%s: expanded shows the tracker AND the person box, exactly once and outside the tracker",
    (status) => {
      renderCard(status, true);
      const tracker = screen.getByTestId("tracker");
      const link = screen.getByText("Hallie H.").closest("a");
      expect(link).toHaveAttribute("href", "/user/helper-1");
      expect(tracker.contains(link!)).toBe(false);
      expect(document.querySelectorAll('a[href="/user/helper-1"]')).toHaveLength(1);
    },
  );

  // THE SCOPE, NOW THE OTHER WAY UP. There is no carve-out left: every status
  // collapses identically, which is what "the collapsed card is a summary"
  // means. Without this the cases above would pass on a card that had simply
  // stopped rendering a tracker anywhere.
  it.each(["accepted", "in_progress", "completed", "open"])(
    "%s: no tracker while collapsed (and now the contested ones agree)",
    (status) => {
      renderCard(status, false);
      expect(screen.queryByTestId("tracker")).toBeNull();
    },
  );

  it.each(["accepted", "in_progress", "completed", "open", "disputed", "revision_requested"])(
    "%s: tracker IS there when expanded — the re-gate hid it, it did not delete it",
    (status) => {
      renderCard(status, true);
      expect(screen.getByTestId("tracker")).toBeInTheDocument();
    },
  );

  it.each(["disputed", "revision_requested", "in_progress"])(
    "%s: expanded, the strip stands down — the body says all of it below",
    (status) => {
      renderCard(status, true);
      expect(document.querySelector("[data-job-status-strip]")).toBeNull();
    },
  );
});
