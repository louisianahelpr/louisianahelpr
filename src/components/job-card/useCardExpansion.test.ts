/**
 * Board 14 (lead 2026-10-20): NO posted card opens by default. VN-29 (owner,
 * 2026-09-14) opened a completed job with a tip or review outstanding; the card
 * face now asks for that as its one button ("Leave a review" / "Tip <name>"),
 * so the card stays shut. What VN-29 also asked survives: a card the poster
 * opened closes itself once the second of tip/review lands.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { Job } from "@/components/job-card/activityConstants";
import {
  useCardExpansion,
  awaitsTipOrReview,
  COLLAPSED_AWAITING_KEY,
  type CompletedJobMeta,
} from "./useCardExpansion";

const job = (id: string, status: string) => ({ id, status }) as unknown as Job;
const jobs = [job("done-1", "completed"), job("open-1", "open"), job("done-2", "completed")];

function setup(initialMeta: CompletedJobMeta) {
  return renderHook(
    ({ meta }: { meta: CompletedJobMeta }) => useCardExpansion(jobs, meta),
    { initialProps: { meta: initialMeta } },
  );
}

beforeEach(() => sessionStorage.clear());

describe("awaitsTipOrReview", () => {
  it("is true only for a completed job whose tip or review is still open", () => {
    const meta: CompletedJobMeta = {
      a: { tipped: false, reviewed: false },
      b: { tipped: true, reviewed: false },
      c: { tipped: true, reviewed: true },
    };
    expect(awaitsTipOrReview(job("a", "completed"), meta)).toBe(true);
    expect(awaitsTipOrReview(job("b", "completed"), meta)).toBe(true);
    expect(awaitsTipOrReview(job("c", "completed"), meta)).toBe(false);
    expect(awaitsTipOrReview(job("a", "in_progress"), meta)).toBe(false);
    // Meta not loaded yet: unknown, so no default open.
    expect(awaitsTipOrReview(job("z", "completed"), meta)).toBe(false);
  });
});

describe("useCardExpansion (board 14)", () => {
  it("opens nothing by default, not even a completed job with a tip or review outstanding", () => {
    const { result } = setup({
      "done-1": { tipped: true, reviewed: false },
      "done-2": { tipped: true, reviewed: true },
    });
    expect(result.current.expandedJobIds.size).toBe(0);
  });

  it("still toggles by hand, in both directions", () => {
    const { result } = setup({ "done-1": { tipped: false, reviewed: false } });
    act(() => result.current.toggleExpandedJobId("done-1"));
    expect(result.current.expandedJobIds.has("done-1")).toBe(true);
    act(() => result.current.toggleExpandedJobId("open-1"));
    expect(result.current.expandedJobIds.has("open-1")).toBe(true);
    act(() => result.current.toggleExpandedJobId("done-1"));
    expect(result.current.expandedJobIds.has("done-1")).toBe(false);
  });

  it("collapses the moment the second of tip/review lands, even if the user had re-opened it", () => {
    const { result, rerender } = setup({ "done-1": { tipped: false, reviewed: false } });
    // Opened by hand, so an override is in play.
    act(() => result.current.toggleExpandedJobId("done-1"));
    rerender({ meta: { "done-1": { tipped: true, reviewed: false } } });
    expect(result.current.expandedJobIds.has("done-1")).toBe(true);
    rerender({ meta: { "done-1": { tipped: true, reviewed: true } } });
    expect(result.current.expandedJobIds.has("done-1")).toBe(false);
    // Once collapsed on done, a manual re-open sticks.
    act(() => result.current.toggleExpandedJobId("done-1"));
    rerender({ meta: { "done-1": { tipped: true, reviewed: true } } });
    expect(result.current.expandedJobIds.has("done-1")).toBe(true);
  });

  it("never force-reopens a card the user collapsed, across a refetch or a remount", () => {
    const meta = { "done-1": { tipped: false, reviewed: false } };
    const first = setup(meta);
    act(() => first.result.current.toggleExpandedJobId("done-1"));
    act(() => first.result.current.toggleExpandedJobId("done-1"));
    expect(first.result.current.expandedJobIds.has("done-1")).toBe(false);
    // Refetch: meta briefly empty, then back with the same answer.
    first.rerender({ meta: {} });
    first.rerender({ meta: { "done-1": { tipped: false, reviewed: false } } });
    expect(first.result.current.expandedJobIds.has("done-1")).toBe(false);
    first.unmount();
    expect(JSON.parse(sessionStorage.getItem(COLLAPSED_AWAITING_KEY) ?? "[]")).toContain("done-1");

    const second = setup(meta);
    expect(second.result.current.expandedJobIds.has("done-1")).toBe(false);
  });
});

// The default stays empty: seeding it again (from the awaiting list) fails the first test of the board-14 block.
// @mutate src/components/job-card/useCardExpansion.ts | const defaultOpen = NONE_OPEN; | const defaultOpen = new Set(awaiting.map((j) => j.id));
// @mutate src/components/job-card/useCardExpansion.ts | return !(m.tipped && m.reviewed); | return false;
// @mutate src/components/job-card/useCardExpansion.ts | for (const job of awaiting) seenAwaiting.current.add(job.id); | for (const id of defaultOpen) seenAwaiting.current.add(id);

describe("useCardExpansion auto-collapse over many done jobs", () => {
  const N = 69;
  const many = Array.from({ length: N }, (_, i) => ({
    id: `c${i}`,
    status: "completed",
    completed_at: new Date(Date.UTC(2026, 8, 1) + i * 3_600_000).toISOString(),
    created_at: "2026-08-01T00:00:00Z",
  })) as unknown as Job[];
  const meta: CompletedJobMeta = Object.fromEntries(many.map((j) => [j.id, { tipped: false, reviewed: false }]));

  it(`opens none of ${N} awaiting cards (each open card mounts a tracker query, Q430)`, () => {
    const { result } = renderHook(() => useCardExpansion(many, meta));
    expect(result.current.expandedJobIds.size).toBe(0);
  });

  it("still auto-collapses a card the user opened once its tip and review land", () => {
    const { result, rerender } = renderHook(({ m }: { m: CompletedJobMeta }) => useCardExpansion(many, m), {
      initialProps: { m: meta },
    });
    act(() => result.current.toggleExpandedJobId("c0"));
    expect(result.current.expandedJobIds.has("c0")).toBe(true);
    rerender({ m: { ...meta, c0: { tipped: true, reviewed: true } } });
    expect(result.current.expandedJobIds.has("c0")).toBe(false);
  });
});
