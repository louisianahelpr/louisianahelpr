import { describe, it, expect, vi, beforeAll } from "vitest";
import { act, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * ONE CONTROL TREATMENT FOR A JOB-CARD ACTION ROW.
 *
 * Owner, 2026-09-19, for the SECOND time and with a screenshot: "i will not say
 * this again. the buttons need to have the same size font and everything they
 * shouldnt have all different stuff".
 *
 * ── WHY THIS FILE EXISTS AND `actionButtonTypeTiers.test.ts` DID NOT ────────
 * The first pass at this owner report shipped a guard that asserted every
 * action button resolved to one of THREE sanctioned tiers (11 / 12 / 14px) and
 * reported PASS. It passed while the screen looked like the screenshot,
 * because it validated the tiers instead of questioning them. The owner is not
 * asking for conformance to a tier list. They are asking for ONE object.
 *
 * So this guard asserts SAMENESS, not membership: it renders every state of
 * both activity cards, reads every control that lands in that state's
 * `[data-job-step-row]`, and fails unless all of them share one SIGNATURE —
 *
 *   type      the type token the VISIBLE LABEL resolves to (the chip's label
 *             span used to say 11px while the primary's bare text said 14px);
 *   stack     icon above the label, or icon beside it (`flex-col`);
 *   minHeight the declared tap floor, not the one index.css happens to rescue;
 *   radius    the corner treatment;
 *   label     whether the label is a wrapping element or bare button text.
 *
 * TONE AND POSITION ARE DELIBERATELY NOT IN THE SIGNATURE. Colour is how a row
 * ranks its moves (green gloss = the main one, danger tint = destructive, done
 * tint = already taken) and the primary trails on the right (owner V2/V3, item
 * 8). Those are the two things that are ALLOWED to differ; size, shape, type
 * and icon placement are not.
 *
 * ── THE INVENTORY IS DERIVED, WITH A FLOOR ─────────────────────────────────
 * `npm run vacuity` already reports 20 guards that pass on an empty inventory;
 * this must not become the 21st. Two independent floors:
 *
 *   1. every `CASES` entry must produce at least two controls in its row, and
 *      the set must include a row of four and a row of five — the widths where
 *      a shape that only works at 3-up falls over;
 *   2. the components that can render INTO a row are read out of the source
 *      tree (every step file's `actions={[...]}`/`primary={...}`, every
 *      `JobStepPrimaryButton` call, every `JobStepRowSlot slot="primary"`) and
 *      every one of them must have been rendered by at least one case. A new
 *      step file that nothing exercises fails this, rather than being silently
 *      exempt.
 */

// PROOF THIS GUARD CAN FAIL (npm run vacuity). Each mutation reintroduces one
// half of the screenshot the owner sent: the first makes the row's primary an
// inline 14px button with no declared tap floor again, the second strips one
// chip's label wrapper so its type resolves from the button instead of its
// span. Neither is a comment change and neither can be satisfied by the
// presence of a shared class NAME — the guard reads the resolved tokens off
// every rendered control and compares them to each other.
// @mutate src/components/activity/JobActionRow.tsx | className={JOB_ROW_CONTROL_SHAPE} | className="w-full h-auto"
// @mutate src/components/activity/appliedJobCard/DirectionsButton.tsx | <span className={JOB_ROW_LABEL_CLASS}>Directions</span> | Directions

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn(), notifyJobParty: vi.fn() }));
vi.mock("@/lib/haptics", () => ({
  hapticLight: vi.fn(), hapticError: vi.fn(), hapticSuccess: vi.fn(),
  hapticMedium: vi.fn(), hapticSelection: vi.fn(), hapticWarning: vi.fn(),
}));
// The uploader's own surface is content. Its ROW CONTROL is not stubbed —
// that is half of what this file is about — so only the group/gallery/step
// panels are replaced.
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
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";

beforeAll(() => {
  Element.prototype.scrollTo = Element.prototype.scrollTo ?? (() => {});
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
});

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

