import { describe, it, expect, vi, beforeAll } from "vitest";
import { act, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * NO CONTROL IN A JOB STEP ROW IS NARROWER THAN ITS OWN LABEL — AT 320.
 *
 * ── WHAT SHIPPED, AND WHY EVERY GREEN GUARD MISSED IT ──────────────────────
 * Measured on PROD on 2026-09-19 at 320px, in Chromium and WebKit identically
 * (so it is layout arithmetic, not an engine bug):
 *
 *   helper `disputed`  "Withdraw Dispute"  w=12px, 43px of label on the card
 *   poster `disputed`  "Resolve & Pay"     w=12px, 31px of label on the card
 *
 * The second one releases escrow.
 *
 * Every existing guard on this row measures something other than WIDTH:
 * `jobRowControlSameness` compares the controls' type/stack/radius tokens to
 * each other (they were identically wrong), `jobStepOneRow` asserts nothing
 * lands outside the row (nothing did — the LABEL left, not the control),
 * `index.css` floors `min-height: 44px` and floors nothing on width, and the
 * one arithmetic test that existed asserted `primaryRoomAfterCompaction` from
 * a row width of 256px that was stated in a comment and never measured. The
 * row is 212px. That is the whole bug: a wrong number in a doc block, checked
 * against itself.
 *
 * ── THIS IS A MATHS CHECK, AND HERE IS WHAT IT THEREFORE CANNOT CATCH ──────
 * jsdom lays nothing out: `getBoundingClientRect()` is 0 for every element and
 * `getComputedStyle` resolves no font, so the shell's real measurement path
 * (`longestWordPx`, an off-screen probe span) returns 0 here and a rendered
 * width cannot be read at all. So this guard asserts the ALLOCATION — the
 * exported `allocateJobStepRow` / `primaryRoomAfterCompaction` arithmetic the
 * shell and `index.css` between them carry out — against:
 *
 *   • the real control INVENTORY of every row state, taken from an actual
 *     render of both cards (how many chips, how many controls in the primary
 *     slot, and each one's visible label);
 *   • the three row widths MEASURED on prod (see ROW_PX);
 *   • a stated character model for 11px label type (see glyphPx).
 *
 * It therefore CANNOT catch: a font change that makes the real words wider
 * than the model; a CSS change that stops `index.css` implementing this
 * arithmetic (the flex bases, the gap, the compact rung); a control whose
 * label is set from data rather than a literal; or anything about how the row
 * LOOKS. Those need the browser. What it does catch is the class that shipped:
 * a row asked to hold more controls than its width can hold, resolving that by
 * making one of them too small to read.
 *
 * Both sides are exercised, deliberately. A sibling defect shipped the same
 * week because a guard drove the helper's card and not the poster's, and the
 * poster's is where the money control lives.
 */

// PROOF THIS GUARD CAN FAIL (npm run vacuity). Both mutations restore a state
// this app has actually been in, and neither is satisfiable by a comment:
//   1. `if (false)` is EXACTLY the shipped behaviour — the row renders every
//      chip the step asked for, whatever the width, which is what put a 12px
//      primary on prod. The guard must go red on the disputed rows at 320.
//   2. 12px is the width that shipped; dropping the tap floor to it makes the
//      allocator hand out slivers again.
// @mutate src/components/activity/jobStepRow.tsx | if (chips > capacity) { | if (false) {
// @mutate src/components/activity/jobStepRow.tsx | export const ROW_CONTROL_MIN_PX = 44; | export const ROW_CONTROL_MIN_PX = 12;

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }));
vi.mock("@/lib/haptics", () => ({
  hapticLight: vi.fn(), hapticError: vi.fn(), hapticSuccess: vi.fn(),
  hapticMedium: vi.fn(), hapticSelection: vi.fn(), hapticWarning: vi.fn(),
}));
vi.mock("@/components/PhotoProof", async (orig) => {
  const actual = await orig<typeof import("@/components/PhotoProof")>();
  return {
    ...actual,
    PhotoProofGroup: () => <div data-testid="photo-proof" />,
    PhotoProofStep: ({ title }: { title: string }) => <div data-testid="photo-proof-step">{title}</div>,
    PhotoProofDialog: () => null,
    PhotoProofRequirementNote: () => null,
  };
});

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
      storage: { from: vi.fn(() => ({ upload: vi.fn(), getPublicUrl: vi.fn(() => ({ data: { publicUrl: "" } })) })) },
    },
  };
}
vi.mock("@/integrations/supabase/client", () => makeSupabase());

