/**
 * OWNER ITEM 7, SECOND PASS (2026-09-19): "trim to one sentence. rest behind
 * the tap."
 *
 * The first version of the stalled-job note said four things at once and
 * measured 112px / 7 lines at 375 (128px / 8 at 320) in 11px semibold amber,
 * directly above a three-line disabled button — about a quarter of the
 * viewport, reading LOUDER than the tracker above it.
 *
 * THE DESIGN PROBLEM this file pins: the control the note explains is DISABLED,
 * so it cannot be what receives the tap, and making it tappable is the
 * anti-pattern this card has rejected twice (OpenStep's greyed Boost, the
 * PayoutPrimary disabled twin). The answer is the one owner item 10 had already
 * chosen on this exact step nine hours earlier — a quiet chip on the row
 * opening a dialog (the `Photos` chip → `PhotoProofDialog`).
 *
 * `stalledCompletionStage.test.ts` pins the two STRINGS; this pins that the
 * short one is what the card shows, that the long one is genuinely reachable,
 * and that the chip and the box it explains are never offered apart.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Job } from "../../../../components/job-card/activityConstants";
import type { PosterStepCtx } from "./posterStepContract";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";

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
}));
vi.mock("@/integrations/supabase/client", () => {
  const result = { data: null, error: null };
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "select", "eq", "order", "limit", "update", "insert"]) chain[m] = vi.fn(() => chain);
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
});

import { InProgressStep } from "./InProgressStep";
import {
  completionStalled,
  STALLED_APPROVE_DETAIL_TITLE,
  STALLED_APPROVE_DISABLED_DETAIL,
  STALLED_APPROVE_DISABLED_LABEL,
  STALLED_APPROVE_DISABLED_REASON,
} from "../../../../../supabase/functions/_shared/stalledCompletion";

beforeAll(() => {
  Element.prototype.scrollTo = Element.prototype.scrollTo ?? (() => {});
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
});

const NOW = Date.now();
const ago = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
// `date_needed` is the job's day IN AMERICA/CHICAGO (jobLocalDateISO's header).
// These were `new Date(NOW - 24h).toISOString().slice(0, 10)` — the UTC day —
// which after 19:00 Pacific names the CURRENT Central day, so the "stalled"
// fixture was a job whose day is not over and `completionStalled` (correctly)
// returned false: no disabled box, no "Why?" chip.
//
// TWO days back, not one: `scheduledEndMs` is the end of the job's DAY, so a
// job dated Central-yesterday is only stalled once 02:00 Central has passed
// (STALLED_FIRST_AFTER_HOURS = 2). Two days back is past that gate at every
// hour of the clock, which is what "the scheduled end is long behind us" means.
const DAY_LONG_PAST = jobLocalDateISO(-2);
const TODAY = jobLocalDateISO(0);

/** In progress, both vouches given, and NOBODY marked it done. */
const stalledJob = (over: Partial<Record<string, unknown>> = {}): Job =>
  ({
    id: "job-1",
    title: "Mow the lawn",
    status: "in_progress",
    date_needed: DAY_LONG_PAST,
    start_time: "09:00",
    estimated_hours: 2,
    budget: 100,
    helper_id: "helper-1",
    customer_id: "poster-1",
    helper_confirmed_at: ago(40),
    helper_on_the_way_at: ago(30),
    helper_arrived_at: ago(29),
    poster_confirmed_arrival_at: ago(29),
    poster_confirmed_working_at: ago(28),
    helper_completed_at: null,
    poster_completed_at: null,
    proof_before_urls: [],
    proof_after_urls: [],
    ...over,
  }) as unknown as Job;

