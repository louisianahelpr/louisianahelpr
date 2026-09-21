import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * THE POSTER'S "CONFIRM OFFERED" BOX (owner, 2026-09-19: "on poster i see no
 * button to ... confirmed offered. if it was clicked already it should still
 * show but with the box disabled").
 *
 * Two holes, both rendering, both in this shared component:
 *
 *   1. `if (helperOnTheWayAt) return null` ran for BOTH sides, so the moment
 *      the Helpr tapped "I'm On My Way" the poster's confirm-offer control —
 *      and the read-back of whether they had ever confirmed — vanished for
 *      good, confirmed or not. The Helpr setting off does not answer the
 *      POSTER's question; their stamp is a different column.
 *   2. the CTA was `!myConfirmed && …`, so there was no box at all once they
 *      had confirmed — only a status pill elsewhere in the card.
 *
 * The HELPER's branch is deliberately untouched and is pinned here too: their
 * control portals into their step card's single action row, where a permanent
 * inert box would occupy the slot the tracker's own next-step CTA needs.
 *
 * NOT covered, because it is a POLICY question rather than a rendering one:
 * the confirmation WINDOW (24h before → noon on the job day for the poster).
 * Widening when a poster may confirm is the owner's call, not this fix's.
 */

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/haptics", () => ({ hapticError: vi.fn(), hapticSuccess: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "update", "eq", "select", "single"]) chain[m] = vi.fn(() => chain);
  chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
  return { supabase: chain };
});

import { JobConfirmation } from "./JobConfirmation";

/** Overrides are typed against the component, not `Record<string, unknown>`:
 *  a prop renamed out from under this file must be a build error here. */
type Props = Partial<React.ComponentProps<typeof JobConfirmation>>;

/** 10:00 in the job's zone on the job's own day: inside the poster's window
 *  (24h before → noon on the day) on every machine, in every month. */
const NOON_MINUS_TWO = new Date("2026-09-19T15:00:00Z");
const JOB_DAY = "2026-09-19";

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOON_MINUS_TWO);
});
afterAll(() => vi.useRealTimers());

const poster = (over: Props = {}) => (
  <JobConfirmation
    jobId="job-1"
    isOwner
    isHelper={false}
    posterConfirmedAt={null}
    helperConfirmedAt="2026-09-17T12:00:00Z"
    helperDayofConfirmedAt="2026-09-19T11:00:00Z"
    dateNeeded={JOB_DAY}
    jobStatus="in_progress"
    helperOnTheWayAt="2026-09-19T14:30:00Z"
    embedded
    {...over}
  />
);

describe("the poster's confirmation survives the Helpr setting off", () => {
  it("still offers the box while the Helpr is on their way", () => {
    render(poster());
    // Before the fix this component returned null outright and the poster's
    // card showed nothing at all where the confirmation had been.
    expect(screen.getByRole("button", { name: /I'm Still On/i })).toBeTruthy();
  });

  it("keeps the box, disabled, once the poster has confirmed", () => {
    render(poster({ posterConfirmedAt: "2026-09-19T13:00:00Z" }));
    const done = screen.getByRole("button", { name: /^Confirmed$/i }) as HTMLButtonElement;
    expect(done.disabled, "the already-confirmed box must be inert, not tappable").toBe(true);
    // …and it must not still be inviting the tap it has already had.
    expect(screen.queryByRole("button", { name: /I'm Still On/i })).toBeNull();
  });

  it("does not wear the glossy primary once it is a statement rather than an action", () => {
    render(poster({ posterConfirmedAt: "2026-09-19T13:00:00Z" }));
    const done = screen.getByRole("button", { name: /^Confirmed$/i });
    expect(
      done.classList.contains("btn-grad-primary"),
      "a done box in the live CTA's surface reads as a broken button, not a finished one",
    ).toBe(false);
  });
});

describe("the HELPER's branch is unchanged", () => {
  const helper = (over: Props = {}) => (
    <JobConfirmation
      jobId="job-1"
      isOwner={false}
      isHelper
      posterConfirmedAt={null}
      helperConfirmedAt="2026-09-17T12:00:00Z"
      helperDayofConfirmedAt={null}
      dateNeeded={JOB_DAY}
      jobStatus="in_progress"
      helperOnTheWayAt="2026-09-19T14:30:00Z"
      variant="inline"
      {...over}
    />
  );

  it("still renders nothing at all once they are on their way", () => {
    const { container } = render(helper());
    expect(container.textContent).toBe("");
  });

  it("gets no inert box of its own once confirmed — the row's primary slot is the tracker's", () => {
    const { container } = render(
      helper({ helperOnTheWayAt: null, helperDayofConfirmedAt: "2026-09-19T11:00:00Z" }),
    );
    expect([...container.querySelectorAll("button")].map((b) => b.textContent?.trim())).toEqual([]);
  });
});

/* BLIND SPOTS. The "no glossy primary" assertion reads a CLASS NAME
 * (`btn-grad-primary`), which jsdom cannot resolve to a computed
 * `background-image` — per CLAUDE.md that is a proxy, and the real gloss check
 * is the rendered one. The confirmation WINDOW (24h before → noon on the job
 * day for the poster, -24h for the helper) is deliberately unexercised: the
 * fixture sits inside it on purpose and widening it is an owner policy call.
 * Nothing here presses the button, so the write to `poster_confirmed_at` and
 * the notification fan-out are not covered by this file. */

// THE LINE THE OWNER REPORTED. `&& !isOwner` is the whole fix: without it the
// Helpr tapping "I'm On My Way" deletes the poster's confirm-offer control and
// its read-back, confirmed or not.
// @mutate src/components/JobConfirmation.tsx | if (helperOnTheWayAt && !isOwner) return null; | if (helperOnTheWayAt) return null;
// …and the TONE half of the same rule: the done box must not wear the live
// CTA's gloss, or "you already did this" reads as a broken button.
// @mutate src/components/JobConfirmation.tsx | variant="outline" | variant="primary"
