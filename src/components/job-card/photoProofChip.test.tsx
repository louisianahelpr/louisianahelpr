/**
 * OWNER ITEM 10 (2026-09-19): "before & after pictures" is a BUTTON, on the
 * SAME ROW as the other action buttons.
 *
 * It used to be `PhotoProofGroup` — a titled two-column panel with six
 * thumbnails and a "View All" text link — sitting in the `ask` slot ABOVE the
 * action row on five different cards. So the one row the owner asked for
 * (VN-21) had a second, taller block of chrome stacked on top of it, on every
 * state where the proof exists.
 *
 * This file is the CLASS check for that ask, over all five call sites at once:
 *
 *   1. every site offers a `Photos` control;
 *   2. on the three step cards it is INSIDE `[data-job-step-row]` — the single
 *      action row — which is the half a "does the chip render" test cannot see
 *      and the half the owner actually asked for;
 *   3. no site still draws the `Photo Proof` panel above the row;
 *   4. the control really opens the gallery. The dialog is the REAL
 *      `PhotoProofDialog` here (not a stub), so this covers the wiring — the
 *      extraction, the `dialogs` slot, and the open state — and not just the
 *      button's existence.
 *
 * The UPLOAD ask is a DIFFERENT control and stays different. Since 2026-09-19
 * it is on this same row (owner: "before and after buttons should also be on
 * the same lines as the other buttons"), so the two now sit side by side on the
 * disputed card — which is exactly why their labels differ: "Photos" opens the
 * gallery of what exists, "Before Photo" / "After Photo" adds what does not.
 * See src/test/beforePhotoCapture.test.tsx.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";
import type { AppliedApp, Job } from "./activityConstants";
import type { PosterStepCtx } from "../../pages/posts/postedJobCard/steps/posterStepContract";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn(), notifyJobParty: vi.fn() }));
vi.mock("@/lib/haptics", () => ({
  hapticLight: vi.fn(), hapticError: vi.fn(), hapticSuccess: vi.fn(),
  hapticMedium: vi.fn(), hapticSelection: vi.fn(), hapticWarning: vi.fn(),
}));
// NOT mocked: @/components/PhotoProof. The point of this file is the real one.
/* PARTIAL MOCK, not a replacement. Only the <JobTracking> COMPONENT is stubbed
   (it opens a realtime channel and runs queries). Its pure exports —
   `deriveCurrentStatusIdx`, `railStepLabels`, `railDisplayIdx` — are the real
   ones, because the collapsed card's compact rail (owner, 2026-09-19) computes
   its dots from them. A mock that dropped them made every card throw, which is
   a truthful failure: the card genuinely needs that derivation now. */
vi.mock("@/components/JobTracking", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/JobTracking")>()),
  JobTracking: ({ personTile }: { personTile?: ReactNode }) => <div data-testid="tracker">{personTile}</div>,
}));
vi.mock("@/components/JobConfirmation", () => ({
  JobConfirmation: () => null,
  helperDayOfConfirmation: () => true,
}));
vi.mock("./JobCardMetaRow", () => ({ JobCardMetaRow: () => <div data-testid="meta" /> }));
vi.mock("./useHighlightPulse", () => ({ useHighlightPulse: () => {} }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ profile: null }) }));

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
      storage: { from: vi.fn(() => ({ upload: vi.fn(), createSignedUrl: vi.fn() })) },
      channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() })),
      removeChannel: vi.fn(),
      rpc: vi.fn(() => Promise.resolve(result)),
      auth: { getUser: vi.fn(() => Promise.resolve({ data: { user: null }, error: null })) },
    },
  };
}
vi.mock("@/integrations/supabase/client", () => makeSupabase());