function ctx(job: Job): PosterStepCtx {
  return {
    job,
    userId: "poster-1",
    helperNames: { "helper-1": "Hallie H." },
    completedJobMeta: {},
    unfunded: false,
    completingJobId: null,
    confirmingArrivalJobId: null,
    confirmingWorkingJobId: null,
    instantReleaseOn: false,
    navigate: vi.fn(),
    onBoost: vi.fn(), onEdit: vi.fn(), onCancel: vi.fn(), onComplete: vi.fn(),
    onNoShow: vi.fn(), onTip: vi.fn(), onReview: vi.fn(), onDispute: vi.fn(),
    onReport: vi.fn(), onViewDispute: vi.fn(), onConfirmArrival: vi.fn(),
    onConfirmWorking: vi.fn(), onActionComplete: vi.fn(),
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

const draw = (job: Job) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <InProgressStep {...ctx(job)} />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("the stalled note is one sentence, and the rest is one tap away", () => {
  // WAS: asserted the note held exactly STALLED_APPROVE_DISABLED_REASON — the
  // "trim to one sentence" pass. Owner, 2026-09-19, THIRD pass: "cut the
  // note, let the button speak" — the disabled box (STALLED_APPROVE_DISABLED_LABEL,
  // "Waiting on the Helpr to mark it done") already names who the row is
  // waiting on, so the note above it was the same fact twice. Now the note is
  // gone entirely and the reason lives only behind the "Why?" tap.
  it("shows NO note on the card — the disabled button carries the reason", () => {
    const { container } = draw(stalledJob());
    const note = container.querySelector("[data-job-step-note]");
    expect(note?.textContent ?? "").toBe("");
    // The short sentence itself is not visible on the card either — only
    // behind "Why?" now (see the reveal test below).
    expect(container.textContent ?? "").not.toContain(STALLED_APPROVE_DISABLED_REASON);
    // The instruction and the escalation promise are NOT on the card.
    expect(container.textContent ?? "").not.toMatch(/Mark Job Complete/);
    expect(container.textContent ?? "").not.toMatch(/our team steps in/i);
  });

  it("the box it explains is still the row's disabled primary", () => {
    draw(stalledJob());
    const box = screen.getByRole("button", { name: new RegExp(STALLED_APPROVE_DISABLED_LABEL, "i") }) as HTMLButtonElement;
    expect(box.disabled, "nothing here is tappable — no money moves from this box").toBe(true);
  });

  it("the tap that reveals the rest is a SEPARATE control, not the disabled box", async () => {
    draw(stalledJob());
    const why = screen.getByRole("button", { name: /^Why\?/ }) as HTMLButtonElement;
    expect(why.disabled).toBe(false);
    // …and it lives on the card's ONE action row, like every other control
    // (VN-21). jobStepOneRow.test.tsx fails the whole card if it does not.
    expect(why.closest("[data-job-step-row]"), "the Why? chip is outside the action row").not.toBeNull();

    await act(async () => { why.click(); });
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain(STALLED_APPROVE_DETAIL_TITLE);
    expect(dialog.textContent, "the remainder is genuinely reachable").toContain(
      STALLED_APPROVE_DISABLED_DETAIL,
    );
    // The short line is repeated inside: someone who taps "Why?" has usually
    // stopped reading the line above it, and the two halves are one answer.
    expect(dialog.textContent).toContain(STALLED_APPROVE_DISABLED_REASON);
  });

  it("no notice, no Why? chip — the explanation never outlives what it explains", () => {
    // Same job, still legitimately running (its scheduled day is not over).
    draw(stalledJob({ date_needed: TODAY }));
    expect(screen.queryByRole("button", { name: /^Why\?/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Working Confirmed/i })).toBeTruthy();
  });

  it("and it never appears once either side has marked the job done", () => {
    draw(stalledJob({ helper_completed_at: ago(1) }));
    expect(screen.queryByRole("button", { name: /^Why\?/ })).toBeNull();
  });

  it("…because the shared PREDICATE stands down, not only the row's precedence", () => {
    // The rendered assertion above is double-gated (vacuity burn-down,
    // 2026-09-21): a job carrying `helper_completed_at` also hands the row's
    // primary slot to the ENABLED Approve rung, which outranks the stalled
    // branch in `posterConfirmationRung` — so deleting `helper_completed_at`
    // from `completionStalled`'s own guard left this file green (proved by
    // mutation). That half matters on its own: the SWEEP reads the same
    // predicate, and a job whose Helpr has marked it done is not in the trap —
    // nudging both parties about it, and escalating it to a human at +48h,
    // would be an accusation the data contradicts.
    const evidence = {
      status: "in_progress",
      helper_completed_at: null as string | null,
      poster_completed_at: null as string | null,
      date_needed: DAY_LONG_PAST,
      start_time: "09:00",
      estimated_hours: 2,
    };
    const now = new Date(NOW);
    // The floor: without it, every line below would pass on a fixture that was
    // never in the trap to begin with.
    expect(completionStalled(evidence, now), "the fixture is not stalled at all").toBe(true);
    expect(completionStalled({ ...evidence, helper_completed_at: ago(1) }, now)).toBe(false);
    expect(completionStalled({ ...evidence, poster_completed_at: ago(1) }, now)).toBe(false);
  });
});

// The card's whole disclosure hangs off ONE predicate: move the trap's grace
// window out of reach and the disabled box and its "Why?" chip both vanish.
// @mutate supabase/functions/_shared/stalledCompletion.ts | export const STALLED_FIRST_AFTER_HOURS = 2; | export const STALLED_FIRST_AFTER_HOURS = 2000;
// …and the half of the predicate that stands it down again (the assertion
// added 2026-09-21; the rendered test alone could not see this line).
// @mutate supabase/functions/_shared/stalledCompletion.ts | if (job.helper_completed_at \|\| job.poster_completed_at) return false; | if (job.poster_completed_at) return false;
