/**
 * A CARD THAT STATES A PROOF REQUIREMENT MUST OFFER A WAY TO SATISFY IT —
 * and it must state it to the person who can.
 *
 * Owner, 2026-09-19, on a `/my-posts` card for a DISPUTED job: "here they have
 * no way to submit the photos after the dispute or revision."
 *
 * ── WHAT WAS ACTUALLY WRONG, ON WHICH SIDE ────────────────────────────────
 * The screenshot was the POSTER's card, and the poster does not upload work
 * proof — so the report had to be split before it could be fixed:
 *
 *   poster · disputed   — showed `PhotoProofRequirementNote`, whose sentence is
 *                         `requiredProof().reason`: "Before & after photos are
 *                         required — they're the proof that releases YOUR
 *                         payment." On a poster's screen that is wrong twice
 *                         (the payment leaves them, and they have no control
 *                         that could satisfy it). MIS-AIMED COPY, fixed by
 *                         aiming it: `audience="poster"`.
 *   poster · revision   — `derivePosterStep` routes revision_requested to the
 *                         in-progress step, which never mounted the note. No
 *                         defect; asserted here so it cannot acquire one.
 *   helper · disputed   — already carried the capture chip (item 10, earlier
 *                         the same day). No defect; asserted so it cannot
 *                         silently lose it.
 *   helper · revision   — THE REAL HOLE. RevisionStep mounted no photo control
 *                         at all, on the reasoning that the revision panel is
 *                         the step's one `ask`. That is true of the ask SLOT
 *                         and was never true of the row. Fixed: the chip is in
 *                         the row, like every other step.
 *
 * ── WHY THIS ASSERTS REACHABILITY AND NOT A STRING ────────────────────────
 * The defect class is "the app names a requirement and offers no control", the
 * same shape as the arrival deadlock. A test that asserted the sentence exists
 * would have been green throughout. What is asserted is the CONTROL: a capture
 * chip the Helpr can press, in the state where the requirement is unmet.
 *
 * @mutate src/components/activity/appliedJobCard/steps/RevisionStep.tsx | <HelperPhotoAsk key="photo" jobId={app.job_id} job={job} step="revision" /> | null
 * @mutate src/components/activity/appliedJobCard/steps/HelperPhotoAsk.tsx | if (step === "revision") { | if (step === "__never__") {
 * @mutate src/components/activity/postedJobCard/steps/DisputedStep.tsx | audience="poster" | audience="helper"
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import type { AppliedApp, Job } from "@/components/activity/activityConstants";
import type { PosterStepCtx } from "@/components/activity/postedJobCard/steps/posterStepContract";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn(), notifyJobParty: vi.fn() }));
vi.mock("@/lib/haptics", () => ({
  hapticLight: vi.fn(), hapticError: vi.fn(), hapticSuccess: vi.fn(),
  hapticMedium: vi.fn(), hapticSelection: vi.fn(), hapticWarning: vi.fn(),
}));
/* PhotoProof is NOT stubbed away: `PhotoProofCaptureChip` is the control under
   test and `PhotoProofRequirementNote` is the sentence under test, so both
   render for real. Only the gallery dialog — portalled and closed — is a stub,
   because it contributes nothing to either question. */
vi.mock("@/components/PhotoProof", async (orig) => {
  const actual = await orig<typeof import("@/components/PhotoProof")>();
  return { ...actual, PhotoProofDialog: () => null };
});

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
      storage: { from: vi.fn(() => ({ upload: vi.fn(), getPublicUrl: vi.fn(() => ({ data: { publicUrl: "" } })) })) },
      auth: { getUser: vi.fn(() => Promise.resolve({ data: { user: null }, error: null })) },
    },
  };
}
vi.mock("@/integrations/supabase/client", () => makeSupabase());

import { RevisionStep } from "@/components/activity/appliedJobCard/steps/RevisionStep";
import { DisputedSection } from "@/components/activity/appliedJobCard/DisputedSection";
import { DisputedStep } from "@/components/activity/postedJobCard/steps/DisputedStep";
import { InProgressStep } from "@/components/activity/postedJobCard/steps/InProgressStep";
import { POSTER_PROOF_MISSING_NOTE } from "@/components/PhotoProof";
import { requiredProof } from "@/lib/photoProofPolicy";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";

beforeAll(() => {
  Element.prototype.scrollTo = Element.prototype.scrollTo ?? (() => {});
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
});

const HELPER = "helper-1";
const POSTER = "poster-1";
const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

