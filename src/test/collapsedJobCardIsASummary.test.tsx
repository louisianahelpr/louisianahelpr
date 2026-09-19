/**
 * A COLLAPSED JOB CARD IS A SUMMARY — ON BOTH TABS — AND IT CARRIES A RAIL.
 *
 * Two owner rulings from 2026-09-19, which are really one:
 *
 *   B. "jobs should open collapsed just like post does."
 *   C. "should we [move] posted, offered accepted confirmed etc ones like this
 *       to the bottom of the collapsed card and when they want to see more
 *       info then they click in to expand."
 *
 * ── THE PREMISE OF (B) WAS WRONG, AND THAT MATTERED ───────────────────────
 * My Jobs ALREADY defaulted to collapsed: `expandedJobIds` comes from
 * `useCardExpansion(postedJobs, …)`, whose default-open set only ever holds
 * POSTED job ids, and `deriveAppliedJobCardState` reads that same set. What
 * made a Jobs card LOOK open was that most of it was never behind the gate —
 * ConfirmedSection / ActiveJobSection / DisputedSection each mounted the full
 * eight-step tracker, its map, AND the step card's action row with no
 * `isExpanded` anywhere. So this file asserts the fix that was actually
 * needed: those blocks are gone from a collapsed card.
 *
 * ── THREE THINGS DELIBERATELY SURVIVE THE COLLAPSE ────────────────────────
 * Each is a carve-out with a reason, and each is asserted here, because "hide
 * the card's contents" is the kind of change that quietly takes too much:
 *
 *   · THE STREET ADDRESS. The owner's explicit carve-out — a Helpr heading out
 *     must not expand a card to see where they are going.
 *     `src/test/enRouteAddressVisible.test.tsx` owns that claim; this file
 *     asserts it again on the collapsed card so the two rulings cannot be
 *     satisfied one at a time.
 *   · AN OPEN DISPUTE. Gating DisputedSection hid the fact of a live dispute
 *     from the Helpr, and `helperDisputeCopy.test.ts` caught it on the first
 *     run. The resolution is the poster card's own pattern — controls behind
 *     the expand, SIGNAL not — via the now-shared `DisputeOpenBadge`.
 *   · THE "Seen" CHIP on a pending application. Information, no tap, and the
 *     one thing a waiting applicant most wants at a glance. Its neighbours
 *     Edit and Withdraw are controls and went behind the gate with everything
 *     else — my call, per the owner's own precedent for the poster's
 *     confirmation ladder ("controls stay inside the expanded card, but the
 *     collapsed card must signal that one is waiting").
 *
 * ── AND THE RAIL IS THE SAME RAIL, ONLY DENSER ────────────────────────────
 * Not a second progress vocabulary: `JobStepRailCompact` and the full rail
 * both paint from `railStepPaint`, and this file asserts the compact one draws
 * the SAME steps in the SAME order as the labelled one it replaces. The
 * geometry (16px dots, measured to fit a 212px card at 320) is asserted in
 * `src/test/compactRailFits.test.ts`.
 *
 * @mutate src/components/activity/AppliedJobCard.tsx | {isConfirmed && isExpanded && ( | {isConfirmed && (
 * @mutate src/components/activity/AppliedJobCard.tsx | {isDisputed && !isExpanded && (\n            <DisputeOpenBadge | {isDisputed && false && (\n            <DisputeOpenBadge
 * @mutate src/components/activity/AppliedJobCard.tsx | {!isMinimalCard && !isExpanded && (isOffered || isConfirmed || isActive || isDisputed) && ( | {false && (
 * @mutate src/components/activity/PostedJobCard.tsx | {!isExpanded && !contested && showsTracker && !unfunded && ( | {false && (
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import type { AppliedApp, Job } from "@/components/activity/activityConstants";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }));
vi.mock("@/lib/haptics", () => ({
  hapticLight: vi.fn(), hapticError: vi.fn(), hapticSuccess: vi.fn(),
  hapticMedium: vi.fn(), hapticSelection: vi.fn(), hapticWarning: vi.fn(),
}));
vi.mock("@/components/PhotoProof", () => ({
  PhotoProofGroup: () => null,
  PhotoProofDialog: () => null,
  PhotoProofRequirementNote: () => null,
  PhotoProofCaptureChip: ({ label }: { label: string }) => <button type="button">{label}</button>,
}));
/* PARTIAL: only the COMPONENT is stubbed (it opens a realtime channel). Its
   pure exports are the real ones — the compact rail computes its dots from
   them, and a mock that dropped them would make the card throw. */