import type { AppliedApp, Job } from "@/components/activity/activityConstants";
import type { PosterStepCtx } from "@/components/activity/postedJobCard/steps/posterStepContract";
import { ActiveJobSection } from "@/components/activity/appliedJobCard/ActiveJobSection";
import { ConfirmedSection } from "@/components/activity/appliedJobCard/ConfirmedSection";
import { DisputedSection } from "@/components/activity/appliedJobCard/DisputedSection";
import { InProgressStep } from "@/components/activity/postedJobCard/steps/InProgressStep";
import { ScheduledStep } from "@/components/activity/postedJobCard/steps/ScheduledStep";
import { OpenStep } from "@/components/activity/postedJobCard/steps/OpenStep";
import { CompletedStep } from "@/components/activity/postedJobCard/steps/CompletedStep";
import { DisputedStep } from "@/components/activity/postedJobCard/steps/DisputedStep";
import {
  allocateJobStepRow,
  shouldCompactJobStepRow,
  primaryControlFloorPx,
  ROW_CONTROL_MIN_PX,
  JOB_STEP_ROW_GAP_PX,
  LABELLED_CHIP_MIN_PX,
} from "@/components/activity/jobStepRow";

beforeAll(() => {
  Element.prototype.scrollTo = Element.prototype.scrollTo ?? (() => {});
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
});

// ── THE ROW'S REAL WIDTH, AT THE THREE WIDTHS THAT MATTER ───────────────────
/**
 * `[data-job-step-row]`'s own `getBoundingClientRect().width`, NOT the
 * viewport's. The difference is 108-113px of page, card and step padding, and
 * assuming the viewport is what put a false "~56px" in the shell's doc block.
 *
 *   320  212px  measured on prod, both engines, 2026-09-19
 *                (row-A3-disputed-320.png / A4-poster-disputed-320.png:
 *                 4 icon chips + primary → 212 − 4×44 − 4×6 = 12px, and 12px
 *                 is exactly what both screenshots show).
 *   375  262px  back-computed from the same pass's verified-good 4-chip
 *                compact row, whose primary measured 62px:
 *                62 + 4×44 + 4×6 = 262.
 *   1440 1035px back-computed from the verified-good 5-up LABELLED row, whose
 *                primary measured 337px: shares = 4 chips + 2, items = 5, so
 *                337 = 2 × (1035 − 4×6) / 6.
 *
 * The 320 and 375 numbers imply 5px more chrome at 375 than at 320. That is
 * taken as measured rather than smoothed: each is the width its own screenshot
 * was measured at, and 262 is the tighter of the two candidates at 375, so
 * using it makes this guard stricter rather than more forgiving.
 */
const ROW_PX: Record<string, number> = { "320": 212, "375": 262, "1440": 1035 };

/**
 * THE TAP TARGET, STATED HERE AND NOT IMPORTED — 44pt, Apple HIG, the same
 * number `index.css` has floored `min-height` at since the app existed.
 *
 * Importing `ROW_CONTROL_MIN_PX` and then asserting against it would make this
 * guard its own oracle: the day someone lowers the constant, every assertion
 * lowers with it and the file stays green. (`npm run vacuity` caught exactly
 * that — the `44 → 12` mutation SURVIVED the first draft of this file.) So the
 * number is written out here, `index.css`'s own declaration is read off disk as
 * the external witness, and the module's constant is checked against both.
 */
const TAP_TARGET_PX = 44;

// ── THE 11px LABEL TYPE, AS A MODEL ─────────────────────────────────────────
/**
 * jsdom resolves no font, so the shell's real probe (`longestWordPx`) measures
 * 0 here. This is a deliberately coarse stand-in for `text-ds-11` in the app's
 * sans stack, calibrated against the one hard data point the prod pass gave
 * us: "Withdraw Dispute" wrapped to "Withdraw", and its label needed ~55px in
 * the 12px box it was given (12 + 43px of overflow). The model puts "Withdraw"
 * at 45px plus the control's 12px of padding and hairline = 57px.
 *
 * It is an approximation and is allowed to be: a floor that is a few px
 * generous fails EARLIER than reality, never later, which is the safe
 * direction for a guard about things being too small.
 */