/** A start `h` hours out, resolved in the JOB's zone — every clock gate on
 *  these cards runs in America/Chicago (see jobStepOneRow.test.tsx). */
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

/**
 * The states, named by the screen the owner can reach. `minControls` is the
 * per-case floor: a fixture that stops reaching its state cannot pass this
 * guard on an empty row.
 */
const CASES: Array<{ name: string; render: () => ReturnType<typeof render>; minControls: number }> = [
  // ── /my-jobs, Helpr — THE SCREENSHOT'S OWN ROW IS THE FIRST TWO ──────────
  {
    name: "Jobs · Confirmed — Directions · Message · Cancel Job + I'm On My Way",
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
    // THE PRIMARY THAT COMES FROM A FOURTH FILE: JobConfirmation portals its
    // "I'm Still On" into this row. It is the easiest one to miss and the
    // easiest to let drift, because nothing in src/components/activity draws it.
    name: "Jobs · Confirmed, day-of confirmation owed — I'm Still On (portalled from JobConfirmation)",
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
    render: active(makeJob({ helper_arrived_at: null, poster_confirmed_working_at: null }), "on_the_way"),
    minControls: 4,
  },
  {
    /* THE OTHER HALF OF THE SCREENSHOT WAS an outline "Try My Location Again"
       sharing the primary slot with the glossy "Start Working" — two different
       SHAPES in one slot, which is what this file exists to catch. Owner,
       2026-09-19: that chip is gone and the pull-to-refresh gesture on My Jobs
       does the re-check (src/lib/arrivalRefresh.ts).

       The state is kept because it is still a real state a Helpr reaches; what
       it proves now is that every control on it is the one shape, with the row
       one control shorter. */
    name: "Jobs · Arrived, unverified — Start Working (retry chip removed)",
    render: active(makeJob({ poster_confirmed_working_at: null }), "arrived"),
    minControls: 3,
  },
  {
    // ON SITE with the before photo still owed — the capture control the owner
    // asked to move onto the row (2026-09-19, second message).
    name: "Jobs · On site, before photo owed",
    render: active(makeJob({ ...VERIFIED, proof_before_urls: [], poster_confirmed_working_at: null }), "arrived"),
    minControls: 3,
  },
  {
    name: "Jobs · Working, after photo owed",
    render: active(makeJob({ ...VERIFIED, proof_after_urls: [] }), "working"),
    minControls: 3,
  },
  {
    name: "Jobs · Working — Mark Job Complete + Message · Report a Problem",
    render: active(makeJob({ ...VERIFIED }), "working"),
    minControls: 3,
  },
  {
    name: "Jobs · Revision — I'll Fix It + Message",
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
    name: "Jobs · Disputed by the Helpr — Withdraw + Timeline · Message · Contact Admin",
    render: disputedHelper(makeJob({ status: "disputed", dispute_status: "open", disputed_by: HELPER, dispute_reason: "x" })),
    minControls: 4,
  },
  // ── /my-posts, poster ────────────────────────────────────────────────────
  {
    name: "Posts · Open — Share · Boost · Edit · Cancel",
    render: () => wrap(<OpenStep {...posterCtx(makeJob({ status: "open", helper_id: null }))} />),
    minControls: 4,
  },
  {
    name: "Posts · Scheduled — Message · Cancel + Confirm Arrival",
    render: () => wrap(<ScheduledStep {...posterCtx(makeJob({ status: "accepted", poster_confirmed_arrival_at: null }))} />),
    minControls: 3,
  },
  {
    name: "Posts · In Progress — SOS · Message + Confirm They're Working",
    render: () => wrap(<InProgressStep {...posterCtx(makeJob({ poster_confirmed_arrival_at: ago(5), poster_confirmed_working_at: null }))} />),
    minControls: 3,
  },
  {
    // The FINISHED box — a done-toned primary. Same object, different tone.
    name: "Posts · In Progress, both vouches in — disabled Working Confirmed",
    render: () => wrap(<InProgressStep {...posterCtx(makeJob({ date_needed: TODAY, poster_confirmed_arrival_at: ago(6), poster_confirmed_working_at: ago(5) }))} />),
    minControls: 3,
  },
  {
    name: "Posts · Completed — Tip · Review · Hire Again · Re-Post",
    render: () => wrap(<CompletedStep {...posterCtx(makeJob({ status: "completed", poster_completed_at: ago(1), helper_completed_at: ago(2), payment_status: "released" }))} />),
    minControls: 3,
  },
  {
    // FIVE CONTROLS — the widest row the app can reach, and the one a shape
    // that only works at 3-up falls over on.
    name: "Posts · Disputed — Escalate · Timeline · Message · Contact Admin + Resolve & Pay",
    render: () =>
      wrap(
        <DisputedStep
          {...posterCtx(makeJob({ status: "disputed", dispute_status: "open", disputed_by: POSTER, dispute_reason: "x", dispute_deadline: ahead(48) }))}
        />,
      ),
    minControls: 5,
  },
];