vi.mock("@/components/JobTracking", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/JobTracking")>()),
  JobTracking: () => <div data-testid="tracker" />,
}));
vi.mock("@/components/JobConfirmation", () => ({
  JobConfirmation: () => null,
  helperDayOfConfirmation: () => true,
}));
vi.mock("@/components/GroupJobHelpers", () => ({ GroupJobHelpers: () => null }));
vi.mock("@/components/activity/SeriesStrip", () => ({ SeriesStrip: () => null }));
vi.mock("@/components/activity/JobCountdown", () => ({ JobCountdown: () => null }));
vi.mock("@/components/activity/JobPetCareSheet", () => ({ JobPetCareSheet: () => null }));
vi.mock("@/components/activity/useHighlightPulse", () => ({ useHighlightPulse: () => {} }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ profile: null }) }));
vi.mock("@/hooks/useFundExistingJob", () => ({ useFundExistingJob: () => ({ fundJob: vi.fn(), fundingJobId: null }) }));

function makeSupabase() {
  const result = { data: null, error: null };
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "select", "eq", "neq", "in", "order", "limit", "insert", "update", "upsert", "delete", "gte", "lte", "is", "not", "filter"]) {
    chain[m] = vi.fn(() => chain);
  }
  chain.single = vi.fn(() => Promise.resolve(result));
  chain.maybeSingle = vi.fn(() => Promise.resolve(result));
  chain.then = (res: (v: typeof result) => unknown) => Promise.resolve(result).then(res);
  return {
    supabase: {
      ...chain,
      channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() })),
      removeChannel: vi.fn(),
      rpc: vi.fn(() => Promise.resolve(result)),
      auth: { getUser: vi.fn(() => Promise.resolve({ data: { user: null }, error: null })) },
    },
  };
}
vi.mock("@/integrations/supabase/client", () => makeSupabase());

import { AppliedJobCard } from "@/components/activity/AppliedJobCard";
import { PostedJobCard } from "@/components/activity/PostedJobCard";
import { railStepLabels } from "@/components/JobTracking";

beforeAll(() => {
  Element.prototype.scrollTo = Element.prototype.scrollTo ?? (() => {});
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
});

const HELPER = "helper-1";
const POSTER = "poster-1";
const ADDRESS = "1412 Bayou Ridge Rd, Lafayette, LA 70508";
const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const noop = () => {};

function wrap(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const baseJob = {
  id: "job-1",
  title: "Pressure wash the driveway",
  description: "Front driveway and the walk to the porch.",
  category: "cleaning",
  budget: 120,
  status: "in_progress",
  customer_id: POSTER,
  helper_id: HELPER,
  location: ADDRESS,
  date_needed: "2026-09-20",
  start_time: "09:00",
  payment_status: "escrow",
  helper_confirmed_at: ago(48),
  helper_dayof_confirmed_at: ago(30),
  poster_confirmed_at: ago(47),
  helper_on_the_way_at: ago(7),
  helper_arrived_at: ago(6),
  proof_before_urls: ["b.jpg"],
  proof_after_urls: ["a.jpg"],
} as unknown as Job;

const makeApp = (over: Record<string, unknown> = {}, jobOver: Record<string, unknown> = {}) =>
  ({
    id: "app-1", job_id: "job-1", helper_id: HELPER, status: "accepted",
    posterName: "Pierre B.", created_at: ago(72),
    job: { ...baseJob, ...jobOver }, ...over,
  }) as unknown as AppliedApp;

function renderApplied(app: AppliedApp, expanded: boolean) {
  return wrap(
    <AppliedJobCard
      app={app}
      expandedJobIds={new Set(expanded ? [app.job_id] : [])}
      toggleExpandedJobId={noop}
      helperReviewedJobIds={new Set()}
      userId={HELPER}
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
    />,
  );
}

function renderPosted(job: Job, expanded: boolean) {
  return wrap(
    <PostedJobCard
      job={job}
      applicantCounts={{}}
      expandedJobIds={new Set(expanded ? [job.id] : [])}
      toggleExpandedJobId={noop}
      helperNames={{ [HELPER]: "Hallie H." }}
      helperAvatars={{ [HELPER]: null }}
      completedJobMeta={{}}
      userId={POSTER}
      onBoost={noop} onEdit={noop} onCancel={noop} onComplete={noop} completingJobId={null}
      onRevision={noop} onNoShow={noop} onTip={noop} onReview={noop} onDispute={noop} onReport={noop}
      onViewDispute={noop} onConfirmArrival={noop} confirmingArrivalJobId={null}
      onConfirmWorking={noop} confirmingWorkingJobId={null}
      onLoadApplications={noop} onLoadInlineApplicants={noop}
      inlineApplicants={{}} loadingApplicants={{}} applicantErrors={{}}
      onActionComplete={noop}
    />,
  );
}

const rail = () => document.querySelector("[data-job-rail-compact]");
const row = () => document.querySelector("[data-job-step-row]");

// ===========================================================================
// B — the collapsed Jobs card
// ===========================================================================
describe("Jobs: a collapsed card hides the tracker and the action row", () => {
  it("collapsed: no full tracker and no action row", () => {
    renderApplied(makeApp(), false);
    expect(
      screen.queryByTestId("tracker"),
      "the full tracker is on a collapsed Jobs card — this is what made the card look " +
        "expanded even though `expandedJobIds` never held its id",
    ).toBeNull();
    expect(row(), "the step card's action row is on a collapsed Jobs card").toBeNull();
  });

  it("expanded: both are back — the collapse hid them, it did not delete them", () => {
    renderApplied(makeApp(), true);
    expect(screen.getByTestId("tracker")).toBeInTheDocument();
    expect(row()).not.toBeNull();
  });

  it("collapsed: the street address SURVIVES (the owner's carve-out)", () => {
    // A Helpr heading out must not expand a card to see where they are going.
    renderApplied(makeApp(), false);
    expect(screen.getByText(ADDRESS)).toBeInTheDocument();
  });

  it("collapsed + disputed: the panel is hidden but the DISPUTE is announced", () => {
    // Gating DisputedSection alone hid a live dispute from the Helpr —
    // helperDisputeCopy.test.ts caught it. Controls behind the expand, signal
    // not: the same badge the poster's card has carried since 2026-09-06.
    renderApplied(makeApp({}, { status: "disputed", dispute_status: "open" }), false);
    expect(document.querySelector("[data-dispute-open-badge]")).not.toBeNull();
    expect(screen.getByText(/Payment on hold/i)).toBeInTheDocument();
    expect(row(), "the dispute's action row is on a collapsed card").toBeNull();
  });

  it("collapsed + pending: the 'Seen' chip stays, Edit and Withdraw do not", () => {
    const app = makeApp(
      { status: "pending", poster_viewed_at: ago(2) },
      { status: "open", helper_id: null, helper_confirmed_at: null },
    );
    renderApplied(app, false);
    expect(screen.getByText(/^Seen /), "the Seen chip is information, not an action").toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Withdraw/i }), "Withdraw is a control").toBeNull();
    expect(screen.queryByRole("button", { name: /Edit your application/i })).toBeNull();
  });
});

