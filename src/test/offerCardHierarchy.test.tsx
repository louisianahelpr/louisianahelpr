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
 *   6. before the tap, the offer card's primary is "Accept Job" whatever the
 *      accept gate says (owner, 2026-10-06: anyone can accept, payout setup
 *      comes after; this reverses the 2026-10-05 "Set Up Payouts" primary);
 *      only an accept already waiting on Stripe makes the setup step the
 *      primary, full width, with one line why. The wiring through to
 *      accept_job_offer: src/test/offerAcceptForEveryone.test.tsx.
 *
 * @mutate src/pages/posts/postedJobCard/steps/posterStepContract.ts |   if (step === "scheduled" && !job.helper_confirmed_at) return null; |   if (false) return null;
 * @mutate src/pages/posts/PostedJobCard.tsx | showStartClock={job.status === "accepted"} | showStartClock={false}
 * @mutate src/pages/jobs/AppliedJobCard.tsx | showStartClock={isConfirmed} | showStartClock={false}
 * @mutate src/components/series/JobSeriesCardControls.tsx |   if (!expanded \|\| !userId) return null; |   if (!userId) return null;
 * @mutate src/pages/jobs/AppliedJobCard.tsx | hideStatus={isOffered} | hideStatus={false}
 * @mutate src/pages/jobs/AppliedJobCard.tsx | {isOffered && isExpanded && ( | {false && (
 * @mutate src/pages/jobs/appliedJobCard/OfferedActions.tsx |       {!isExpired && acceptPending && ( |       {false && (
 * @mutate src/pages/jobs/appliedJobCard/OfferedActions.tsx | const acceptLabel = busy ? "Accepting…" : acceptPending ? "Finish Accepting" : "Accept Job"; | const acceptLabel = busy ? "Accepting…" : acceptPending ? "Finish Stripe Setup" : "Accept Job";
 * @mutate src/pages/jobs/appliedJobCard/OfferedActions.tsx | { id: "answer", at: deadline, text: "left to answer", expiredText: "Response deadline expired" }, |
 * @mutate src/pages/jobs/appliedJobCard/OfferedActions.tsx |             startClock,\n |             \n
 * @mutate src/pages/posts/PostedJobCard.tsx |       eyebrow={offerUnanswered ? "Offered to" : "Helpr"} |       eyebrow="Helpr"
 * @mutate src/pages/posts/PostedJobCard.tsx |                   {!offerUnanswered && <JobConfirmation |                   {<JobConfirmation
 * @mutate src/pages/posts/PostedJobCard.tsx | <JobConfirmation embedded hideNotYetOpen jobId | <JobConfirmation embedded jobId
 * @mutate src/pages/posts/postedJobCard/posterOfferClocks.ts |   const answerDeadline = offerUnanswered ? posterDeadline("unconfirmed", job) : null; |   const answerDeadline = null;
 * @mutate src/pages/posts/postedJobCard/posterOfferClocks.ts |   const posterConfirmOpens = offerUnanswered ? null : confirmationOpensClock(job.date_needed, job.status, true); |   const posterConfirmOpens = confirmationOpensClock(job.date_needed, job.status, true);
 * @mutate src/components/job-card/jobStatusLine.ts | "left to accept" | "left to confirm"
 * @mutate src/components/job-card/jobStatusLine.ts | unconfirmed: { detail: "Offer sent — they haven't accepted yet" }, | unconfirmed: { detail: "They haven't confirmed" },
 * @mutate src/components/job-card/JobStatusStrip.tsx |   const deadlineInline = line.id === "unconfirmed" && !!line.deadline; |   const deadlineInline = false;
 * @mutate src/pages/posts/postedJobCard/PosterStatusStrip.tsx | const clocks = showStartClock ? collapsedClocks(job, true) : []; | const clocks: never[] = [];
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { AppliedApp, Job } from "../components/job-card/activityConstants";
import type { AwardBlockReason } from "@/lib/awardGate";

const gateState: { loading: boolean; reason: AwardBlockReason | null; missing: ("payout_setup" | "stripe_id")[] } = { loading: false, reason: null, missing: [] };
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
vi.mock("@/components/JobConfirmation", () => ({
  JobConfirmation: ({ hideNotYetOpen }: { hideNotYetOpen?: boolean }) => (
    <div data-testid="job-confirmation" data-hide-not-yet-open={String(!!hideNotYetOpen)} />
  ),
  helperDayOfConfirmation: () => true,
}));
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
  gateState.missing = [];
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
  // Owner, 2026-10-07 (Q1399, spec 7): on a collapsed card BOTH times go at
  // the bottom, under the status line, the one ending first listed first, in
  // one format; no start pill above the strip.
  const stripRows = () =>
    [...document.querySelectorAll("[data-job-status-strip] [data-countdown-row]")].map((r) => r.getAttribute("data-countdown-row"));

  it("poster: collapsed offer card reads 'Offer sent — they haven't accepted yet · Nm left to accept', the start clock on the next line", () => {
    // Owner, 2026-10-08 (pop-up: two lines): the answer clock rides the sentence.
    renderPosted(offerJob, false);
    expect(stripRows()).toEqual(["start"]);
    const strip = document.querySelector("[data-job-status-strip]")!;
    expect(strip.textContent).toMatch(/Offer sent — they haven't accepted yet/);
    // The answer clock (DeadlineCountdown, mocked here) sits INSIDE the first line.
    expect(strip.querySelector('[data-countdown-inline="deadline"] [data-testid="answer-clock"]')).not.toBeNull();
    expect(strip.textContent).toMatch(/until the job starts/);
    expect(strip.textContent).not.toMatch(/confirm/i);
    expect(document.querySelector("[data-collapsed-start-clock]")).toBeNull();
  });

  it("the start first when it ends first (soonest first, whichever it is)", () => {
    const late = { ...offerJob, response_deadline: new Date(Date.now() + 5 * 86_400_000).toISOString() } as unknown as Job;
    renderPosted(late, false);
    // The answer clock rides the sentence now (owner, 2026-10-08); the rows hold the rest.
    expect(stripRows()).toEqual(["start"]);
    expect(document.querySelector('[data-countdown-inline="deadline"]')).not.toBeNull();
  });

  it("Helpr: collapsed confirmed card draws the start clock in its strip", () => {
    const confirmed = { ...offerJob, helper_confirmed_at: "2026-10-05T17:00:00Z" } as unknown as Job;
    renderApplied({ ...offerApp, job: confirmed } as unknown as AppliedApp, false);
    expect(stripRows()).toContain("start");
    expect(document.querySelector("[data-collapsed-start-clock]")).toBeNull();
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
  // One clock panel, both clocks in one format, soonest first (owner,
  // 2026-10-07, Q1399 item 6): the start was a grey pill and the answer-by a
  // cream box.
  const boxRows = () =>
    [...document.querySelectorAll('[data-countdown-rows="box"] [data-countdown-row]')].map((r) => r.getAttribute("data-countdown-row"));

  it("collapsed: one clock panel (answer, then start), and no footer strip repeating the body", () => {
    renderApplied(offerApp, false);
    expect(document.querySelector("[data-job-status-strip]")).toBeNull();
    expect(document.querySelectorAll('[data-countdown-rows="box"]')).toHaveLength(1);
    expect(boxRows()).toEqual(["answer", "start"]);
    expect(screen.queryByTestId("start-clock")).toBeNull();
    expect(screen.queryByTestId("answer-clock")).toBeNull();
    expect(screen.queryByTestId("tracker")).toBeNull();
  });

  it("expanded: the step rail is there, and still one clock panel", () => {
    renderApplied(offerApp, true);
    expect(screen.getByTestId("tracker")).toBeInTheDocument();
    expect(document.querySelectorAll('[data-countdown-rows="box"]')).toHaveLength(1);
    expect(boxRows()).toEqual(["answer", "start"]);
  });
});

describe("6. the offer card's primary is Accept before the tap, for every Helpr", () => {
  const renderOffer = () =>
    render(
      <MemoryRouter>
        <OfferedActions app={offerApp} job={offerJob} onHelperResponse={noop} respondingHelperAppId={null} />
      </MemoryRouter>,
    );

  it.each([
    ["helper_identity_unverified"],
    ["helper_payout_setup_incomplete"],
    ["helper_unknown"],
  ] as const)("gate %s: an enabled Accept Job beside Decline, no setup step and no gate line", (reason) => {
    gateState.reason = reason;
    renderOffer();
    expect(screen.getByRole("button", { name: /Accept Job/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /^Decline$/ })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /Set Up Payouts|Finish Stripe Setup/ })).toBeNull();
    expect(document.querySelector("[data-offer-gate-line]")).toBeNull();
  });

  it("gate unknown (profile loading): Accept Job is there and enabled, never a Checking… wait", () => {
    gateState.loading = true;
    renderOffer();
    expect(screen.getByRole("button", { name: /Accept Job/ })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /Checking/ })).toBeNull();
  });

  // After a pending accept (owner, 2026-10-07, Q1399 items 2, 3, 5): still
  // one row, Decline LEFT of Accept, the primary still says Accept, and the
  // card says plainly it is NOT accepted yet and what it waits on.
  it.each([
    [["payout_setup", "stripe_id"], /Not accepted yet: waiting on your payout setup and Stripe ID check/],
    [["stripe_id"], /Not accepted yet: waiting on your Stripe ID check/],
    [["payout_setup"], /Not accepted yet: waiting on your payout setup\./],
  ] as const)("accepted, waiting on %j: Decline | Finish Accepting in one row, and the status says not accepted yet", (missing, line) => {
    pendingJobs.add("job-1");
    gateState.missing = [...missing];
    gateState.reason = gateState.missing.includes("payout_setup") ? "helper_payout_setup_incomplete" : "helper_identity_unverified";
    renderOffer();
    // Owner, 2026-10-08: "it should say finish accepting, they already accepted".
    const accept = screen.getByRole("button", { name: /Finish Accepting/ });
    const row = accept.parentElement!;
    const labels = [...row.querySelectorAll(":scope > button")].map((b) => b.textContent?.trim());
    expect(labels).toEqual(["Decline", "Finish Accepting"]);
    expect(screen.queryByRole("button", { name: /Set Up Payouts|Finish Stripe Setup|Decline this job/ })).toBeNull();
    expect(document.querySelector("[data-offer-pending-status]")?.textContent).toMatch(line);
  });
});

describe("7. the poster's EXPANDED offer card agrees on one state (owner, 2026-10-07, Q1399 items 9-10)", () => {
  const rows = () =>
    [...document.querySelectorAll('[data-countdown-rows="box"] [data-countdown-row]')].map((r) => r.getAttribute("data-countdown-row"));
  const farOffer = { ...offerJob, date_needed: jobLocalDateISO(4) } as unknown as Job;

  it("unanswered: 'Offered to' the Helpr, two clocks (answer, start) in one panel, no day-before confirmation box", () => {
    renderPosted(farOffer, true);
    expect(document.body.textContent).toMatch(/Offered to/);
    expect(rows()).toEqual(["answer", "start"]);
    expect(document.querySelectorAll('[data-countdown-rows="box"]')).toHaveLength(1);
    const panel = document.querySelector('[data-countdown-rows="box"]')!;
    expect(panel.textContent).toMatch(/left to accept/);
    expect(panel.textContent).not.toMatch(/confirm/i);
    expect(screen.queryByTestId("job-confirmation")).toBeNull();
  });

  it("accepted: 'Helpr', the answer clock is gone, 'until confirmation opens' joins the start in the same panel, soonest first", () => {
    renderPosted({ ...farOffer, helper_confirmed_at: "2026-10-05T17:00:00Z" } as unknown as Job, true);
    expect(document.body.textContent).not.toMatch(/Offered to/);
    expect(rows()).toEqual(["confirm-opens", "start"]);
    expect(screen.getByTestId("job-confirmation")).toHaveAttribute("data-hide-not-yet-open", "true");
  });
});
