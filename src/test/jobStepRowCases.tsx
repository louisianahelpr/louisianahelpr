 
/**
 * THE JOB STEP ROW'S REAL CONTROL INVENTORY — shared fixture, not a spec.
 *
 * `src/test/jobStepRowWidthFloor.test.tsx` (is any control narrower than its
 * own label?) and `src/test/jobStepRowLabelsVisible.test.tsx` (does every chip
 * the row draws still SHOW its label?) are two questions about one row, and
 * they have to be asked of the SAME states or one of them is answering about a
 * surface the other never saw. That is how a poster-side defect shipped the
 * same week a helper-side guard went green.
 *
 * It is NOT matched by vitest's `include` (`src/**\/*.{test,spec}.{ts,tsx}`),
 * so it never runs as a spec of its own. Each importer registers its OWN
 * `vi.mock` calls — mock factories are hoisted per test FILE and cannot reach
 * an import — and this module's components pick them up because the importer's
 * registry is already in place by the time it loads.
 */
import { vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
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
import { jobLocalDateISO } from "./helpers/jobLocalDate";
/* THIS MODULE IMPORTS NOTHING FROM `jobStepRow` ON PURPOSE. It is the
   INVENTORY and the stated character model — the thing the allocator is
   measured AGAINST. A fixture that imported the constants it then handed to
   the assertions would be the "registry checked against itself" shape: lower
   `ROW_CONTROL_MIN_PX` and every number here would move with it. The specs
   import the module; this file states the world. */

/** jsdom implements neither; every card under test scrolls something. Call
 *  from the importer's `beforeAll`. */
export function prepareStepCardDom() {
  Element.prototype.scrollTo = Element.prototype.scrollTo ?? (() => {});
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
}

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
export const ROW_PX: Record<string, number> = { "320": 212, "375": 262, "414": 301, "1440": 1035 };

/**
 * 414 IS DERIVED, NOT MEASURED, AND SAYS SO. The two measured pairs give the
 * page+card+step chrome around the row as 320−212 = 108px and 375−262 = 113px;
 * 414 uses the LARGER of the two (414 − 113 = 301), which makes this guard
 * stricter rather than more forgiving. It is in the set because 414 is where
 * the owner's second report starts ("at 414px and below, every NON-PRIMARY
 * label is clipped to `clip: rect(0,0,0,0)`"), so a guard that stopped at 375
 * would not have been standing where the defect was seen. The browser pass
 * that follows this change is what turns 301 into a measured number.
 */
export const DERIVED_WIDTHS = new Set(["414"]);

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
export const TAP_TARGET_PX = 44;

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
export function glyphPx(ch: string): number {
  if (NARROW.includes(ch)) return 3.2;
  if (WIDE.includes(ch)) return 8.8;
  if (ch === " ") return 3.0;
  if (ch >= "A" && ch <= "Z") return 7.0;
  return 6.0;
}
/** The widest single WORD, because a word is what cannot wrap. Plus the
 *  control's `px-1` each side, its 0.5px border and a pixel of rounding — the
 *  same +12 the shell's own `chipNeedPx` / `primaryWordNeeds` add. */
export function controlNeedPx(text: string): number {
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
// The job's day in AMERICA/CHICAGO, the zone every clock gate on these cards
// resolves in (`jobLocalStartMs` / `todayMs()` / `completionStalled`). These
// were `.toISOString().slice(0, 10)` — the UTC day — which after 19:00 Pacific
// names the NEXT Central day, so a "yesterday" fixture was really today and a
// "today" fixture was really tomorrow. Eight specs went red on that on
// 2026-09-19 with the product entirely correct; see
// src/test/helpers/jobLocalDate.ts.
const YESTERDAY = jobLocalDateISO(-1);
const TODAY = jobLocalDateISO(0);

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

export interface Case {
  name: string;
  side: "helper" | "poster";
  render: () => ReturnType<typeof render>;
  /** Per-case floor: a fixture that has stopped reaching its state cannot pass
   *  this guard on an empty row. */
  minControls: number;
}

export const CASES: Case[] = [
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
    /* ONE CONTROL IN THE PRIMARY SLOT AGAIN, 2026-09-19.
       This case existed because the slot held TWO — JobTracking rendered
       `retryEl` and `ctaEl` as two children of a single
       `JobStepRowSlot slot="primary"`, measured at 320 on prod at 29px and
       27px with 19px and 21px of label hanging outside them. That is the
       overflow this whole file measures, and it was the worst instance of it.

       The owner removed the retry chip and gave the job to the pull-to-refresh
       gesture (src/lib/arrivalRefresh.ts), so the slot is back to one control.
       The case is KEPT rather than deleted: it is still a reachable state, its
       labels still have to fit their controls, and `primaryNeeds` still takes
       an array because the day-of confirmation can put a second control in
       this slot through its own `JobStepRowSlot`. Only the count moved. */
    name: "Jobs · Arrived, unverified — Start Working (retry chip removed)",
    side: "helper",
    render: active(makeJob({ poster_confirmed_working_at: null }), "arrived"),
    minControls: 3,
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
export function visibleLabel(el: Element): string {
  const span = [...el.querySelectorAll("span")].find(
    (s) => (s.textContent || "").trim() && !s.classList.contains("sr-only"),
  );
  return ((span ?? el).textContent || "").trim().replace(/\s+/g, " ");
}

export interface RowInventory {
  chipLabels: string[];
  primaryLabels: string[];
}

export function readRow(container: Element): RowInventory {
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
export function stepFilesFromSource(): { helper: string[]; poster: string[] } {
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