const NARROW = "ijltfrI.,'!|:;()[]";
const WIDE = "mwMW@";
function glyphPx(ch: string): number {
  if (NARROW.includes(ch)) return 3.2;
  if (WIDE.includes(ch)) return 8.8;
  if (ch === " ") return 3.0;
  if (ch >= "A" && ch <= "Z") return 7.0;
  return 6.0;
}
/** The widest single WORD, because a word is what cannot wrap. Plus the
 *  control's `px-1` each side, its 0.5px border and a pixel of rounding — the
 *  same +12 the shell's own `chipNeedPx` / `primaryWordNeeds` add. */
function controlNeedPx(text: string): number {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  return Math.max(...words.map((w) => [...w].reduce((a, ch) => a + glyphPx(ch), 0))) + 12;
}

// ── FIXTURES (the same states jobRowControlSameness drives) ─────────────────

const HELPER = "helper-1";
const POSTER = "poster-1";
const NOW = Date.now();
const ago = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const ahead = (h: number) => new Date(NOW + h * 3_600_000).toISOString();
const YESTERDAY = new Date(NOW - 24 * 3_600_000).toISOString().slice(0, 10);
const TODAY = new Date(NOW).toISOString().slice(0, 10);

function jobClock(h: number): { date: string; time: string } {
  const at = new Date(NOW + h * 3_600_000);
  return {
    date: at.toLocaleDateString("en-CA", { timeZone: "America/Chicago" }),
    time: at.toLocaleTimeString("en-GB", { timeZone: "America/Chicago", hour: "2-digit", minute: "2-digit" }),
  };
}
const STARTS_SOON = jobClock(1);

type J = Job & { revision_note?: string | null };

/** Both halves of the VN-33 arrival rule, so the tracker offers its next step
 *  rather than the legacy retry. */
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

const disputedHelper = (job: J) => () =>
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

interface Case {
  name: string;
  side: "helper" | "poster";
  render: () => ReturnType<typeof render>;
  /** Per-case floor: a fixture that has stopped reaching its state cannot pass
   *  this guard on an empty row. */
  minControls: number;
}