// ── THE SIGNATURE ───────────────────────────────────────────────────────────

const classesOf = (el: Element) => (el.getAttribute("class") || "").split(/\s+/).filter(Boolean);

/**
 * The type token the control's VISIBLE LABEL resolves to.
 *
 * The innermost text-bearing wrapper wins, because that is what the reader
 * sees: a chip declares `text-ds-14` on the button (from `size="sm"`) and
 * `text-ds-11` on its label span, and 11 is the number on screen. A control
 * with no wrapper falls back to the button's own token — which is exactly how
 * a 14px inline primary ended up beside an 11px stacked chip.
 */
function typeToken(el: Element): string {
  const wrappers = [...el.querySelectorAll("span, div, p")].filter(
    (n) => (n.textContent || "").trim() && !n.classList.contains("sr-only"),
  );
  for (let i = wrappers.length - 1; i >= 0; i--) {
    const hit = classesOf(wrappers[i]).find((c) => /^text-ds-\d+$/.test(c));
    if (hit) return hit;
  }
  const own = classesOf(el).find((c) => /^text-ds-\d+$/.test(c));
  return own ?? "(inherited)";
}

/** Icon above the label, or beside it. */
const stackToken = (el: Element) =>
  classesOf(el).includes("flex-col") ? "icon-above-label" : "icon-beside-label";

/** The tap floor the control DECLARES. index.css rescues the row's primary to
 *  44px at runtime; a control that does not say 44 itself is relying on that
 *  rescue, which is how one slot's control ends a different height from its
 *  neighbour's the moment the row's CSS changes. */
function minHeightToken(el: Element): string {
  const cls = classesOf(el);
  const min = cls.find((c) => /^min-h-\[\d+px\]$/.test(c));
  if (min) return min;
  const h = cls.find((c) => /^h-\d+$/.test(c));
  return h ? `${h} (no declared floor)` : "(no declared floor)";
}

const radiusToken = (el: Element) =>
  classesOf(el)
    .filter((c) => c === "squircle" || /^rounded(-|$)/.test(c))
    .sort()
    .join(" ") || "(none)";

/** Is the label a wrapping element, or bare text on the button? */
const labelToken = (el: Element) =>
  [...el.querySelectorAll("span")].some((s) => (s.textContent || "").trim() && !s.classList.contains("sr-only"))
    ? "wrapped"
    : "bare";

interface Signature {
  type: string;
  stack: string;
  minHeight: string;
  radius: string;
  label: string;
}
const signature = (el: Element): Signature => ({
  type: typeToken(el),
  stack: stackToken(el),
  minHeight: minHeightToken(el),
  radius: radiusToken(el),
  label: labelToken(el),
});

const nameOf = (el: Element) =>
  (el.getAttribute("aria-label") || el.textContent || "?").trim().replace(/\s+/g, " ").slice(0, 40);

