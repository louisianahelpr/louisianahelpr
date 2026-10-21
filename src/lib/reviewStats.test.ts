/**
 * Rating stats (src/lib/reviewStats.ts): get_public_profile_stats is the one
 * source; only a not-deployed RPC (PGRST202) falls back to the direct read,
 * which still applies the reveal window and published status. Any other error
 * throws, never an empty Map that reads as "never reviewed".
 *
 * @mutate src/lib/reviewStats.ts |   if ((statsRes.error as { code?: string } \| null)?.code !== "PGRST202") { |   if (!statsRes.error) {
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const queue: { data?: unknown; error?: unknown; status?: number }[] = [];
  const calls: unknown[][] = [];
  const next = () => queue.shift() ?? { data: null, error: null };
  const builder = () => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "in", "eq", "lte"]) {
      b[m] = (...a: unknown[]) => {
        calls.push([m, ...a]);
        return b;
      };
    }
    b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(next()).then(res, rej);
    return b;
  };
  const supabase = {
    from: (t: string) => {
      calls.push(["from", t]);
      return builder();
    },
    rpc: (name: string, args: unknown) => {
      calls.push(["rpc", name, args]);
      return Promise.resolve(next());
    },
  };
  return { queue, calls, supabase };
});

vi.mock("@/integrations/supabase/client", () => ({ supabase: h.supabase }));

import { countsTowardRating, fetchRatingStats } from "./reviewStats";

beforeEach(() => {
  h.queue.length = 0;
  h.calls.length = 0;
});

describe("fetchRatingStats", () => {
  it("makes no call for no ids, and de-duplicates the ids it sends", async () => {
    await expect(fetchRatingStats([])).resolves.toEqual(new Map());
    await expect(fetchRatingStats(["", ""])).resolves.toEqual(new Map());
    expect(h.calls).toEqual([]);
    h.queue.push({ data: [], error: null });
    await fetchRatingStats(["a", "a", "b"]);
    expect(h.calls).toEqual([["rpc", "get_public_profile_stats", { p_user_ids: ["a", "b"] }]]);
  });

  it("maps the RPC rows, leaving out anyone with no counted review", async () => {
    h.queue.push({
      data: [
        { user_id: "a", review_count: 3, avg_rating: 4.67 },
        { user_id: "b", review_count: 0, avg_rating: null },
        { user_id: "c", review_count: null, avg_rating: 5 },
        { user_id: "d", review_count: 1, avg_rating: null },
      ],
      error: null,
    });
    const m = await fetchRatingStats(["a", "b", "c", "d"]);
    expect([...m]).toEqual([
      ["a", { count: 3, avg: 4.67 }],
      ["d", { count: 1, avg: 0 }],
    ]);
  });

  it("throws on a real RPC error", async () => {
    h.queue.push({ data: null, error: { code: "57014", message: "statement timeout" }, status: 500 });
    await expect(fetchRatingStats(["a"])).rejects.toBeTruthy();
  });

  it("falls back to the published, revealed reviews when the RPC is not deployed, and averages them", async () => {
    h.queue.push({ data: null, error: { code: "PGRST202", message: "missing" } });
    h.queue.push({
      data: [
        { reviewee_id: "a", rating: 5 },
        { reviewee_id: "a", rating: 4 },
        { reviewee_id: "a", rating: 3 },
        { reviewee_id: "b", rating: 2 },
      ],
      error: null,
    });
    const m = await fetchRatingStats(["a", "b"]);
    expect([...m]).toEqual([
      ["a", { count: 3, avg: 4 }],
      ["b", { count: 1, avg: 2 }],
    ]);
    expect(h.calls.slice(1, 5)).toEqual([
      ["from", "reviews"],
      ["select", "reviewee_id, rating"],
      ["in", "reviewee_id", ["a", "b"]],
      ["eq", "status", "published"],
    ]);
    expect(h.calls[5][0]).toBe("lte");
    expect(h.calls[5][1]).toBe("feedback_visible_at");
    h.queue.push({ data: null, error: { code: "PGRST202", message: "missing" } });
    h.queue.push({ data: null, error: null });
    await expect(fetchRatingStats(["a"])).resolves.toEqual(new Map());
  });
});

describe("countsTowardRating", () => {
  const now = Date.parse("2026-10-19T12:00:00Z");
  const base = { status: "published", feedback_visible_at: "2026-10-18T00:00:00Z", jobs: { status: "completed" } };
  it("counts only published, revealed reviews on a readable, non-cancelled job", () => {
    expect(countsTowardRating(base, now)).toBe(true);
    expect(countsTowardRating({ ...base, status: "hidden" }, now)).toBe(false);
    expect(countsTowardRating({ ...base, feedback_visible_at: null }, now)).toBe(false);
    expect(countsTowardRating({ ...base, feedback_visible_at: "2026-10-20T00:00:00Z" }, now)).toBe(false);
    expect(countsTowardRating({ ...base, jobs: null }, now)).toBe(false);
    expect(countsTowardRating({ ...base, jobs: { status: "cancelled" } }, now)).toBe(false);
  });
});