function wrap(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

function makeJob(over: Record<string, unknown> = {}): Job {
  return {
    id: "job-1",
    title: "Move a piano across the house",
    description: "Upright, ground floor to the back room.",
    location: "Lafayette, LA",
    customer_id: POSTER,
    helper_id: HELPER,
    budget: 180,
    category: "moving",
    status: "revision_requested",
    date_needed: jobLocalDateISO(0), // Central, not UTC — see src/test/helpers/jobLocalDate.ts
    start_time: "09:00",
    proof_before_urls: [],
    proof_after_urls: [],
    helper_confirmed_at: ago(48),
    poster_confirmed_at: ago(47),
    helper_on_the_way_at: ago(7),
    helper_arrived_at: ago(6),
    poster_confirmed_arrival_at: ago(6),
    poster_confirmed_working_at: ago(5),
    helper_completed_at: ago(2),
    revision_requested_at: ago(1),
    ...over,
  } as unknown as Job;
}

const makeApp = (job: Job) =>
  ({ id: "app-1", job_id: job.id, helper_id: HELPER, status: "accepted", posterName: "Pierre B.", created_at: ago(72), job }) as unknown as AppliedApp;

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

/**
 * Every CAPTURE control on the card.
 *
 * Matched on `aria-label`, which `PhotoProof` always ends "— add the before/
 * after photo for this job", rather than on the visible text. The visible text
 * is NOT stable: the chip reads "Before Photo" / "After Photo" while the array
 * is empty and relabels to "Before (1)" / "After (2)" once it is not — which
 * is exactly the revision case this file exists for, and exactly the sort of
 * near-miss that makes a guard quietly stop asserting anything.
 *
 * It also cannot collide with the neutral `Photos` chip beside it on the
 * disputed row: that one OPENS the gallery and says so in its own label.
 */
const captureChips = () =>
  screen.queryAllByRole("button").filter((b) => /add the (before|after) photo/i.test(b.getAttribute("aria-label") ?? ""));

const renderRevision = (job: Job) =>
  wrap(
    <RevisionStep
      app={makeApp(job)}
      job={job}
      userId={HELPER}
      tracker={<div data-testid="tracker" />}
      messageChip={<button type="button" key="m">Message</button>}
      reportChip={<button type="button" key="r">Report a Problem</button>}
      sosChip={null}
      exitChip={null}
      abortedNotice={null}
      revisionAccepted
      onRevisionAcceptedChange={vi.fn()}
      resolving={false}
      onMarkFixed={vi.fn()}
    />,
  );

// ===========================================================================
// /my-jobs — the side that actually uploads
// ===========================================================================
describe("Jobs card: the Helpr can file photos in BOTH contested states", () => {
  it("revision: a capture chip is in the action row", () => {
    renderRevision(makeJob());
    const chips = captureChips();
    expect(
      chips.length,
      "the revision card offers no way to file a photo. A revision is a second " +
        "round of work and the new after photo is what the poster judges the fix " +
        "by (owner, 2026-09-19).",
    ).toBeGreaterThan(0);
    // IN THE ROW, not stacked above it — VN-21 still holds.
    const row = document.querySelector("[data-job-step-row]")!;
    expect(row.contains(chips[0])).toBe(true);
  });

  it("revision: the chip SURVIVES an after photo already existing", () => {
    // The whole point. The helper uploaded an after photo for the first
    // submission; the poster asked for a fix; gating on emptiness would leave
    // the one state that most needs a new photo unable to take one.
    renderRevision(makeJob({ proof_before_urls: ["b.jpg"], proof_after_urls: ["a.jpg"] }));
    const chips = captureChips();
    expect(chips.length, "the chip vanished once an after photo existed").toBeGreaterThan(0);
    // …and it is the AFTER, relabelled with its count because one already
    // exists. The new photo APPENDS; it does not replace the first.
    expect(chips[0].getAttribute("aria-label")).toMatch(/add the after photo/i);
    expect(chips[0]).toHaveTextContent("After (1)");
  });

  it("revision: it respects the poster's per-job opt-out", () => {
    // Not a new rule — `require_photo_proof === false` silences the ask
    // everywhere. Asserted so "always offered" is not read as "unconditional".
    renderRevision(makeJob({ require_photo_proof: false }));
    expect(captureChips()).toHaveLength(0);
  });

  it("disputed: a capture chip is in the action row (unchanged, pinned)", () => {
    const job = makeJob({ status: "disputed", dispute_status: "open" });
    wrap(
      <DisputedSection
        app={makeApp(job)}
        job={job}
        userId={HELPER}
        initialTracking={null}
        navigate={vi.fn()}
        onViewDispute={vi.fn()}
        onRefresh={vi.fn()}
        disputeResponse=""
        setDisputeResponse={vi.fn()}
        respondingJobId={null}
        setRespondingJobId={vi.fn()}
        submittingResponse={false}
        setSubmittingResponse={vi.fn()}
      />,
    );
    expect(captureChips().length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// /my-posts — the side that does NOT upload
// ===========================================================================
describe("Posts card: the proof note is aimed at its reader", () => {
  it("disputed: the poster is told the FACT, not the Helpr's instruction", () => {
    wrap(<DisputedStep {...posterCtx(makeJob({ status: "disputed", dispute_status: "open" }))} />);
    expect(screen.getByText(new RegExp(POSTER_PROOF_MISSING_NOTE.slice(0, 40)))).toBeInTheDocument();
    // The helper's sentence — read from the policy module, never retyped — must
    // NOT be on the poster's screen. "your payment" is the poster's money
    // leaving, and no control on this card could satisfy the requirement.
    const helperLine = requiredProof({}).reason;
    expect(
      screen.queryByText(new RegExp(helperLine.slice(0, 40).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))),
      `the poster's disputed card prints the HELPER's sentence ("${helperLine}")`,
    ).toBeNull();
  });

  it("disputed: and it still offers the poster NO capture control", () => {
    // The fix is the copy, not a control. A poster who could upload "work
    // proof" would be filing evidence about work they did not do.
    wrap(<DisputedStep {...posterCtx(makeJob({ status: "disputed", dispute_status: "open" }))} />);
    expect(captureChips()).toHaveLength(0);
  });

  it("revision: the poster's card states no proof requirement at all", () => {
    // `derivePosterStep` routes revision_requested to the in-progress step,
    // which never mounted the note. Pinned so it cannot acquire one and
    // recreate the defect on the other contested state.
    wrap(<InProgressStep {...posterCtx(makeJob())} />);
    const helperLine = requiredProof({}).reason;
    expect(screen.queryByText(new RegExp(helperLine.slice(0, 40).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))).toBeNull();
    expect(screen.queryByText(new RegExp(POSTER_PROOF_MISSING_NOTE.slice(0, 40)))).toBeNull();
  });
});
