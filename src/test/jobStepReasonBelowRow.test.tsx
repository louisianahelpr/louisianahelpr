/**
 * THE ROW'S ONE EXPLANATION LINE SITS BELOW THE ROW, CENTRED — BOTH CARDS.
 *
 * Owner, 2026-09-19, twice:
 *   "You'll be able to confirm this once your Helpr is at the job. should be
 *    under the buttons"
 *   "Approve to release payment — then you can review and tip. center under
 *    buttons"
 * and, on the whole batch: "these changes all apply to jobs also".
 *
 * ── WHAT MOVED, AND WHY IT IS ONE MOVE AND NOT FOUR ───────────────────────
 * Four components portal a line into the step row's `note` host, and all four
 * are the same object with two tones:
 *
 *   GATE REASONS (amber — a control is disabled and this says why)
 *     · JobTracking.tsx `reasonEl`          — the arrival/GPS block, the
 *                                             before-photo gate, the lock
 *     · PosterConfirmationPrimary.tsx       — the poster's confirmation ladder
 *     · JobConfirmation.tsx `deadlineNotice`— "Confirm by Tue 12:00 PM"
 *     · PayoutPrimary.tsx PayoutUnlockNote  — the 30-minute payout floor
 *   CONSEQUENCE (muted — the control is ENABLED and this says what it does)
 *     · InProgressStep.tsx `footnote`       — "Approve to release payment…"
 *
 * They move as a SET or not at all: one line above the row and one below it is
 * a worse inconsistency than the state we started in. Because every one of them
 * reaches the row through the same host, the move is one edit in JobStepCard —
 * which is exactly why this file asserts the HOST's position rather than four
 * separate strings. A per-caller assertion would pass while a fifth caller,
 * written next week, landed somewhere else.
 *
 * ── AND IT IS CENTRED, ONCE ───────────────────────────────────────────────
 * `text-center` lives on the host, not on the callers, so "one alignment for
 * the set" is structural rather than a convention four files have to remember.
 *
 * ── AND THERE IS ONLY EVER ONE LINE ───────────────────────────────────────
 * The footnote stands down while the note host has something in it. NOTE, and
 * this is deliberate honesty rather than a claim of a bug fixed: no state of
 * either card can currently produce both at once — `posterConfirmationRung`
 * returns null once `helper_completed_at` is set, which is the same flag that
 * turns the Approve footnote on, so the two are mutually exclusive TODAY by an
 * accident of one gate. The suppression is the guard that keeps it true when
 * that accident changes, and it is exercised here by driving the shell
 * directly — the only way to reach a state the product cannot currently reach.
 *
 * The position mutation puts the host back ABOVE the row (where it lived until
 * today) by re-declaring it between `notice` and the person tile; the assertions
 * read the FIRST `[data-job-step-note]`, so a host above the row is exactly the
 * pre-2026-09-19 layout and must turn this file red.
 *
 * @mutate src/components/job-card/JobStepCard.tsx | {notice}\n        {/* WHO, directly above | {notice}\n        <div ref={setNoteHost} data-job-step-note="" className="space-y-1.5 text-center empty:hidden" />\n        {/* WHO, directly above
 * @mutate src/components/job-card/JobStepCard.tsx | className="space-y-1.5 text-center empty:hidden" | className="space-y-1.5 empty:hidden"
 * @mutate src/components/job-card/JobStepCard.tsx | {noteFilled ? null : footnote} | {footnote}
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import type { AppliedApp, Job } from "@/components/job-card/activityConstants";
import type { PosterStepCtx } from "@/pages/posts/postedJobCard/steps/posterStepContract";

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

import { JobStepCard } from "@/components/job-card/JobStepCard";
import { JobStepRowSlot } from "@/components/job-card/jobStepRow";
import { InProgressStep } from "@/pages/posts/postedJobCard/steps/InProgressStep";
import { ConfirmedSection } from "@/pages/jobs/appliedJobCard/ConfirmedSection";

beforeAll(() => {
  Element.prototype.scrollTo = Element.prototype.scrollTo ?? (() => {});
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
});

const HELPER = "helper-1";
const POSTER = "poster-1";
const NOW = Date.now();
const ago = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

/** A date/time pair `h` hours out, resolved in the JOB's timezone — every
 *  clock gate on these cards resolves in America/Chicago. */
