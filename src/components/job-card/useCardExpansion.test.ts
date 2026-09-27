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
import type { Job } from "@/components/job-card/activityConstants";
import {
  useCardExpansion,
  awaitsTipOrReview,
  COLLAPSED_AWAITING_KEY,
  MAX_DEFAULT_EXPANDED,
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
// @mutate src/components/job-card/useCardExpansion.ts | () => postedJobs.filter((job) => awaitsTipOrReview(job, completedJobMeta)), | () => postedJobs.filter(() => false),
// @mutate src/components/job-card/useCardExpansion.ts | return !(m.tipped && m.reviewed); | return false;

// Q430 (owner, 2026-09-27): "cap default-expanded completed cards at the
// newest 3". Each expanded card mounts a JobTracking query, a realtime channel
// and an avatar, so the number of cards open by default IS the per-card request
// count of /posts?filter=done. The test poster's 69 untipped completed jobs all
// opened (a 330-request burst on WebKit, nightly-red #1794); this pins the
// default to MAX_DEFAULT_EXPANDED whatever N is, and to the NEWEST ones.
describe("useCardExpansion default-open cap (Q430)", () => {
  const N = 69;
  const many = Array.from({ length: N }, (_, i) => ({
    id: `c${i}`,
    status: "completed",
    // c0 completed first, c68 most recently.
    completed_at: new Date(Date.UTC(2026, 8, 1) + i * 3_600_000).toISOString(),
    created_at: "2026-08-01T00:00:00Z",
  })) as unknown as Job[];
  const meta: CompletedJobMeta = Object.fromEntries(many.map((j) => [j.id, { tipped: false, reviewed: false }]));

  it(`opens only the newest ${MAX_DEFAULT_EXPANDED} of ${N} awaiting cards`, () => {
    expect(MAX_DEFAULT_EXPANDED).toBe(3);
    // Shuffled input: the order the list arrives in must not decide which open.
    const shuffled = [...many].reverse().sort((a, b) => (a.id.length - b.id.length) || a.id.localeCompare(b.id));
    const { result } = renderHook(() => useCardExpansion(shuffled, meta));
    expect([...result.current.expandedJobIds].sort()).toEqual(["c66", "c67", "c68"]);
  });

  it("still auto-collapses a capped card the user opened once its tip and review land", () => {
    const { result, rerender } = renderHook(({ m }: { m: CompletedJobMeta }) => useCardExpansion(many, m), {
      initialProps: { m: meta },
    });
    act(() => result.current.toggleExpandedJobId("c0"));
    expect(result.current.expandedJobIds.has("c0")).toBe(true);
    rerender({ m: { ...meta, c0: { tipped: true, reviewed: true } } });
    expect(result.current.expandedJobIds.has("c0")).toBe(false);
  });
});
// @mutate src/components/job-card/useCardExpansion.ts | .slice(0, MAX_DEFAULT_EXPANDED) | .slice(0)
// @mutate src/components/job-card/useCardExpansion.ts | .sort((a, b) => recency(b) - recency(a)) | .sort(() => 0)
// @mutate src/components/job-card/useCardExpansion.ts | for (const job of awaiting) seenAwaiting.current.add(job.id); | for (const id of defaultOpen) seenAwaiting.current.add(id);
