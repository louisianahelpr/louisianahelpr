import { describe, it, expect, vi, beforeAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
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
 * "START WORKING" IS NOW GATED TOO — AND THE SERVER GATED IT FIRST.
 *
 * THE HISTORY, KEPT BECAUSE THE ORDER IS THE POINT. Until 2026-09-19 this file
 * pinned the OPPOSITE: Start Working was deliberately ungated, because the
 * server was the oracle and the server did not enforce a before-photo on this
 * transition. Verified read-only against prod `fncmgoasalhdgfwzhsqa` that
 * morning — `job_tracking` carried exactly one non-internal trigger,
 * `trg_job_tracking_arrival_gate` → `enforce_job_tracking_arrival_gate()`, and
 * its `working` branch read
 *
 *     IF NEW.status = 'working'
 *        AND v_job.helper_completed_at IS NULL
 *        AND v_job.poster_confirmed_arrival_at IS NULL THEN
 *       RAISE EXCEPTION 'tracker_requires_arrival' …
 *
 * — the poster's vouch, and nothing about photos. A client block on top of
 * that would have made the app STRICTER than the database: a Helpr whose
 * upload fails (denied camera, storage error, offline) unable to start a job
 * the backend would happily have started, with no override anywhere. That is
 * the class that produced the bad-GPS deadlock removed the same day, and the
 * standing rule is that the client never gates ahead of the server.
 *
 * `20260919195158_before_photo_gates_working_step.sql` adds the server rule:
 * the same `working` branch now also raises `tracker_requires_before_photo`
 * (a DISTINCT code — the arrival gate is cleared by the POSTER's tap, this one
 * by the HELPR's own chip) when `require_photo_proof` is on and
 * `proof_before_urls` is empty, mirroring `requiredProof(job).before`. The
 * client block below shipped in the SAME commit, never ahead of it.
 *
 * NOT ON TAP. An earlier version of the Done gate enforced its rule by failing
 * on tap with a toast, and JobTracking's own note on it says the control that
 * LOOKED pressable was the worse half of the pair to get wrong. So this is a
 * render-time disabled state with the reason on the line above the row, and
 * the reason NAMES the "Before Photo" chip sitting beside it in the row.
 *
 * (That sentence said "one control to its left" until 2026-09-19, when the
 * owner pinned the chip order: "before and after photos should be to the left
 * of the primary buttons". The capture chip is now the LAST chip, immediately
 * left of the primary, so it is no longer left of the reason — and the reason
 * itself moved below the row in the same batch. The relationship the guard
 * cares about is unchanged: the card names a control that is on the card.)
 */

// PROOF THIS GUARD CAN FAIL (npm run vacuity). The first mutation takes the
// capture control back off the row (it was a panel in the `ask` slot); the
// second removes the done-step half of the proof gate, which is the half the
// database really does enforce.
// (Re-anchored 2026-09-19: the chip moved to the END of the actions array
// when the owner pinned the row's two ends, so it no longer carries a
// trailing comma.)
// @mutate src/components/activity/appliedJobCard/steps/OnSiteStep.tsx | <HelperPhotoAsk key="photo" jobId={app.job_id} job={job} step="on_site" />] | null]
// @mutate src/components/JobTracking.tsx | !hasRequiredProof({ require_photo_proof: requirePhotoProof ?? true }, proofBeforeUrls, proofAfterUrls); | false;
// The third takes the BEFORE-photo half of the gate off Start Working — the
// owner's 2026-09-19 rule, and the half that only became safe to enforce once
// 20260919195158 put it in the database.
// @mutate src/components/JobTracking.tsx | disabled={updating \|\| isLocked \|\| needsArrival \|\| needsBeforePhoto \|\| needsProof} | disabled={updating \|\| isLocked \|\| needsArrival \|\| needsProof}

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
import { BEFORE_PHOTO_GATE_REASON } from "@/lib/lifecycleErrors";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";

// Read as TEXT, not imported: LIFECYCLE_REASONS is module-private on purpose,
// and the thing being checked is that the CODE the trigger raises is a key in
// that table — not that some string exists.
const LIFECYCLE_COPY = readFileSync(resolve(__dirname, "../lib/lifecycleErrors.ts"), "utf8");

beforeAll(() => {
  Element.prototype.scrollTo = Element.prototype.scrollTo ?? (() => {});
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
});

/**
 * Does `enforce_job_tracking_arrival_gate()` refuse `status='working'` without
 * the before photo? YES since
 * `20260919195158_before_photo_gates_working_step.sql`. This constant is the
 * interlock: it may only be `true` while a migration actually raises
 * `tracker_requires_before_photo` from that function's `working` branch, which
 * the first test below reads out of the migration set and asserts. Flipping it
 * without the SQL turns this file red, which is the whole point — the client
 * must never gate ahead of the server.
 */
const START_WORKING_IS_SERVER_GATED = true;

const HELPER = "helper-1";
const POSTER = "poster-1";
const NOW = Date.now();
const ago = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
// The job's day in AMERICA/CHICAGO, the zone every clock gate on these cards
// resolves in (`jobLocalStartMs` / `todayMs()` / `completionStalled`). These
// were `.toISOString().slice(0, 10)` — the UTC day — which after 19:00 Pacific
// names the NEXT Central day, so a "yesterday" fixture was really today and a
// "today" fixture was really tomorrow. Eight specs went red on that on
// 2026-09-19 with the product entirely correct; see
// src/test/helpers/jobLocalDate.ts.
const YESTERDAY = jobLocalDateISO(-1);

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

  /**
   * THE INTERLOCK. The client may only disable Start Working while the
   * DATABASE refuses the same write, so the flag that turns the block on is
   * itself checked against the migration set. Read from the latest migration
   * that defines the trigger function, not from a name — a rename that loses
   * the rule fails here rather than passing on an absent file.
   */
  it("the server refuses status='working' without the before photo", () => {
    const dir = resolve(__dirname, "../../supabase/migrations");
    const defining = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .filter((f) =>
        readFileSync(resolve(dir, f), "utf8").includes("FUNCTION public.enforce_job_tracking_arrival_gate"),
      );
    expect(defining.length, "no migration defines enforce_job_tracking_arrival_gate any more").toBeGreaterThan(0);
    const sql = readFileSync(resolve(dir, defining[defining.length - 1]), "utf8");

    const gated = /RAISE EXCEPTION 'tracker_requires_before_photo'/.test(sql);
    expect(
      gated,
      "START_WORKING_IS_SERVER_GATED is true but no migration raises tracker_requires_before_photo — " +
        "the client would be stricter than the database, which is the deadlock class. Ship the SQL or flip the flag back.",
    ).toBe(START_WORKING_IS_SERVER_GATED);

    // The predicate is the APP's rule (src/lib/photoProofPolicy.ts
    // requiredProof().before + hasRequiredProof), mirrored — not a second
    // definition of "required".
    expect(sql, "the SQL stopped reading the poster's per-job flag").toContain(
      "COALESCE(v_job.require_photo_proof, true)",
    );
    expect(sql, "the SQL stopped reading the before-photo array").toContain(
      "COALESCE(array_length(v_job.proof_before_urls, 1), 0) = 0",
    );
    // A DISTINCT code: reusing tracker_requires_arrival would send the Helpr to
    // pester the poster for a tap that clears nothing.
    expect(sql).not.toMatch(/tracker_requires_before_photo'[^\n]*\n[^\n]*Confirm They Arrived/);
    // And the code has words at the surface that renders it.
    expect(LIFECYCLE_COPY, "tracker_requires_before_photo has no copy in lifecycleErrors.ts").toContain(
      "tracker_requires_before_photo",
    );
  });

  it("Start Working is DISABLED with the reason under it when the before photo is missing", async () => {
    const { container } = await renderStep(
      makeJob({ proof_before_urls: [], poster_confirmed_working_at: null }),
      "arrived",
    );
    const cta = primary(container);
    expect(cta?.textContent?.trim(), "the on-site step's primary").toMatch(/Start Working/);
    expect(
      cta?.disabled,
      START_WORKING_IS_SERVER_GATED
        ? "the server refuses status='working' without the before photo, so the button must say so BEFORE the tap — " +
          "failing on tap with a toast is the shape this card was audited for twice"
        : "a CLIENT-ONLY block: enforce_job_tracking_arrival_gate() lets status='working' through without a before photo, " +
          "so this strands any Helpr whose upload fails with no way past. Gate the database first (see the header).",
    ).toBe(START_WORKING_IS_SERVER_GATED);

    // A dead control the card cannot explain is the defect, not the gate — and
    // the sentence must NAME the chip that clears it.
    const note = container.querySelector("[data-job-step-note]");
    expect(note?.textContent ?? "").toContain(BEFORE_PHOTO_GATE_REASON);
    expect(BEFORE_PHOTO_GATE_REASON, "the reason no longer names the control").toContain("Before Photo");
    // …and that control is one tap away, in the same row.
    expect(within(row(container)).getByRole("button", { name: /^Before Photo\b/ })).toBeTruthy();
  });

  it("adding the before photo clears it — Start Working is ENABLED", async () => {
    const { container } = await renderStep(
      makeJob({ proof_before_urls: ["before.jpg"], poster_confirmed_working_at: null }),
      "arrived",
    );
    const cta = primary(container);
    expect(cta?.textContent?.trim()).toMatch(/Start Working/);
    expect(cta?.disabled, "the gate is refusing a job whose before photo exists").toBe(false);
  });

  it("a job the poster marked as needing no photos is UNAFFECTED — Start Working is ENABLED", async () => {
    const { container } = await renderStep(
      makeJob({ proof_before_urls: [], require_photo_proof: false, poster_confirmed_working_at: null }),
      "arrived",
    );
    const cta = primary(container);
    expect(cta?.textContent?.trim()).toMatch(/Start Working/);
    expect(
      cta?.disabled,
      "requiredProof({ require_photo_proof: false }).before is false — this job has no before photo to owe",
    ).toBe(false);
  });
});
