import { describe, it, expect, vi, beforeAll } from "vitest";
import { act, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import type { AppliedApp, Job } from "./activityConstants";
import type { PosterStepCtx } from "./postedJobCard/steps/posterStepContract";

/**
 * VN-21 — EVERY BUTTON ON A STEP CARD SITS ON ONE ROW (owner, 2026-09-14).
 *
 * "i don't think i like the multiple rows of buttons for jobs and posts. can
 * all the buttons be on 1 row" — then "all buttons should be with the live
 * tracker box", and on the Posts side "confirm they're working, no show,
 * message etc — all of these buttons need to be on 1 line not multiple".
 *
 * The shell (JobStepCard) used to draw a full-width `primary`, then a chip
 * grid, and the tracker drew its own full-width CTA inside the header — three
 * stacked rows on a Working card. This file renders every step of BOTH cards
 * and fails if any action control lives outside the step's single
 * `[data-job-step-row]`, if there is more than one row, or if that row is
 * allowed to wrap.
 *
 * "Action control" is every button or link the card renders, minus the things
 * that are content rather than the card's moves: the inline dispute-response
 * form (it IS the ask, opened from the row), and dialogs (portalled, closed).
 */

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }));
vi.mock("@/lib/haptics", () => ({
  hapticLight: vi.fn(), hapticError: vi.fn(), hapticSuccess: vi.fn(),
  hapticMedium: vi.fn(), hapticSelection: vi.fn(), hapticWarning: vi.fn(),
}));
// Uploaders and proof galleries are content (the `ask`), not the row's moves.
vi.mock("@/components/PhotoProof", () => ({
  PhotoProofGroup: () => <div data-testid="photo-proof" />,
  PhotoProofStep: ({ title }: { title: string }) => <div data-testid="photo-proof-step">{title}</div>,
}));

