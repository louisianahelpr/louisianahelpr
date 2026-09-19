import { describe, it, expect, vi, beforeAll } from "vitest";
import { act, render, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

/**
 * THE BEFORE/AFTER CAPTURE IS A CONTROL ON THE ACTION ROW — and what actually
 * gates the two steps it belongs to.
 *
 * Owner, 2026-09-19: "before and after buttons should also be on the same
 * lines as the other buttons. if a before photo is required they can't press
 * the working button until its done and same for a completed job for an after
 * photo".
 *
 * ── PART 1: WHERE THE CONTROL IS ────────────────────────────────────────────
 * It used to be `PhotoProofStep` in the card's `ask` slot: a titled panel with
 * a hint and a full-width "Add Photo" button, stacked ABOVE the one action row
 * VN-21 asked for. It is now one chip IN the row, on every step that offers it
 * (on_site, working, dispute), and it still self-gates on
 * `jobs.require_photo_proof` so a no-photos job shows no control at all.
 *
 * ── PART 2: WHAT THE GATE ACTUALLY IS, AND WHAT IT IS NOT ───────────────────
 * "Mark Job Complete" IS gated on the full requirement — `JobTracking`'s
 * `needsProof`, rendered as a disabled primary with `requiredProof().reason`
 * in the row's note. That half is correct and this file pins it.
 *
 * "START WORKING" IS NOT GATED, DELIBERATELY, AND THIS FILE PINS THAT TOO.
 * Read before changing it: the server is the oracle, and the server does not
 * enforce a before-photo on this transition. Verified read-only against prod
 * `fncmgoasalhdgfwzhsqa` on 2026-09-19 — `job_tracking` carries exactly one
 * non-internal trigger, `trg_job_tracking_arrival_gate` →
 * `enforce_job_tracking_arrival_gate()`, and its `working` branch is
 *
 *     IF NEW.status = 'working'
 *        AND v_job.helper_completed_at IS NULL
 *        AND v_job.poster_confirmed_arrival_at IS NULL THEN
 *       RAISE EXCEPTION 'tracker_requires_arrival' …
 *
 * — the poster's vouch, and nothing about photos. A client block here would
 * make the app STRICTER than the database: a Helpr whose upload fails (denied
 * camera, storage error, offline) would be unable to start a job the backend
 * would happily have let them start, with no override anywhere. That is the
 * class that produced the bad-GPS deadlock, and the standing rule is that the
 * client never gates ahead of the server.
 *
 * So the control is made one tap away — the capture chip sits directly beside
 * "Start Working" in the same row — and the BLOCK waits on a migration to
 * `enforce_job_tracking_arrival_gate()` (supabase/**, another lane's files).
 * The moment that lands, flip `START_WORKING_IS_SERVER_GATED` below and the
 * expectation with it.
 */

// PROOF THIS GUARD CAN FAIL (npm run vacuity). The first mutation takes the
// capture control back off the row (it was a panel in the `ask` slot); the
// second removes the done-step half of the proof gate, which is the half the
// database really does enforce.
// @mutate src/components/activity/appliedJobCard/steps/OnSiteStep.tsx | <HelperPhotoAsk key="photo" jobId={app.job_id} job={job} step="on_site" />, | null,
// @mutate src/components/JobTracking.tsx | !hasRequiredProof({ require_photo_proof: requirePhotoProof ?? true }, proofBeforeUrls, proofAfterUrls); | false;

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }));
vi.mock("@/lib/haptics", () => ({
  hapticLight: vi.fn(), hapticError: vi.fn(), hapticSuccess: vi.fn(),
  hapticMedium: vi.fn(), hapticSelection: vi.fn(), hapticWarning: vi.fn(),
}));
// The REAL PhotoProof — the capture control is the subject here, so only the
// review surfaces are replaced.
vi.mock("@/components/PhotoProof", async (orig) => {
  const actual = await orig<typeof import("@/components/PhotoProof")>();
  return {
    ...actual,
    PhotoProofGroup: () => <div data-testid="photo-proof-group" />,
    PhotoProofDialog: () => null,
    PhotoProofRequirementNote: () => null,
  };
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
      storage: { from: vi.fn(() => ({ upload: vi.fn(), createSignedUrl: vi.fn() })) },
      channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() })),
      removeChannel: vi.fn(),
      rpc: vi.fn(() => Promise.resolve(result)),
      auth: { getUser: vi.fn(() => Promise.resolve({ data: { user: null }, error: null })) },
    },
  };
}
vi.mock("@/integrations/supabase/client", () => makeSupabase());