import { CompletedStep } from "../../pages/posts/postedJobCard/steps/CompletedStep";
import { InProgressStep } from "../../pages/posts/postedJobCard/steps/InProgressStep";
import { DisputedStep } from "../../pages/posts/postedJobCard/steps/DisputedStep";
import { AppliedJobCard } from "../../pages/jobs/AppliedJobCard";
import { POSTER_PROOF_MISSING_NOTE } from "@/components/PhotoProof";
import { requiredProof } from "@/lib/photoProofPolicy";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";

const HELPER = "helper-1";
const POSTER = "poster-1";
const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
// The job's day in AMERICA/CHICAGO, the zone every clock gate on these cards
// resolves in (`jobLocalStartMs` / `todayMs()` / `completionStalled`). These
// were `.toISOString().slice(0, 10)` — the UTC day — which after 19:00 Pacific
// names the NEXT Central day, so a "yesterday" fixture was really today and a
// "today" fixture was really tomorrow. Eight specs went red on that on
// 2026-09-19 with the product entirely correct; see
// src/test/helpers/jobLocalDate.ts.
const TODAY = jobLocalDateISO(0);

const BEFORE = ["https://example.test/before-1.jpg"];
const AFTER = ["https://example.test/after-1.jpg", "https://example.test/after-2.jpg"];

function makeJob(over: Record<string, unknown>): Job {
  return {
    id: "job-1",
    title: "Mow the lawn",
    description: "Front and back",
    location: "Lafayette, LA",
    customer_id: POSTER,
    helper_id: HELPER,
    budget: 100,
    category: "yard_work",
    date_needed: TODAY,
    start_time: "09:00",
    proof_before_urls: BEFORE,
    proof_after_urls: AFTER,
    helper_confirmed_at: ago(48),
    poster_confirmed_at: ago(47),
    poster_confirmed_arrival_at: ago(6),
    poster_confirmed_working_at: ago(5),
    helper_on_the_way_at: ago(7),
    helper_arrived_at: ago(6),
    helper_completed_at: null,
    poster_completed_at: null,
    status: "in_progress",
    ...over,
  } as unknown as Job;
}

