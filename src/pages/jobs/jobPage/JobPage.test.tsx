/**
 * The signed-in job page (/jobs/:id, boards 15, 42, 168, 169; J2).
 *
 * - The page renders for a signed-in member instead of bouncing them to
 *   /home?quickApply=<id>, and its Apply button is what opens that quick-apply
 *   sheet now (the behaviour stays reachable from the page's primary action).
 * - Poster side: the money line is the TRUE charge moment (jobs charge at
 *   post, design-b measured): "Paid when you posted...", never "Nothing is
 *   charged until then"; an unpaid post says Helprs can't see it; a state we
 *   have not verified prints nothing. Never the Helpr's take-home.
 * - Helpr side: always their take-home: the 5% + 70c stamp on a fee-stamped
 *   job, the viewer's own tier rate on an older unstamped one (the feed's rule),
 *   and the whole price on a poster-fee job.
 * - Tracker: four steps from jobs.status; none for a Helpr just browsing.
 * The data hook is stubbed (no Supabase mock): these check what each state renders.
 *
 * @mutate src/pages/jobs/jobPage/posterPageActions.tsx | go: () => navigate(`/posts?highlight=${id}&applicants=1`) | go: () => navigate(`/posts?highlight=${id}`)
 * @mutate src/pages/jobs/jobPage/JobPage.tsx |         {hasPhoto && ( |         {true && (
 * @mutate src/pages/jobs/jobPage/JobPage.tsx |             {isHired && isSellForMeJob(job.category) && !job.helper_completed_at && hiredFace && ( |             {false && (
 * @mutate src/pages/jobs/jobPage/JobPage.tsx |             {hasVideo && <ScopeVideo url={job.scope_video_url} />} |
 * @mutate src/pages/jobs/jobPage/JobPage.tsx |   const posterStep = posterWait === "confirm_arrival" |   const posterStep = false && posterWait === "confirm_arrival"
 * @mutate src/pages/jobs/jobPage/JobPage.tsx | arrival.confirming ? "Confirming…" : "Confirm they've arrived" | arrival.confirming ? "Confirming…" : "Confirm arrival"
 * @mutate src/pages/jobs/jobPage/usePageConfirmArrival.ts |       await confirmPosterArrival(job); |       void job;
 * @mutate src/pages/jobs/jobPage/JobPage.tsx |   const hiredFace = isHired && viewer.action.kind === "open_working" |   const hiredFace = false && viewer.action.kind === "open_working"
 * @mutate src/pages/jobs/jobPage/JobPageParts.tsx |     workUnderway: helperProgress(job as unknown as Job, trackingStatus).workUnderway, |     workUnderway: undefined,
 * @mutate src/pages/jobs/jobPage/JobPage.tsx |               {isHired && job.location && job.status !== "cancelled" && ( |               {false && job.location && job.status !== "cancelled" && (
 * @mutate src/pages/jobs/JobDetail.tsx |         <JobPage id={id} userId={user.id} /> |         <Navigate to={`/home?quickApply=${id}`} replace />
 * @mutate src/pages/jobs/jobPage/JobPage.tsx |             ? { label: "Apply", go: ageGate("apply", () => void apply.flow.handleApplyRequest(job.id)), gated: ageGatedProps("apply") } |             ? { label: "Apply", go: () => navigate(`/home?quickApply=${encodeURIComponent(job.id)}`) }
 * @mutate src/pages/jobs/jobPage/PageApplySheet.tsx | posterName: formatName(poster?.name, "A neighbor"), | posterName: undefined,
 * @mutate src/pages/jobs/jobPage/JobPageParts.tsx |   // Q2399: the card is held (or, far out, only saved) at posting and charged at the hire. |   escrow: "Paid. Louisiana Helpr holds it until the job is done.",
 * @mutate src/pages/jobs/jobPage/JobPageParts.tsx | const line = released ? releasedLine(job) : refundInTracker ? null : HELD_LINE[status] ?? null; | const line = released ? releasedLine(job) : status === "held" \|\| refundInTracker ? null : HELD_LINE[status] ?? null;
 * @mutate src/pages/jobs/jobPage/JobPageParts.tsx |   held: "Your card isn't charged until a Helpr accepts your offer.", |
 * @mutate src/pages/jobs/jobPage/JobPageParts.tsx |   const net = computeNet(job.budget, tierPct, |   const net = computeNet(job.budget, 0,
 * @mutate src/pages/jobs/jobPage/JobPageParts.tsx |   if (!side) return null; |   if (false) return null;
 * @mutate src/pages/jobs/jobPage/JobPage.tsx | {isPoster && open && !offerOut && (job.payment_status === "escrow" \|\| job.payment_status === "held") && | {isPoster && open && !offerOut &&
 * @mutate src/pages/jobs/jobPage/NoApplicantsYet.tsx |         {reach && reach > 0 |         {reach !== null
 * @mutate src/pages/jobs/jobPage/NoApplicantsYet.tsx |     !(job.photos ?? []).length && { key: "photo" |     false && { key: "photo"
 * @mutate src/pages/jobs/jobPage/JobPage.tsx |     job.location ? getCity(job.location) : null, |     job.location,
 * @mutate src/pages/jobs/jobPage/JobPage.tsx | go: ageGate("apply", () => void apply.flow.handleApplyRequest(job.id)) | go: () => void apply.flow.handleApplyRequest(job.id)
 * @mutate src/pages/jobs/jobPage/JobPage.tsx |   const isHired = !isPoster && ((!!job.helper_id && job.helper_id === userId) \|\| onCrew); |   const isHired = !isPoster && ((!!job.helper_id && job.helper_id === userId));
 * @mutate src/pages/jobs/jobPage/JobPage.tsx | myApplication: myApplication.data, posterFirst, onCrew, offeredToMe }); | myApplication: myApplication.data, posterFirst, offeredToMe });
 * @mutate src/components/tracker/jobProgressState.ts | poster ? (o.pendingApplicants === 0 ? "Waiting for Helprs to apply" : "Pick your Helpr") | poster ? ("Pick your Helpr")
 * @mutate src/pages/jobs/jobPage/JobPage.tsx |  pendingApplicants={isPoster && applicants.data ? pending : undefined} | pendingApplicants={undefined}
 * @mutate src/pages/jobs/jobPage/JobPage.tsx | {!isPoster && !isHired && !instantUntil && viewer.action.kind !== "see_offer" && <p className="text-ds-13 text-muted-foreground">The street address is shared once you're offered the job.</p>} |
 * @mutate src/pages/jobs/jobPage/JobPage.tsx | {party && (isPoster \|\| isHired) && ((job.proof_before_urls | {false && ((job.proof_before_urls
 * @mutate src/pages/jobs/jobPage/JobPage.tsx | {party && (isPoster \|\| isHired) && ((job.proof_before_urls | {((job.proof_before_urls
 * @mutate src/pages/jobs/jobPage/JobPage.tsx | {party && (isPoster \|\| isHired) && ((job.proof_before_urls | {(isPoster \|\| isHired) && ((job.proof_before_urls
 * @mutate src/pages/jobs/jobPage/JobPage.tsx |             {!isPoster && instantUntil && <InstantBookingCard | {false && instantUntil && <InstantBookingCard
 * @mutate src/pages/jobs/jobPage/JobPage.tsx |             {!isPoster && instantUntil && <InstantBookingCard | {instantUntil && <InstantBookingCard
 * @mutate src/pages/jobs/jobPage/JobPage.tsx |     : instantUntil\n      ? null\n |
 * @mutate src/pages/jobs/jobPage/JobPage.tsx | {viewer.status && !(!isPoster && instantUntil) && | {viewer.status &&
 * @mutate src/pages/jobs/jobPage/JobPage.tsx | {!isPoster && !isHired && !instantUntil && viewer.action.kind !== "see_offer" && <p | {!isPoster && !isHired && viewer.action.kind !== "see_offer" && <p
 * @mutate src/pages/jobs/jobPage/JobPage.tsx | {(isPoster \|\| isHired) && job.status === "accepted" && <CountdownRows | {false && <CountdownRows
 */
import { describe, expect, it, vi, beforeEach, onTestFinished } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { JobPageRow } from "./useJobPage";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const state = {
  job: null as JobPageRow | null,
  reach: null as number | null,
  party: false,
  applicants: { total: 0, pending: 0 } as { total: number; pending: number; noShowAt?: string | null },
  owed: 0,
  myApplication: null as { status: string; closed_reason: string | null } | null,
  cardHold: false,
  /** The job's latest job_tracking.status (useJobPage's tracking read). */
  tracking: null as string | null,
  onCrew: false,
  /** usePosterPageFlows' moreCount: the card actions the page offers beside Message (jobStepMenu.tsx). */
  moreCount: 2,
  /** usePosterPageFlows' leadCount: the card's own primaries (Review, Tip) that lead when the page has no step. */
  leadCount: 0,
  /** OnTheWayNow's position read (job_tracking status, latitude, longitude). */
  position: null as { status: string | null; latitude: number | null; longitude: number | null } | null,
  /** useJobPage's crewConfirmed: the member's roster row has helper_confirmed_at (JA-33). */
  crewConfirmed: false,
  /** usePosterPageFlows' crewNobodyLeft (JOBS-3: every crew member reported a no-show). */
  crewNobodyLeft: false,
  /** usePosterPageFlows' crewRoster (JA-32: the page draws the crew). */
  crewRoster: undefined as Array<Record<string, unknown>> | undefined,
  /** CMP-4: the viewer's instant booking's decline-by (useMyInstantBooking), or null. */
  instantUntil: null as string | null,
  /** useOfferedToMe: a pending direct offer to the viewer (an instant booking is one). */
  offeredToMe: false,
  /** useOwesReview: the hired Helpr has not reviewed the poster on this finished job. */
  owesReview: false,
};

vi.mock("./useJobPage", () => ({
  useOfferedToMe: () => state.offeredToMe,
  useOwesReview: () => ({ owes: state.owesReview, refetch: () => {} }),
  // CMP-4: the viewer's instant booking (its read and latch are src/test/jobPageInstantBooking.test.tsx).
  useMyInstantBooking: () => state.instantUntil,
  useJobPage: (_id: string, userId: string) => ({
    job: { isLoading: false, isError: false, data: state.job ? { job: state.job, party: state.party } : null, refetch: vi.fn() },
    applicants: { isLoading: false, data: state.applicants },
    isPoster: !!state.job && state.job.customer_id === userId,
    myApplication: { data: state.myApplication },
    tracking: { data: state.tracking },
    onCrew: state.onCrew,
    crewConfirmed: state.crewConfirmed,
  }),
}));
vi.mock("@/hooks/useProofPhotoUrls", () => ({
  PENDING_PHOTO_SRC: "pending",
  useProofPhotoUrls: (values: readonly string[]) => values.map((v) => `https://signed.example/${v}`),
}));
vi.mock("@/hooks/useFirstPayoutFee", () => ({ useFirstPayoutFeeDollars: () => state.owed }));
// The poster's confirm-arrival write (src/lib/posterArrival.ts), shared with the Posted card; F14 checks the page calls it.
const confirmArrivalMock = vi.hoisted(() => vi.fn(async (_job: { id: string; helper_id: string | null }) => {}));
vi.mock("@/lib/posterArrival", () => ({ confirmPosterArrival: confirmArrivalMock }));
// The hired Helpr's button asks the Working card's tracker to act (F26); record what it asked.
const faceRequests = vi.hoisted(() => [] as unknown[][]);
vi.mock("@/components/job-card/faceActionRequest", async (orig) => ({
  ...(await orig<typeof import("@/components/job-card/faceActionRequest")>()),
  requestFaceAction: (...a: unknown[]) => { faceRequests.push(a); },
}));
// F9: Apply runs Home's flow on this page. A small stateful stand-in for useApplyFlow (its own behaviour is
// Home's tests) and a stub sheet that prints what it was handed.
const applyRequests = vi.hoisted(() => [] as string[]);
vi.mock("@/pages/home/useApplyFlow", async () => {
  const { useState } = await import("react");
  return {
    useApplyFlow: () => {
      const [id, setId] = useState<string | null>(null);
      return {
        confirmApplyJobId: id, setConfirmApplyJobId: setId,
        handleApplyRequest: async (jobId: string) => { applyRequests.push(jobId); setId(jobId); return true; },
        handleApplyConfirm: vi.fn(), applyMessage: "", setApplyMessage: vi.fn(), applyFiles: [], setApplyFiles: vi.fn(),
        applyLoading: false, applyTimeSuggestion: null, setApplyTimeSuggestion: vi.fn(),
        applicationSent: null, closeApplicationSent: vi.fn(), viewApplication: vi.fn(),
      };
    },
  };
});
vi.mock("@/components/dashboard/ApplyConfirmDialog", () => ({
  ApplyConfirmDialog: ({ confirmApplyJob }: { confirmApplyJob: { title: string; posterName?: string } }) => (
    <div data-testid="apply-sheet">{`${confirmApplyJob.title} · ${confirmApplyJob.posterName}`}</div>
  ),
}));
// A booked ("accepted") job asks whether its slot was moved; no move on these fixtures.
vi.mock("@/hooks/useJobRescheduled", () => ({ useJobRescheduled: () => false }));
// The Helpr Guarantee panel's read (no claim on these jobs); its own behaviour is helprGuarantee.test.ts and the PGlite proof.
vi.mock("@/lib/guarantee", async (orig) => ({ ...(await orig<typeof import("@/lib/guarantee")>()), fetchGuaranteeClaim: async () => null }));
vi.mock("@/lib/declutter/api", () => ({
  // JA-49: the Helpr a direct offer went to (get_job_offer_targets below) is "Yusef"; everyone else "Rhonda".
  fetchSellerCard: async (id: string) => ({ name: id === "33333333-3333-3333-3333-333333333333" ? "Yusef Brown" : "Rhonda Dupre", avatarUrl: null, joinedAt: "2025-03-10T12:00:00Z" }),
  fetchSellerRating: async () => null,
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: { id: ME_ID }, profile: null, isLoading: false, profileQuery: {}, refresh: vi.fn() }),
}));
vi.mock("@/hooks/usePendingSaveConsumer", () => ({ usePendingSaveConsumer: () => undefined }));
vi.mock("@/hooks/useJobRef", () => ({ useJobRef: () => undefined }));
// Board 184: the reach read is a hidden-switch RPC; the tests set it through state.reach.
vi.mock("./useJobReach", () => ({ useJobReach: () => state.reach }));
// Continue another day (owner 2026-11-01): the job's active continue day, and the calls the page makes.
const continueCalls = vi.hoisted(() => [] as string[]);
const continueState = vi.hoisted(() => ({ row: null as null | Record<string, unknown> }));
vi.mock("@/lib/continueDay", async (orig) => ({
  ...(await orig<typeof import("@/lib/continueDay")>()),
  fetchContinueDay: async () => continueState.row,
  answerContinueDay: async (id: string, accept: boolean) => { continueCalls.push(`answer:${id}:${accept}`); },
  confirmContinueDay: async (id: string) => { continueCalls.push(`confirm:${id}`); },
  proposeContinueDay: async () => { continueCalls.push("propose"); return { status: "set" }; },
}));
// CMP-4: the poster's Book now panel reads its own data; it is proven in src/test/instantBookScreens.test.tsx.
vi.mock("@/components/jobs/InstantBookPanel", () => ({ InstantBookPanel: () => null }));
// An accepted (offered) job asks whether it was rescheduled; these jobs never were.
vi.mock("@/hooks/useJobRescheduled", () => ({ useJobRescheduled: () => false }));
// Q2399 card_hold_at_post: the poster's money line follows it (F4).
// instant_book is on here: these cases pin the page with the switch on; switched off is instantBookSwitchOff.test.tsx.
vi.mock("@/hooks/useFeature", () => ({ useFeature: (key: string) => key === "instant_book" || (key === "card_hold_at_post" && state.cardHold) }));
// The Posted card's own flows on the page (usePosterPageFlows; its wiring is posterPageFlows.test.tsx): record each call.
const flowCalls = vi.hoisted(() => [] as string[]);
// OnTheWayNow's position read (onTheWayPosition.ts): no position unless a test sets one.
vi.mock("./onTheWayPosition", () => ({ fetchOnTheWayPosition: async () => state.position }));
// The Apple map loads MapKit's script and a token over the network: a stand-in that says where it was pointed.
vi.mock("@/components/TrackingMap", () => ({ TrackingMap: (p: { helperLive?: boolean }) => <div data-testid="tracking-map" data-live={String(p.helperLive)} /> }));
vi.mock("./usePosterPageFlows", () => ({
  usePosterPageFlows: () => ({
    ready: true, completing: false, moreCount: state.moreCount, leadCount: state.leadCount,
    setLeadHost: (el: HTMLElement | null) => { if (el) flowCalls.push("lead-host"); },
    setAskHost: () => {},
    approve: () => flowCalls.push("approve"), cancel: () => flowCalls.push("cancel"), edit: () => flowCalls.push("edit"),
    setSecondHost: () => {}, setListHost: (el: HTMLElement | null) => { if (el) flowCalls.push("options-list"); },
    crewNobodyLeft: state.crewNobodyLeft, crewRoster: state.crewRoster, panel: <div data-testid="card-panel" />, dialogs: null,
  }),
}));
// JA-30: the case dialog the page opens (the cards' own DisputeTimelineDialog), recorded rather than reading Supabase.
vi.mock("@/components/DisputeTimelineDialog", () => ({
  DisputeTimelineDialog: (p: { jobId: string; open: boolean }) => (p.open ? <div data-testid="dispute-case" data-job={p.jobId} /> : null),
}));
// JA-49: the poster's read of who a direct offer went to (offered_to_helper_id is not selectable).
const offerTargetCalls = vi.hoisted(() => [] as string[][]);
vi.mock("@/lib/jobOfferTargets", () => ({
  fetchJobOfferTargets: async (ids: string[]) => { offerTargetCalls.push(ids); return new Map(ids.map((i) => [i, "33333333-3333-3333-3333-333333333333"])); },
}));
vi.mock("@/hooks/useFeedPhase", () => ({ useFeedPhase: () => "ready", useProfileWaitPhase: () => "ready" }));

