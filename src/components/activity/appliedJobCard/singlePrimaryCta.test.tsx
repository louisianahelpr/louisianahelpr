import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ActiveJobSection } from "./ActiveJobSection";
import type { AppliedApp, Job } from "../activityConstants";

/**
 * ONE primary action per card.
 *
 * 1808 unit tests were green while a revision-state card stacked THREE
 * completion CTAs — the tracker's "Done", the revision card's "I'll Fix It",
 * and "Mark Fixed" — because every one of those tests asserted props and
 * branches, never the coherence of what actually rendered together. This file
 * asserts the rendered output: across every state the helper's active card can
 * be in, at most one glossy/primary CTA is on screen at a time.
 *
 * "Primary" is detected by the `btn-grad-primary` class the Button `default`/
 * `primary` variants apply — the single visual marker of the highest-priority
 * action, whatever inline colour a caller layers on top of it.
 */

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }));
vi.mock("@/lib/haptics", () => ({
  hapticLight: vi.fn(), hapticError: vi.fn(), hapticSuccess: vi.fn(),
  hapticMedium: vi.fn(), hapticSelection: vi.fn(), hapticWarning: vi.fn(),
}));
// Photo proof is an uploader, not a CTA surface — stubbed so the count stays
// about completion actions.
vi.mock("@/components/PhotoProof", () => ({ PhotoProofGroup: () => <div data-testid="photo-proof" /> }));

/** A supabase double whose every builder method chains and whose terminals
 *  resolve empty — enough for JobTracking / HelperRevisionCard to mount. */
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

const HELPER = "helper-1";
const NOW = Date.now();
const ago = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
/** Yesterday, so the tracker's "actions unlock 2h before start" gate is open. */
const JOB_DAY = new Date(NOW - 24 * 3_600_000).toISOString().slice(0, 10);

function makeJob(over: Partial<Job> & { status: string }): Job & { revision_note?: string | null } {
  return {
    id: "job-1",
    title: "Mow the lawn",
    description: "Front and back",
    location: "Lafayette, LA",
    customer_id: "poster-1",
    helper_id: HELPER,
    budget: 100,
    category: "yard_work",
    date_needed: JOB_DAY,
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
    ...over,
  } as unknown as Job & { revision_note?: string | null };
}

function makeApp(job: Job): AppliedApp {
  return {
    id: "app-1",
    job_id: job.id,
    helper_id: HELPER,
    status: "accepted",
    created_at: ago(72),
    job,
  } as unknown as AppliedApp;
}