const CASES: Case[] = [
  {
    name: "Jobs · Confirmed — Directions · Message · Cancel Job + I'm On My Way",
    side: "helper",
    render: () =>
      wrap(
        <ConfirmedSection
          app={makeApp(makeJob({}))}
          job={makeJob({
            status: "accepted", date_needed: STARTS_SOON.date, start_time: STARTS_SOON.time,
            helper_on_the_way_at: null, helper_arrived_at: null, poster_confirmed_working_at: null,
          })}
          userId={HELPER}
          initialTracking={tracking("job_confirmed")}
          navigate={vi.fn()}
        />,
      ),
    minControls: 4,
  },
  {
    // TWO CONTROLS IN THE ONE PRIMARY SLOT, arriving through two SEPARATE
    // `JobStepRowSlot`s: JobTracking's next-step CTA and JobConfirmation's
    // "I'm Still On".
    name: "Jobs · Confirmed, day-of confirmation owed — I'm On My Way + I'm Still On",
    side: "helper",
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
  },
  {
    name: "Jobs · On the Way — Directions · Message · Report a Problem + I've Arrived",
    side: "helper",
    render: active(makeJob({ helper_arrived_at: null, poster_confirmed_working_at: null }), "on_the_way"),
    minControls: 4,
  },
  {
    // TWO CONTROLS IN THE ONE PRIMARY SLOT, arriving through ONE slot:
    // JobTracking renders `retryEl` and `ctaEl` as two children of a single
    // `JobStepRowSlot slot="primary"`. Measured at 320 on prod: 29px and 27px,
    // with 19px and 21px of label outside them.
    name: "Jobs · Arrived, unverified — Try My Location Again + Start Working",
    side: "helper",
    render: active(makeJob({ poster_confirmed_working_at: null }), "arrived"),
    minControls: 4,
  },
  {
    name: "Jobs · On site, before photo owed",
    side: "helper",
    render: active(makeJob({ ...VERIFIED, proof_before_urls: [], poster_confirmed_working_at: null }), "arrived"),
    minControls: 3,
  },
  {
    name: "Jobs · Working, after photo owed",
    side: "helper",
    render: active(makeJob({ ...VERIFIED, proof_after_urls: [] }), "working"),
    minControls: 3,
  },
  {
    name: "Jobs · Working — Mark Job Complete + Message · Report a Problem",
    side: "helper",
    render: active(makeJob({ ...VERIFIED }), "working"),
    minControls: 3,
  },
  {
    name: "Jobs · Revision — I'll Fix It + Message",
    side: "helper",
    render: active(
      makeJob({
        status: "revision_requested", helper_completed_at: ago(5), revision_requested_at: ago(3),
        revision_deadline: ahead(60), revision_note: "The back gate area was missed.",
      }),
      "working",
    ),
    minControls: 3,
  },
  {
    name: "Jobs · Disputed by the Helpr — Withdraw Dispute + Timeline · Message · Contact Admin",
    side: "helper",
    render: disputedHelper(makeJob({ status: "disputed", dispute_status: "open", disputed_by: HELPER, dispute_reason: "x" })),
    minControls: 4,
  },
  {
    // THE 12px SCREENSHOT, HELPER SIDE — the evidence capture chip joins the
    // row (owner, 2026-09-19) and makes it 5-up. `proof_after_urls: []` is
    // what keeps HelperPhotoAsk rendering.
    name: "Jobs · Disputed, evidence still owed — FIVE controls",
    side: "helper",
    render: disputedHelper(
      makeJob({
        status: "disputed", dispute_status: "open", disputed_by: HELPER, dispute_reason: "x",
        proof_after_urls: [],
      }),
    ),
    minControls: 5,
  },
  {
    name: "Posts · Open — Share · Boost · Edit · Cancel",
    side: "poster",
    render: () => wrap(<OpenStep {...posterCtx(makeJob({ status: "open", helper_id: null }))} />),
    minControls: 4,
  },
  {
    name: "Posts · Scheduled — Message · Cancel + Confirm Arrival",
    side: "poster",
    render: () => wrap(<ScheduledStep {...posterCtx(makeJob({ status: "accepted", poster_confirmed_arrival_at: null }))} />),
    minControls: 3,
  },
  {
    name: "Posts · In Progress — SOS · Message + Confirm They're Working",
    side: "poster",
    render: () => wrap(<InProgressStep {...posterCtx(makeJob({ poster_confirmed_arrival_at: ago(5), poster_confirmed_working_at: null }))} />),
    minControls: 3,
  },
  {
    name: "Posts · In Progress, both vouches in — disabled Working Confirmed",
    side: "poster",
    render: () => wrap(<InProgressStep {...posterCtx(makeJob({ date_needed: TODAY, poster_confirmed_arrival_at: ago(6), poster_confirmed_working_at: ago(5) }))} />),
    minControls: 3,
  },
  {
    name: "Posts · Completed — Tip · Review · Hire Again · Re-Post",
    side: "poster",
    render: () => wrap(<CompletedStep {...posterCtx(makeJob({ status: "completed", poster_completed_at: ago(1), helper_completed_at: ago(2), payment_status: "released" }))} />),
    minControls: 3,
  },
  {
    // THE 12px SCREENSHOT, POSTER SIDE — and the widest row in the app:
    // Escalate · Photos · Timeline · Message · Contact Admin + Resolve & Pay.
    // Its primary RELEASES ESCROW. This is the case a one-sided guard misses.
    name: "Posts · Disputed — FIVE chips + Resolve & Pay",
    side: "poster",
    render: () =>
      wrap(
        <DisputedStep
          {...posterCtx(makeJob({ status: "disputed", dispute_status: "open", disputed_by: POSTER, dispute_reason: "x", dispute_deadline: ahead(48) }))}
        />,
      ),
    minControls: 5,
  },
];

// ── READING THE ROW ─────────────────────────────────────────────────────────

/** The text a reader sees on the control — the label span if it has one (the
 *  row's controls all do), else the button's own text. Never the aria-label:
 *  that is the spoken name and is deliberately longer. */
function visibleLabel(el: Element): string {
  const span = [...el.querySelectorAll("span")].find(
    (s) => (s.textContent || "").trim() && !s.classList.contains("sr-only"),
  );
  return ((span ?? el).textContent || "").trim().replace(/\s+/g, " ");
}

interface RowInventory {
  chipLabels: string[];
  primaryLabels: string[];
}