import JobPage from "./JobPage";
import { blankComments } from "@/test/helpers/blankNonCode";
import { formatJobDate } from "@/lib/dateUtils";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";
import { pinJobClock } from "@/test/helpers/pinJobClock";
import { jobOnContinueDay } from "@/lib/continueDay";

/** A day ahead, never a literal that ages into the past (jobDayFixtureTimezone). */
const DAY = jobLocalDateISO(11);
import { tierFeePercent } from "@/lib/subscriptionTiers";
import JobDetail from "../JobDetail";

const ME = "11111111-1111-1111-1111-111111111111";
// Hoisted for the useCurrentUser mock (vi.mock factories run before the module body).
var ME_ID = "11111111-1111-1111-1111-111111111111"; // eslint-disable-line no-var
const POSTER = "22222222-2222-2222-2222-222222222222";

function row(over: Partial<JobPageRow> = {}): JobPageRow {
  return {
    id: "33333333-3333-3333-3333-333333333333",
    title: "Pressure wash driveway",
    description: "Two-car concrete driveway and the front walk.",
    category: "pressure_washing",
    budget: 90,
    date_needed: DAY,
    start_time: "09:00",
    is_flexible_schedule: false,
    location: "123 Main St, Delcambre, LA 70528",
    customer_id: POSTER,
    helper_id: null,
    status: "open",
    payment_status: "escrow",
    urgent_fee: null,
    helpers_needed: 1,
    is_group_job: false,
    photos: [],
    helper_fee_flat_cents: 70,
    helper_fee_percent: 5,
    poster_fee_flat_cents: null,
    ...over,
  };
}

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname + l.search}</p>;
}

/** A row button's full words: a pair shows the short label (pairLabel.ts) and keeps the full one as its name. */
const fullName = (b: HTMLElement) => b.getAttribute("aria-label") ?? b.textContent ?? "";

function renderPage(userId = ME) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/jobs/x"]}>
        <Routes>
          <Route path="/jobs/x" element={<JobPage id="x" userId={userId} />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.onCrew = false;
  state.crewConfirmed = false;
  state.job = null;
  state.party = false;
  state.applicants = { total: 0, pending: 0 };
  state.myApplication = null;
  state.tracking = null;
  faceRequests.length = 0;
  flowCalls.length = 0;
  applyRequests.length = 0;
  state.owed = 0;
  state.cardHold = false;
  state.crewNobodyLeft = false;
  state.crewRoster = undefined;
  state.instantUntil = null;
  state.offeredToMe = false;
  state.moreCount = 2;
  state.leadCount = 0;
  state.owesReview = false;
  state.position = null;
});

describe("job page, Helpr side (boards 42, 169)", () => {
  // Audit #8: a job with no photo shows no placeholder band (it read as a maroon block); a real photo shows.
  it("no photo, no band; a real photo, the gallery", () => {
    state.job = row();
    const { unmount } = renderPage();
    expect(document.querySelector("[data-job-photos]")).toBeNull();
    unmount();
    state.job = row({ photos: ["https://example.test/a.jpg"] });
    renderPage();
    expect(document.querySelector("[data-job-photos]")).not.toBeNull();
  });

  // A2-B6: the poster's scope video was stored and shown nowhere. The Helpr and the poster both see it; no video, no player.
  it("shows the scope video to the Helpr and the poster, and nothing when the job has none", () => {
    const VIDEO = "https://fncmgoasalhdgfwzhsqa.supabase.co/storage/v1/object/public/job-photos/x/scope-video.mp4";
    state.job = row();
    const first = renderPage();
    expect(document.querySelector("video")).toBeNull();
    first.unmount();
    for (const customer_id of [POSTER, ME]) {
      state.job = row({ customer_id, scope_video_url: VIDEO });
      const { unmount } = renderPage();
      const v = document.querySelector("video[data-scope-video]") as HTMLVideoElement | null;
      expect(v?.getAttribute("src"), customer_id === ME ? "poster" : "Helpr").toBe(VIDEO);
      unmount();
    }
  });

  // Owner bug 2026-10-21: a member who already applied saw "Apply". Now: the applied state and View application.
  it("an applicant sees 'You applied · Waiting on Rhonda' and View application, never Apply", async () => {
    state.job = row();
    state.myApplication = { status: "pending", closed_reason: null };
    renderPage();
    expect(await screen.findByText("You applied · Waiting on Rhonda")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "View application" }));
    expect(screen.getByTestId("where").textContent).toContain("/jobs?tab=working");
  });

  it("shows the real take-home (no fee named), the city only, and Apply opens the apply sheet on the page", async () => {
    state.job = row();
    renderPage();
    // $90 - (5% of $90 + 70c) = $84.80, floored to whole dollars on the headline (owner, 2026-08-19).
    // Owner 11-01: "Remove you take home": the figure alone on screen, "Your pay" for a screen reader.
    expect(document.body.textContent).not.toMatch(/take home/i);
    expect(document.querySelector("[data-helpr-money] p")?.textContent).toBe("Your pay $84");
    expect(document.querySelector("[data-helpr-money] .sr-only")?.textContent).toBe("Your pay ");
    // Owner 2026-10-25: no fee name, rate or maths beside the take-home.
    expect(document.querySelector("[data-helpr-money]")?.textContent ?? "").not.toMatch(/fee|%/i);
    expect(screen.getByText(`${formatJobDate(DAY)} · 9:00 AM · Delcambre`)).toBeTruthy();
    expect(document.body.textContent).not.toContain("123 Main St");
    expect(screen.getByText("The street address is shared once you're offered the job.")).toBeTruthy();
    expect(screen.getByText("Home · Pressure washing")).toBeTruthy();
    // A Helpr browsing an open job is not on it yet: no tracker.
    expect(document.querySelector("[data-job-tracker]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    // F9: the apply sheet opens over THIS page (Home's flow, useApplyFlow), not /home?quickApply.
    const sheet = await screen.findByTestId("apply-sheet");
    expect(screen.queryByTestId("where")).toBeNull();
    expect(applyRequests).toEqual([row().id]);
    // F8 on this path: the sheet names the poster the way the page's poster card does, never "a neighbor".
    expect(sheet.textContent).toBe(`${row().title} · Rhonda D.`);
  });

  // JOBS-17: a member under 18 got a live Apply here, filled the sheet, uploaded, and only then read the refusal.
  it("under 18: Apply is greyed and a tap does not open the sheet", async () => {
    const { queryClient } = await import("@/lib/queryClient");
    const key = ["currentUser", "under-18-apply"];
    queryClient.setQueryData(key, { profile: { date_of_birth: "2015-01-01" } });
    try {
      state.job = row();
      renderPage();
      const apply = screen.getByRole("button", { name: "Apply" });
      expect(apply.getAttribute("data-age-gated")).toBe("apply");
      expect(apply.getAttribute("aria-disabled")).toBe("true");
      fireEvent.click(apply);
      expect(applyRequests).toEqual([]);
      expect(screen.queryByTestId("apply-sheet")).toBeNull();
    } finally {
      queryClient.removeQueries({ queryKey: key });
    }
  });

  it("an unstamped (older) job shows the take-home at the viewer's own tier rate", () => {
    state.job = row({ helper_fee_flat_cents: null, helper_fee_percent: null, budget: 60 });
    renderPage();
    const pct = tierFeePercent(undefined, undefined);
    expect(pct).toBeGreaterThan(0);
    expect(document.querySelector("[data-helpr-money] p")?.textContent).toBe(`Your pay $${Math.floor(60 - (60 * pct) / 100)}`);
    expect(document.querySelector("[data-helpr-money]")?.textContent ?? "").not.toMatch(/fee|%/i);
  });

  it("a poster-fee job: the Helpr keeps the whole price", () => {
    state.job = row({ helper_fee_flat_cents: 0, helper_fee_percent: 0, poster_fee_flat_cents: 520 });
    renderPage();
    expect(screen.getByText("$90")).toBeTruthy();
    expect(document.querySelector("[data-helpr-money]")?.textContent ?? "").not.toMatch(/fee|%/i);
  });
});

// Tester 6, 10-30: the photos showed only in the approve sheet.
describe("job page: the Helpr's before and after photos, for the job's parties only", () => {
  const PHOTOS = { proof_before_urls: ["j/b1.jpg"], proof_after_urls: ["j/a1.jpg", "j/a2.jpg"] };
  const imgs = () => [...document.querySelectorAll("[data-job-proof-photos] img")].map((i) => i.getAttribute("src"));

  it("the poster sees them while the job is under way, signed, and opening them only opens them", () => {
    state.job = row({ customer_id: ME, helper_id: POSTER, status: "in_progress", ...PHOTOS });
    state.party = true;
    renderPage();
    expect(imgs()).toEqual(["https://signed.example/j/b1.jpg", "https://signed.example/j/a1.jpg"]);
    fireEvent.click(screen.getByRole("button", { name: "See the before and after photos" }));
    expect(screen.getByText("Photo proof")).toBeTruthy();
    expect(screen.queryByTestId("where")).toBeNull();
  });

  it("the Helpr sees them on their page after release", () => {
    state.job = row({ helper_id: ME, status: "completed", payment_status: "released", ...PHOTOS });
    state.party = true;
    renderPage();
    expect(imgs()).toHaveLength(2);
  });

  it("the before photo shows alone, as soon as it's in", () => {
    state.job = row({ customer_id: ME, helper_id: POSTER, status: "in_progress", proof_before_urls: ["j/b1.jpg"], proof_after_urls: [] });
    state.party = true;
    renderPage();
    expect(imgs()).toEqual(["https://signed.example/j/b1.jpg"]);
  });

  it("nobody else: not a stranger, and not a row that did not come from the party read", () => {
    state.job = row({ status: "in_progress", ...PHOTOS });
    state.party = true;
    renderPage();
    expect(document.querySelector("[data-job-proof-photos]")).toBeNull();
    cleanup();
    state.job = row({ helper_id: ME, status: "in_progress", ...PHOTOS });
    state.party = false;
    renderPage();
    expect(document.querySelector("[data-job-proof-photos]")).toBeNull();
  });

  it("no photos, no section", () => {
    state.job = row({ customer_id: ME, helper_id: POSTER, status: "in_progress", proof_before_urls: null, proof_after_urls: [] });
    state.party = true;
    renderPage();
    expect(document.querySelector("[data-job-proof-photos]")).toBeNull();
  });
});