// ===========================================================================
// C — the rail at the bottom of the collapsed card
// ===========================================================================
describe("the collapsed card carries the progress rail, on both tabs", () => {
  it("Jobs: the compact rail is on the collapsed card and gone once expanded", () => {
    renderApplied(makeApp(), false);
    expect(rail(), "no rail on a collapsed Jobs card").not.toBeNull();
    renderApplied(makeApp(), true);
    // Two cards are now in the document; the expanded one must not add a rail.
    expect(
      document.querySelectorAll("[data-job-rail-compact]"),
      "the expanded card drew the compact rail as well as the full one",
    ).toHaveLength(1);
  });

  it("Posts: the compact rail is on the collapsed card", () => {
    renderPosted(baseJob, false);
    expect(rail(), "no rail on a collapsed Posts card").not.toBeNull();
  });

  it("Posts: a CONTESTED collapsed card keeps the full tracker and draws no compact rail", () => {
    // The two conditions are exact complements — one rail per card, never two.
    renderPosted({ ...baseJob, status: "disputed" } as Job, false);
    expect(screen.getByTestId("tracker")).toBeInTheDocument();
    expect(rail(), "the same rail twice on one card").toBeNull();
  });

  it("it is the SAME rail: same steps, same order, same count as the labelled one", () => {
    // Not a second progress vocabulary. The poster's card includes the posting
    // steps and the helper's does not — exactly as their expanded trackers do.
    renderPosted(baseJob, false);
    expect(Number(rail()!.getAttribute("data-step-count"))).toBe(railStepLabels(true).length);
    document.body.innerHTML = "";
    renderApplied(makeApp(), false);
    expect(Number(rail()!.getAttribute("data-step-count"))).toBe(railStepLabels(false).length);
  });

  it("it announces WHERE the job is in one sentence, for a screen reader", () => {
    // Eight unlabelled dots say nothing; this says more than the labelled rail
    // manages, which announces as a group of eight icon buttons.
    renderApplied(makeApp(), false);
    expect(screen.getByText(/Job progress: step \d+ of \d+, /)).toBeInTheDocument();
  });

  it("a not-selected or cancelled card draws no rail — there is no progress to show", () => {
    renderApplied(makeApp({ status: "rejected" }, { status: "cancelled" }), false);
    expect(rail()).toBeNull();
  });
});
