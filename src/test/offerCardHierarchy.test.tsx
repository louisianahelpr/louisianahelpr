/**
 * THE OFFER CARD, BOTH SIDES (owner, 2026-10-05, seen live on "Clean my room"
 * at 375):
 *
 *   poster (/posts, Waiting): a DISABLED green "Confirm Arrival" with "Your
 *     Helpr hasn't confirmed this booking yet…" on an offer the Helpr had not
 *     accepted; and "Job starts in" only on the expanded card.
 *   Helpr (/jobs, offered): the answer-by clock TWICE (box over Accept and the
 *     footer strip), no step rail, the reschedule block's gradient Accept
 *     beside "Accept Job", "Ask for a new date or time" on the collapsed card,
 *     and an enabled "Accept Job" that only after the tap said Stripe setup
 *     was unfinished.
 *
 * The rules, each failing on the state that shipped:
 *   1. no arrival control on the poster's card before the Helpr accepts — an
 *      inventory of every stamp combination on an unanswered offer;
 *   2. the start clock shows on the COLLAPSED card on both sides;
 *   3. the date-change control (ask + request) lives behind the expand, and its
 *      Accept is never the gradient primary;
 *   4. one answer-by clock on the Helpr's offer card;
 *   5. the Helpr's offer card draws the step rail when expanded;
 *   6. the offer card never draws an enabled "Accept Job" while the accept
 *      gate has a reason; the primary IS the setup step, with one line why,
 *      and waits while the gate is unknown.
 *
 * @mutate src/pages/posts/postedJobCard/steps/posterStepContract.ts |   if (step === "scheduled" && !job.helper_confirmed_at) return null; |   if (false) return null;
 * @mutate src/pages/posts/PostedJobCard.tsx | showStartClock={job.status === "accepted"} | showStartClock={false}
 * @mutate src/pages/jobs/AppliedJobCard.tsx | showStartClock={isConfirmed} | showStartClock={false}
 * @mutate src/components/series/JobSeriesCardControls.tsx |   if (!expanded) return null; |   if (false) return null;
 * @mutate src/pages/jobs/AppliedJobCard.tsx | hideStatus={isOffered} | hideStatus={false}
 * @mutate src/pages/jobs/AppliedJobCard.tsx | {isOffered && isExpanded && ( | {false && (
 * @mutate src/pages/jobs/appliedJobCard/OfferedActions.tsx | : setupLabel ?? (acceptPending ? "Finish Stripe Setup" : "Accept Job"); | : (acceptPending ? "Finish Stripe Setup" : "Accept Job");
 * @mutate src/pages/jobs/appliedJobCard/OfferedActions.tsx |   const setupStep = !gate.loading && (!!gate.reason \|\| acceptPending); |   const setupStep = false;
 * @mutate src/pages/jobs/appliedJobCard/OfferedActions.tsx |       ? "Checking…" |       ? "Accept Job"
 * @mutate src/pages/jobs/appliedJobCard/OfferedActions.tsx |             className="w-full rounded-ds-md" |             className="flex-1 rounded-ds-md"
 * @mutate src/pages/jobs/appliedJobCard/OfferedActions.tsx |       <JobCountdown dateNeeded={job.date_needed} startTime={job.start_time} label="Job starts in" /> | <span />
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { AppliedApp, Job } from "../components/job-card/activityConstants";
import type { AwardBlockReason } from "@/lib/awardGate";

const gateState: { loading: boolean; reason: AwardBlockReason | null } = { loading: false, reason: null };
// Q1461: the Access & Parking note is a network read once a card opens; none here.
vi.mock("@/hooks/useJobAccessNote", () => ({ useJobAccessNote: () => null, fetchJobAccessNote: async () => null }));
vi.mock("@/hooks/useAwardBlockReason", () => ({
  useAcceptGate: () => gateState,
  useAwardBlockReason: () => gateState.reason,
}));
const pendingJobs = new Set<string>();
vi.mock("@/hooks/useAcceptPendingJobs", () => ({ useAcceptPendingJobs: () => pendingJobs }));
vi.mock("@/hooks/useFirstPayoutFee", () => ({ useFirstPayoutFeeDollars: () => 0, useFirstPayoutFeeCents: () => 0 }));
vi.mock("@/hooks/useUnsettledDisputeJobIds", () => ({ useUnsettledDisputeJobIds: () => undefined }));
vi.mock("@/hooks/useCurrentUser", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useCurrentUser")>()),
  useCurrentUser: () => ({ profile: null }),
}));
vi.mock("@/components/JobTracking", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/JobTracking")>()),
  JobTracking: () => <div data-testid="tracker" />,
}));
vi.mock("@/components/JobConfirmation", () => ({ JobConfirmation: () => null, helperDayOfConfirmation: () => true }));
vi.mock("@/components/GroupJobHelpers", () => ({ GroupJobHelpers: () => null }));
vi.mock("@/pages/posts/SeriesStrip", () => ({ SeriesStrip: () => null }));
vi.mock("@/components/series/SeriesDatesPanel", () => ({ SeriesDatesPanel: () => null }));
vi.mock("@/components/schedule/ScheduleChangeControl", () => ({ ScheduleChangeControl: () => <div data-testid="schedule-change" /> }));
vi.mock("@/components/schedule/DetailChangeControl", () => ({ DetailChangeControl: () => <div data-testid="detail-change" /> }));
vi.mock("@/components/job-card/JobCountdown", () => ({
  JobCountdown: ({ label }: { label: string }) => <div data-testid="start-clock">{label}</div>,
}));
vi.mock("@/components/job-card/DeadlineCountdown", () => ({ default: () => <div data-testid="answer-clock" /> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/haptics", () => ({ hapticError: vi.fn(), hapticLight: vi.fn(), hapticWarning: vi.fn(), hapticSuccess: vi.fn() }));
vi.mock("@/pages/jobs/JobPetCareSheet", () => ({ JobPetCareSheet: () => null }));
vi.mock("@/components/PhotoProof", () => ({ PhotoProofGroup: () => null, PhotoProofDialog: () => null }));
vi.mock("../components/job-card/JobCardMetaRow", () => ({ JobCardMetaRow: () => <div data-testid="meta" /> }));
vi.mock("../components/job-card/useHighlightPulse", () => ({ useHighlightPulse: () => {} }));
vi.mock("../pages/posts/postedJobCard/PostedJobApplicants", () => ({ PostedJobApplicants: () => null }));
vi.mock("../pages/posts/postedJobCard/PostedJobActions", () => ({ PostedJobActions: () => null }));

import { posterConfirmationRung } from "../pages/posts/postedJobCard/steps/posterStepContract";
import { PostedJobCard } from "../pages/posts/PostedJobCard";
import { AppliedJobCard } from "../pages/jobs/AppliedJobCard";
import { OfferedActions } from "../pages/jobs/appliedJobCard/OfferedActions";
import { ScheduleChangeForJob } from "@/components/series/JobSeriesCardControls";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";

const noop = () => {};
const STAMPS = ["helper_on_the_way_at", "helper_arrived_at", "helper_arrival_near_miss_at", "helper_completed_at", "poster_confirmed_arrival_at"] as const;

/** An offer the Helpr has not answered (accepted, helper_confirmed_at null). */
const offerJob = {
  id: "job-1",
  title: "Clean my room",
  description: "Vacuum and dust the bedroom.",
  category: "cleaning",
  budget: 80,
  customer_id: "poster-1",
  helper_id: "helper-1",
  location: "Lafayette, LA",
  date_needed: jobLocalDateISO(1),
  start_time: "13:50:00",
  payment_status: "escrow",
  status: "accepted",
  helper_confirmed_at: null,
  response_deadline: new Date(Date.now() + 3_600_000).toISOString(),
} as unknown as Job;