function jobClock(h: number) {
  const at = new Date(NOW + h * 3_600_000);
  return {
    date: at.toLocaleDateString("en-CA", { timeZone: "America/Chicago" }),
    time: at.toLocaleTimeString("en-GB", { timeZone: "America/Chicago", hour: "2-digit", minute: "2-digit" }),
  };
}
const SOON = jobClock(1);

function wrap(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const row = () => document.querySelector("[data-job-step-row]")!;
const noteHost = () => document.querySelector("[data-job-step-note]")!;
const before = (a: Element, b: Element) =>
  !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

function makeJob(over: Record<string, unknown> = {}): Job {
  return {
    id: "job-1",
    title: "Mow the lawn",
    description: "Front and back",
    location: "Lafayette, LA",
    customer_id: POSTER,
    helper_id: HELPER,
    budget: 100,
    category: "yard_work",
    status: "in_progress",
    date_needed: SOON.date,
    start_time: SOON.time,
    proof_before_urls: ["b.jpg"],
    proof_after_urls: ["a.jpg"],
    helper_confirmed_at: ago(48),
    helper_dayof_confirmed_at: ago(30),
    poster_confirmed_at: ago(47),
    ...over,
  } as unknown as Job;
}

function posterCtx(job: Job): PosterStepCtx {
  return {
    job, userId: POSTER, helperNames: { [HELPER]: "Hallie H." }, completedJobMeta: {},
    unfunded: false, completingJobId: null, confirmingArrivalJobId: null,
    confirmingWorkingJobId: null, instantReleaseOn: false, navigate: vi.fn(),
    onBoost: vi.fn(), onEdit: vi.fn(), onCancel: vi.fn(), onComplete: vi.fn(),
    onNoShow: vi.fn(), onTip: vi.fn(), onReview: vi.fn(), onDispute: vi.fn(),
    onReport: vi.fn(), onViewDispute: vi.fn(), onConfirmArrival: vi.fn(),
    onConfirmWorking: vi.fn(), onActionComplete: vi.fn(),
    completionSheetOpen: false, setCompletionSheetOpen: vi.fn(),
    disputeActing: false, resolveConfirmOpen: false, setResolveConfirmOpen: vi.fn(),
    escalateConfirmOpen: false, setEscalateConfirmOpen: vi.fn(),
    escalateDispute: vi.fn(), resolveDisputeAndRelease: vi.fn(),
  };
}

const makeApp = (job: Job) =>
  ({ id: "app-1", job_id: job.id, helper_id: HELPER, status: "accepted", posterName: "Pierre B.", created_at: ago(72), job }) as unknown as AppliedApp;

// ===========================================================================
// /my-posts — the poster's gate reason
// ===========================================================================
describe("Posts card: the gate reason renders BELOW the action row", () => {
  it("the owner's own string is in the note host, and the host follows the row", () => {
    // Nothing has happened yet: the Helpr is neither on the way nor arrived, so
    // "Confirm They Arrived" is disabled and owes the exact sentence the owner
    // quoted.
    wrap(<InProgressStep {...posterCtx(makeJob({ helper_on_the_way_at: null, helper_arrived_at: null }))} />);
    const line = screen.getByText(/You'll be able to confirm this once your Helpr is at the job\./);
    expect(noteHost().contains(line), "the reason must land in the row's note host").toBe(true);
    expect(
      before(row(), noteHost()),
      "the note host must come AFTER [data-job-step-row] (owner, 2026-09-19: " +
        "'should be under the buttons'). It sat above the row until today.",
    ).toBe(true);
  });

  it("it is CENTRED, and centred by the host rather than by the caller", () => {
    wrap(<InProgressStep {...posterCtx(makeJob({ helper_on_the_way_at: null, helper_arrived_at: null }))} />);
    expect(
      noteHost().className,
      "owner, 2026-09-19: 'center under buttons'. The class belongs on the HOST so " +
        "all four note producers share one alignment — a per-caller class is four " +
        "chances to drift.",
    ).toContain("text-center");
  });

  it("the consequence line ('Approve to release payment…') is also below the row", () => {
    // The Helpr has marked the job done: Approve is live and its footnote is
    // the enabled-consequence half of the owner's rule.
    wrap(
      <InProgressStep
        {...posterCtx(
          makeJob({
            helper_on_the_way_at: ago(7),
            helper_arrived_at: ago(6),
            poster_confirmed_arrival_at: ago(6),
            poster_confirmed_working_at: ago(5),
            helper_completed_at: ago(1),
          }),
        )}
      />,
    );
    const line = screen.getByText(/Approve to release payment — then you can review and tip\./);
    expect(before(row(), line), "the consequence line must come AFTER the row too").toBe(true);
  });
});

// ===========================================================================
// /my-jobs — the helper's gate reason ("applies to jobs also")
// ===========================================================================
describe("Jobs card: the gate reason renders BELOW the action row", () => {
  it("the day-of confirmation deadline sits under the row, not above it", () => {
    wrap(
      <ConfirmedSection
        app={makeApp(makeJob({ status: "accepted" }))}
        job={makeJob({
          status: "accepted",
          helper_dayof_confirmed_at: null,
          helper_confirmed_at: ago(72),
          helper_on_the_way_at: null,
          helper_arrived_at: null,
        })}
        userId={HELPER}
        initialTracking={{ id: "t-1", status: "job_confirmed", latitude: null, longitude: null, eta_minutes: null, updated_at: ago(5) } as never}
        navigate={vi.fn()}
      />,
    );
    // The host is the assertion, not any one sentence: whatever this state's
    // note is, it has to be under the row on this card exactly as on the other.
    expect(noteHost().childElementCount, "no note rendered — the fixture stopped reaching a gated state").toBeGreaterThan(0);
    expect(before(row(), noteHost()), "the Jobs card's note host must follow its row too").toBe(true);
    expect(noteHost().className).toContain("text-center");
  });
});

// ===========================================================================
// One line, never two
// ===========================================================================
describe("the row carries at most ONE explanation line", () => {
  /* Driven at the SHELL, because no state of either card can currently produce
     a gate reason and a consequence line at once (see the file header). The
     shell is where the rule lives and where it can be reached. */
  it("a gate reason standing in the note host suppresses the footnote", () => {
    render(
      <JobStepCard
        side="poster"
        step="in_progress"
        notice={<JobStepRowSlot slot="note"><p>You&apos;ll be able to confirm this once your Helpr is at the job.</p></JobStepRowSlot>}
        footnote={<p>Approve to release payment — then you can review and tip.</p>}
        actions={[<button key="a" type="button">Message</button>]}
      />,
    );
    expect(screen.getByText(/You'll be able to confirm this/)).toBeInTheDocument();
    expect(
      screen.queryByText(/Approve to release payment/),
      "two centred sentences under one row is worse than either alone — the GATE wins, " +
        "because it is the reason the reader is standing in front of right now",
    ).toBeNull();
  });

  it("with the note host empty, the footnote renders (the suppression is not a delete)", () => {
    render(
      <JobStepCard
        side="poster"
        step="in_progress"
        footnote={<p>Approve to release payment — then you can review and tip.</p>}
        actions={[<button key="a" type="button">Message</button>]}
      />,
    );
    expect(screen.getByText(/Approve to release payment/)).toBeInTheDocument();
  });
});