import type { AppliedApp, Job } from "@/components/activity/activityConstants";
import { ActiveJobSection } from "@/components/activity/appliedJobCard/ActiveJobSection";
import { requiredProof } from "@/lib/photoProofPolicy";

beforeAll(() => {
  Element.prototype.scrollTo = Element.prototype.scrollTo ?? (() => {});
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
});

/**
 * Does `enforce_job_tracking_arrival_gate()` refuse `status='working'` without
 * the before photo? Read from prod, 2026-09-19: NO. Flip this when the
 * migration lands, and the two expectations below flip with it.
 */
const START_WORKING_IS_SERVER_GATED = false;

const HELPER = "helper-1";
const POSTER = "poster-1";
const NOW = Date.now();
const ago = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const YESTERDAY = new Date(NOW - 24 * 3_600_000).toISOString().slice(0, 10);

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
    date_needed: YESTERDAY,
    start_time: "09:00",
    proof_before_urls: ["before.jpg"],
    proof_after_urls: ["after.jpg"],
    helper_confirmed_at: ago(48),
    helper_dayof_confirmed_at: ago(30),
    poster_confirmed_at: ago(47),
    poster_confirmed_arrival_at: ago(6),
    poster_confirmed_working_at: ago(8),
    helper_arrival_verified_at: ago(6),
    helper_on_the_way_at: ago(7),
    helper_arrived_at: ago(6),
    helper_completed_at: null,
    poster_completed_at: null,
    status: "in_progress",
    ...over,
  } as unknown as Job;
}

const makeApp = (job: Job) =>
  ({ id: "app-1", job_id: job.id, helper_id: HELPER, status: "accepted", created_at: ago(72), job }) as unknown as AppliedApp;

