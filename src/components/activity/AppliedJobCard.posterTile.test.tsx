/**
 * ITEM 3, HELPER SIDE (owner, 2026-09-19): "the profile should be under the
 * tracker and above the map" — the same move PostedJobCard made for the Helpr's
 * tile in 9a39abbea, now on the Helpr's own My Jobs card for the POSTER.
 *
 * Before: AppliedJobCard printed the "Posted by" PersonTile in the card body,
 * ABOVE the tracker. After: HelperTrackerPanel builds it and hands it to
 * <JobTracking> as `personTile`, the slot JobTracking renders between the step
 * rail and the map — so its vertical position relative to the map is
 * JobTracking's own contract (covered by JobTracking.arrivalOnMap.test.tsx),
 * and what THIS file proves is that the helper card fills that slot, fills it
 * exactly once, and fills it only when expanded.
 *
 * THE EXPANDED GATE IS THE POINT. The poster's tracker is itself behind the
 * expand; the helper's is not (ConfirmedSection / ActiveJobSection /
 * DisputedSection render on a collapsed card), so moving the tile without
 * gating it would have put the poster's name on every collapsed Jobs card —
 * reversing V6 (owner, 2026-09-15). Owner, 2026-09-19: keep it hidden when
 * collapsed.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import type { AppliedApp, Job } from "./activityConstants";

// The tracker carries the tile in its `personTile` slot, so the double has to
// render what it is handed — a stub that drops the slot would "prove" the tile
// is missing no matter what the card does.
vi.mock("@/components/JobTracking", () => ({
  JobTracking: ({ personTile }: { personTile?: ReactNode }) => (
    <div data-testid="tracker">{personTile}</div>
  ),
}));
vi.mock("@/components/JobConfirmation", () => ({
  JobConfirmation: () => null,
  // Day-of confirmation already in: the panel's own gate is closed, which is
  // the ordinary confirmed card. Nothing in this file depends on the gate.
  helperDayOfConfirmation: () => true,
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/haptics", () => ({ hapticError: vi.fn(), hapticLight: vi.fn(), hapticWarning: vi.fn() }));
vi.mock("@/components/activity/JobCountdown", () => ({ JobCountdown: () => null }));
vi.mock("@/components/activity/JobPetCareSheet", () => ({ JobPetCareSheet: () => null }));
vi.mock("@/components/PhotoProof", () => ({ PhotoProofGroup: () => null }));
vi.mock("./JobCardMetaRow", () => ({ JobCardMetaRow: () => <div data-testid="meta" /> }));
vi.mock("./useHighlightPulse", () => ({ useHighlightPulse: () => {} }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ profile: null }) }));

import { AppliedJobCard } from "./AppliedJobCard";

const job = {
  id: "job-1",
  title: "Pressure wash the driveway",
  description: "Front driveway and the walk to the porch.",
  category: "cleaning",
  budget: 120,
  // accepted + helper_confirmed_at = the Confirmed card, which mounts
  // ConfirmedSection → HelperTrackerPanel → JobTracking.
  status: "accepted",
  customer_id: "poster-1",
  helper_id: "helper-1",
  location: "123 Main St, Lafayette, LA 70503",
  date_needed: "2026-09-20",
  start_time: "09:00",
  helper_confirmed_at: "2026-09-18T12:00:00Z",
  payment_status: "escrow",
} as unknown as Job;

const app = {
  id: "app-1",
  job_id: "job-1",
  helper_id: "helper-1",
  status: "accepted",
  posterName: "Pierre B.",
  job,
} as unknown as AppliedApp;

const noop = () => {};
function renderCard(expanded: boolean, toggle = vi.fn()) {
  return render(
    <MemoryRouter>
      <AppliedJobCard
        app={app}
        expandedJobIds={new Set(expanded ? [job.id] : [])}
        toggleExpandedJobId={toggle}
        helperReviewedJobIds={new Set()}
        userId="helper-1"
        onHelperResponse={noop}
        respondingHelperAppId={null}
        onComplete={noop}
        completingJobId={null}
        onResolveRevision={noop}
        onHelperReview={noop}
        onDispute={noop}
        onViewDispute={noop}
        onRefresh={noop}
        disputeResponse=""
        setDisputeResponse={noop}
        respondingJobId={null}
        setRespondingJobId={noop}
        submittingResponse={false}
        setSubmittingResponse={noop}
        withdrawingAppId={null}
        setWithdrawTarget={noop}
        uploadingAttachment={null}
        editingMessageAppId={null}
        setEditingMessageAppId={noop}
        editMessageText=""
        setEditMessageText={noop}
        savingMessage={false}
        handleSaveMessage={noop}
        handleAddAttachment={noop}
        handleRemoveAttachment={noop}
      />
    </MemoryRouter>,
  );
}

describe("Jobs card shows the poster as a profile tile inside the tracker (item 3)", () => {
  it("collapsed: no poster name or profile link anywhere on the card", () => {
    renderCard(false);
    // The tracker IS mounted while collapsed on this side — that is exactly why
    // the tile needs its own gate. Assert the tracker is there, so this test
    // cannot pass by the tracker simply being absent.
    expect(screen.getByTestId("tracker")).toBeInTheDocument();
    expect(screen.queryByText("Pierre B.")).toBeNull();
    expect(document.querySelector('a[href="/user/poster-1"]')).toBeNull();
  });

  it("expanded: exactly one profile tile, and it is inside the tracker", () => {
    renderCard(true);
    const name = screen.getByText("Pierre B.");
    const link = name.closest("a");
    expect(link).toHaveAttribute("href", "/user/poster-1");
    expect(link).toHaveTextContent("Posted by");
    // Exactly one — the body copy does not keep a second one now that the
    // tracker carries it.
    expect(document.querySelectorAll('a[href="/user/poster-1"]')).toHaveLength(1);
    // INSIDE the tracker: that is what puts it under the step rail and above
    // the map, which JobTracking renders below this slot.
    expect(screen.getByTestId("tracker").contains(link!)).toBe(true);
    // Still after the description — the tracker itself sits below it.
    const description = screen.getByText(/Front driveway/);
    expect(description.compareDocumentPosition(link!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("tapping the tile does not also toggle the card", () => {
    const toggle = vi.fn();
    renderCard(true, toggle);
    fireEvent.click(screen.getByText("Pierre B."));
    expect(toggle).not.toHaveBeenCalled();
  });
});

/**
 * THE FALLBACK. A state with no tracker has nowhere to put the tile, so it
 * keeps its old spot in the card body — exactly what PostedJobCard does for the
 * Helpr's tile. Without this the poster's profile would silently disappear from
 * every pending / offered / completed card, which is V6 in reverse.
 */