function wrap(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

function posterCtx(job: Job): PosterStepCtx {
  return {
    job,
    userId: POSTER,
    helperNames: { [HELPER]: "Hallie H." },
    completedJobMeta: {},
    unfunded: false,
    completingJobId: null,
    confirmingArrivalJobId: null,
    confirmingWorkingJobId: null,
    instantReleaseOn: false,
    navigate: vi.fn(),
    onBoost: vi.fn(),
    onEdit: vi.fn(),
    onCancel: vi.fn(),
    onComplete: vi.fn(),
    onNoShow: vi.fn(),
    onTip: vi.fn(),
    onReview: vi.fn(),
    onDispute: vi.fn(),
    onReport: vi.fn(),
    onViewDispute: vi.fn(),
    onConfirmArrival: vi.fn(),
    onConfirmWorking: vi.fn(),
    onActionComplete: vi.fn(),
    completionSheetOpen: false,
    setCompletionSheetOpen: vi.fn(),
    disputeActing: false,
    resolveConfirmOpen: false,
    setResolveConfirmOpen: vi.fn(),
    escalateConfirmOpen: false,
    setEscalateConfirmOpen: vi.fn(),
    escalateDispute: vi.fn(),
    resolveDisputeAndRelease: vi.fn(),
  };
}

const noop = () => {};
function renderAppliedCard(job: Job, reviewed: boolean) {
  const app = { id: "app-1", job_id: job.id, helper_id: HELPER, status: "accepted", posterName: "Pierre B.", job } as unknown as AppliedApp;
  return wrap(
    <AppliedJobCard
      app={app}
      expandedJobIds={new Set([job.id])}
      toggleExpandedJobId={vi.fn()}
      helperReviewedJobIds={new Set(reviewed ? [job.id] : [])}
      userId={HELPER}
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
    />,
  );
}

/** The completed job both sides of the app show, with proof attached. */
const COMPLETED = {
  status: "completed",
  helper_completed_at: ago(3),
  poster_completed_at: ago(2),
  payment_status: "released",
} as const;

const SITES: Array<{
  name: string;
  render: () => ReturnType<typeof render>;
  /** Step cards only: the chip must land in the single action row. */
  inStepRow: boolean;
}> = [
  {
    name: "Posts · In Progress, Helpr marked done",
    render: () => wrap(<InProgressStep {...posterCtx(makeJob({ helper_completed_at: ago(1) }))} />),
    inStepRow: true,
  },
  {
    name: "Posts · Completed",
    render: () => wrap(<CompletedStep {...posterCtx(makeJob(COMPLETED))} />),
    inStepRow: true,
  },
  {
    name: "Posts · Disputed",
    render: () =>
      wrap(
        <DisputedStep
          {...posterCtx(makeJob({ status: "disputed", dispute_status: "open", disputed_by: POSTER, dispute_reason: "x" }))}
        />,
      ),
    inStepRow: true,
  },
  {
    name: "Jobs · Completed, not yet reviewed",
    render: () => renderAppliedCard(makeJob(COMPLETED), false),
    inStepRow: false,
  },
  {
    name: "Jobs · Fully done, expanded",
    render: () => renderAppliedCard(makeJob(COMPLETED), true),
    inStepRow: false,
  },
];

const photosButton = () =>
  screen.getByRole("button", { name: /^Photos\b/ });

describe("item 10 — the before & after pictures are a button on the action row", () => {
  for (const site of SITES) {
    it(`${site.name}: offers a Photos button and no panel above the row`, () => {
      const { container } = site.render();

      const btn = photosButton();
      expect(btn).toBeInTheDocument();

      // The PANEL is gone. Checked BEFORE the dialog opens, because the
      // dialog's own hero carries the same words.
      expect(screen.queryByText("Photo Proof")).toBeNull();
      // …and so is its "View All" escape hatch, which only that panel had.
      expect(screen.queryByText("View All")).toBeNull();

      if (site.inStepRow) {
        const row = container.querySelector("[data-job-step-row]");
        expect(row, "the step card has no action row").not.toBeNull();
        expect(
          row!.contains(btn),
          "the Photos button is on the card but NOT in its single action row — which is the whole ask",
        ).toBe(true);
      }
    });

    it(`${site.name}: the button opens the gallery`, async () => {
      site.render();
      expect(screen.queryByRole("dialog"), "the gallery is open before anyone tapped").toBeNull();

      fireEvent.click(photosButton());

      const dialog = screen.getByRole("dialog");
      expect(within(dialog).getByText("Photo Proof")).toBeInTheDocument();
      // Every photo the job carries, before and after. The gallery signs each
      // one first (useProofPhotoUrls, since 65676a7ad), so the src arrives a
      // tick after the dialog does — wait for it rather than read the placeholder.
      for (const url of [...BEFORE, ...AFTER]) {
        await waitFor(() => expect(dialog.querySelector(`img[src="${url}"]`), url).not.toBeNull());
      }
      expect(within(dialog).getByText("Before")).toBeInTheDocument();
      expect(within(dialog).getByText("After")).toBeInTheDocument();
    });
  }

  it("no site offers it when the job has no photos — an empty gallery is a dead-end tap", () => {
    const bare = { proof_before_urls: [], proof_after_urls: [] };
    for (const ui of [
      <InProgressStep key="a" {...posterCtx(makeJob({ ...bare, helper_completed_at: ago(1) }))} />,
      <CompletedStep key="b" {...posterCtx(makeJob({ ...COMPLETED, ...bare }))} />,
      <DisputedStep key="c" {...posterCtx(makeJob({ ...bare, status: "disputed", dispute_status: "open", disputed_by: POSTER, dispute_reason: "x" }))} />,
    ]) {
      const { unmount } = wrap(ui);
      expect(screen.queryByRole("button", { name: /^Photos\b/ })).toBeNull();
      unmount();
    }
    for (const reviewed of [false, true]) {
      const { unmount } = renderAppliedCard(makeJob({ ...COMPLETED, ...bare }), reviewed);
      expect(screen.queryByRole("button", { name: /^Photos\b/ })).toBeNull();
      unmount();
    }
  });
});

/**
 * REGRESSION GUARD for the one thing item 10 took away by accident.
 *
 * `PhotoProofGroup` carried a red line — "before & after photos are required" —
 * that appeared when a job was short of the proof its budget demands. Item 10
 * replaced that panel with a chip + `PhotoProofDialog`, and the dialog shows
 * photos and nothing else, so on the DISPUTED card the line vanished silently.
 *
 * That is the card where it matters most. A poster weighing a dispute is
 * weighing exactly this evidence, and a card that says nothing reads as "the
 * proof is fine" rather than "the proof is missing" — a false signal on a
 * money decision. Restored into the step's `notice` slot via the exported
 * `PhotoProofRequirementNote`, so the panel and the card share one definition
 * of the rule rather than the card re-deriving it.
 *
 * 2026-09-19, LATER THE SAME DAY: the line is still here and still gated the
 * same way — what changed is WHO it is written to. It printed
 * `requiredProof().reason`, the HELPER's sentence, ending "they're the proof
 * that releases YOUR payment", on the screen of the person the money leaves,
 * beside a row with no way to file a photo. `audience="poster"` gives it
 * `POSTER_PROOF_MISSING_NOTE` instead. The assertions below therefore match
 * the poster's wording, imported rather than retyped, and the "must not cry
 * wolf" case is unchanged because the GATE is unchanged.
 */
describe("the disputed card still says when the proof is short (item 10 regression)", () => {
  const disputed = (over: Record<string, unknown>) =>
    makeJob({ status: "disputed", dispute_status: "open", disputed_by: POSTER, dispute_reason: "x", ...over });

  /** The poster's wording, read from the module that owns it. */
  const posterLine = new RegExp(POSTER_PROOF_MISSING_NOTE.slice(0, 40));

  it("after-photos missing on a job that requires them: the red line is on the card", () => {
    wrap(<DisputedStep {...posterCtx(disputed({ budget: 100, proof_after_urls: [] }))} />);
    expect(screen.getByText(posterLine)).toBeInTheDocument();
  });

  it("proof complete: no red line — it must not cry wolf", () => {
    wrap(<DisputedStep {...posterCtx(disputed({ budget: 100 }))} />);
    expect(screen.queryByText(posterLine)).toBeNull();
    expect(screen.queryByText(/photos are required|required for jobs/i)).toBeNull();
  });

  it("the line sits on the CARD, not behind the Photos button", () => {
    wrap(<DisputedStep {...posterCtx(disputed({ budget: 100, proof_after_urls: [] }))} />);
    // Visible before anything is opened — a poster must not have to press a
    // button to discover that the evidence they are judging is incomplete.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText(posterLine)).toBeVisible();
  });

  it("and it is NOT the Helpr's sentence — the poster cannot act on that one", () => {
    wrap(<DisputedStep {...posterCtx(disputed({ budget: 100, proof_after_urls: [] }))} />);
    const helperLine = requiredProof({}).reason;
    expect(
      screen.queryByText(new RegExp(helperLine.slice(0, 40).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))),
      `the poster's disputed card prints the HELPER's sentence ("${helperLine}") — ` +
        `"your payment" is the poster's money leaving, and no control on their card ` +
        `could satisfy the requirement`,
    ).toBeNull();
  });
});

// Shown able to fail: the "something to look at" half of the Photos chip gate.
// Drop `hasProof` and a job with no proof offers a chip that opens an empty
// gallery — the dead-end tap this file forbids at every call site.
// @mutate src/pages/posts/postedJobCard/steps/InProgressStep.tsx | showApprove && hasProof ? ( | showApprove ? (