function makeSupabase() {
  const result = { data: null, error: null };
  const chain: Record<string, unknown> = {};
  const methods = [
    "from", "select", "eq", "neq", "in", "order", "limit", "insert", "update",
    "upsert", "delete", "gte", "lte", "is", "not", "filter",
  ];
  for (const m of methods) chain[m] = vi.fn(() => chain);
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

import { ActiveJobSection } from "./appliedJobCard/ActiveJobSection";
import { ConfirmedSection } from "./appliedJobCard/ConfirmedSection";
import { DisputedSection } from "./appliedJobCard/DisputedSection";
import { InProgressStep } from "./postedJobCard/steps/InProgressStep";
import { ScheduledStep } from "./postedJobCard/steps/ScheduledStep";
import { OpenStep } from "./postedJobCard/steps/OpenStep";
import { CompletedStep } from "./postedJobCard/steps/CompletedStep";
import { DisputedStep } from "./postedJobCard/steps/DisputedStep";
import { JobStepCard } from "./JobStepCard";
import { JobStepRowSlot, shouldCompactJobStepRow } from "./jobStepRow";

beforeAll(() => {
  Element.prototype.scrollTo = Element.prototype.scrollTo ?? (() => {});
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
});

const HELPER = "helper-1";
const POSTER = "poster-1";
const NOW = Date.now();
const ago = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const ahead = (h: number) => new Date(NOW + h * 3_600_000).toISOString();
const YESTERDAY = new Date(NOW - 24 * 3_600_000).toISOString().slice(0, 10);
const TODAY = new Date(NOW).toISOString().slice(0, 10);

type J = Job & { revision_note?: string | null };

/** Both halves of the VN-33 arrival rule, so the tracker offers its next step
 *  rather than the legacy "Try My Location Again" retry. */
const VERIFIED = { helper_arrival_verified_at: ago(6), poster_confirmed_arrival_at: ago(6) };

function makeJob(over: Record<string, unknown>): J {
  return {
    id: "job-1",
    title: "Mow the lawn",
    description: "Front and back",
    location: "Lafayette, LA",
    customer_id: POSTER,
    helper_id: HELPER,
    budget: 100,
    category: "yard_work",
    date_needed: YESTERDAY,
    start_time: "09:00",
    latitude: null,
    longitude: null,
    proof_before_urls: ["before.jpg"],
    proof_after_urls: ["after.jpg"],
    helper_confirmed_at: ago(48),
    helper_dayof_confirmed_at: ago(30),
    poster_confirmed_at: ago(47),
    poster_confirmed_working_at: ago(8),
    helper_on_the_way_at: ago(7),
    helper_arrived_at: ago(6),
    helper_completed_at: null,
    poster_completed_at: null,
    revision_requested_at: null,
    revision_deadline: null,
    revision_completed_at: null,
    revision_acceptance_deadline: null,
    revision_note: null,
    status: "in_progress",
    ...over,
  } as unknown as J;
}

const makeApp = (job: Job) =>
  ({ id: "app-1", job_id: job.id, helper_id: HELPER, status: "accepted", created_at: ago(72), job }) as unknown as AppliedApp;

const tracking = (status: string) => ({
  id: "t-1", status, latitude: null, longitude: null, eta_minutes: null, updated_at: ago(5),
});

function wrap(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const active = (job: J, trackingStatus: string) => () =>
  wrap(
    <ActiveJobSection
      app={makeApp(job)}
      job={job}
      status={job.status}
      userId={HELPER}
      initialTracking={tracking(trackingStatus)}
      completingJobId={null}
      onComplete={vi.fn()}
      onResolveRevision={vi.fn()}
      onOpenDispute={vi.fn()}
      navigate={vi.fn()}
    />,
  );

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

const disputed = (job: J, respondingJobId: string | null = null) => () =>
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
      respondingJobId={respondingJobId}
      setRespondingJobId={vi.fn()}
      submittingResponse={false}
      setSubmittingResponse={vi.fn()}
    />,
  );

/** Every state of both cards the owner can reach, by the screen they named. */
const CASES: Array<{
  name: string;
  render: () => ReturnType<typeof render>;
  /** Floor on the controls found, so a fixture that stops reaching its state
   *  cannot pass on an empty card. */
  minControls: number;
  /** What the row's primary slot holds, in order ([] = no primary). */
  primary: string[];
}> = [
  // ── /my-jobs, Helpr ──
  {
    name: "Jobs · Confirmed (tracker CTA + Directions · Message · Cancel Job)",
    render: () =>
      wrap(
        <ConfirmedSection
          app={makeApp(makeJob({}))}
          job={makeJob({
            status: "accepted", date_needed: TODAY, start_time: "00:00",
            helper_on_the_way_at: null, helper_arrived_at: null, poster_confirmed_working_at: null,
          })}
          userId={HELPER}
          initialTracking={tracking("job_confirmed")}
          navigate={vi.fn()}
        />,
      ),
    minControls: 4,
    primary: ["I'm On My Way"],
  },
  {
    name: "Jobs · Confirmed, day-of confirmation still owed (I'm Still On)",
    render: () =>
      wrap(
        <ConfirmedSection
          app={makeApp(makeJob({}))}
          job={makeJob({
            status: "accepted", date_needed: TODAY, start_time: "23:59",
            helper_confirmed_at: ago(72), helper_dayof_confirmed_at: null,
            helper_on_the_way_at: null, helper_arrived_at: null, poster_confirmed_working_at: null,
          })}
          userId={HELPER}
          initialTracking={tracking("confirmed")}
          navigate={vi.fn()}
        />,
      ),
    minControls: 4,
    primary: ["I'm Still On"],
  },
  {
    name: "Jobs · On the Way (I've Arrived + Directions · Message · Report a Problem)",
    render: active(makeJob({ helper_arrived_at: null, poster_confirmed_working_at: null }), "on_the_way"),
    minControls: 4,
    primary: ["I've Arrived"],
  },
  {
    name: "Jobs · Arrived (Start Working + Message · Report a Problem)",
    render: active(makeJob({ ...VERIFIED, poster_confirmed_working_at: null }), "arrived"),
    minControls: 3,
    primary: ["Start Working"],
  },
  {
    name: "Jobs · Arrived, legacy unverified arrival (Start Working + Try My Location Again share the slot)",
    render: active(makeJob({ poster_confirmed_working_at: null }), "arrived"),
    minControls: 4,
    primary: ["Start Working", "Try My Location Again"],
  },
  {
    // The pair singlePrimaryCta.test.tsx pinned at 2: the tracker's "Mark Job
    // Complete" above PayoutPrimary's identical one. The tracker's IS the
    // primary; PayoutPrimary stands down.
    name: "Jobs · Working (Mark Job Complete + Message · Report a Problem)",
    render: active(makeJob({ ...VERIFIED }), "working"),
    minControls: 3,
    primary: ["Mark Job Complete"],
  },
  {
    name: "Jobs · Working, after photo still owed (ask above, disabled Mark Job Complete in the row)",
    render: active(makeJob({ ...VERIFIED, proof_after_urls: [] }), "working"),
    minControls: 3,
    primary: ["Mark Job Complete"],
  },
  {
    name: "Jobs · Submitted (Message · Report a Problem, no primary)",
    render: active(makeJob({ ...VERIFIED, helper_completed_at: ago(2) }), "done"),
    minControls: 2,
    primary: [],
  },
  {
    name: "Jobs · Revision (I'll Fix It + Message)",
    render: active(
      makeJob({
        status: "revision_requested", helper_completed_at: ago(5), revision_requested_at: ago(3),
        revision_deadline: ahead(60), revision_note: "The back gate area was missed.",
      }),
      "working",
    ),
    minControls: 3,
    primary: ["I'll Fix It"],
  },
  {
    name: "Jobs · Disputed, filed by the Helpr (Withdraw + Timeline · Message · Contact Admin)",
    render: disputed(makeJob({ status: "disputed", dispute_status: "open", disputed_by: HELPER, dispute_reason: "x" })),
    minControls: 4,
    primary: ["Withdraw Dispute"],
  },
  {
    name: "Jobs · Disputed, filed by the poster (Respond + Timeline · Message · Contact Admin)",
    render: disputed(makeJob({ status: "disputed", dispute_status: "open", disputed_by: POSTER, dispute_reason: "x" })),
    minControls: 4,
    primary: ["Respond to Dispute"],
  },
  // ── /my-posts, poster ──
  {
    name: "Posts · Open (Share · Boost · Edit · Cancel)",
    render: () => wrap(<OpenStep {...posterCtx(makeJob({ status: "open", helper_id: null }))} />),
    minControls: 4,
    primary: [],
  },
  {
    name: "Posts · Scheduled (Message · Cancel)",
    render: () => wrap(<ScheduledStep {...posterCtx(makeJob({ status: "accepted", helper_on_the_way_at: null, helper_arrived_at: null }))} />),
    minControls: 2,
    primary: [],
  },
  {
    // Was a full-width button of its own in PostedJobCard, above the tracker.
    name: "Posts · Scheduled, Helpr says they arrived (Confirm Arrival + Message · Cancel)",
    render: () => wrap(<ScheduledStep {...posterCtx(makeJob({ status: "accepted", poster_confirmed_arrival_at: null }))} />),
    minControls: 3,
    primary: ["Confirm Arrival"],
  },
  {
    name: "Posts · In Progress, arrived (Confirm They Arrived + SOS · Message)",
    render: () => wrap(<InProgressStep {...posterCtx(makeJob({ poster_confirmed_arrival_at: null, poster_confirmed_working_at: null }))} />),
    minControls: 3,
    primary: ["Confirm They Arrived"],
  },
  {
    name: "Posts · In Progress, arrival confirmed (Confirm They're Working + SOS · Message)",
    render: () => wrap(<InProgressStep {...posterCtx(makeJob({ poster_confirmed_arrival_at: ago(5), poster_confirmed_working_at: null }))} />),
    minControls: 3,
    primary: ["Confirm They're Working"],
  },
  {
    name: "Posts · In Progress, start passed and nobody arrived (No-Show · Message)",
    render: () => wrap(<InProgressStep {...posterCtx(makeJob({ helper_on_the_way_at: null, helper_arrived_at: null, poster_confirmed_working_at: null }))} />),
    minControls: 2,
    primary: [],
  },
  {
    name: "Posts · In Progress, Helpr marked done (Message · Approve)",
    render: () => wrap(<InProgressStep {...posterCtx(makeJob({ poster_confirmed_arrival_at: ago(5), helper_completed_at: ago(1) }))} />),
    minControls: 2,
    primary: [],
  },
  {
    name: "Posts · Completed (Tip · Review · Hire Again)",
    render: () => wrap(<CompletedStep {...posterCtx(makeJob({ status: "completed", poster_completed_at: ago(1), helper_completed_at: ago(2), payment_status: "released" }))} />),
    minControls: 3,
    primary: [],
  },
  {
    name: "Posts · Disputed (Resolve & Pay + Escalate · Timeline · Message · Contact Admin)",
    render: () =>
      wrap(
        <DisputedStep
          {...posterCtx(makeJob({ status: "disputed", dispute_status: "open", disputed_by: POSTER, dispute_reason: "x", dispute_deadline: ahead(48) }))}
        />,
      ),
    minControls: 5,
    primary: ["Resolve & Pay"],
  },
];

/** Content, not the card's moves: the step rail's per-step timestamp tooltips,
 *  an open inline form, and dialogs. */
const isContent = (el: Element) =>
  !!el.closest('[role="group"][aria-label="Job progress"]') ||
  !!el.closest("[data-job-step-form]") ||
  !!el.closest('[role="dialog"]');

/** The buttons and links the card offers as moves. */
function actionControls(card: Element): HTMLElement[] {
  return [...card.querySelectorAll<HTMLElement>("button, a[href]")].filter((el) => !isContent(el));
}

describe("VN-21 — a step card's buttons are ONE row", () => {
  for (const c of CASES) {
    it(c.name, async () => {
      const { container } = c.render();
      await act(async () => { await Promise.resolve(); });
      await act(async () => { await Promise.resolve(); });

      const card = container.querySelector("[data-job-step]");
      expect(card, "no JobStepCard rendered — this state bypassed the shared shell").not.toBeNull();

      const controls = actionControls(card!);
      const labels = controls.map((b) => (b.getAttribute("aria-label") || b.textContent || "").trim());
      expect(
        controls.length,
        `expected at least ${c.minControls} controls, got [${labels.join(" | ")}] — the fixture no longer reaches this state`,
      ).toBeGreaterThanOrEqual(c.minControls);

      const rows = card!.querySelectorAll("[data-job-step-row]");
      expect(rows.length, `${rows.length} action rows on one card — [${labels.join(" | ")}]`).toBe(1);
      const row = rows[0] as HTMLElement;

      const outside = controls.filter((b) => !row.contains(b));
      expect(
        outside.map((b) => (b.getAttribute("aria-label") || b.textContent || "").trim()),
        "these controls render on their own row, outside the step's single action row",
      ).toEqual([]);

      // The primary LEADS the row, and it is the control this state is about.
      const primarySlot = row.firstElementChild as HTMLElement;
      expect(primarySlot.hasAttribute("data-job-step-primary"), "the row does not start with its primary slot").toBe(true);
      const primaryLabels = [...primarySlot.children].map((b) => (b.textContent || "").trim());
      expect(primaryLabels, "the row's primary").toEqual(c.primary);
      // The row may never wrap onto a second line.
      const cls = row.className.split(/\s+/);
      expect(cls, "the action row is not a flex row").toContain("flex");
      expect(cls, "the action row must not wrap").toContain("flex-nowrap");
      expect(cls.some((k) => k === "flex-wrap" || k.startsWith("grid")), "the action row can wrap").toBe(false);

      // At most ONE primary, and when there is one it is the row's primary slot.
      const glossy = [...card!.querySelectorAll<HTMLElement>("button.btn-grad-primary")].filter((b) => !isContent(b));
      expect(glossy.length, `primaries: [${glossy.map((b) => b.textContent?.trim()).join(" | ")}]`).toBeLessThanOrEqual(1);
      for (const g of glossy) {
        expect(g.closest("[data-job-step-primary]"), `${g.textContent?.trim()} is glossy but not the row's primary`).not.toBeNull();
      }
      // …and the primary IS the dark green one (owner: "primary action in the
      // dark green (btn primary)") — not a tint or an outline in the lead slot.
      if (c.primary.length > 0) {
        expect(
          (primarySlot.firstElementChild as HTMLElement).classList.contains("btn-grad-primary"),
          `the row's primary "${primaryLabels[0]}" does not wear btn-grad-primary`,
        ).toBe(true);
      }
    });
  }
});

describe("VN-21 — icon-only chips instead of a second row", () => {
  it("keeps labels while every chip has room for one", () => {
    // 1440: the row is ~1000px.
    expect(shouldCompactJobStepRow({ width: 1000, chips: 3, hasPrimary: true })).toBe(false);
    expect(shouldCompactJobStepRow({ width: 1000, chips: 4, hasPrimary: true })).toBe(false);
    // 375: the row is ~311px. Primary + 2 chips still fits labels…
    expect(shouldCompactJobStepRow({ width: 311, chips: 2, hasPrimary: true })).toBe(false);
    // …and 3–4 chips with no primary do too (Open: Share · Boost · Edit · Cancel).
    expect(shouldCompactJobStepRow({ width: 311, chips: 4, hasPrimary: false })).toBe(false);
  });

  it("drops chips to icon-only when 3–4 buttons would squeeze a label at 375 and 320", () => {
    // 375: primary + 3 chips (Confirmed, On the Way).
    expect(shouldCompactJobStepRow({ width: 311, chips: 3, hasPrimary: true })).toBe(true);
    // 375: primary + 4 chips (poster Disputed).
    expect(shouldCompactJobStepRow({ width: 311, chips: 4, hasPrimary: true })).toBe(true);
    // 320: primary + 2 chips.
    expect(shouldCompactJobStepRow({ width: 256, chips: 2, hasPrimary: true })).toBe(true);
  });

  it("never compacts an unmeasured row or a lone button", () => {
    expect(shouldCompactJobStepRow({ width: 0, chips: 4, hasPrimary: true })).toBe(false);
    expect(shouldCompactJobStepRow({ width: 200, chips: 1, hasPrimary: false })).toBe(false);
    expect(shouldCompactJobStepRow({ width: 200, chips: 0, hasPrimary: true })).toBe(false);
  });

  it("the shell measures its row and marks it compact, so CSS hides chip labels (not the primary's)", async () => {
    const widthSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const w = this.hasAttribute("data-job-step-row") ? 311 : 0;
      return { width: w, height: 0, top: 0, left: 0, right: w, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    });
    try {
      const { container } = active(makeJob({ helper_arrived_at: null, poster_confirmed_working_at: null }), "on_the_way")();
      await act(async () => { await Promise.resolve(); });
      await act(async () => { await Promise.resolve(); });
      const row = container.querySelector<HTMLElement>("[data-job-step-row]")!;
      expect(row.getAttribute("data-has-primary")).toBe("true");
      expect(row.getAttribute("data-compact"), "4 buttons in 311px must drop the chips to icon-only").toBe("true");
      // The label is still the chip's accessible name — only its paint is hidden.
      const chips = [...row.children].filter((ch) => !ch.hasAttribute("data-job-step-primary"));
      expect(chips.length).toBe(3);
      for (const chip of chips) {
        expect((chip.getAttribute("aria-label") || chip.textContent || "").trim(), "an icon-only chip with no name").not.toBe("");
      }
    } finally {
      widthSpy.mockRestore();
    }
  });
});

describe("VN-21 — a nested CTA replaces the step's own primary", () => {
  it("renders the step's primary only while nothing has claimed the slot", async () => {
    const { rerender, container } = render(
      <JobStepCard side="helper" step="t" primary={<button type="button">Fallback</button>} actions={[<button key="m" type="button">Message</button>]} />,
    );
    await act(async () => { await Promise.resolve(); });
    const slot = () => container.querySelector("[data-job-step-primary]")!;
    expect([...slot().children].map((b) => b.textContent)).toEqual(["Fallback"]);

    rerender(
      <JobStepCard
        side="helper"
        step="t"
        header={<JobStepRowSlot slot="primary"><button type="button">Tracker CTA</button></JobStepRowSlot>}
        primary={<button type="button">Fallback</button>}
        actions={[<button key="m" type="button">Message</button>]}
      />,
    );
    await act(async () => { await Promise.resolve(); });
    expect([...slot().children].map((b) => b.textContent), "two primaries in one row").toEqual(["Tracker CTA"]);
  });

  it("renders a slot in place when there is no step card around it", () => {
    const { container } = render(<JobStepRowSlot slot="primary"><button type="button">Standalone</button></JobStepRowSlot>);
    expect(container.textContent).toBe("Standalone");
  });
});
