/**
 * ITEM 2, HELPER SIDE (owner, 2026-09-19): "the helpr or posted by should be
 * right above the buttons", and "these changes all apply to jobs also".
 *
 * THE TILE HAS MOVED THREE TIMES IN FIVE DAYS and this file has been rewritten
 * with it each time, so the history is worth keeping straight: card body under
 * the description (VN-22) → inside the tracker between the rail and the map
 * (2026-09-16, the version this comment replaces) → directly above the action
 * row (now). `HelperTrackerPanel` no longer builds a tile at all and
 * `CardExpandedContext` went with it; both cards publish one tile through
 * `JobCardPersonContext` and the step shell renders it.
 *
 * What THIS file proves is the half local to the helper card: exactly one tile,
 * only when expanded, not inside the tracker, and still present in the
 * tracker-less states. Its position relative to the row is asserted with
 * compareDocumentPosition in src/test/jobCardPersonTileAboveRow.test.tsx.
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
import type { AppliedApp, Job } from "../../components/job-card/activityConstants";

// The tracker no longer carries the tile (owner, 2026-09-19). A real marker
// element, so "not in the tracker" and "the tracker is nevertheless mounted on
// a collapsed card" are both assertions that can fail.
/* PARTIAL MOCK, not a replacement. Only the <JobTracking> COMPONENT is stubbed
   (it opens a realtime channel and runs queries). Its pure exports —
   `deriveCurrentStatusIdx`, `railStepLabels`, `railDisplayIdx` — are the real
   ones, because the collapsed card's compact rail (owner, 2026-09-19) computes
   its dots from them. A mock that dropped them made every card throw, which is
   a truthful failure: the card genuinely needs that derivation now. */
vi.mock("@/components/JobTracking", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/JobTracking")>()),
  JobTracking: () => <div data-testid="tracker" />,
}));
vi.mock("@/components/JobConfirmation", () => ({
  JobConfirmation: () => null,
  // Day-of confirmation already in: the panel's own gate is closed, which is
  // the ordinary confirmed card. Nothing in this file depends on the gate.
  helperDayOfConfirmation: () => true,
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));
// The change-request control and the series dates panel read through React
// Query; this card test renders without a QueryClient and is not about them.
vi.mock("@/components/schedule/ScheduleChangeControl", () => ({ ScheduleChangeControl: () => null }));
vi.mock("@/components/series/SeriesDatesPanel", () => ({ SeriesDatesPanel: () => null }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/haptics", () => ({ hapticError: vi.fn(), hapticLight: vi.fn(), hapticWarning: vi.fn() }));
vi.mock("@/components/job-card/JobCountdown", () => ({ JobCountdown: () => null }));
vi.mock("@/pages/jobs/JobPetCareSheet", () => ({ JobPetCareSheet: () => null }));
vi.mock("@/components/PhotoProof", () => ({ PhotoProofGroup: () => null, PhotoProofDialog: () => null }));
vi.mock("../../components/job-card/JobCardMetaRow", () => ({ JobCardMetaRow: () => <div data-testid="meta" /> }));
vi.mock("../../components/job-card/useHighlightPulse", () => ({ useHighlightPulse: () => {} }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ profile: null }) }));

import { AppliedJobCard } from "./AppliedJobCard";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";

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
  date_needed: jobLocalDateISO(0),
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

describe("Jobs card shows the poster as a profile tile, expanded only (item 2)", () => {
  it("collapsed: no poster name or profile link anywhere on the card", () => {
    renderCard(false);
    /* THE TRACKER IS NO LONGER MOUNTED WHILE COLLAPSED (owner, 2026-09-19:
       "jobs should open collapsed just like post does"). This used to assert
       `getByTestId("tracker")` here, precisely BECAUSE the helper's card drew
       the full tracker on a collapsed card and the tile therefore needed its
       own gate — see the file header.

       The gate and the reason for it both still stand, so the assertion is
       re-pointed rather than dropped: the collapsed card now draws the STATUS
       STRIP, which is a real element saying what this same job is waiting on,
       so this case still cannot pass by the card simply rendering nothing.
       (It was the compact 16px rail for a few hours on 2026-09-19; the owner
       replaced the dots with the sentence the same day.) */
    expect(document.querySelector("[data-job-status-strip]")).toBeInTheDocument();
    expect(screen.queryByTestId("tracker"), "the full tracker is back on a collapsed card").toBeNull();
    expect(screen.queryByText("Pierre B.")).toBeNull();
    expect(document.querySelector('a[href="/user/poster-1"]')).toBeNull();
  });

  it("expanded: exactly one profile tile, and it is NOT inside the tracker", () => {
    renderCard(true);
    const name = screen.getByText("Pierre B.");
    const link = name.closest("a");
    expect(link).toHaveAttribute("href", "/user/poster-1");
    expect(link).toHaveTextContent("Posted by");
    // Exactly one — the body copy does not keep a second one now that the
    // tracker carries it.
    expect(document.querySelectorAll('a[href="/user/poster-1"]')).toHaveLength(1);
    // OUT of the tracker (owner, 2026-09-19). The tracker is mounted in this
    // render, so the assertion has something real to be false about.
    expect(screen.getByTestId("tracker").contains(link!)).toBe(false);
    // Still after the description.
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
 * THE FALLBACK. A state that mounts no STEP CARD has no row for the tile to sit
 * above, so the card body prints it — exactly what PostedJobCard does for the
 * Helpr's tile on a cancelled post. Without it the poster's profile would
 * silently disappear from every pending / offered / not-selected card, which is
 * V6 in reverse. Five of this card's states are like that, which is why the
 * mechanism is a CLAIM from the shell and not a hand-copied list of statuses.
 */
describe("a card with no step card keeps the tile in its body", () => {
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

// Proof this guard can fail: the expanded gate IS the point (file header). Drop
// it and the poster name + profile link land on every COLLAPSED Jobs card,
// which is V6 (owner, 2026-09-15) in reverse.
// @mutate src/pages/jobs/AppliedJobCard.tsx | isExpanded && posterId && app.posterName ? ( | posterId && app.posterName ? (