function readRow(container: Element): RowInventory {
  const row = container.querySelector("[data-job-step-row]");
  if (!row) return { chipLabels: [], primaryLabels: [] };
  const host = row.querySelector<HTMLElement>(":scope > [data-job-step-primary]");
  const chips = [...row.children].filter((c) => c !== host);
  return {
    // A chip element can itself wrap its control (DirectionsButton, the SOS
    // share chip): take the innermost control's label, else the child's own.
    chipLabels: chips.map((c) => visibleLabel(c.querySelector("button, a[href]") ?? c)),
    primaryLabels: host ? [...host.children].map((c) => visibleLabel(c)) : [],
  };
}

// ── THE DERIVED INVENTORY (floor #2) ────────────────────────────────────────

const ROOT = resolve(__dirname, "../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx") && !p.includes(".test.")) out.push(p);
  }
  return out;
}

/**
 * Every STEP FILE that draws a job step card, read out of the tree. A new step
 * whose row nothing in CASES exercises fails the floor below rather than being
 * silently exempt — which is how the poster's half of a two-sided marketplace
 * goes unchecked.
 */
function stepFilesFromSource(): { helper: string[]; poster: string[] } {
  const files = walk(join(ROOT, "src/components/activity"));
  const helper: string[] = [];
  const poster: string[] = [];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    const m = src.match(/side=\{?["']?(helper|poster)["']?\}?/);
    if (!m || !/<JobStepCard\b/.test(src)) continue;
    (m[1] === "helper" ? helper : poster).push(f.slice(ROOT.length + 1));
  }
  return { helper, poster };
}

// ── THE GUARD ───────────────────────────────────────────────────────────────

describe("every control in a job step row is at least as wide as its own label", () => {
  it("the inventory is not empty, and it has BOTH sides", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(13);
    expect(CASES.filter((c) => c.side === "helper").length).toBeGreaterThanOrEqual(5);
    expect(CASES.filter((c) => c.side === "poster").length).toBeGreaterThanOrEqual(5);
    // …and the widest rows, which are where a shape that works at 3-up falls
    // over. One on each side: the helper's disputed row with the evidence
    // capture, and the poster's disputed row whose primary releases escrow.
    expect(CASES.filter((c) => c.minControls >= 5).length).toBeGreaterThanOrEqual(2);

    const steps = stepFilesFromSource();
    expect(steps.helper.length, "no helper step files found — the source scan has drifted").toBeGreaterThan(1);
    expect(steps.poster.length, "no poster step files found — the source scan has drifted").toBeGreaterThan(2);
    expect(Object.keys(ROW_PX).length).toBe(3);
  });

  it("the 44px floor is the app's own, and the row module has not quietly lowered it", () => {
    // THE EXTERNAL WITNESS. `index.css` floors every button's HEIGHT at 44px
    // (Apple HIG 44pt) and floors nothing on the width — the hole this guard
    // exists for. Read off disk rather than imported, so the row module cannot
    // move the number and take this file's assertions with it.
    const css = readFileSync(join(ROOT, "src/index.css"), "utf8");
    const heightFloors = [...css.matchAll(/min-height:\s*(\d+)px/g)].map((m) => Number(m[1]));
    expect(heightFloors.length, "index.css declares no min-height floor at all").toBeGreaterThan(0);
    expect(heightFloors, "index.css no longer floors a control at 44px").toContain(TAP_TARGET_PX);
    // …and the same 44 is now floored on WIDTH, which is what shipped missing.
    const widthFloors = [...css.matchAll(/min-width:\s*(\d+)px/g)].map((m) => Number(m[1]));
    expect(widthFloors, "index.css floors no control WIDTH — the 12px hole is open again").toContain(TAP_TARGET_PX);
    // The row's own constant must BE that number, not merely be consulted.
    expect(ROW_CONTROL_MIN_PX, "the row module lowered the tap target").toBe(TAP_TARGET_PX);
  });

  /** Everything this guard asserts about one state at one width. */
  function check(where: string, inv: RowInventory, width: number) {
    const chips = inv.chipLabels.length;
    const primaryNeeds = inv.primaryLabels.map(controlNeedPx);
    const chipNeed = chips
      ? Math.max(...inv.chipLabels.map(controlNeedPx))
      : LABELLED_CHIP_MIN_PX;
    const compact = shouldCompactJobStepRow({
      width,
      chips,
      hasPrimary: primaryNeeds.length > 0,
      chipNeedPx: chipNeed,
      // The compaction decision uses the SOFTER two-line need; approximate it
      // the way the shell does — the whole label over two lines, never below
      // its longest word.
      primaryNeedPx: inv.primaryLabels.reduce(
        (sum, l, i) =>
          sum +
          Math.max(controlNeedPx(l), [...l].reduce((a, ch) => a + glyphPx(ch), 0) / 2 + 24) +
          (i ? JOB_STEP_ROW_GAP_PX : 0),
        0,
      ),
    });
    const alloc = allocateJobStepRow({ width, chips, compact, primaryNeeds });

    // 1. NOTHING IS LOST. Every chip the step asked for is either in the row
    //    or in the overflow control.
    expect(
      alloc.visibleChips + alloc.overflowChips,
      `${where}: chips went missing (${alloc.visibleChips} shown + ${alloc.overflowChips} overflowed ≠ ${chips} asked for)`,
    ).toBe(chips);

    // 2. THE ROW IS NEVER DEGENERATE. If the step wants chips, at least one
    //    chip slot is drawn — an overflow control with nowhere to live would
    //    make its contents unreachable.
    if (chips > 0) {
      expect(alloc.chipSlots, `${where}: the row has no room for even one chip slot`).toBeGreaterThanOrEqual(1);
    }

    // 3. EVERY CHIP CLEARS THE TAP TARGET, IN WIDTH.
    if (alloc.chipSlots > 0) {
      expect(
        Math.round(alloc.chipPx * 10) / 10,
        `${where}: chips get ${alloc.chipPx.toFixed(1)}px, under the ${TAP_TARGET_PX}px tap target`,
      ).toBeGreaterThanOrEqual(TAP_TARGET_PX);
    }

    // 4. EVERY CONTROL IN THE PRIMARY SLOT CLEARS THE TAP TARGET **AND** ITS
    //    OWN LONGEST WORD. This is the assertion that shipped 12px.
    for (const label of inv.primaryLabels) {
      // `Math.max` with the LOCAL 44, not just whatever `primaryControlFloorPx`
      // decides — see TAP_TARGET_PX for why the oracle is not imported.
      const floor = Math.max(TAP_TARGET_PX, primaryControlFloorPx(controlNeedPx(label)));
      expect(
        Math.round(alloc.perPrimaryPx * 10) / 10,
        `${where}: "${label}" gets ${alloc.perPrimaryPx.toFixed(1)}px but needs ${floor.toFixed(1)}px ` +
          `(row ${width}px, ${chips} chips asked for, ${alloc.chipSlots} chip slots drawn, compact=${compact})`,
      ).toBeGreaterThanOrEqual(floor);
    }

    // 5. AND IT ALL FITS — the row never wraps, so anything over the row's
    //    width is a control painting outside the card.
    const used =
      alloc.chipSlots * alloc.chipPx +
      alloc.primaryPx +
      JOB_STEP_ROW_GAP_PX * Math.max(0, alloc.chipSlots + (primaryNeeds.length ? 1 : 0) - 1);
    expect(
      Math.round(used * 10) / 10,
      `${where}: the row lays out ${used.toFixed(1)}px of controls in ${width}px`,
    ).toBeLessThanOrEqual(width + 0.5);
  }

  for (const c of CASES) {
    it(`${c.side} · ${c.name}`, async () => {
      const { container } = c.render();
      await act(async () => { await Promise.resolve(); });
      await act(async () => { await Promise.resolve(); });

      const row = container.querySelector("[data-job-step-row]");
      expect(row, "this state renders no job step row").not.toBeNull();
      // The card says whose it is, so a case cannot quietly drift to the other
      // side of the marketplace and still look covered.
      expect(
        container.querySelector("[data-job-step]")?.getAttribute("data-job-step") ?? "",
        "this row is not on the side the case claims",
      ).toMatch(new RegExp(`^${c.side}:`));

      const inv = readRow(container);
      const controls = inv.chipLabels.length + inv.primaryLabels.length;
      expect(
        controls,
        `expected at least ${c.minControls} controls, got [${[...inv.chipLabels, ...inv.primaryLabels].join(" | ")}]`,
      ).toBeGreaterThanOrEqual(c.minControls);
      // Every control has a readable label, or "its longest word" is vacuous.
      for (const l of [...inv.chipLabels, ...inv.primaryLabels]) {
        expect(l.length, `a control in this row has no visible label`).toBeGreaterThan(0);
      }

      for (const [w, rowPx] of Object.entries(ROW_PX)) {
        check(`${c.side}:${c.name} @${w}`, inv, rowPx);
      }
    });
  }
});