function renderPosted(job: Job, expanded: boolean) {
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

const offerApp = { id: "app-1", job_id: "job-1", helper_id: "helper-1", status: "accepted", posterName: "Pierre B.", job: offerJob } as unknown as AppliedApp;

function renderApplied(app: AppliedApp, expanded: boolean) {
  return render(
    <MemoryRouter>
      <AppliedJobCard
        app={app}
        expandedJobIds={new Set(expanded ? [app.job_id] : [])}
        toggleExpandedJobId={vi.fn()}
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

beforeEach(() => {
  pendingJobs.clear();
  gateState.loading = false;
  gateState.reason = null;
});

describe("1. no arrival control on the poster's card before the Helpr accepts", () => {
  it("every stamp combination on an unanswered offer draws no rung", () => {
    let combos = 0;
    for (let mask = 0; mask < 1 << STAMPS.length; mask++) {
      const job = { ...offerJob } as Record<string, unknown>;
      STAMPS.forEach((k, i) => { job[k] = mask & (1 << i) ? "2026-10-05T18:00:00Z" : null; });
      expect(posterConfirmationRung(job as unknown as Job, "scheduled"), JSON.stringify(job)).toBeNull();
      combos++;
    }
    expect(combos).toBe(32);
  });

  it("can fail: the same job once the Helpr has accepted and arrived does draw the enabled box", () => {
    const booked = { ...offerJob, helper_confirmed_at: "2026-10-05T17:00:00Z", helper_on_the_way_at: "2026-10-05T18:00:00Z", helper_arrived_at: "2026-10-05T18:30:00Z" } as unknown as Job;
    expect(posterConfirmationRung(booked, "scheduled")).toMatchObject({ action: "arrival", enabled: true });
  });
});

describe("2. the start clock shows on the collapsed card, both sides", () => {
  it("poster: collapsed offer card draws Job starts in AND the answer-by clock", () => {
    renderPosted(offerJob, false);
    expect(screen.getByTestId("start-clock")).toHaveTextContent("Job starts in");
    expect(screen.getAllByTestId("answer-clock")).toHaveLength(1);
  });

  it("Helpr: collapsed confirmed card draws Job starts in", () => {
    const confirmed = { ...offerJob, helper_confirmed_at: "2026-10-05T17:00:00Z" } as unknown as Job;
    renderApplied({ ...offerApp, job: confirmed } as unknown as AppliedApp, false);
    expect(screen.getByTestId("start-clock")).toHaveTextContent("Job starts in");
  });
});

describe("3. the date-change control is behind the expand and never a second primary", () => {
  it("collapsed: no date-change control on either card; expanded: it is there", () => {
    const { unmount } = renderPosted(offerJob, false);
    expect(screen.queryByTestId("schedule-change")).toBeNull();
    unmount();
    const a = renderApplied(offerApp, false);
    expect(screen.queryByTestId("schedule-change")).toBeNull();
    a.unmount();
    render(<ScheduleChangeForJob job={offerJob as never} userId="helper-1" viewer="helper" expanded />);
    expect(screen.getByTestId("schedule-change")).toBeInTheDocument();
  });

  it("the request's Accept is not the gradient primary", () => {
    const src = readFileSync("src/components/schedule/ScheduleChangeControl.tsx", "utf8");
    expect(src).not.toMatch(/btn-grad-primary/);
  });
});

describe("4-5. the Helpr's offer card: one answer-by clock, and the step rail when expanded", () => {
  it("collapsed: exactly one answer-by clock, and no footer strip repeating the body", () => {
    renderApplied(offerApp, false);
    expect(document.querySelector("[data-job-status-strip]")).toBeNull();
    expect(screen.getAllByTestId("answer-clock")).toHaveLength(1);
    expect(screen.getByTestId("start-clock")).toBeInTheDocument();
    expect(screen.queryByTestId("tracker")).toBeNull();
  });

  it("expanded: the step rail is there, and still one answer-by clock", () => {
    renderApplied(offerApp, true);
    expect(screen.getByTestId("tracker")).toBeInTheDocument();
    expect(screen.getAllByTestId("answer-clock")).toHaveLength(1);
  });
});

describe("6. the offer card's primary says what the tap will do", () => {
  const renderOffer = () =>
    render(
      <MemoryRouter>
        <OfferedActions app={offerApp} job={offerJob} onHelperResponse={noop} respondingHelperAppId={null} />
      </MemoryRouter>,
    );

  it.each([
    ["helper_identity_unverified", "Finish Stripe Setup", /confirm your ID/],
    ["helper_payout_setup_incomplete", "Set Up Payouts", /Set up payouts/],
  ] as const)("gate %s: no enabled Accept Job; the primary is %s with one line why", (reason, label, line) => {
    gateState.reason = reason;
    renderOffer();
    expect(screen.queryByRole("button", { name: /Accept Job/ })).toBeNull();
    expect(screen.getByRole("button", { name: new RegExp(label) })).toBeEnabled();
    expect(document.querySelector("[data-offer-gate-line]")?.textContent).toMatch(line);
  });

  it("gate unknown (profile loading): the primary waits, never an enabled Accept Job", () => {
    gateState.loading = true;
    renderOffer();
    expect(screen.getByRole("button", { name: /Checking/ })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Accept Job/ })).toBeNull();
  });

  it("can fail: nothing in the way draws an enabled Accept Job and no gate line", () => {
    renderOffer();
    expect(screen.getByRole("button", { name: /Accept Job/ })).toBeEnabled();
    expect(document.querySelector("[data-offer-gate-line]")).toBeNull();
  });

  // The clipped "Finish Stripe Setu|" at 375 (owner, iPhone Safari): the long
  // setup label shared a two-up row with Decline. Structural check (jsdom has
  // no layout): the setup primary is full width and ALONE in its row, and
  // Decline steps down to a quiet text action. The pixel check (label
  // scrollWidth <= clientWidth at 320/375/414/1440) is recorded with the
  // screenshots under ~/.lh-shots/offer-card/.
  it.each([
    ["gated before the tap", () => { gateState.reason = "helper_identity_unverified"; }],
    ["accepted, waiting on Stripe", () => { gateState.reason = "helper_identity_unverified"; pendingJobs.add("job-1"); }],
  ] as const)("%s: the setup primary is full width and alone in its row; Decline is quiet", (_n, arrange) => {
    arrange();
    renderOffer();
    const primary = document.querySelector('[data-offer-primary="setup"]') as HTMLElement;
    expect(primary).not.toBeNull();
    expect(primary.className).toMatch(/\bw-full\b/);
    expect(primary.parentElement!.querySelectorAll(":scope > button").length).toBe(1);
    const decline = screen.getByRole("button", { name: /Decline this job/ });
    expect(decline.className).not.toMatch(/btn-grad-primary|bg-primary/);
    expect(document.querySelectorAll("[data-offer-gate-line]")).toHaveLength(1);
  });
});
