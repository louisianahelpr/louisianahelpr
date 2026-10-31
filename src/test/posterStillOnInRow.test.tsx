/**
 * Owner, 2026-10-08, on the live IKEA-dresser job (screenshots):
 *   - "Buttons should be side by side always for post and jobs. So move I'm
 *     still on to the right side of more and under profile" — the poster's
 *     card drew a "Still on for this one?" panel with a full-width I'm still on
 *     ABOVE the Helpr tile, and More alone under it. "Same for all of these
 *     screens" — after confirming, the same panel held a greyed "Confirm
 *     They've Arrived".
 *   - "The person who posted it hasn't confirmed yet · [Nudge] this should be
 *     above the buttons and below the profile for both post and jobs".
 *   - "when i click nudge it does nothing" — the answer was a success/info
 *     toast, and toastPolicy.ts suppresses those app-wide.
 *   - "change you're booked to you're scheduled".
 *
 * @mutate src/pages/posts/postedJobCard/steps/PosterConfirmationPrimary.tsx |       {!rung.waiting && <JobStepRowSlot slot="primary"> |       {<JobStepRowSlot slot="primary">
 * @mutate src/pages/posts/PostedJobCard.tsx | import { GroupJobHelpers } | import { JobConfirmation } from "@/components/JobConfirmation";\nimport { GroupJobHelpers }
 * @mutate src/pages/posts/postedJobCard/steps/ScheduledStep.tsx |         {job.status === "accepted" && job.helper_confirmed_at && ( |         {false && (
 * @mutate src/components/JobConfirmation.tsx |     if (variant === "inline" && isOwner) { |     if (false) {
 * @mutate src/components/JobConfirmation.tsx |       ) : null\n      /* Poster confirmed: NO greyed | ) : isOwner ? <JobStepPrimaryButton icon={CheckCircle2} label="Confirm they've arrived" disabled onClick={() => {}} /> : null\n      /* Poster confirmed: NO greyed
 * @mutate src/components/job-card/NudgeConfirmLink.tsx |               setResult(NUDGE_RESULT[String(data)] ?? NUDGE_RESULT.sent); |               toast.success(NUDGE_RESULT.sent);
 * @mutate src/components/JobConfirmation.tsx |   if (variant === "inline" && isOwner && (helperOnTheWayAt \|\| helperArrivedAt)) return null; |   if (variant === "inline" && isOwner && helperArrivedAt) return null;
 * @mutate src/components/job-card/jobStatusLine.ts |   confirmed: { detail: "You're scheduled" }, |   confirmed: { detail: "You're booked" },
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import type { Job } from "@/components/job-card/activityConstants";
import type { PosterStepCtx } from "@/pages/posts/postedJobCard/steps/posterStepContract";

vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/haptics", () => ({
  hapticLight: vi.fn(), hapticError: vi.fn(), hapticSuccess: vi.fn(),
  hapticMedium: vi.fn(), hapticSelection: vi.fn(), hapticWarning: vi.fn(),
}));
const rpcResult: { data: unknown; error: unknown } = { data: null, error: null };
vi.mock("@/integrations/supabase/client", () => {
  const result = { data: null, error: null };
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "select", "eq", "neq", "in", "order", "limit", "gte", "lte", "is", "not", "filter"]) chain[m] = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(() => Promise.resolve(result));
  chain.single = vi.fn(() => Promise.resolve(result));
  chain.then = (res: (v: typeof result) => unknown) => Promise.resolve(result).then(res);
  return {
    supabase: {
      ...chain,
      channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() })),
      removeChannel: vi.fn(),
      rpc: vi.fn(() => Promise.resolve(rpcResult)),
      auth: { getUser: vi.fn(() => Promise.resolve({ data: { user: null }, error: null })) },
    },
  };
});

import { ScheduledStep } from "@/pages/posts/postedJobCard/steps/ScheduledStep";
import { InProgressStep } from "@/pages/posts/postedJobCard/steps/InProgressStep";
import { NudgeConfirmLink } from "@/components/job-card/NudgeConfirmLink";
import { helperStatusLine } from "@/components/job-card/jobStatusLine";

beforeAll(() => {
  Element.prototype.scrollTo = Element.prototype.scrollTo ?? (() => {});
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
});

const HELPER = "helper-1";
const POSTER = "poster-1";
const NOW = Date.now();
const ago = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
function jobClock(h: number) {
  const at = new Date(NOW + h * 3_600_000);
  return {
    date: at.toLocaleDateString("en-CA", { timeZone: "America/Chicago" }),
    time: at.toLocaleTimeString("en-GB", { timeZone: "America/Chicago", hour: "2-digit", minute: "2-digit" }),
  };
}
const START = jobClock(3);

function makeJob(over: Record<string, unknown> = {}): Job {
  return {
    id: "job-1", title: "Assemble an IKEA dresser", description: "In the box", location: "Delcambre, LA",
    customer_id: POSTER, helper_id: HELPER, budget: 10, category: "assembly", status: "accepted",
    payment_status: "escrow", date_needed: START.date, start_time: START.time,
    helper_confirmed_at: ago(1), helper_dayof_confirmed_at: ago(0.5), poster_confirmed_at: null,
    ...over,
  } as unknown as Job;
}

function ctx(job: Job): PosterStepCtx {
  return {
    job, userId: POSTER, helperNames: { [HELPER]: "Lexi L." }, completedJobMeta: {},
    completingJobId: null, confirmingArrivalJobId: null, confirmingWorkingJobId: null,
    instantReleaseOn: false, navigate: vi.fn(), onBoost: vi.fn(), onEdit: vi.fn(), crewBooked: false,
    onCancel: vi.fn(), onComplete: vi.fn(), onNoShow: vi.fn(), onTip: vi.fn(), onReview: vi.fn(),
    onDispute: vi.fn(), onReport: vi.fn(), onViewDispute: vi.fn(), onConfirmArrival: vi.fn(),
    onConfirmWorking: vi.fn(), onActionComplete: vi.fn(), completionSheetOpen: false,
    setCompletionSheetOpen: vi.fn(), disputeActing: false, resolveConfirmOpen: false,
    setResolveConfirmOpen: vi.fn(), escalateConfirmOpen: false, setEscalateConfirmOpen: vi.fn(),
    escalateDispute: vi.fn(), resolveDisputeAndRelease: vi.fn(),
  } as unknown as PosterStepCtx;
}

function wrap(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
}
const row = () => document.querySelector("[data-job-step-row]")!;
const noteHost = () => document.querySelector("[data-job-step-note]")!;
const before = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe("Posts, booked job: I'm still on is the row's primary beside More", () => {
  it("unconfirmed poster: the live I'm still on sits IN the row, no 'Still on for this one?' panel", () => {
    wrap(<ScheduledStep {...ctx(makeJob())} />);
    const btn = screen.getByRole("button", { name: /I'm still on/ });
    expect(row().contains(btn)).toBe(true);
    expect((btn as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(/Still on for this one\?/)).toBeNull();
  });

  // Owner, 2026-10-21: never a disabled future step. Confirmed poster: no greyed arrival button; the
  // primary is "Message <Helpr>" and the line says what happens next.
  it("confirmed poster: no greyed arrival button; Message is the primary and the line says what's next", () => {
    wrap(<ScheduledStep {...ctx(makeJob({ poster_confirmed_at: ago(0.2) }))} />);
    expect(screen.queryByRole("button", { name: /Confirm they've arrived/i })).toBeNull();
    const msg = screen.getByRole("button", { name: /^Message /i });
    expect(row().contains(msg)).toBe(true);
    const note = screen.getByText(/Waiting on .+ to confirm by|You're both confirmed/);
    expect(noteHost().contains(note)).toBe(true);
    expect(screen.queryByText(/turns on once/)).toBeNull();
  });

  it("more than a day out: no greyed I'm still on; the line says when confirming opens", () => {
    const far = jobClock(72);
    wrap(<ScheduledStep {...ctx(makeJob({ date_needed: far.date, start_time: far.time, helper_dayof_confirmed_at: null }))} />);
    expect(screen.queryByRole("button", { name: /I'm still on/ })).toBeNull();
    expect(row().contains(screen.getByRole("button", { name: /^Message /i }))).toBe(true);
    expect(screen.getByText(/confirm the day before\. Opens /)).toBeInTheDocument();
  });
});

describe("on the way: no greyed arrival button, nothing above the profile", () => {
  // Owner, 2026-10-08: "Should only be the greyed out button at the bottom remove the other one"; then the
  // owner rule of 2026-10-21 (never a greyed future step): the row's primary is Message, and one line says
  // the confirm comes once the Helpr says they've arrived.
  it("no 'Confirm they've arrived' control yet: Message is the primary and ONE waiting line", () => {
    // On My Way moves the job to in_progress, so the card is InProgressStep;
    // the "Still on for this one?" panel PostedJobCard drew above it is gone.
    wrap(<InProgressStep {...ctx(makeJob({ status: "in_progress", poster_confirmed_at: ago(0.2), helper_on_the_way_at: ago(0.05) }))} />);
    expect(screen.queryAllByRole("button", { name: /Confirm they('ve)? arrived/i })).toHaveLength(0);
    expect(row().contains(screen.getByRole("button", { name: /^Message / }))).toBe(true);
    expect(screen.queryByText(/Still on for this one\?/)).toBeNull();
    expect(screen.getAllByText(/You'll confirm once they say they've arrived/)).toHaveLength(1);
  });

  // The row a poster sees between the Helpr's On My Way tap and the status
  // flip reaching this card: still `accepted`, so ScheduledStep (which mounts
  // JobConfirmation) and not InProgressStep. JobConfirmation's on-the-way
  // early return is what stands it down there; the test above renders
  // InProgressStep, which never mounts it, so dropping that clause survived
  // (vacuity push run 38181478413).
  it("on the way but the card still reads accepted: no I'm still on in the row", () => {
    wrap(<ScheduledStep {...ctx(makeJob({ poster_confirmed_at: null, helper_on_the_way_at: ago(0.05) }))} />);
    expect(row()).not.toBeNull();
    expect(screen.queryByRole("button", { name: /I'm still on/ })).toBeNull();
    expect(screen.queryByText(/Still on for this one\?/)).toBeNull();
  });
});

describe("the poster card draws no confirmation panel of its own", () => {
  it("PostedJobCard never mounts JobConfirmation (the steps own it, in the row)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/pages/posts/PostedJobCard.tsx", "utf8");
    expect(src).not.toMatch(/<JobConfirmation\b|from "@\/components\/JobConfirmation"/);
  });
});

describe("the Nudge line", () => {
  it("sits above the row (under the profile) when the Helpr has not confirmed", () => {
    wrap(<ScheduledStep {...ctx(makeJob({ helper_dayof_confirmed_at: null }))} />);
    const nudge = document.querySelector("[data-nudge-confirm]")!;
    expect(nudge).not.toBeNull();
    expect(noteHost().contains(nudge)).toBe(true);
    expect(before(noteHost(), row())).toBe(true);
  });

  it("answers in place after a tap — never only by a toast the app suppresses", async () => {
    rpcResult.data = "sent";
    render(<NudgeConfirmLink jobId="job-1" otherLabel="Your Helpr" />);
    fireEvent.click(screen.getByRole("button", { name: "Nudge" }));
    await waitFor(() => expect(screen.getByText(/Nudge sent/)).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Nudge" })).toBeNull();
  });

  it("a repeat tap inside 2 hours says so in place", async () => {
    rpcResult.data = "too_soon";
    render(<NudgeConfirmLink jobId="job-1" otherLabel="Your Helpr" />);
    fireEvent.click(screen.getByRole("button", { name: "Nudge" }));
    await waitFor(() => expect(screen.getByText(/Nudged recently/)).toBeTruthy());
  });
});

describe("the Helpr's booked status line", () => {
  it("reads \"You're scheduled\"", () => {
    const app = { id: "a", job_id: "job-1", helper_id: HELPER, status: "accepted", posterName: null,
      job: makeJob({ date_needed: jobClock(72).date, start_time: jobClock(72).time, helper_dayof_confirmed_at: null }) };
    expect(helperStatusLine(app as never).detail).toBe("You're scheduled");
  });
});
