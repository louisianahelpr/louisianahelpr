/**
 * VN-29 (owner, 2026-09-14): "if they have a tip or review still needing to be
 * done on a done job, leave it expanded until tip and review are both done,
 * when they're done then collapse".
 *
 * Before: expansion was purely user-toggled — every posted card opened
 * collapsed, so the first and third tests below fail on the old hook.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { Job } from "@/components/activity/activityConstants";
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

describe("useCardExpansion (VN-29)", () => {
  it("opens a completed job with a tip or review outstanding, and nothing else", () => {
    const { result } = setup({
      "done-1": { tipped: true, reviewed: false },
      "done-2": { tipped: true, reviewed: true },
    });
    expect(result.current.expandedJobIds.has("done-1")).toBe(true);
    expect(result.current.expandedJobIds.has("done-2")).toBe(false);
    expect(result.current.expandedJobIds.has("open-1")).toBe(false);
  });

  it("still toggles by hand, in both directions", () => {
    const { result } = setup({ "done-1": { tipped: false, reviewed: false } });
    act(() => result.current.toggleExpandedJobId("done-1"));
    expect(result.current.expandedJobIds.has("done-1")).toBe(false);
    act(() => result.current.toggleExpandedJobId("open-1"));
    expect(result.current.expandedJobIds.has("open-1")).toBe(true);
    act(() => result.current.toggleExpandedJobId("done-1"));
    expect(result.current.expandedJobIds.has("done-1")).toBe(true);
  });

  it("collapses the moment the second of tip/review lands, even if the user had re-opened it", () => {
    const { result, rerender } = setup({ "done-1": { tipped: false, reviewed: false } });
    // Collapse then re-open by hand, so an override is in play.
    act(() => result.current.toggleExpandedJobId("done-1"));
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

// VN-29 in one line: the hook must actually SEED its open set from
// awaitsTipOrReview. Unwiring it (rather than breaking the predicate the
// first describe block tests directly) is what proves the wiring.
// @mutate src/pages/activity/useCardExpansion.ts | for (const job of postedJobs) if (awaitsTipOrReview(job, completedJobMeta)) s.add(job.id); | for (const job of postedJobs) if (false) s.add(job.id);
// @mutate src/pages/activity/useCardExpansion.ts | return !(m.tipped && m.reviewed); | return false;