describe("job page, poster side (boards 15, 168)", () => {
  it("says the money was paid at post and is held, counts applicants, and reviews them in Posted", () => {
    state.job = row({ customer_id: ME });
    state.party = true;
    state.applicants = { total: 3, pending: 2 };
    renderPage();
    // Owner 2026-11-01: no budget card; the amount and its word sit at the right of the header.
    expect(screen.queryByText("Your budget")).toBeNull();
    const money = document.querySelector("[data-poster-money]") as HTMLElement;
    expect(document.querySelector("[data-job-head]")?.contains(money)).toBe(true);
    expect(money.textContent).toContain("$");
    // Owner 11-01: "Remove paid Louisiana Helpr holds until job is done." A paid (escrow) job prints no money line.
    expect(document.body.textContent).not.toMatch(/holds it until the job is done/i);
    expect(document.body.textContent).not.toMatch(/Nothing is charged|take home|takes home|not charged/i);
    expect(screen.getByText("3 applicants")).toBeTruthy();
    expect(screen.getByLabelText(/^Job progress, step 1 of 8: Posted,/)).toBeTruthy();
    // The next step (owner 11-01 12:05 PM): "Next: choose a Helpr · 2 applied".
    expect(document.querySelector("[data-next-step]")?.textContent).toBe("Next: choose a Helpr · 2 applied");
    fireEvent.click(screen.getByRole("button", { name: "Review 2 applicants" }));
    expect(screen.getByTestId("where").textContent).toBe(`/posts?highlight=${row().id}&applicants=1`);
  });

  // Audit 2026-10-28 A2-C30: the poster's own open job with nobody applied said "Pick your Helpr".
  it("with no applicants yet, the tracker says it is waiting for Helprs to apply, never 'Pick your Helpr'", () => {
    state.job = row({ customer_id: ME });
    state.party = true;
    state.applicants = { total: 0, pending: 0 };
    renderPage();
    expect(screen.getByText("Waiting for Helprs to apply")).toBeTruthy();
    expect(screen.queryByText("Pick your Helpr")).toBeNull();
  });

  // Audit 2026-10-28 F4: with card_hold_at_post on, the card is charged at the hire, so a paid job's line
  // never says "when you posted"; a job whose card is only held says it is not charged yet.
  it("under the card hold: a paid job prints no 'holds it' line (owner 11-01), and a held card is not charged until the hire", () => {
    state.cardHold = true;
    state.job = row({ customer_id: ME, helper_id: "44444444-4444-4444-4444-444444444444", status: "in_progress", helper_confirmed_at: "2026-10-20T12:00:00Z" });
    state.party = true;
    const { unmount } = renderPage();
    expect(document.body.textContent).not.toMatch(/holds it until the job is done/i);
    expect(document.body.textContent).not.toContain("when you posted");
    unmount();
    state.job = row({ customer_id: ME, payment_status: "held" });
    renderPage();
    expect(screen.getByText("Your card isn't charged until a Helpr accepts your offer.")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Paid when you posted|You're charged when you post/);
  });

  it("an unpaid post says Helprs can't see it; an unverified money state prints nothing", () => {
    state.job = row({ customer_id: ME, payment_status: "abandoned" });
    state.party = true;
    const { unmount } = renderPage();
    expect(screen.getByText("Not paid yet. Helprs can't see this job until it's paid.")).toBeTruthy();
    // JOBS-9: not "Waiting for Helprs to apply", and the button goes somewhere, not to a list without this job.
    expect(screen.queryByText("Waiting for Helprs to apply")).toBeNull();
    expect(screen.getByRole("button", { name: "Post this job again" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Manage job" })).toBeNull();
    unmount();
    // payout_pending was this "unverified" example until F32 gave it its line (posterMoneyAfterRelease.test.tsx);
    // a state the card has no verified sentence for still prints nothing.
    state.job = row({ customer_id: ME, status: "completed", payment_status: "cancelling" });
    renderPage();
    expect(document.querySelector("[data-poster-money] p.mt-1\\.5")).toBeNull();
    expect(screen.getByLabelText(/^Job progress: all 8 steps done/)).toBeTruthy();
  });

  it("a cancelled job says so instead of drawing a tracker", () => {
    state.job = row({ customer_id: ME, status: "cancelled", payment_status: "refunded" });
    state.party = true;
    renderPage();
    // The one tracker (owner 2026-10-21): off the path it is the line alone, no step bar.
    expect(screen.getByText(/This job was cancelled/)).toBeTruthy();
    // The refund is said ONCE (lead 11-01, B107): on the tracker line, not again under the price.
    expect(screen.getByText(/Your payment was refunded/)).toBeTruthy();
    expect(screen.queryByText("Refunded to your card.")).toBeNull();
    // No misleading progress colour (lead review 2026-10-22): an all-grey bar that says Cancelled.
    expect(screen.getByLabelText(/^Job progress: Cancelled/).getAttribute("data-tone")).toBe("cancelled");
  });
});

describe("job page, the poster confirms the arrival here (F14)", () => {
  // Audit 2026-10-28 (p4j-parr-card-375.png): the page's tracker said "Confirm they arrived" and the only button was
  // "Manage job"; the confirm lived on the Posted card. Now the page's button is the confirm, the card's own write.
  const arrived = () =>
    row({
      customer_id: ME, helper_id: POSTER, status: "in_progress", helper_confirmed_at: "2026-10-27T12:00:00Z",
      helper_dayof_confirmed_at: "2026-10-27T12:00:00Z", poster_confirmed_at: "2026-10-27T12:00:00Z",
      helper_on_the_way_at: "2026-10-28T12:00:00Z", helper_arrived_at: "2026-10-28T12:30:00Z",
    });

  beforeEach(() => confirmArrivalMock.mockClear());

  it("offers Confirm arrival, never Manage job, and runs the card's own write", async () => {
    state.job = arrived();
    state.party = true;
    renderPage();
    expect(screen.getByLabelText(/^Job progress, step 6 of 8: Arrived, waiting on you\./)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Manage job" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Confirm they've arrived" }));
    await waitFor(() => expect(confirmArrivalMock).toHaveBeenCalledTimes(1));
    expect(confirmArrivalMock.mock.calls[0][0]).toMatchObject({ id: arrived().id, helper_id: POSTER });
    // Still on the job page: the catch-all route (any navigation) never rendered.
    expect(screen.queryByTestId("where")).toBeNull();
  });

  it("the page and the Posted card share ONE confirm-arrival write (src/lib/posterArrival.ts)", () => {
    const ROOT = path.resolve(__dirname, "../../../..");
    const files = execFileSync("git", ["ls-files", "src"], { cwd: ROOT, encoding: "utf8" })
      .split("\n").filter((f) => /\.(ts|tsx)$/.test(f) && !/\.(test|spec)\./.test(f) && !f.startsWith("src/test/"));
    expect(files.length).toBeGreaterThan(500);
    const writers = files.filter((f) => /\.update\(\{\s*poster_confirmed_arrival_at\b/.test(readFileSync(path.join(ROOT, f), "utf8")));
    expect(writers).toEqual(["src/lib/posterArrival.ts"]);
    const callers = files.filter((f) => /\bconfirmPosterArrival\(/.test(readFileSync(path.join(ROOT, f), "utf8")) && f !== "src/lib/posterArrival.ts");
    expect(callers.sort()).toEqual(["src/components/job-card/activityActions/useLifecycleHandlers.ts", "src/pages/jobs/jobPage/usePageConfirmArrival.ts"]);
  });

  // AUD31-77: marked done, the page said "Check the work and approve" over a lone "Manage job".
  // @mutate src/pages/jobs/jobPage/posterPageActions.tsx |       : posterWait === "approve" |       : false
  // @mutate src/pages/jobs/jobPage/posterPageActions.tsx | go: flows.approve, disabled: | go: () => navigate(`/posts?highlight=${id}&manage=1`), disabled:
  it("once the Helpr marked it done, the button is Approve and release: the card's own approve runs ON the page", () => {
    state.job = { ...arrived(), poster_confirmed_arrival_at: "2026-10-28T12:40:00Z", helper_completed_at: "2026-10-28T15:00:00Z" };
    state.party = true;
    renderPage();
    expect(screen.queryByRole("button", { name: "Manage job" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Approve and release" }));
    expect(flowCalls).toEqual(["approve"]);
    // No trip to the Posted card, no request left for it; the card's controls (its CompletionChoiceSheet) are mounted here.
    expect(screen.queryByTestId("where")).toBeNull();
    expect(faceRequests).toEqual([]);
    expect(screen.getByTestId("card-panel")).toBeTruthy();
  });

  // LEAD-JOBPAGE-LAYOUT (owner 2026-10-31): no step due is the next useful thing, never "Manage job".
  // @mutate src/pages/jobs/jobPage/posterPageActions.tsx |   const message = job.helper_id && HAS_HELPR.has(status) |   const message = false && HAS_HELPR.has(status)
  it("with nothing to confirm yet (on the way) the button is Message the Helpr, never Manage job", async () => {
    state.job = { ...arrived(), helper_arrived_at: null };
    state.party = true;
    renderPage();
    expect(screen.queryByRole("button", { name: "Confirm they've arrived" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Manage job" })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Message Rhonda" }));
    expect(screen.getByTestId("where").textContent).toBe(`/messages?jobId=${arrived().id}&userId=${POSTER}`);
  });
});

// Owner 2026-11-01: the on-the-way line and where the Helpr is sit ABOVE the tracker; Message and the card's options
// share one row (none: Message alone; one: that action; two or more: More options); the Helpr's card sits above them.
// @mutate src/pages/jobs/jobPage/JobPage.tsx |           {isPoster && !continueDay.row && <OnTheWayNow job={job} helperFirst={helperFirst} trackingStatus={trackingStatus} />} |
// @mutate src/pages/jobs/jobPage/OnTheWayNow.tsx |   const mapped = p != null && (arrived ? p.status === "arrived" : p.status === "on_the_way") && |   const mapped = p != null &&
// @mutate src/pages/jobs/jobPage/JobPageActionRow.tsx |     : others === 1 | : others === -1
// @mutate src/pages/jobs/jobPage/posterPageActions.tsx |     const extras = [...(lead === msg ? [] : msg ? [msg] : []), ...pageExtras(), ...moreExtras]; |     const extras = [msg as RowAction, ...pageExtras(), ...moreExtras];
describe("job page, the poster's Helpr is on the way (owner 2026-11-01)", () => {
  const onTheWay = () => row({
    customer_id: ME, helper_id: POSTER, status: "in_progress", helper_confirmed_at: "2026-10-27T12:00:00Z",
    helper_dayof_confirmed_at: "2026-10-27T12:00:00Z", poster_confirmed_at: "2026-10-27T12:00:00Z",
    helper_on_the_way_at: "2026-10-28T13:51:00Z", helper_arrived_at: null, latitude: 30.0, longitude: -91.8,
  });

  it("says who is on the way and since when (Louisiana time), above the tracker, which no longer repeats it", async () => {
    state.job = onTheWay();
    state.party = true;
    renderPage();
    const block = document.querySelector("[data-on-the-way]") as HTMLElement;
    await waitFor(() => expect(block.textContent).toContain("Rhonda is on the way · since 8:51 AM"));
    expect(block.textContent).toContain("You'll confirm once they say they've arrived.");
    const tracker = document.querySelector("[data-job-tracker]") as HTMLElement;
    expect(block.compareDocumentPosition(tracker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tracker.querySelector("[data-job-progress-next]")).toBeNull();
    // No position on the tracking row: no map and no empty box.
    expect(document.querySelector("[data-on-the-way-map]")).toBeNull();
  });

  it("with his position, a small map; once he has arrived, the on-the-way line gives way to the arrived one", async () => {
    state.position = { status: "on_the_way", latitude: 30.01, longitude: -91.81 };
    state.job = onTheWay();
    state.party = true;
    const { unmount } = renderPage();
    expect(await screen.findByLabelText("On the way")).toBeTruthy();
    await waitFor(() => expect(document.querySelector("[data-on-the-way-map]")).toBeTruthy());
    unmount();
    state.job = { ...onTheWay(), helper_arrived_at: "2026-10-28T14:20:00Z" };
    renderPage();
    expect(document.querySelector("[data-on-the-way]")).toBeNull();
    expect(document.querySelector("[data-arrived-now]")).toBeTruthy();
  });

  // Owner 2026-11-01 9:36 and 9:40 AM: at Arrived, "Rhonda arrived · 9:20 AM" and the Apple map with the job's pin and
  // where she tapped Arrived, above the tracker; no GPS text line. Gone once the work is under way.
  it("arrived: the time she tapped it and the map of where she was, above the tracker; no GPS line", async () => {
    state.position = { status: "arrived", latitude: 30.0001, longitude: -91.8001 };
    state.job = { ...onTheWay(), helper_arrived_at: "2026-10-28T14:20:00Z" };
    state.party = true;
    const { unmount } = renderPage();
    const block = await screen.findByLabelText("Arrived");
    await waitFor(() => expect(block.textContent).toContain("Rhonda arrived · 9:20 AM"));
    expect(block.textContent).not.toMatch(/GPS|on the way/i);
    await waitFor(() => expect(block.querySelector("[data-on-the-way-map]")).toBeTruthy());
    const tracker = document.querySelector("[data-job-tracker]") as HTMLElement;
    expect(block.compareDocumentPosition(tracker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    unmount();
    // No position shared: the line alone, no empty map box.
    state.position = null;
    const second = renderPage();
    expect((await screen.findByLabelText("Arrived")).querySelector("[data-on-the-way-map]")).toBeNull();
    second.unmount();
    // The last point is still a driving one (not where he tapped Arrived): no map of a spot he wasn't at.
    state.position = { status: "on_the_way", latitude: 30.01, longitude: -91.81 };
    const third = renderPage();
    const stale = await screen.findByLabelText("Arrived");
    await new Promise((r) => setTimeout(r, 50));
    expect(stale.querySelector("[data-on-the-way-map]")).toBeNull();
    third.unmount();
    state.job = { ...onTheWay(), helper_arrived_at: "2026-10-28T14:20:00Z", poster_confirmed_working_at: "2026-10-28T14:30:00Z" };
    renderPage();
    expect(document.querySelector("[data-arrived-now]")).toBeNull();
  });

  it("one card action (No-Show): [Message Rhonda | that action], no More options; the Helpr's card sits above them", async () => {
    state.moreCount = 1;
    state.job = onTheWay();
    state.party = true;
    renderPage();
    const actions = document.querySelector('[data-job-row="poster"]') as HTMLElement;
    expect(await within(actions).findByRole("button", { name: "Message Rhonda" })).toBeTruthy();
    expect(actions.querySelector("[data-row-one-action]")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "More options" })).toBeNull();
    // Message is in the row, not also the big button above it.
    expect(screen.getAllByRole("button", { name: "Message Rhonda" })).toHaveLength(1);
    const card = await screen.findByRole("region", { name: "Your Helpr" });
    expect(card.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("no card action: Message alone; two or more: [Message | More options]", async () => {
    state.moreCount = 0;
    state.job = onTheWay();
    state.party = true;
    const { unmount } = renderPage();
    const actions = document.querySelector('[data-job-row="poster"]') as HTMLElement;
    await within(actions).findByRole("button", { name: "Message Rhonda" });
    expect(within(actions).getAllByRole("button").map(fullName)).toEqual(["Message Rhonda"]);
    unmount();
    state.moreCount = 3;
    renderPage();
    const row2 = document.querySelector('[data-job-row="poster"]') as HTMLElement;
    await within(row2).findByRole("button", { name: "Message Rhonda" });
    // The green one on the RIGHT (owner 11-01 12:00 PM, app-wide).
    expect(within(row2).getAllByRole("button").map(fullName)).toEqual(["More options", "Message Rhonda"]);
  });
});

describe("job page, the poster sees who they hired (AUD31-80)", () => {
  // @mutate src/pages/jobs/jobPage/JobPage.tsx |             {isPoster && job.helper_id && !job.is_group_job && HAS_HELPR.has(job.status ?? "") && <HiredHelpr helprId={job.helper_id} />} |
  // @mutate src/pages/jobs/jobPage/JobPage.tsx | {isPoster && job.helper_id && !job.is_group_job && HAS_HELPR.has(job.status ?? "") && | {isPoster && job.helper_id && !job.is_group_job &&
  // @mutate src/pages/jobs/jobPage/JobPageParts.tsx |       <DeclutterSellerCard sellerId={helprId} noun="Helpr" /> |       <DeclutterSellerCard sellerId={helprId} noun="poster" />
  const hired = () => row({ customer_id: ME, helper_id: POSTER, status: "in_progress", helper_confirmed_at: "2026-10-27T12:00:00Z" });

  it("a hired job shows the Helpr's own person card, linked to their profile, beside Message <name>", async () => {
    state.job = hired();
    state.party = true;
    renderPage();
    const card = await screen.findByRole("link", { name: /^See the Helpr, Rhonda/ });
    expect(card.getAttribute("href")).toBe(`/user/${POSTER}`);
    expect(screen.getByRole("region", { name: "Your Helpr" }).contains(card)).toBe(true);
    expect(screen.getByRole("button", { name: "Message Rhonda" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Posted by" })).toBeNull();
  });

  it("no card while the job is still open (nobody hired), nor for the Helpr's own view", () => {
    state.job = row({ customer_id: ME, helper_id: POSTER, status: "open" });
    state.party = true;
    const open = renderPage();
    expect(screen.queryByRole("region", { name: "Your Helpr" })).toBeNull();
    open.unmount();
    state.job = row({ customer_id: POSTER, helper_id: ME, status: "in_progress", helper_confirmed_at: "2026-10-27T12:00:00Z" });
    renderPage();
    expect(screen.queryByRole("region", { name: "Your Helpr" })).toBeNull();
  });
});

describe("job page, the hired Helpr", () => {
  it("sees the tracker with their next step and opens the job in Working; no address note", () => {
    state.job = row({ helper_id: ME, status: "in_progress", helper_confirmed_at: "2026-10-20T12:00:00Z", poster_confirmed_arrival_at: "2026-10-21T12:00:00Z" });
    state.party = true;
    renderPage();
    expect(screen.getByLabelText(/^Job progress, step 7 of 8: Working, waiting on you\./)).toBeTruthy();
    expect(screen.getByText("Next: mark it done when you finish")).toBeTruthy();
    expect(screen.queryByText("The street address is shared once you're offered the job.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open in working" }));
    // F10: Working's own card for THIS job, in its bucket and opened (`?job=`; `?highlight=` there is an application id).
    expect(screen.getByTestId("where").textContent).toBe(`/jobs?tab=working&job=${row().id}&open=1`);
  });

  // F26 (audit 2026-10-28, p4j-hired-hallie-p1-375.png): the hired Helpr's page had no address, no Message and no
  // next action, only "Open in working". Now: the street address, the Working card's own next-step button, Message.
  const TOMORROW = jobLocalDateISO(1);
  const booked = () => row({ helper_id: ME, status: "accepted", helper_confirmed_at: "2026-10-27T12:00:00Z", date_needed: TOMORROW, start_time: "09:00" });

  // JA-20 / JA-25 (audit 11-01): the address opens Maps; a cancelled job's Helpr no longer sees it.
  // @mutate src/pages/jobs/jobPage/JobPage.tsx |               {isHired && job.location && job.status !== "cancelled" && ( |               {isHired && job.location && (
  // @mutate src/pages/jobs/jobPage/JobPage.tsx | <a href={mapsSearchUrl(job.location)} target="_blank" | <a target="_blank"
  it("the hired Helpr's address opens Maps, and is gone once the job is cancelled", () => {
    state.job = booked();
    state.party = true;
    const { unmount } = renderPage();
    const link = document.querySelector("[data-job-address] a") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("https://maps.apple.com/?q=123%20Main%20St%2C%20Delcambre%2C%20LA%2070528");
    unmount();
    state.job = { ...booked(), status: "cancelled" };
    renderPage();
    expect(document.querySelector("[data-job-address]")).toBeNull();
  });

  it("shows the street address, the day-before confirm as the button, and Message", () => {
    state.job = booked();
    state.party = true;
    renderPage();
    expect(document.querySelector("[data-job-address]")?.textContent).toBe("Address: 123 Main St, Delcambre, LA 70528");
    // The Working card's own face for this state (helperFaceAction: confirm_day).
    fireEvent.click(screen.getByRole("button", { name: "Confirm you'll be at the job" }));
    expect(faceRequests).toEqual([[row().id, "confirm"]]);
    expect(screen.getByTestId("where").textContent).toBe(`/jobs?tab=working&job=${row().id}&open=1`);
  });

  it("Message opens the thread with the poster", async () => {
    state.job = booked();
    state.party = true;
    renderPage();
    // The step leads; Message and Open in working sit behind More options, one tap away (owner 2026-11-01).
    await screen.findByRole("button", { name: "Confirm you'll be at the job" });
    fireEvent.click(screen.getByRole("button", { name: "More options" }));
    fireEvent.click(await within(document.querySelector("[data-row-options]") as HTMLElement).findByRole("button", { name: "Message Rhonda" }));
    expect(screen.getByTestId("where").textContent).toBe(`/messages?jobId=${row().id}&userId=${POSTER}`);
  });

  it("reads the photos and the tracking row like the Working card: both photos and started = Mark job complete", () => {
    state.job = row({
      helper_id: ME, status: "in_progress", helper_confirmed_at: "2026-10-27T12:00:00Z", helper_dayof_confirmed_at: "2026-10-27T12:00:00Z",
      poster_confirmed_at: "2026-10-27T12:00:00Z", helper_on_the_way_at: "2026-10-28T12:00:00Z", helper_arrived_at: "2026-10-28T12:30:00Z",
      helper_arrival_verified_at: "2026-10-28T12:30:00Z", poster_confirmed_arrival_at: "2026-10-28T12:35:00Z",
      require_photo_proof: true, proof_before_urls: ["b.jpg"], proof_after_urls: ["a.jpg"],
    });
    state.party = true;
    state.tracking = "working";
    renderPage();
    expect(document.body.textContent).not.toMatch(/before photo/i);
    expect(screen.getByRole("button", { name: "Mark job complete" })).toBeTruthy();
  });

  it("a Have a Helpr list it job says when it is done (sent for approval) beside Mark job complete; other jobs don't", () => {
    const working = {
      helper_id: ME, status: "in_progress", helper_confirmed_at: "2026-10-27T12:00:00Z", helper_dayof_confirmed_at: "2026-10-27T12:00:00Z",
      poster_confirmed_at: "2026-10-27T12:00:00Z", helper_on_the_way_at: "2026-10-28T12:00:00Z", helper_arrived_at: "2026-10-28T12:30:00Z",
      helper_arrival_verified_at: "2026-10-28T12:30:00Z", poster_confirmed_arrival_at: "2026-10-28T12:35:00Z",
      require_photo_proof: true, proof_before_urls: ["b.jpg"], proof_after_urls: ["a.jpg"],
    };
    state.job = row({ ...working, category: "declutter_help" });
    state.party = true;
    state.tracking = "working";
    const { unmount } = renderPage();
    expect(screen.getByRole("button", { name: "Mark job complete" })).toBeTruthy();
    expect(screen.getByText("Mark it done once you've sent the listings to the seller for approval.")).toBeTruthy();
    unmount();
    state.job = row({ ...working, category: "yard_work" });
    renderPage();
    expect(document.querySelector("[data-sell-for-me-done-note]")).toBeNull();
  });

  it("10 minutes after arriving, Mark job complete is greyed with the Working card's sentence; at 30 it is live", () => {
    const stamps = {
      helper_id: ME, status: "in_progress", helper_confirmed_at: "2026-10-27T12:00:00Z", helper_dayof_confirmed_at: "2026-10-27T12:00:00Z",
      poster_confirmed_at: "2026-10-27T12:00:00Z", helper_on_the_way_at: "2026-10-28T12:00:00Z", poster_confirmed_arrival_at: "2026-10-28T12:30:00Z",
      require_photo_proof: true, proof_before_urls: ["b.jpg"], proof_after_urls: ["a.jpg"],
    };
    state.job = row({ ...stamps, helper_arrived_at: new Date(Date.now() - 10 * 60_000).toISOString() });
    state.party = true;
    state.tracking = "working";
    const { unmount } = renderPage();
    expect((screen.getByRole("button", { name: "Mark job complete" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Available in 20 min — 30 minutes after you arrived, to ensure quality.")).toBeTruthy();
    unmount();

    state.job = row({ ...stamps, helper_arrived_at: new Date(Date.now() - 31 * 60_000).toISOString() });
    renderPage();
    expect((screen.getByRole("button", { name: "Mark job complete" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(/^Available in/)).toBeNull();
  });

  it("the tracker reads the tracking row: before photo taken, not started, arrival not yet confirmed", () => {
    state.job = row({
      helper_id: ME, status: "in_progress", helper_confirmed_at: "2026-10-27T12:00:00Z", helper_dayof_confirmed_at: "2026-10-27T12:00:00Z",
      poster_confirmed_at: "2026-10-27T12:00:00Z", helper_on_the_way_at: "2026-10-28T12:00:00Z", helper_arrived_at: "2026-10-28T12:30:00Z",
      require_photo_proof: true, proof_before_urls: ["b.jpg"], proof_after_urls: [],
    });
    state.party = true;
    state.tracking = "arrived";
    renderPage();
    const tracker = document.querySelector("[data-job-tracker]")?.textContent ?? "";
    // Without the tracking row the line guessed "working" and said to mark it done.
    expect(tracker).not.toMatch(/mark it done/i);
    expect(screen.queryByRole("button", { name: "Mark job complete" })).toBeNull();
  });

  it("still asks for the before photo while it is owed", () => {
    state.job = row({
      helper_id: ME, status: "in_progress", helper_confirmed_at: "2026-10-27T12:00:00Z", helper_dayof_confirmed_at: "2026-10-27T12:00:00Z",
      poster_confirmed_at: "2026-10-27T12:00:00Z", helper_on_the_way_at: "2026-10-28T12:00:00Z", helper_arrived_at: "2026-10-28T12:30:00Z",
      helper_arrival_verified_at: "2026-10-28T12:30:00Z", require_photo_proof: true, proof_before_urls: [], proof_after_urls: [],
    });
    state.party = true;
    state.tracking = "arrived";
    renderPage();
    expect(screen.getByRole("button", { name: "Take the before photo" })).toBeTruthy();
  });

  it("an offered Helpr's See the offer opens that offer's card on Working", () => {
    state.job = row({ helper_id: ME, status: "accepted", helper_confirmed_at: null });
    state.party = true;
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "See the offer" }));
    expect(screen.getByTestId("where").textContent).toBe(`/jobs?tab=working&job=${row().id}&open=1`);
  });
});

// CMP-4 (lead 2026-11-01): the booked Helpr's job page showed only "See the offer"; the instant booking card (Confirm,
// Decline, the 2-hour countdown) was on the Working offer card alone. The page now shows the same card, and no
// "See the offer" or "offered you this job" beside it. The card's own answers are src/test/instantBookScreens.test.tsx.
describe("job page, the booked Helpr's instant booking (CMP-4)", () => {
  const openOffer = () => row({ status: "open", payment_status: "held", direct_offer_status: "pending" });

  it("inside the 2 hours: the card with its countdown, Confirm and Decline, and no See the offer", () => {
    state.job = openOffer();
    state.party = true;
    state.offeredToMe = true;
    state.instantUntil = new Date(Date.now() + 102 * 60_000 + 30_000).toISOString();
    renderPage();
    const card = document.querySelector(`[data-instant-booking="${row().id}"]`) as HTMLElement | null;
    expect(card).not.toBeNull();
    expect(card!.closest("[data-job-card]")).not.toBeNull();
    expect(within(card!).getByText("1 h 42 min left to decline")).toBeTruthy();
    expect(within(card!).getByText(/You were booked for .Pressure wash driveway./)).toBeTruthy();
    expect(within(card!).getByRole("button", { name: "Confirm" })).toBeTruthy();
    expect(within(card!).getByRole("button", { name: "Decline" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "See the offer" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
    expect(document.querySelector("[data-viewer-status]")).toBeNull();
    expect(screen.queryByText("The street address is shared once you're offered the job.")).toBeNull();
  });

  it("past the 2 hours: the card says they're booked, with no buttons", () => {
    state.job = openOffer();
    state.party = true;
    state.offeredToMe = true;
    state.instantUntil = new Date(Date.now() - 60_000).toISOString();
    renderPage();
    const card = document.querySelector(`[data-instant-booking="${row().id}"]`) as HTMLElement;
    expect(within(card).getByText("The 2 hours to decline have ended, so you're booked.")).toBeTruthy();
    expect(within(card).queryByRole("button", { name: "Confirm" })).toBeNull();
    expect(within(card).queryByRole("button", { name: "Decline" })).toBeNull();
  });

  it("a plain direct offer on an open job (no decline window): See the offer and 'offered you', no card", () => {
    state.job = openOffer();
    state.party = true;
    state.offeredToMe = true;
    renderPage();
    expect(document.querySelector("[data-instant-booking]")).toBeNull();
    expect(screen.getByRole("button", { name: "See the offer" })).toBeTruthy();
    expect(document.querySelector("[data-viewer-status]")?.textContent).toMatch(/offered you this job$/);
  });

  it("no instant booking: no card, and the page is as before", () => {
    state.job = row({ helper_id: ME, status: "accepted", helper_confirmed_at: null });
    state.party = true;
    renderPage();
    expect(document.querySelector("[data-instant-booking]")).toBeNull();
    expect(screen.getByRole("button", { name: "See the offer" })).toBeTruthy();
  });

  it("the poster never sees the Helpr's card", () => {
    state.job = row({ customer_id: ME, status: "open", payment_status: "held", direct_offer_status: "pending" });
    state.instantUntil = new Date(Date.now() + 60 * 60_000).toISOString();
    renderPage();
    expect(document.querySelector("[data-instant-booking]")).toBeNull();
  });
});

// Audit 2026-10-28 F7: the offer card in Working printed the street while the job page said only the
// city. Owner rule 2026-08-31 ("Should only see address when they are offered the job"): the offered
// Helpr sees the street on both; a Helpr who only applied sees the city and the line saying when.
describe("job page, the street address follows the Working card", () => {
  it("the offered Helpr sees the street the offer card shows, and no 'shared once' line", () => {
    state.job = row({ helper_id: ME, status: "accepted", helper_confirmed_at: null });
    state.party = true;
    renderPage();
    // JA-16 (audit 11-01): said once, by the tracker, never again as a bold status line under it.
    // @mutate src/pages/jobs/jobPage/viewerState.ts |     return { action: { kind: "see_offer" }, status: null }; |     return { action: { kind: "see_offer" }, status: "Lexi offered you this job" };
    expect(document.querySelector("[data-viewer-status]")).toBeNull();
    expect(document.body.textContent!.match(/offered you this job/g)?.length).toBe(1);
    expect(document.querySelector("[data-job-address]")?.textContent).toBe("Address: 123 Main St, Delcambre, LA 70528");
    expect(document.querySelector("[data-job-meta]")?.textContent).toBe(`${formatJobDate(DAY)} · 9:00 AM · Delcambre`);
    expect(screen.queryByText("The street address is shared once you're offered the job.")).toBeNull();
  });

  it("the hired, working Helpr sees the street too", () => {
    state.job = row({ helper_id: ME, status: "in_progress", helper_confirmed_at: "2026-10-20T12:00:00Z" });
    state.party = true;
    renderPage();
    expect(document.querySelector("[data-job-address]")?.textContent).toContain("123 Main St");
    expect(document.querySelector("[data-job-meta]")?.textContent).not.toContain("123 Main St");
  });

  it("an applicant sees the city only, with the line saying the street comes with an offer", async () => {
    state.job = row();
    state.myApplication = { status: "pending", closed_reason: null };
    renderPage();
    await screen.findByText("You applied · Waiting on Rhonda");
    expect(document.querySelector("[data-job-meta]")?.textContent).toBe(`${formatJobDate(DAY)} · 9:00 AM · Delcambre`);
    expect(screen.getByText("The street address is shared once you're offered the job.")).toBeTruthy();
  });

  it("the poster's page is unchanged (the city in the meta line)", () => {
    state.job = row({ customer_id: ME });
    state.party = true;
    renderPage();
    expect(document.querySelector("[data-job-meta]")?.textContent).toBe(`${formatJobDate(DAY)} · 9:00 AM · Delcambre`);
  });

  // Owner 11-01: "Move the category to the second line and the location, day and time to the first."
  // @mutate src/pages/jobs/jobPage/JobPage.tsx |               {meta && <p data-job-meta="" className="text-ds-14 text-muted-foreground">{meta}</p>} |               {false && <p data-job-meta="" className="text-ds-14 text-muted-foreground">{meta}</p>}
  // @mutate src/pages/jobs/jobPage/JobPage.tsx |               <p data-job-category="" className="text-ds-14 font-semibold text-primary">{eyebrow}</p> |               <p data-job-category="" className="text-ds-14 font-semibold text-primary">{eyebrow}{meta ? ` · ${meta}` : ""}</p>
  it("the head: day, time and town on line 1, the category alone on line 2 (poster and Helpr)", () => {
    for (const job of [row({ customer_id: ME }), row({ helper_id: ME, status: "accepted" })]) {
      state.job = job;
      state.party = true;
      const { unmount } = renderPage();
      const head = document.querySelector("[data-job-head]") as HTMLElement;
      const lines = [...head.querySelectorAll("p")].map((p) => p.textContent);
      const meta = `${formatJobDate(DAY)} · 9:00 AM · Delcambre`;
      expect(lines.indexOf(meta)).toBeGreaterThanOrEqual(0);
      const cat = head.querySelector("[data-job-category]")!;
      expect(cat.textContent).not.toContain("9:00 AM");
      expect(lines.indexOf(cat.textContent)).toBe(lines.indexOf(meta) + 1);
      unmount();
    }
  });
});

describe("/jobs/:id for a signed-in member", () => {
  it("renders the job page instead of redirecting to /home?quickApply", async () => {
    state.job = row();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/jobs/${row().id}`]}>
          <Routes>
            <Route path="/jobs/:id" element={<JobDetail />} />
            <Route path="*" element={<Where />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("button", { name: "Apply" })).toBeTruthy();
    expect(screen.queryByTestId("where")).toBeNull();
  });
});

describe("board 57: the poster's open job with no applicants", () => {
  beforeEach(() => { state.party = false; state.applicants = { total: 0, pending: 0 }; state.reach = null; });

  // Board 184: with the reach known and above 0, the page says how many were already told (a floor).
  it("board 184: 'Sent to N Helprs so far.' when the alerts went out; nothing new at 0 or unknown", async () => {
    state.job = row({ customer_id: ME });
    state.reach = 14;
    renderPage();
    expect(await screen.findByText(/^Sent to 14 Helprs so far\. We'll tell you when someone applies\.$/)).toBeTruthy();
  });

  it("board 184: a reach of 0 keeps the plain line (a fresh post has not been sent yet)", async () => {
    state.job = row({ customer_id: ME });
    state.reach = 0;
    renderPage();
    expect(await screen.findByText(/It's out to Helprs near Delcambre\./)).toBeTruthy();
    expect(screen.queryByText(/Sent to/)).toBeNull();
  });

  it("a paid, open job nobody applied to says so, with only what the poster can do", async () => {
    state.job = row({ customer_id: ME });
    renderPage();
    expect(await screen.findByRole("heading", { name: "No applicants yet" })).toBeTruthy();
    expect(screen.getByText(/It's out to Helprs near Delcambre\./)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Add a photo/ })).toBeTruthy();
    const price = screen.getByRole("button", { name: /Change the price/ });
    expect(price.textContent).toContain("You're at $90");
    expect(screen.queryByText(/quotes/i)).toBeNull();
    fireEvent.click(price);
    // The card's own edit, on this page (LEAD-JOBPAGE-LAYOUT).
    expect(flowCalls).toEqual(["edit"]);
  });

  it("an unpaid post, a post with a photo, or one with applicants does not claim it", async () => {
    state.job = row({ customer_id: ME, payment_status: "unpaid" });
    const { unmount } = renderPage();
    expect(await screen.findByText(/Not paid yet\. Helprs/)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "No applicants yet" })).toBeNull();
    unmount();
    state.job = row({ customer_id: ME, photos: ["a.jpg"] });
    const r2 = renderPage();
    expect(await screen.findByRole("heading", { name: "No applicants yet" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Add a photo/ })).toBeNull();
    r2.unmount();
    state.applicants = { total: 2, pending: 2 };
    state.job = row({ customer_id: ME });
    renderPage();
    expect(await screen.findByText("2 applicants")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "No applicants yet" })).toBeNull();
  });
});

// Audit 2026-10-28 A2-B8: a crew job's helper_id is null, so a member on its roster (group_job_helpers) read as
// "not hired": "This job is no longer available" and the city only. The roster read (useJobPage onCrew) makes them hired.
describe("a crew member's own job page (A2-B8)", () => {
  it("shows the street, the Working card and the tracker, never 'no longer available'", async () => {
    state.job = row({ status: "in_progress", is_group_job: true, helpers_needed: 3, helper_id: null, location: "4412 Highland Rd, Baton Rouge, LA 70808" });
    state.party = true;
    state.myApplication = { status: "accepted", closed_reason: null };
    state.onCrew = true;
    renderPage();
    // JA-18: "See your crew steps" opens the Working card, so no "Open in working" beside it (two buttons, one place).
    expect(await screen.findByRole("button", { name: "See your crew steps" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open in working" })).toBeNull();
    expect(screen.queryByText("This job is no longer available")).toBeNull();
    expect(document.querySelector("[data-job-address]")?.textContent).toContain("4412 Highland Rd");
    expect(screen.queryByText(/street address is shared once/)).toBeNull();
    expect(document.querySelector("[data-job-tracker]")).not.toBeNull();
  });

  // JOBS-27 (Jobs audit 10-30, h6-crew): the member's page offered only a generic "Manage job"; their steps are on
  // the crew roster in the Working card, so the button names them and opens that card.
  // @mutate src/pages/jobs/jobPage/hiredHelprFace.ts | return { ...face, label: "See your crew steps" }; | return face;
  it("names the crew steps as the button, not a generic Manage job, and opens the Working card", async () => {
    state.job = row({ status: "in_progress", is_group_job: true, helpers_needed: 3, helper_id: null, location: "4412 Highland Rd, Baton Rouge, LA 70808" });
    state.party = true;
    state.myApplication = { status: "accepted", closed_reason: null };
    state.onCrew = true;
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "See your crew steps" }));
    expect(screen.queryByRole("button", { name: "Manage job" })).toBeNull();
    expect(screen.getByTestId("where").textContent).toBe(`/jobs?tab=working&job=${row().id}&open=1`);
  });

  // JA-33 (audit 11-01): a member already on the roster, spot confirmed, read "Dana offered you this job" (your move).
  // @mutate src/pages/jobs/jobPage/JobPage.tsx | crewMember={!isPoster && onCrew ? { confirmed: crewConfirmed } : undefined} | crewMember={undefined}
  // @mutate src/components/tracker/jobProgressState.ts |   if (o.viewer === "helpr" && o.crewMember && job.is_group_job === true | if (false && job.is_group_job === true
  it("a crew member's tracker follows their own spot: confirmed, or theirs to confirm", async () => {
    state.job = row({ status: "accepted", is_group_job: true, helpers_needed: 2, helper_id: null });
    state.party = true;
    state.myApplication = { status: "accepted", closed_reason: null };
    state.onCrew = true;
    state.crewConfirmed = true;
    const { unmount } = renderPage();
    const tracker = () => document.querySelector("[data-job-tracker]")?.textContent ?? "";
    await waitFor(() => expect(tracker()).toContain("You're on the crew. Your spot is confirmed"));
    expect(tracker()).not.toMatch(/offered you this job/);
    unmount();
    state.crewConfirmed = false;
    renderPage();
    await waitFor(() => expect(tracker()).toContain("Next: confirm your spot on the crew"));
  });

  it("an applicant NOT on the crew still reads as closed out", async () => {
    state.job = row({ status: "in_progress", is_group_job: true, helpers_needed: 3, helper_id: null, location: null });
    state.party = false;
    state.myApplication = { status: "rejected", closed_reason: null };
    renderPage();
    expect(await screen.findByText("Not selected this time")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open in working" })).toBeNull();
  });
});

// LEAD-JOBPAGE-LAYOUT (owner 2026-10-31): ONE screen in the owner's order. The top bar is the back arrow with the
// job's title; then the price, the description, the tracker with the step needed now as the big button; the Helpr
// Guarantee at the very bottom. "Get help now" is off the page (help is the header icon). On a phone the column boxes
// are `contents`, so each part's `order-N` places it in the one stack (jsdom draws no layout: the classes are read).
// Layout V2 (owner 11-01): the order is the DOM's own now (no `order-N`), read by "job page layout V2" below.
// @mutate src/pages/jobs/jobPage/JobPage.tsx | <div data-job-details="" className="space-y-4 lg:col-span-2"> | <div data-job-details="" className="space-y-4">
// @mutate src/pages/jobs/jobPage/JobPage.tsx | <section aria-label="Job summary" data-job-head="" | <section aria-label="Job summary" data-job-head-gone=""
// @mutate src/pages/jobs/jobPage/JobPage.tsx | <div data-job-guarantee="" className="empty:hidden"> | <div data-job-guarantee-gone="" className="empty:hidden">
// @mutate src/pages/jobs/jobPage/posterPageActions.tsx |     posterWait === "confirm_still_on" |     false
// @mutate src/pages/jobs/jobPage/JobPage.tsx |       backTo={isPoster ? "/posts" : "/jobs"}\n      titleActions | backTo={isPoster ? "/posts" : "/jobs"}\n      phoneHidesTitle\n      titleActions
describe("job page, one screen in the owner's order (LEAD-JOBPAGE-LAYOUT)", () => {
  it("the title shows in the top bar beside the back arrow on a phone (no phoneHidesTitle), and no Get help now", () => {
    state.job = row({ customer_id: ME, helper_id: POSTER, status: "accepted", helper_confirmed_at: "2026-10-27T12:00:00Z" });
    state.party = true;
    renderPage();
    const src = readFileSync(path.resolve(__dirname, "JobPage.tsx"), "utf8");
    const call = src.slice(src.indexOf("<AppPage\n      title={job.title}"), src.indexOf(">", src.indexOf("<AppPage\n      title={job.title}") + 30));
    expect(call.length).toBeGreaterThan(20);
    expect(call).not.toMatch(/phoneHidesTitle/);
    expect(screen.queryByRole("button", { name: "Get help now" })).toBeNull();
  });

  // @mutate src/pages/jobs/jobPage/posterPageActions.tsx |       ? { label: "Confirm it's still on", go: () => setConfirmAsk((n) => n + 1) } |       ? { label: "Confirm it's still on", go: flows.approve }
  // @mutate src/components/posterConfirmWarning.ts |   if (!isOwner) return "No-shows | if (true) return "No-shows
  // @mutate src/components/posterConfirmWarning.ts |   return helperConfirmedAt\n    ? | return !helperConfirmedAt\n    ?
  // @mutate src/components/JobConfirmation.tsx |     if (owed && (openNow \|\| takeFaceAction(jobId, "confirm"))) setShowConfirmDialog(true); |     if (owed && takeFaceAction(jobId, "confirm")) setShowConfirmDialog(true);
  it("the poster's day-before step is the big button: Confirm it's still on opens its confirm sheet ON the page", async () => {
    state.job = row({
      customer_id: ME, helper_id: POSTER, status: "accepted", helper_confirmed_at: "2026-10-27T12:00:00Z",
      poster_confirmed_at: null, date_needed: jobLocalDateISO(1), start_time: "00:30",
    });
    state.party = true;
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Confirm it's still on" }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("Confirm the job is still on")).toBeTruthy();
    expect(within(sheet).getByText("Pressure wash driveway")).toBeTruthy();
    expect(within(sheet).getByRole("button", { name: "Yes, it's still on" })).toBeTruthy();
    // LEAD-CONFIRM-WORDS (owner 10-31): the poster's own consequence, true to the cancel rules (the Helpr confirmed,
    // so a cancel inside 24 hours pays them 25-50%: computeCancellationFee), never the Helpr's no-show line.
    expect(within(sheet).getByText("If you cancel late, your Helpr is paid for their trouble.")).toBeTruthy();
    expect(sheet.textContent ?? "").not.toMatch(/No-shows/);
    // Still on the job page: no trip to the Posted card, no request left for it.
    expect(screen.queryByTestId("where")).toBeNull();
    expect(faceRequests).toEqual([]);
    // ONE row (owner 2026-11-01): the confirm leads on the right; Message, Change date or time and Cancel job are behind
    // More options on its left (the open sheet hides the page from roles).
    const row2 = document.querySelector('[data-job-row="poster"]') as HTMLElement;
    expect(within(row2).getAllByRole("button", { hidden: true }).map(fullName)).toEqual(["More options", "Confirm it's still on"]);
  });

});

/** Every action the page offers: the row's buttons, and what its More options lists (opened, then closed again). */
function pageActions(): string[] {
  const rowEl = document.querySelector("[data-job-row]");
  if (!rowEl) return [];
  const inRow = within(rowEl as HTMLElement).queryAllByRole("button").map(fullName);
  const more = within(rowEl as HTMLElement).queryByRole("button", { name: "More options" });
  if (!more) return inRow;
  fireEvent.click(more);
  const sheet = document.querySelector("[data-row-options]") as HTMLElement;
  const listed = within(sheet).queryAllByRole("button").map(fullName).filter((t) => t && t !== "Close");
  fireEvent.click(within(sheet).getByRole("button", { name: "Close" }));
  return [...inRow.filter((t) => t !== "More options"), ...listed];
}
/** Press an action, opening More options first when it is listed there (one tap). */
function pressAction(name: string) {
  const direct = document.querySelector("[data-job-row]") ? within(document.querySelector("[data-job-row]") as HTMLElement).queryByRole("button", { name }) : null;
  if (direct) return fireEvent.click(direct);
  fireEvent.click(screen.getByRole("button", { name: "More options" }));
  fireEvent.click(within(document.querySelector("[data-row-options]") as HTMLElement).getByRole("button", { name }));
}

describe("the poster acts on the job page (LEAD-JOBPAGE-LAYOUT, owner 2026-10-31)", () => {
  // The Manage job card's actions are the page's secondary buttons: message, change the date or time, cancel.
  const booked = () => row({
    customer_id: ME, helper_id: POSTER, status: "accepted", helper_confirmed_at: "2026-10-27T12:00:00Z",
    poster_confirmed_at: "2026-10-27T12:00:00Z", helper_dayof_confirmed_at: null,
  });

  // @mutate src/pages/jobs/jobPage/posterPageActions.tsx |     canChange && { key: "change" |     false && { key: "change"
  // @mutate src/pages/jobs/jobPage/JobPageActionRow.tsx |       {others > 1 && ( |       {others > 99 && (
  it("a booked job: [Message | More options], and More options lists Change date or time and Cancel job in one tap", async () => {
    state.job = booked();
    state.party = true;
    renderPage();
    const steps = document.querySelector("[data-job-card]") as HTMLElement;
    const row2 = steps.querySelector('[data-job-row="poster"]') as HTMLElement;
    expect(await within(row2).findByRole("button", { name: "Message Rhonda" })).toBeTruthy();
    // The green one on the RIGHT (owner 11-01 12:00 PM, app-wide).
    expect(within(row2).getAllByRole("button").map(fullName)).toEqual(["More options", "Message Rhonda"]);
    // Never a stack of buttons: nothing else under the row.
    expect(screen.queryByRole("button", { name: "Cancel job" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Manage job" })).toBeNull();
    fireEvent.click(within(row2).getByRole("button", { name: "More options" }));
    const sheet = await screen.findByRole("dialog", { name: "More options" });
    expect(within(sheet).getAllByRole("button").map(fullName).filter((t) => t !== "Close")).toEqual(["Change date or time", "Cancel job"]);
    // jsdom has no scrollTo (the sheet's date strip scrolls itself into view).
    Element.prototype.scrollTo ??= () => {};
    fireEvent.click(within(sheet).getByRole("button", { name: "Change date or time" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.queryByTestId("where")).toBeNull();
  });

  // @mutate src/pages/jobs/jobPage/posterPageActions.tsx | label: "Cancel job", go: flows.cancel, | label: "Cancel job", go: () => navigate(`/posts?highlight=${id}&manage=1`),
  it("Cancel job runs the card's own cancel flow (on-the-way check, fee quote, refund) ON the page", () => {
    state.job = booked();
    state.party = true;
    renderPage();
    pressAction("Cancel job");
    expect(flowCalls).toEqual(["cancel"]);
    expect(screen.queryByTestId("where")).toBeNull();
    expect(faceRequests).toEqual([]);
  });

  // @mutate src/pages/jobs/jobPage/posterPageActions.tsx | const CANCELLABLE = new Set(["open", "accepted"]); | const CANCELLABLE = new Set(["open", "accepted", "in_progress"]);
  // @mutate src/pages/jobs/jobPage/posterPageActions.tsx | (CANCELLABLE.has(status) && !job.helper_on_the_way_at && | (CANCELLABLE.has(status) &&
  // JA-6 (Jobs audit 11-01): nor Change date or time, by the same rule.
  // @mutate src/pages/jobs/jobPage/posterPageActions.tsx |   const canChange = !!job.date_needed && !job.helper_on_the_way_at && !job.helper_arrived_at | const canChange = !!job.date_needed
  it("no Cancel or Change date or time once the Helpr set off, and an open job with no applicants offers Cancel", () => {
    // Today at 23:30 is "later today" except in the last half hour before Central midnight: pin the clock (jobDayFixtureTimezone).
    pinJobClock();
    onTestFinished(() => { vi.useRealTimers(); });
    state.moreCount = 0;
    for (const over of [{ helper_on_the_way_at: "2026-10-28T12:00:00Z" }, { status: "in_progress", helper_arrived_at: "2026-10-28T12:30:00Z" }]) {
      state.job = { ...booked(), date_needed: jobLocalDateISO(0), start_time: "23:30", ...over };
      state.party = true;
      const { unmount } = renderPage();
      const offered = pageActions();
      expect(offered, JSON.stringify(over)).not.toContain("Cancel job");
      expect(offered, JSON.stringify(over)).not.toContain("Change date or time");
      unmount();
    }
    // An under-way job is never cancelled from the page, even with no set-off or arrival stamp (CANCELLABLE).
    state.job = { ...booked(), status: "in_progress", helper_on_the_way_at: null, helper_arrived_at: null };
    const under = renderPage();
    expect(pageActions()).not.toContain("Cancel job");
    under.unmount();
    state.job = row({ customer_id: ME });
    state.applicants = { total: 0, pending: 0 };
    renderPage();
    expect(pageActions()).toContain("Cancel job");
    expect(screen.queryByRole("button", { name: "Manage job" })).toBeNull();
  });

  // JOBS-3 (lead verdict 10-31): every member of an under-way crew was reported a no-show, so the poster cancels
  // for a full refund here too (guard: src/test/crewAllNoShowCanCancel.test.tsx).
  // @mutate src/pages/jobs/jobPage/posterPageActions.tsx |  !job.helper_arrived_at) \|\| flows.crewNobodyLeft); |  !job.helper_arrived_at));
  it("an under-way crew with nobody left on it offers Cancel job, which runs the card's cancel", () => {
    state.job = { ...booked(), status: "in_progress", is_group_job: true, helper_id: null, helpers_needed: 2 } as JobPageRow;
    state.party = true;
    state.crewNobodyLeft = true;
    renderPage();
    pressAction("Cancel job");
    expect(flowCalls).toEqual(["cancel"]);
  });

  // JA-32 (audit 11-01): a crew job's page showed no crew. The roster is on the page: each member, their step, a
  // Message per member and the per-member Confirm work (JOBS-3); the tracker never says "accept the offer".
  // @mutate src/pages/jobs/jobPage/JobPage.tsx |             {isPoster && job.is_group_job && posterFlows.ready && CREW_ROSTER_STATUSES.has(job.status ?? "") && ( |             {false && (
  // @mutate src/components/GroupJobHelpers.tsx |               {onMessage && h.helper_id && h.status === "accepted" && ( |               {false && (
  // @mutate src/components/tracker/jobProgressState.ts |   if (poster && crewBookedOnRow(job)) return at(2 | if (false) return at(2
  // @mutate src/components/tracker/jobProgressState.ts | if (o.viewer === "poster" && crewBookedOnRow(job) && base.word === "Hired") return base; | if (false) return base;
  it("a crew job: the roster on the page, with each member's step, Message and Confirm work", () => {
    const m = (id: string, name: string, over: Record<string, unknown>) => ({
      id: `slot-${id}`, helper_id: id, status: "accepted", helperName: name, helper_confirmed_at: "2026-10-27T12:00:00Z",
      helper_on_the_way_at: null, helper_arrived_at: null, poster_confirmed_arrival_at: null, helper_completed_at: null,
      poster_confirmed_completion_at: null, ...over,
    });
    state.job = row({ customer_id: ME, status: "in_progress", is_group_job: true, helpers_needed: 2, date_needed: jobLocalDateISO(-1) });
    state.party = true;
    state.crewRoster = [
      m("44444444-4444-4444-4444-444444444444", "Ann B.", { helper_arrived_at: "t", poster_confirmed_arrival_at: "t", helper_completed_at: "t" }),
      m("55555555-5555-5555-5555-555555555555", "Marcus T.", {}),
    ];
    renderPage();
    const crew = document.querySelector("[data-job-crew]") as HTMLElement;
    expect(crew).toBeTruthy();
    expect(crew.textContent).toContain("Your crew · 2 of 2 hired");
    expect(crew.querySelectorAll("[data-crew-member]").length).toBe(2);
    expect(screen.getByRole("button", { name: /Confirm Ann B\.'s work/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Message Marcus T\./ }));
    expect(screen.getByTestId("where").textContent).toBe(`/messages?jobId=${encodeURIComponent(row().id)}&userId=55555555-5555-5555-5555-555555555555`);
  });

  it("a booked crew's tracker follows the crew, never 'Waiting on your Helpr to accept the offer'", () => {
    state.job = row({ customer_id: ME, status: "accepted", is_group_job: true, helpers_needed: 2 });
    state.party = true;
    state.crewRoster = [];
    renderPage();
    expect(document.body.textContent).not.toContain("accept the offer");
    expect(document.body.textContent).toContain("Your crew is booked");
    expect(document.querySelector("[data-job-crew]")).toBeTruthy();
  });

  // @mutate src/pages/jobs/jobPage/posterPageActions.tsx |       : status === "cancelled" |       : false
  // @mutate src/pages/jobs/jobPage/posterPageActions.tsx |   const draft = jobIsUnfundedDraft(job); |   const draft = false;
  it("an unpaid draft (on no Posted list) offers Post this job again and no Edit or Cancel", () => {
    state.job = row({ customer_id: ME, payment_status: "unpaid" });
    renderPage();
    expect(screen.getByRole("button", { name: "Post this job again" })).toBeTruthy();
    // Read through More options too: since the one-row rule, Edit and Cancel would sit in its sheet.
    const offered = pageActions();
    expect(offered).toContain("Post this job again");
    expect(offered).not.toContain("Edit job");
    expect(offered).not.toContain("Cancel job");
  });

  it("a cancelled job: Post this job again", () => {
    state.job = row({ customer_id: ME, status: "cancelled" });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Post this job again" }));
    expect(screen.getByTestId("where").textContent).toBe(`/post-job?rebook=${row().id}`);
  });

  // @mutate src/pages/jobs/jobPage/posterPageActions.tsx |   const canEdit = !draft && status === "open" && !job.is_group_job && job.direct_offer_status !== "pending"; |   const canEdit = false;
  // @mutate src/pages/jobs/jobPage/JobPage.tsx | <NoApplicantsYet job={job} onManage={posterActions.edit} /> | <NoApplicantsYet job={job} onManage={() => navigate(`/posts?highlight=${encodeURIComponent(job.id)}&manage=1`)} />
  // @mutate src/pages/jobs/jobPage/posterPageActions.tsx | label: "Edit job", go: flows.edit, | label: "Edit job", go: () => navigate(`/posts?highlight=${id}&manage=1`),
  it("an open job: Edit job, and the no-applicants rows (photo, price) open the card's own edit ON the page", () => {
    state.job = row({ customer_id: ME });
    state.applicants = { total: 0, pending: 0 };
    const { unmount } = renderPage();
    pressAction("Edit job");
    expect(flowCalls).toEqual(["edit"]);
    unmount();
    flowCalls.length = 0;
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Change the price/ }));
    expect(flowCalls).toEqual(["edit"]);
    expect(screen.queryByTestId("where")).toBeNull();
    expect(faceRequests).toEqual([]);
  });

  // @mutate src/pages/jobs/jobPage/posterPageActions.tsx | const MORE_ON_CARD = new Set(["in_progress", "revision_requested", "completed", "disputed"]); | const MORE_ON_CARD = new Set<string>([]);
  // @mutate src/pages/jobs/jobPage/JobPageActionRow.tsx | aria-haspopup="dialog" data-row-more="" onClick={() => setOpen(true)}> | aria-haspopup="dialog" data-row-more="" onClick={() => {}}>
  it("a job under way or done: More options opens the card's other steps (no-show, dispute, tip, review) ON the page, in one tap", async () => {
    state.job = { ...booked(), status: "completed", poster_completed_at: "2026-10-28T15:00:00Z", helper_completed_at: "2026-10-28T14:00:00Z" };
    state.party = true;
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "More options" }));
    // One tap: the options sheet is open with the card's list host in it (jobStepMenu.tsx draws the actions there).
    expect(await screen.findByRole("dialog", { name: "More options" })).toBeTruthy();
    expect(flowCalls).toEqual(["options-list"]);
    expect(screen.getByTestId("card-panel")).toBeTruthy();
    expect(screen.queryByTestId("where")).toBeNull();
    expect(faceRequests).toEqual([]);
  });

  // @mutate src/pages/jobs/jobPage/posterPageActions.tsx |   const panel = cardSteps \|\| posterWait === "approve" ? flows.panel : null; |   const panel = flows.panel;
  it("a booked job not yet under way offers only the page's own actions (no card steps)", async () => {
    state.job = booked();
    state.party = true;
    renderPage();
    await screen.findByRole("button", { name: "Message Rhonda" });
    expect(pageActions()).toEqual(["Message Rhonda", "Change date or time", "Cancel job"]);
    // Nor the card's controls mounted out of sight (their reads), with no step that uses them.
    expect(screen.queryByTestId("card-panel")).toBeNull();
  });

  it("no source on the job page still names a Manage job button", () => {
    for (const f of ["JobPage.tsx", "posterPageActions.tsx"]) {
      const src = blankComments(readFileSync(path.resolve(__dirname, f), "utf8"));
      expect(src.length).toBeGreaterThan(1000);
      expect(src).not.toMatch(/label: [^,]*"Manage job"/);
    }
  });
});

// B93 (owner 2026-11-01, 9:13 to 9:40 AM, and the Jobs audit's JA-3/7/8/9/10/22): the same one row at every stage.
// @mutate src/pages/jobs/jobPage/JobPageActionRow.tsx |   const cells = (stepRight ? [second, leadNode] : [leadNode, second]).filter(Boolean); |   const cells = [leadNode, second].filter(Boolean);
// @mutate src/pages/jobs/jobPage/posterPageActions.tsx |     const cardLead = !step && cardSteps && flows.leadCount > 0; |     const cardLead = false;
// @mutate src/pages/jobs/jobPage/JobPage.tsx |   const approveLeft = isPoster && posterWait === "approve" && job.helper_completed_at && !instantRelease |   const approveLeft = false && isPoster && posterWait === "approve" && job.helper_completed_at && !instantRelease
// @mutate src/pages/jobs/jobPage/JobPage.tsx | owesReview, review: () => setReviewOpen(true) }) | review: () => setReviewOpen(true) })
describe("one row of buttons at every stage (B93)", () => {
  const live = { customer_id: ME, helper_id: POSTER, status: "in_progress", helper_confirmed_at: "2026-10-27T12:00:00Z",
    helper_dayof_confirmed_at: "2026-10-27T12:00:00Z", poster_confirmed_at: "2026-10-27T12:00:00Z",
    helper_on_the_way_at: "2026-10-28T13:51:00Z" } as const;
  const rowLabels = () => within(document.querySelector("[data-job-row]") as HTMLElement).getAllByRole("button").map(fullName);

  it("arrived (JA-3, JA-7, JA-8): never three in a row; the confirm leads on the right, its options one tap away, no duplicate", async () => {
    state.tracking = "arrived";
    state.job = row({ ...live, helper_arrived_at: "2026-10-28T14:20:00Z" });
    state.party = true;
    renderPage();
    await waitFor(() => expect(rowLabels()).toEqual(["More options", "Confirm they've arrived"]));
    expect(screen.getAllByRole("button", { name: "Confirm they've arrived" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /Fewer options/ })).toBeNull();
    // Message is in the list, one tap away.
    fireEvent.click(screen.getByRole("button", { name: "More options" }));
    expect(await within(document.querySelector("[data-row-options]") as HTMLElement).findByRole("button", { name: "Message Rhonda" })).toBeTruthy();
  });

  it("Approve and release (JA-9): how long the poster has to check, beside the button", async () => {
    state.moreCount = 0;
    state.job = row({ ...live, helper_arrived_at: "2026-10-28T14:20:00Z", poster_confirmed_working_at: "2026-10-28T14:25:00Z", helper_completed_at: new Date().toISOString() });
    state.party = true;
    renderPage();
    await waitFor(() => expect(rowLabels()).toEqual(["Message Rhonda", "Approve and release"]));
    // Continue another day (owner 2026-11-01, Yusef's job): a VISIBLE "Not finished? Set a day" under the pair.
    expect(screen.getByRole("button", { name: "Not finished? Set a day" })).toBeTruthy();
    // The review window is IN the next-step line (owner 11-01, live Done-stage screenshot), never a second panel.
    const line = document.querySelector("[data-next-step]") as HTMLElement;
    await waitFor(() => expect(line.textContent).toMatch(/Rhonda/));
    expect(line.textContent).toMatch(/^Next: approve Rhonda's work · 23h 5\dm left, then Helpr support steps in$/);
    expect(document.querySelector("[data-approve-by]")).toBeNull();
    expect(document.body.textContent).not.toMatch(/to review — then Helpr support steps in/);
  });

  it("completed (JA-10): the card's own Review leads the row; Message joins the options", async () => {
    state.leadCount = 1;
    state.moreCount = 1;
    state.job = row({ ...live, status: "completed", payment_status: "payout_pending", helper_arrived_at: "2026-10-28T14:20:00Z",
      helper_completed_at: "2026-10-28T15:00:00Z", poster_completed_at: "2026-10-28T15:10:00Z" });
    state.party = true;
    renderPage();
    await waitFor(() => expect(flowCalls).toContain("lead-host"));
    const rowEl = document.querySelector("[data-job-row]") as HTMLElement;
    // The lead slot is the row's right half; Message + the card's one other action make two, so More options.
    expect(rowEl.lastElementChild?.hasAttribute("data-card-lead")).toBe(true);
    expect(within(rowEl).getAllByRole("button").map(fullName)).toEqual(["More options"]);
  });

  it("the hired Helpr's finished job (JA-22): Leave a review leads; Message and Open in working one tap away", async () => {
    state.owesReview = true;
    state.job = row({ helper_id: ME, status: "completed", payment_status: "payout_pending", helper_completed_at: "2026-10-28T15:00:00Z",
      poster_completed_at: "2026-10-28T15:10:00Z", payout_scheduled_at: new Date(Date.now() + 86_400_000).toISOString() });
    state.party = true;
    renderPage();
    await waitFor(() => expect(rowLabels()).toEqual(["More options", "Leave a review"]));
    expect(document.querySelector("[data-helpr-paid]")?.textContent).toMatch(/^Approved\. Your pay goes out /);
  });
});


/*
 * JOB PAGE LAYOUT V2 (owner 2026-11-01 12:00 PM, mockups 4 and 5) and the next-step line (12:05 PM).
 * @mutate src/pages/jobs/jobPage/JobPage.tsx |         <div data-job-main="" className="flex min-w-0 flex-col gap-4 empty:hidden lg:col-start-1"> |         <div data-job-main="" className="flex min-w-0 flex-col gap-4 empty:hidden lg:col-start-2">
 * @mutate src/pages/jobs/jobPage/JobPage.tsx |   const detailsLong = posterDetails.length > 90 |   const detailsLong = posterDetails.length > 90000
 * @mutate src/pages/jobs/jobPage/JobPageActionRow.tsx |   const stepRight = cardLead \|\| (!!lead && !plainLead); |   const stepRight = cardLead \|\| leadIsStep;
 * @mutate src/components/tracker/jobProgressState.ts |   if (status === "in_progress" && !job.is_group_job && (job.proof_after_urls |   if (false && status === "in_progress" && !job.is_group_job && (job.proof_after_urls
 * @mutate src/pages/jobs/jobPage/JobPage.tsx |   const offerOut = isPoster && open && job.direct_offer_status === "pending"; |   const offerOut = false;
 * @mutate src/pages/jobs/jobPage/posterPageActions.tsx |  && job.direct_offer_status !== "pending"; | ;
 * @mutate src/pages/jobs/jobPage/JobPage.tsx | [msg, job.status === "cancelled" ? null : work] | [msg, work]
 */
describe("job page layout V2 (owner 11-01, mockups 4 and 5)", () => {
  const LONG = "Mow and weed eat an empty lot in New Iberia. The edge of the bank near the water has become overgrown and needs to be weed eaten.";
  const working = () => row({ customer_id: ME, helper_id: POSTER, status: "in_progress", description: LONG,
    helper_confirmed_at: "2026-10-27T12:00:00Z", helper_arrived_at: "2026-10-28T14:20:00Z", poster_confirmed_working_at: "2026-10-28T14:25:00Z",
    poster_confirmed_arrival_at: "2026-10-28T14:22:00Z", proof_before_urls: ["p/b1.jpg"], proof_after_urls: ["p/a1.jpg"] });
  const follows = (a: Element | null, b: Element | null) => {
    expect(a, "first part drawn").not.toBeNull();
    expect(b, "second part drawn").not.toBeNull();
    return !!(a!.compareDocumentPosition(b!) & Node.DOCUMENT_POSITION_FOLLOWING);
  };

  it("in the owner's order: details, the status line + tracker (full width), photos (main column), the card, the Guarantee", async () => {
    state.job = working();
    state.party = true;
    state.moreCount = 2;
    renderPage();
    const page = document.querySelector("[data-job-page]")!;
    const head = page.querySelector("[data-job-head]");
    const details = page.querySelector("[data-job-details]");
    const steps = page.querySelector("[data-job-steps]");
    const photos = page.querySelector("[data-job-main] [data-job-proof-photos]");
    const card = page.querySelector("[data-job-side] [data-job-card]");
    const guarantee = page.querySelector("[data-job-side] [data-job-guarantee]");
    expect(follows(head, details) && follows(details, steps) && follows(steps, photos) && follows(photos, card) && follows(card, guarantee)).toBe(true);
    expect((details!.getAttribute("class") ?? "")).toContain("lg:col-span-2");
    expect((steps!.getAttribute("class") ?? "")).toContain("lg:col-span-2");
    expect((page.querySelector("[data-job-main]")!.getAttribute("class") ?? "")).toContain("lg:col-start-1");
    // The right column is sticky on a computer.
    expect((page.querySelector("[data-job-side]")!.getAttribute("class") ?? "")).toMatch(/lg:sticky/);
    // The Helpr's card and the buttons are in the one card, the buttons after the card.
    const rowEl = card!.querySelector('[data-job-row="poster"]');
    expect(follows(card!.querySelector('[aria-label="Your Helpr"]'), rowEl)).toBe(true);
    // Green on the RIGHT: [More options | Message Rhonda].
    await waitFor(() => expect(within(rowEl as HTMLElement).getAllByRole("button").map(fullName)).toEqual(["More options", "Message Rhonda"]));
  });

  it("after photos in, not marked done: the poster reads who added them and what it waits on (job 7b1da54b)", async () => {
    state.job = working();
    state.party = true;
    renderPage();
    await waitFor(() => expect(document.querySelector("[data-next-step]")?.textContent).toBe("Rhonda added after photos · waiting for them to mark it done"));
    expect(document.body.textContent).not.toContain("Rhonda is working");
  });

  it("the hired Helpr with after photos in is told the one step left", () => {
    state.job = row({ helper_id: ME, status: "in_progress", helper_confirmed_at: "2026-10-27T12:00:00Z", helper_arrived_at: "2026-10-28T14:20:00Z",
      poster_confirmed_working_at: "2026-10-28T14:25:00Z", poster_confirmed_arrival_at: "2026-10-28T14:22:00Z", proof_before_urls: ["p/b1.jpg"], proof_after_urls: ["p/a1.jpg"] });
    state.party = true;
    renderPage();
    expect(document.querySelector("[data-next-step]")?.textContent).toBe("Next: your after photos are in. Mark it done");
  });

  it("details: two lines and Show more on a phone; a short description has no Show more", () => {
    state.job = working();
    state.party = true;
    renderPage();
    const text = document.querySelector("[data-details-text]")!;
    expect(text.getAttribute("class")).toContain("line-clamp-2");
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(document.querySelector("[data-details-text]")!.getAttribute("class")).not.toContain("line-clamp-2");
    expect(screen.getByRole("button", { name: "Show less" })).toBeTruthy();
    cleanup();
    state.job = row();
    renderPage();
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  });

  it("JA-48 / JA-49: an offer out shows no 'No applicants yet' or Edit job, and the line waits on that Helpr", () => {
    state.job = row({ customer_id: ME, direct_offer_status: "pending" });
    state.party = true;
    state.applicants = { total: 0, pending: 0 };
    renderPage();
    expect(screen.queryByText(/No applicants yet/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit job" })).toBeNull();
    expect(document.querySelector("[data-next-step]")?.textContent).toMatch(/^Waiting on .+ to accept your offer$/);
  });

  it("JA-27: a no-show put the job back up: the poster's line says so, with the day", () => {
    state.job = row({ customer_id: ME });
    state.party = true;
    state.applicants = { total: 0, pending: 0, noShowAt: `${DAY}T15:00:00Z` };
    renderPage();
    expect(document.querySelector("[data-next-step]")?.textContent).toBe(`No-show reported · reposted ${formatJobDate(DAY)} · waiting for Helprs to apply`);
  });

  it("L27 JA-F2: a cancelled job's hired Helpr is not offered 'Open in working'", () => {
    state.job = row({ helper_id: ME, status: "cancelled", helper_confirmed_at: "2026-10-27T12:00:00Z", cancelled_by: POSTER, cancelled_at: "2026-10-28T12:00:00Z" });
    state.party = true;
    renderPage();
    expect(screen.queryByRole("button", { name: "Open in working" })).toBeNull();
  });
});

// JA-34 (audit 11-01): the Posted / Working card said "28m until the job starts"; the page for the same job had no
// clock. The page now draws the card's own clock (collapsedClocks) under the tracker for a booked job's two parties.
describe("job page: the booked job's clock, as its card shows it (JA-34)", () => {
  const booked = (over: Partial<JobPageRow> = {}) => row({ status: "accepted", helper_confirmed_at: null, ...over });
  it("the poster sees when the job starts", () => {
    state.job = booked({ customer_id: ME, helper_id: POSTER });
    state.party = true;
    renderPage();
    expect(document.querySelector('[data-job-steps] [data-countdown-row="start"]')?.textContent).toMatch(/Starts|until the job starts/);
  });
  it("the hired Helpr sees it too", () => {
    state.job = booked({ helper_id: ME });
    state.party = true;
    renderPage();
    expect(document.querySelector('[data-job-steps] [data-countdown-row="start"]')).not.toBeNull();
  });
  it("an open job (nobody hired) draws no clock", () => {
    state.job = row({ customer_id: ME });
    state.party = true;
    renderPage();
    expect(document.querySelector("[data-job-steps] [data-countdown-row]")).toBeNull();
  });
});

/**
 * JA-30 (Jobs audit 11-01): a disputed job's page says when they hear back AND links to the case.
 * @mutate src/pages/jobs/jobPage/JobPage.tsx | {party && (isPoster \|\| isHired) && (job.status === "disputed" | {false && party && (isPoster \|\| isHired) && (job.status === "disputed"
 */
describe("job page, a disputed job (JA-30)", () => {
  it("both parties get 'See the case', which opens the dispute's own case view", async () => {
    for (const viewer of [ME, POSTER]) {
      state.job = row({ customer_id: POSTER, helper_id: ME, status: "disputed", payment_status: "escrow", has_active_dispute: true });
      state.party = true;
      renderPage(viewer);
      fireEvent.click(screen.getByRole("button", { name: "See the case" }));
      expect((await screen.findByTestId("dispute-case")).getAttribute("data-job")).toBe(state.job.id);
      cleanup();
    }
  });

  it("not on a job with no dispute, nor for someone outside the job", () => {
    state.job = row({ customer_id: POSTER, helper_id: ME, status: "in_progress", payment_status: "escrow" });
    state.party = true;
    renderPage();
    expect(screen.queryByRole("button", { name: "See the case" })).toBeNull();
    cleanup();
    state.job = row({ customer_id: POSTER, helper_id: "someone-else", status: "disputed", has_active_dispute: true });
    state.party = false;
    renderPage();
    expect(screen.queryByRole("button", { name: "See the case" })).toBeNull();
  });
});

/**
 * Lead 11-01 (B107): at 1440 a stage with nothing in the main column (Done, Cancelled: no photos, crew or fix) left the
 * left column EMPTY beside the side card. The main column hides when empty, and the card then takes its place.
 * @mutate src/pages/jobs/jobPage/JobPage.tsx |  lg:[[data-job-main]:empty+&]:col-span-2"> | ">
 */
describe("job page, no dead column at 1440", () => {
  it("a Done job with no photos: the main column is empty (hidden) and the card moves into it", () => {
    state.job = row({ customer_id: ME, helper_id: POSTER, status: "completed", payment_status: "released" });
    state.party = true;
    renderPage();
    const main = document.querySelector("[data-job-main]")!;
    const side = document.querySelector("[data-job-side]")!;
    expect(main.childNodes.length).toBe(0);
    expect(main.className.split(/\s+/)).toContain("empty:hidden");
    // The card is the main column's next sibling, and moves to column 1 when it is empty (CSS: :empty + aside).
    expect(main.nextElementSibling).toBe(side);
    // Full content width, right under the tracker (owner via lead 11-01): the first column AND both columns.
    expect(side.className.split(/\s+/)).toContain("lg:[[data-job-main]:empty+&]:col-start-1");
    expect(side.className.split(/\s+/)).toContain("lg:[[data-job-main]:empty+&]:col-span-2");
  });
});

/**
 * JA-49 (lead 11-01, B107): the poster's direct offer out names the offered Helpr and says until when it stands.
 * @mutate src/pages/jobs/jobPage/JobPage.tsx |  ?? (offerPending ? offerTarget.data ?? null : null) : null; |  : null;
 * @mutate src/components/tracker/jobNextStep.ts |     return { who: "them", text: `Waiting on ${other \|\| "the Helpr"} to accept your offer`, by }; |     return { who: "them", text: `Waiting on ${other \|\| "the Helpr"} to accept your offer` };
 * @mutate src/pages/jobs/jobPage/useJobPage.ts |  completed_at, direct_offer_expires_at, has_active_dispute, |  completed_at, has_active_dispute,
 */
describe("job page, the poster's direct offer out (JA-49)", () => {
  it("names the offered Helpr and the offer's expiry, read through get_job_offer_targets", async () => {
    offerTargetCalls.length = 0;
    const until = new Date(Date.now() + 20 * 3600_000);
    state.job = row({ customer_id: ME, helper_id: null, status: "open", payment_status: "held", direct_offer_status: "pending", direct_offer_expires_at: until.toISOString() });
    state.party = true;
    state.applicants = { total: 0, pending: 0 };
    renderPage();
    await waitFor(() => expect(document.querySelector("[data-job-tracker]")?.textContent).toContain("Waiting on Yusef to accept your offer"));
    const day = until.toLocaleString("en-US", { timeZone: "America/Chicago", weekday: "short", hour: "numeric", minute: "2-digit" });
    expect(document.querySelector("[data-job-tracker]")?.textContent).toContain(`Waiting on Yusef to accept your offer · until ${day}`);
    expect(offerTargetCalls.length).toBeGreaterThan(0);
    // One job per read: the page's own (its route id).
    expect(offerTargetCalls.every((c) => c.length === 1)).toBe(true);
    expect(readFileSync(path.resolve("src/pages/jobs/jobPage/useJobPage.ts"), "utf8")).toMatch(/PARTY_COLUMNS =\n\s*"[^"]*\bdirect_offer_expires_at\b/);
  });

  it("no offer out: no offer-target read", () => {
    offerTargetCalls.length = 0;
    state.job = row({ customer_id: ME, status: "open", payment_status: "held", direct_offer_status: null });
    state.party = true;
    renderPage();
    expect(offerTargetCalls).toEqual([]);
  });
});

/**
 * JA-50 (Jobs audit 11-01): a Helpr with a direct offer pending is never told "the street address is shared once
 * you're offered the job" (the viewer state's See the offer hides it; offeredToMe makes it See the offer).
 * @mutate src/pages/jobs/jobPage/JobPage.tsx | !instantUntil && viewer.action.kind !== "see_offer" && <p | !instantUntil && <p
 */
describe("job page, an offered Helpr is not told the address comes with an offer (JA-50)", () => {
  it("a pending direct offer to me: See the offer, and no 'shared once you're offered' line", () => {
    state.job = row({ status: "open", payment_status: "held", direct_offer_status: "pending" });
    state.party = true;
    state.offeredToMe = true;
    renderPage();
    expect(screen.getByRole("button", { name: "See the offer" })).toBeTruthy();
    expect(screen.queryByText("The street address is shared once you're offered the job.")).toBeNull();
  });
});

describe("job page: couldn't finish, continue another day (owner 2026-11-01, Yusef's job)", () => {
  // @mutate src/pages/jobs/jobPage/useContinueDayActions.tsx |     setDay = { key: "continue-set", label: row ? "Set a different day" : "Not finished? Set a day", go: open }; |
  // @mutate src/pages/jobs/jobPage/JobPageParts.tsx | continueStep ?? jobNextStep( | jobNextStep(
  // @mutate src/pages/jobs/jobPage/JobPage.tsx |             {isPoster && posterActions.row(continueDay.posterLead ?? posterStep, continueDay.posterExtras)} |             {isPoster && posterActions.row(posterStep)}
  // @mutate src/pages/jobs/jobPage/useContinueDayActions.tsx |     setDay = { key: "continue-ask", label: row ? "Ask for a different day" : "Need another day", go: open }; |
  const underWay = (over: Partial<JobPageRow> = {}) => row({
    customer_id: ME, helper_id: POSTER, status: "in_progress", helper_confirmed_at: "2026-10-27T12:00:00Z",
    helper_dayof_confirmed_at: "2026-10-27T12:00:00Z", poster_confirmed_at: "2026-10-27T12:00:00Z",
    helper_on_the_way_at: "2026-10-28T12:00:00Z", helper_arrived_at: "2026-10-28T12:30:00Z",
    poster_confirmed_arrival_at: "2026-10-28T12:40:00Z", ...over,
  });
  const setRow = (over: Record<string, unknown> = {}) => ({
    id: "c1", job_id: "33333333-3333-3333-3333-333333333333", proposed_by: ME, new_date: "2026-11-05",
    new_start_time: "09:00:00", note: null, status: "set", helper_confirmed_at: null, ...over,
  });
  beforeEach(() => { continueState.row = null; continueCalls.length = 0; Element.prototype.scrollTo ??= () => {}; });

  it("the Helpr marked it done (Yusef's case): the poster can say it isn't finished and set a day", async () => {
    state.job = underWay({ helper_completed_at: "2026-10-28T15:00:00Z" });
    state.party = true;
    state.moreCount = 0;
    renderPage();
    // Visible under the pair, never in More options (lead 11-01).
    fireEvent.click(await screen.findByRole("button", { name: "Not finished? Set a day" }));
    expect(await screen.findByRole("dialog", { name: "Set a day to finish" })).toBeTruthy();
  });

  it("a set day: both sides read 'Continuing Thu 11/5 at 9 AM', the poster waiting on the Helpr by name", async () => {
    continueState.row = setRow();
    state.job = underWay();
    state.party = true;
    renderPage();
    expect(await screen.findByText("Continuing Thu 11/5 at 9 AM")).toBeTruthy();
    expect(document.querySelector("[data-next-step]")?.textContent).toBe("Continuing Thu 11/5 at 9 AM · waiting on Rhonda");
  });

  it("a Helpr's ask: 'Confirm new day' leads on the right (one tap) over Approve", async () => {
    continueState.row = setRow({ status: "proposed", proposed_by: POSTER });
    state.job = underWay({ helper_completed_at: "2026-10-28T15:00:00Z" });
    state.party = true;
    renderPage();
    const btn = await screen.findByRole("button", { name: "Confirm new day" });
    const rowEl = document.querySelector('[data-job-row="poster"]') as HTMLElement;
    const names = within(rowEl).getAllByRole("button").map(fullName);
    expect(names[names.length - 1]).toBe("Confirm new day");
    expect(screen.queryByRole("button", { name: "Approve and release" })).toBeNull();
    fireEvent.click(btn);
    await waitFor(() => expect(continueCalls).toEqual(["answer:c1:true"]));
  });

  it("the hired Helpr on a job under way: 'Need another day'; on a set day, 'Confirm I'll be there' leads", async () => {
    state.job = underWay({ customer_id: POSTER, helper_id: ME });
    state.party = true;
    const { unmount } = renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Need another day" }));
    expect(await screen.findByRole("dialog", { name: "Need another day" })).toBeTruthy();
    unmount();
    continueState.row = setRow({ proposed_by: POSTER });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Confirm I'll be there" }));
    await waitFor(() => expect(continueCalls).toEqual(["confirm:c1"]));
  });

  // B118 follow-up (lead 11-01): with a SET day the bar read day 1 ("Late" on Arrived on a day that had passed).
  // @mutate src/pages/jobs/jobPage/JobPage.tsx | <JobTracker job={jobOnContinueDay(job, continueDay.row)} side= | <JobTracker job={job} side=
  // @mutate src/lib/continueDay.ts |   return { ...job, date_needed: row.new_date, start_time: row.new_start_time.slice(0, 5) }; |   return job;
  it("a set day: the tracker bar reads the new day, never 'Late' off day 1's passed date", async () => {
    continueState.row = setRow({ new_date: jobLocalDateISO(3), proposed_by: POSTER });
    state.job = underWay({ customer_id: POSTER, helper_id: ME, date_needed: jobLocalDateISO(-1), helper_arrived_at: null });
    state.party = true;
    renderPage();
    await screen.findByRole("button", { name: "Confirm I'll be there" });
    const bar = document.querySelector("[data-job-tracker] [data-job-steps]") as HTMLElement;
    expect(bar).toBeTruthy();
    expect(bar.getAttribute("data-tone")).toBe("progress");
    expect(within(document.querySelector("[data-job-tracker]") as HTMLElement).queryByText("Late")).toBeNull();
  });

  it("a proposed day is not agreed: day 1 stands for the bar (only a set day moves it)", () => {
    const job = { date_needed: "2026-10-31", start_time: "09:00" };
    expect(jobOnContinueDay(job, setRow({ status: "proposed" }) as never)).toBe(job);
    expect(jobOnContinueDay(job, setRow() as never)).toEqual({ date_needed: "2026-11-05", start_time: "09:00" });
    expect(jobOnContinueDay(job, null)).toBe(job);
  });

  // B118 follow-up (lead 11-01): "Need another day" showed after arrival, before any day-1 work had started.
  // @mutate src/pages/jobs/jobPage/useContinueDayActions.tsx |   const offerSetDay = workStarted \|\| !!row; |   const offerSetDay = true;
  it("arrived but not started on day 1: no 'Need another day' yet; once working, it shows", async () => {
    state.job = underWay({ customer_id: POSTER, helper_id: ME, poster_confirmed_arrival_at: null });
    state.tracking = "arrived";
    state.party = true;
    const { unmount } = renderPage();
    await waitFor(() => expect(document.querySelector('[data-job-row="helpr"]')).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Need another day" })).toBeNull();
    unmount();
    state.tracking = "working";
    renderPage();
    expect(await screen.findByRole("button", { name: "Need another day" })).toBeTruthy();
  });
});