function wrap(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

/** `trackingStatus` "arrived" is the ON SITE step; "working" is Working. */
async function renderStep(job: Job, trackingStatus: string) {
  const out = wrap(
    <ActiveJobSection
      app={makeApp(job)}
      job={job}
      status={job.status}
      userId={HELPER}
      initialTracking={{ id: "t-1", status: trackingStatus, latitude: null, longitude: null, eta_minutes: null, updated_at: ago(5) } as never}
      completingJobId={null}
      onComplete={vi.fn()}
      onResolveRevision={vi.fn()}
      onOpenDispute={vi.fn()}
      navigate={vi.fn()}
    />,
  );
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
  return out;
}

const row = (container: HTMLElement) => {
  const el = container.querySelector<HTMLElement>("[data-job-step-row]");
  expect(el, "this state renders no job step row").not.toBeNull();
  return el!;
};

const primary = (container: HTMLElement) => {
  const slot = container.querySelector<HTMLElement>("[data-job-step-primary]");
  expect(slot, "no primary slot").not.toBeNull();
  return slot!.lastElementChild as HTMLButtonElement | null;
};

describe("the photo capture is a control IN the action row", () => {
  it("on site, before photo owed: a Before Photo chip inside the row — not a panel above it", async () => {
    const { container } = await renderStep(
      makeJob({ proof_before_urls: [], poster_confirmed_working_at: null }),
      "arrived",
    );
    const btn = within(row(container)).getByRole("button", { name: /^Before Photo\b/ });
    expect(btn).toBeTruthy();
    // The panel's own heading and hint are gone from the card entirely.
    expect(container.textContent).not.toMatch(/Add a before photo/);
    expect(container.textContent).not.toMatch(/Show the job as you found it/);
  });

  it("working, after photo owed: an After Photo chip inside the row", async () => {
    const { container } = await renderStep(makeJob({ proof_after_urls: [] }), "working");
    expect(within(row(container)).getByRole("button", { name: /^After Photo\b/ })).toBeTruthy();
    expect(container.textContent).not.toMatch(/Add an after photo/);
  });

  it("the capture control is NAMED for which photo, so it cannot read as the Photos gallery chip", async () => {
    const { container } = await renderStep(makeJob({ proof_before_urls: [], poster_confirmed_working_at: null }), "arrived");
    const names = [...row(container).querySelectorAll("button, a[href]")].map(
      (b) => (b.getAttribute("aria-label") || b.textContent || "").trim(),
    );
    // "Photos" opens the gallery of what exists; "Before Photo" adds what does
    // not. A helper with no before photo tapping "Photos" would land in an
    // empty gallery, which is why these were not merged.
    expect(names.some((n) => /^Before Photo\b/.test(n))).toBe(true);
    expect(names.some((n) => /^Photos\b/.test(n))).toBe(false);
  });

  it("no control at all when the poster does not require photos", async () => {
    const { container } = await renderStep(
      makeJob({ proof_before_urls: [], require_photo_proof: false, poster_confirmed_working_at: null }),
      "arrived",
    );
    const names = [...row(container).querySelectorAll("button, a[href]")].map(
      (b) => (b.getAttribute("aria-label") || b.textContent || "").trim(),
    );
    expect(names.filter((n) => /Photo\b/.test(n)), "a photo control on a job that needs none").toEqual([]);
  });

  it("satisfied steps render no capture control — the row is one shorter", async () => {
    const { container } = await renderStep(makeJob({}), "working");
    const names = [...row(container).querySelectorAll("button, a[href]")].map(
      (b) => (b.getAttribute("aria-label") || b.textContent || "").trim(),
    );
    expect(names.filter((n) => /^(Before|After) Photo\b/.test(n))).toEqual([]);
  });
});

describe("the completion gate, and the one that is the SERVER's to add", () => {
  it("Mark Job Complete is DISABLED with the reason under it when a proof photo is missing", async () => {
    const { container } = await renderStep(makeJob({ proof_after_urls: [] }), "working");
    const cta = primary(container);
    expect(cta?.textContent?.trim(), "the working step's primary").toMatch(/Mark Job Complete/);
    expect(cta?.disabled, "the completion gate stopped firing — this one IS enforced server-side").toBe(true);
    const note = container.querySelector("[data-job-step-note]");
    expect(note?.textContent ?? "", "a dead control the card cannot explain").toContain(
      requiredProof({ require_photo_proof: true }).reason,
    );
  });

  it("Mark Job Complete is ENABLED once both photos exist", async () => {
    const { container } = await renderStep(makeJob({}), "working");
    const cta = primary(container);
    expect(cta?.textContent?.trim()).toMatch(/Mark Job Complete/);
    expect(cta?.disabled, "the gate is refusing a job whose proof is complete").toBe(false);
  });

  it("Start Working is NOT blocked by a missing before photo — the server does not block it either", async () => {
    const { container } = await renderStep(
      makeJob({ proof_before_urls: [], poster_confirmed_working_at: null }),
      "arrived",
    );
    const cta = primary(container);
    expect(cta?.textContent?.trim(), "the on-site step's primary").toMatch(/Start Working/);
    expect(
      cta?.disabled,
      START_WORKING_IS_SERVER_GATED
        ? "the server now refuses status='working' without the before photo, so the button must say so BEFORE the tap"
        : "a CLIENT-ONLY block: enforce_job_tracking_arrival_gate() lets status='working' through without a before photo, " +
          "so this strands any Helpr whose upload fails with no way past. Gate the database first (see the header).",
    ).toBe(START_WORKING_IS_SERVER_GATED);
    // …and the way to satisfy it is one tap away, in the same row.
    expect(within(row(container)).getByRole("button", { name: /^Before Photo\b/ })).toBeTruthy();
  });
});