describe("a card with no tracker keeps the tile in its body", () => {
  it("pending + expanded: one tile, and it is NOT inside a tracker", () => {
    const pendingApp = {
      ...app,
      status: "pending",
      job: { ...job, status: "open", helper_id: null, helper_confirmed_at: null },
    } as unknown as AppliedApp;
    render(
      <MemoryRouter>
        <AppliedJobCard
          app={pendingApp}
          expandedJobIds={new Set([job.id])}
          toggleExpandedJobId={noop}
          helperReviewedJobIds={new Set()}
          userId="helper-1"
          onHelperResponse={noop} respondingHelperAppId={null}
          onComplete={noop} completingJobId={null}
          onResolveRevision={noop} onHelperReview={noop}
          onDispute={noop} onViewDispute={noop} onRefresh={noop}
          disputeResponse="" setDisputeResponse={noop}
          respondingJobId={null} setRespondingJobId={noop}
          submittingResponse={false} setSubmittingResponse={noop}
          withdrawingAppId={null} setWithdrawTarget={noop}
          uploadingAttachment={null} editingMessageAppId={null}
          setEditingMessageAppId={noop} editMessageText="" setEditMessageText={noop}
          savingMessage={false} handleSaveMessage={noop}
          handleAddAttachment={noop} handleRemoveAttachment={noop}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId("tracker")).toBeNull();
    const links = document.querySelectorAll('a[href="/user/poster-1"]');
    expect(links).toHaveLength(1);
  });
});
