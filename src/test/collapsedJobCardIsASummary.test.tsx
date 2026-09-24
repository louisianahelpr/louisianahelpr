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
 * ── AND WHAT THE COLLAPSED CARD SAYS INSTEAD IS A SENTENCE ────────────────
 * For a few hours on 2026-09-19 it was a compact 16px-dot rail, and this file
 * asserted it drew the same steps in the same order as the labelled rail. The
 * owner saw it and asked for words: "in the box to the left of the dots should
 * show what we are waiting on… remove the dots." So the section below asserts
 * the STRIP — one line, naming whose move it is — in the same three places the
 * rail was asserted, plus the thing the dots could not do: it is present on
 * every state and it says something different to each side of the job.
 * The inventory, the honesty rule and the 320/375 arithmetic all live in
 * `src/test/collapsedStatusSentence.test.tsx`; this file's job is the CARD.
 *
 * ALL THREE SECTIONS ARE MUTATED, because each mounts its own tracker and its
 * own action row and a change could un-gate one of them alone. The first pass
 * registered only `isConfirmed` and it SURVIVED — the fixture below is an
 * in_progress job, which routes to ActiveJobSection, so un-gating the confirmed
 * one changed nothing it rendered. That is the mutation doing its job: a case
 * per section now exists, and each has a mutation that reaches it.
 *
 * @mutate src/pages/jobs/AppliedJobCard.tsx | {isConfirmed && isExpanded && ( | {isConfirmed && (
 * @mutate src/pages/jobs/AppliedJobCard.tsx | {isActive && isExpanded && ( | {isActive && (
 * @mutate src/pages/jobs/AppliedJobCard.tsx | {isDisputed && isExpanded && ( | {isDisputed && (
 * @mutate src/pages/jobs/AppliedJobCard.tsx | {!isMinimalCard && !isExpanded && <JobStatusStrip line={helperStatusLine(app)} />} | {false && <JobStatusStrip line={helperStatusLine(app)} />}
 * @mutate src/pages/posts/PostedJobCard.tsx | {!isExpanded && (\n              <JobStatusStrip | {false && (\n              <JobStatusStrip
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import type { AppliedApp, Job } from "@/components/job-card/activityConstants";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn(), notifyJobParty: vi.fn() }));
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
vi.mock("@/pages/posts/SeriesStrip", () => ({ SeriesStrip: () => null }));
vi.mock("@/components/job-card/JobCountdown", () => ({ JobCountdown: () => null }));
vi.mock("@/pages/jobs/JobPetCareSheet", () => ({ JobPetCareSheet: () => null }));
vi.mock("@/components/job-card/useHighlightPulse", () => ({ useHighlightPulse: () => {} }));
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

import { AppliedJobCard } from "@/pages/jobs/AppliedJobCard";
import { PostedJobCard } from "@/pages/posts/PostedJobCard";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";

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
  date_needed: jobLocalDateISO(0),
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
      onNoShow={noop} onTip={noop} onReview={noop} onDispute={noop} onReport={noop}
      onViewDispute={noop} onConfirmArrival={noop} confirmingArrivalJobId={null}
      onConfirmWorking={noop} confirmingWorkingJobId={null}
      onLoadApplications={noop} onLoadInlineApplicants={noop}
      inlineApplicants={{}} loadingApplicants={{}} applicantErrors={{}}
      onActionComplete={noop}
    />,
  );
}

const strip = () => document.querySelector("[data-job-status-strip]");
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

  it("collapsed: the same holds for a CONFIRMED job (ConfirmedSection)", () => {
    // One case per section. The three mount separate trackers and separate
    // action rows, so a change can un-gate one of them on its own — which the
    // mutation register caught when this file covered only the active one.
    renderApplied(makeApp({}, { status: "accepted", helper_on_the_way_at: null, helper_arrived_at: null }), false);
    expect(screen.queryByTestId("tracker"), "ConfirmedSection's tracker is on a collapsed card").toBeNull();
    expect(row(), "ConfirmedSection's action row is on a collapsed card").toBeNull();
  });

  it("expanded: a confirmed card gets them back too", () => {
    renderApplied(makeApp({}, { status: "accepted", helper_on_the_way_at: null, helper_arrived_at: null }), true);
    expect(screen.getByTestId("tracker")).toBeInTheDocument();
    expect(row()).not.toBeNull();
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
    expect(screen.queryByTestId("tracker"), "DisputedSection's tracker is on a collapsed card").toBeNull();
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
// C — the status line at the bottom of the collapsed card
// ===========================================================================
describe("the collapsed card says what it is waiting on, on both tabs", () => {
  it("Jobs: the strip is on the collapsed card and gone once expanded", () => {
    renderApplied(makeApp(), false);
    expect(strip(), "no status line on a collapsed Jobs card").not.toBeNull();
    renderApplied(makeApp(), true);
    // Two cards are now in the document; the expanded one must not add one.
    expect(
      document.querySelectorAll("[data-job-status-strip]"),
      "the expanded card drew the strip as well as the full tracker below it",
    ).toHaveLength(1);
  });

  it("Posts: the strip is on the collapsed card", () => {
    renderPosted(baseJob, false);
    expect(strip(), "no status line on a collapsed Posts card").not.toBeNull();
  });

  it("Posts: a CONTESTED collapsed card draws the strip and NO tracker", () => {
    /* INVERTED ON 2026-09-19 BY THE OWNER, and the inversion is recorded in
       full in PostedJobCard.contestedTracker.test.tsx. This case used to
       assert a contested card kept the FULL tracker while collapsed and drew
       no rail. It now asserts the other half of the same concern: the card is
       not silent, it just says it in one line instead of an eight-step rail.
       "the live tracker should also be collapsed for disputes unless its
       clicked to expand it." */
    renderPosted({ ...baseJob, status: "disputed" } as Job, false);
    expect(screen.queryByTestId("tracker"), "the tracker is back on a collapsed contested card").toBeNull();
    expect(strip()!.textContent).toContain("Dispute open");
  });

  it("it says something DIFFERENT to each side of the same job", () => {
    // Not a second copy of the job's status: the line is about whose move it
    // is, and that is the one thing the two ends of a job never share. Eight
    // identical dots on both cards was exactly the failure this replaced.
    renderPosted(baseJob, false);
    const posted = strip()!.textContent;
    document.body.innerHTML = "";
    renderApplied(makeApp(), false);
    expect(strip()!.textContent, `both cards read "${posted}"`).not.toBe(posted);
  });

  it("it announces as ONE sentence, and the rail's old aria-label is gone", () => {
    renderApplied(makeApp(), false);
    const el = strip()!;
    // Eight unlabelled dots announced as "Job progress: step 5 of 8, Working" —
    // a position on a track, which is what the owner replaced.
    expect(document.body.textContent).not.toMatch(/Job progress: step/);
    expect(el.textContent!.trim().length).toBeGreaterThan(8);
    expect(el.querySelectorAll("button, a[href]"), "the status line grew a control").toHaveLength(0);
  });

  it("a not-selected or cancelled card draws no strip — its body says it in prose", () => {
    // `describeCancellation` names WHO cancelled, which a strip cannot carry.
    // Recorded as a decision here so it reads as a choice, not a gap.
    renderApplied(makeApp({ status: "rejected" }, { status: "cancelled" }), false);
    expect(strip()).toBeNull();
    expect(screen.getByText(/^Cancelled/), "the minimal card says nothing either").toBeInTheDocument();
  });
});