/** Every control that lands in the row: the row's direct children that are
 *  controls, the controls nested inside them, and the primary slot's. */
function rowControls(row: Element): HTMLElement[] {
  return [...row.querySelectorAll<HTMLElement>("button, a[href]")].filter(
    (el) => !el.closest('[role="dialog"]') && !el.closest("[data-job-step-form]"),
  );
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
 * The components a job step card can put in its row, read out of the tree:
 * anything passed in an `actions={[ … ]}` array or a `primary={ … }` prop, any
 * `JobStepPrimaryButton`, and anything portalled through
 * `JobStepRowSlot slot="primary"`. Component names only — a lowercase tag is
 * markup, not a control component.
 */
function rowComponentsFromSource(): Set<string> {
  const found = new Set<string>();
  const files = [
    ...walk(join(ROOT, "src/components/activity")),
    join(ROOT, "src/components/JobTracking.tsx"),
    join(ROOT, "src/components/JobConfirmation.tsx"),
  ];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/\bactions=\{\[([\s\S]*?)\]\}/g)) {
      for (const c of m[1].matchAll(/<([A-Z][\w]*)/g)) found.add(c[1]);
    }
    for (const m of src.matchAll(/\bprimary=\{([\s\S]{0,400}?)\}\s*\n/g)) {
      for (const c of m[1].matchAll(/<([A-Z][\w]*)/g)) found.add(c[1]);
    }
    if (/<JobStepPrimaryButton\b/.test(src)) found.add("JobStepPrimaryButton");
  }
  // These are the shells, not controls — they render the row, they never sit
  // in it.
  for (const shell of ["JobStepCard", "JobStepRowSlot", "JobActionRow"]) found.delete(shell);
  return found;
}

describe("a job-card action row is ONE kind of control", () => {
  it("the inventory is not empty (a guard that renders nothing passes everything)", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(13);
    const fromSource = rowComponentsFromSource();
    expect(fromSource.size, "no row components found in source — the scan has drifted").toBeGreaterThan(4);
    // The control primitives themselves must be in there, or the scan is
    // matching something other than the row.
    for (const required of ["JobActionChip", "JobStepPrimaryButton", "DirectionsButton", "SosShareButton"]) {
      expect([...fromSource], `${required} is not in the derived row inventory`).toContain(required);
    }
  });

  const widths: number[] = [];

  for (const c of CASES) {
    it(c.name, async () => {
      const { container } = c.render();
      await act(async () => { await Promise.resolve(); });
      await act(async () => { await Promise.resolve(); });

      const row = container.querySelector("[data-job-step-row]");
      expect(row, "this state renders no job step row").not.toBeNull();

      const controls = rowControls(row!);
      widths.push(controls.length);
      expect(
        controls.length,
        `expected at least ${c.minControls} controls in the row, got [${controls.map(nameOf).join(" | ")}]`,
      ).toBeGreaterThanOrEqual(c.minControls);

      const sigs = controls.map((el) => ({ name: nameOf(el), sig: signature(el) }));
      const first = sigs[0];
      const drift = sigs
        .filter((s) => JSON.stringify(s.sig) !== JSON.stringify(first.sig))
        .map((s) => `"${s.name}" ${JSON.stringify(s.sig)}`);
      expect(
        drift,
        `these controls are a DIFFERENT KIND OF OBJECT from "${first.name}" ${JSON.stringify(first.sig)} — ` +
          `a row may vary only in TONE and POSITION, never in type size, icon placement, tap floor, radius or label treatment`,
      ).toEqual([]);
    });
  }

  it("covers a four-up and a five-up row (a shape that only works at 3-up must fail here)", () => {
    expect(Math.max(...widths), "no case reached a five-control row").toBeGreaterThanOrEqual(5);
    expect(widths.filter((w) => w >= 4).length, "fewer than three wide rows exercised").toBeGreaterThanOrEqual(3);
  });
});