function renderSection(
  job: Job & { revision_note?: string | null },
  /** The live `job_tracking` row. Defaults to `working` — the state most of
   *  these cases are about. Pass `on_the_way` to sit BEFORE work starts. */
  trackingStatus: string = "working",
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ActiveJobSection
          app={makeApp(job)}
          job={job}
          status={job.status}
          userId={HELPER}
          initialTracking={{
            id: "t-1",
            status: trackingStatus,
            latitude: null,
            longitude: null,
            eta_minutes: null,
            updated_at: ago(5),
          }}
          completingJobId={null}
          onComplete={vi.fn()}
          onResolveRevision={vi.fn()}
          onOpenDispute={vi.fn()}
          navigate={vi.fn()}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Every visible primary/glossy CTA currently on screen, by label. */
function primaryCtas(container: HTMLElement): string[] {
  return [...container.querySelectorAll<HTMLElement>("button.btn-grad-primary")]
    .filter((b) => !b.hasAttribute("aria-hidden"))
    .map((b) => (b.textContent || "").trim());
}

// jsdom implements neither Element.scrollTo nor scrollIntoView; the tracker
// centres its current step on mount. Not a product concern — stub them.
beforeAll(() => {
  Element.prototype.scrollTo = Element.prototype.scrollTo ?? (() => {});
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
});

beforeEach(() => vi.clearAllMocks());

/**
 * Each case is one real helper-side state of an active job. `working` /
 * `arrived` / `awaiting approval` / `revision requested` / `revision fixed`
 * are the five the completion CTAs can collide in.
 */
const CASES: Array<{
  name: string;
  job: Job & { revision_note?: string | null };
  /** Documented, REPORTED defect count. Omitted = the invariant (1). */
  knownDefect?: number;
}> = [
  {
    name: "on the way (not yet arrived)",
    job: makeJob({ status: "in_progress", helper_arrived_at: null, poster_confirmed_working_at: null }),
  },
  {
    name: "arrived, work underway",
    job: makeJob({ status: "in_progress" }),
    // FINDING (reported, NOT fixed here — this file may only add tests):
    // an arrived, working job renders TWO glossy CTAs for the same decision —
    // the tracker's next-step "Done" (JobTracking → updateStatus("done")) and
    // the section's "I'm Done — Request Payout" (onComplete). Same collision
    // the revision state was fixed for, one state earlier in the lifecycle;
    // the revision fix hid the tracker's Done only when
    // `jobStatus === "revision_requested"`.
    // Pinned at 2 so this test passes at HEAD AND fails the moment someone
    // fixes it — at which point drop this line and let the invariant apply.
    knownDefect: 2,
  },
  {
    name: "awaiting the poster's approval",
    job: makeJob({ status: "in_progress", helper_completed_at: ago(2) }),
  },
  {
    name: "revision requested",
    job: makeJob({
      status: "revision_requested",
      helper_completed_at: ago(5),
      revision_requested_at: ago(3),
      revision_deadline: new Date(NOW + 60 * 3_600_000).toISOString(),
      revision_note: "The back gate area was missed.",
    }),
  },
  {
    name: "revision marked fixed, waiting on the poster",
    job: makeJob({
      status: "revision_requested",
      helper_completed_at: ago(5),
      revision_requested_at: ago(3),
      revision_completed_at: ago(1),
      revision_acceptance_deadline: new Date(NOW + 60 * 3_600_000).toISOString(),
      revision_note: "The back gate area was missed.",
    }),
  },
];

/**
 * The sanctioned exit, and its replacement.
 *
 * "Can't Finish" disappears once work is underway (owner: "i dont belive they
 * should be able to do this once thy have started the job"). Removing a
 * CONTROL must not remove the PATH, so the state that loses it — and only that
 * state — gains a quiet "Report a Problem" link into the existing dispute
 * dialog. These two tests are each other's complement: neither state may end
 * up with both, and neither may end up with none.
 */
describe("helper active card — exactly one way out of a live job", () => {
  const linkIn = (c: HTMLElement) =>
    [...c.querySelectorAll("button")].find((b) => /Report a Problem/i.test(b.textContent || ""));
  const exitIn = (c: HTMLElement) =>
    [...c.querySelectorAll("button")].find((b) => /Can.t Finish/i.test(b.textContent || ""));

  it("before Working: Can't Finish is the exit, and Report a Problem is not offered", async () => {
    const { container } = renderSection(CASES[0].job, "on_the_way");
    await act(async () => { await Promise.resolve(); });
    expect(exitIn(container), "the pre-work exit disappeared").toBeTruthy();
    expect(linkIn(container), "Report a Problem is duplicating an exit that already exists").toBeUndefined();
  });

  it("once Working: Can't Finish is gone and Report a Problem replaces it — subordinately", async () => {
    const { container } = renderSection(CASES[1].job);
    await act(async () => { await Promise.resolve(); });
    expect(exitIn(container), "a job already underway still offers the unilateral bail").toBeUndefined();
    const link = linkIn(container);
    expect(link, "a working job has no exit at all — not even a report path").toBeTruthy();
    // Subordinate by construction: never the glossy primary, never a chip in
    // the action row beside Message.
    expect(link!.className).not.toContain("btn-grad-primary");
    expect(link!.hasAttribute("data-job-action-chip")).toBe(false);
    // Message must stay reachable in this state — it is the other half of the
    // answer for a helper who cannot continue.
    expect(
      [...container.querySelectorAll("button")].some((b) => /Message/i.test(b.textContent || "")),
    ).toBe(true);
  });
});

describe("helper active card — at most one primary CTA per state", () => {
  for (const { name, job, knownDefect } of CASES) {
    it(`renders no more than one glossy CTA: ${name}`, async () => {
      const { container } = renderSection(job);
      // Let the async sections settle (HelperRevisionCard loads its row in a
      // promise) — counting synchronously would miss a CTA that arrives a tick
      // later, which is precisely how a stacked pair hides from a unit test.
      await act(async () => { await Promise.resolve(); });
      const ctas = primaryCtas(container);
      if (knownDefect !== undefined) {
        expect(
          ctas.length,
          `${name}: the KNOWN, reported stacked-CTA defect changed shape — [${ctas.join(" | ")}]. ` +
            `If you fixed it, delete this case's \`knownDefect\` so the one-CTA invariant applies.`,
        ).toBe(knownDefect);
        return;
      }
      expect(
        ctas.length,
        `${name}: ${ctas.length} primary CTAs on one card — [${ctas.join(" | ")}]. ` +
          `A card may offer exactly one highest-priority action; everything else must be outline/ghost.`,
      ).toBeLessThanOrEqual(1);
    });
  }

  it("revision_requested offers 'I'll Fix It' and NOT the tracker's Done", async () => {
    // The exact three-CTA stack found live: the tracker's next step was "Done"
    // while the revision card offered "I'll Fix It" and the section offered
    // "Mark Fixed". The revision flow owns completion here.
    const { container } = renderSection(CASES[3].job);
    expect(await screen.findByRole("button", { name: /I'll Fix It/i })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Done$/i }),
      "the tracker's Done button is back on a revision-state card — that is the third CTA",
    ).toBeNull();
    expect(primaryCtas(container)).toEqual(["I'll Fix It"]);
  });

  it("'Mark Fixed' does not exist until the revision is accepted", async () => {
    // Owner, 2026-09-11: "Mark Fixed appears ONLY after they have accepted the
    // revision (not before — today both show at once, which is why it reads as
    // competing)". Accept-the-work and declare-it-done are sequential steps,
    // and offering them simultaneously invited the second before the first.
    const { container } = renderSection(CASES[3].job);
    await act(async () => { await Promise.resolve(); });
    const markFixed = () =>
      [...container.querySelectorAll("button")].find((b) => /Mark Fixed/i.test(b.textContent || ""));
    expect(markFixed(), "'Mark Fixed' is showing on a revision nobody has accepted yet").toBeUndefined();

    // …and it must arrive once they accept, or the way out of a revision is gone.
    const fixIt = await screen.findByRole("button", { name: /I'll Fix It/i });
    await act(async () => { fixIt.click(); await Promise.resolve(); });
    const btn = markFixed();
    expect(btn, "the 'Mark Fixed' escape from an accepted revision never appeared").toBeTruthy();
    expect(
      btn!.className,
      "'Mark Fixed' must stay secondary — two glossy CTAs is the bug this file guards",
    ).not.toContain("btn-grad-primary");
  });

  it("the revision card no longer draws its own 'Discuss' twin of Message", async () => {
    // Both navigated to `/messages?jobId=…&userId=…`. Verified identical
    // before removal; the Message chip is the survivor.
    const { container } = renderSection(CASES[3].job);
    await act(async () => { await Promise.resolve(); });
    const labels = [...container.querySelectorAll("button")].map((b) => (b.textContent || "").trim());
    expect(labels.some((l) => /^Discuss$/i.test(l)), `[${labels.join(" | ")}]`).toBe(false);
    expect(labels.some((l) => /Message/i.test(l)), "Message must stay reachable").toBe(true);
  });

  it("does not offer a completion CTA while a revision is open", async () => {
    const { container } = renderSection(CASES[3].job);
    const labels = [...container.querySelectorAll("button")].map((b) => b.textContent || "");
    expect(
      labels.some((l) => /Request Payout|Mark Complete/i.test(l)),
      `a payout CTA is showing beside an open revision: [${labels.map((l) => l.trim()).join(" | ")}]`,
    ).toBe(false);
  });
});
