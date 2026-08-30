import { describe, it, expect } from "vitest";
import type { EnrichedJob } from "@/components/dashboard/types";
import { smartScore, sortJobsSmart, type HelperLocation } from "./smartSort";

// A reference "now" so tests are deterministic regardless of when CI runs.
const NOW = new Date("2026-05-20T12:00:00.000Z").getTime();

// Build a minimal EnrichedJob shape — the score function only reads a
// handful of fields, so we widen with `as EnrichedJob` to avoid stubbing
// out the entire 80-column row.
function makeJob(overrides: Partial<EnrichedJob> & { id: string }): EnrichedJob {
  return {
    title: "T",
    description: "D",
    category: "other",
    budget: 50,
    date_needed: "2026-06-20",
    location: "Baton Rouge",
    customer_id: "c1",
    status: "open",
    created_at: new Date(NOW).toISOString(),
    ...overrides,
  } as EnrichedJob;
}

describe("smartScore", () => {
  it("returns higher score for fresher jobs (recency)", () => {
    const fresh = makeJob({ id: "fresh", created_at: new Date(NOW - 60_000).toISOString() });
    const old = makeJob({
      id: "old",
      // 8 days old → recency ≈ 0.25 vs ≈ 1 for "60s ago"
      created_at: new Date(NOW - 8 * 24 * 60 * 60 * 1000).toISOString(),
    });
    expect(smartScore(fresh, null, NOW)).toBeGreaterThan(smartScore(old, null, NOW));
  });

  it("recency halves on the ~4-day half-life", () => {
    const fresh = makeJob({ id: "fresh", created_at: new Date(NOW).toISOString(), budget: 0 });
    const fourDays = makeJob({
      id: "4d",
      created_at: new Date(NOW - 4 * 24 * 60 * 60 * 1000).toISOString(),
      budget: 0,
    });
    const a = smartScore(fresh, null, NOW);
    const b = smartScore(fourDays, null, NOW);
    // Allow a small float tolerance; should be ~0.5
    expect(b / a).toBeGreaterThan(0.49);
    expect(b / a).toBeLessThan(0.51);
  });

  it("log-scales budget — $100 > $50 > $20 but $5000 is not 100x $50", () => {
    const base = { created_at: new Date(NOW).toISOString(), date_needed: "2026-06-20" };
    const cheap = smartScore(makeJob({ id: "20", budget: 20, ...base }), null, NOW);
    const mid = smartScore(makeJob({ id: "50", budget: 50, ...base }), null, NOW);
    const rich = smartScore(makeJob({ id: "100", budget: 100, ...base }), null, NOW);
    const huge = smartScore(makeJob({ id: "5000", budget: 5000, ...base }), null, NOW);

    expect(rich).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(cheap);
    // log-scale: budget contribution alone is ~log10(b+1).
    // log10(5001) ≈ 3.7 vs log10(51) ≈ 1.71 — under 3x, never 100x.
    const budgetGap = (huge - mid) / Math.max(mid - cheap, 0.001);
    expect(budgetGap).toBeLessThan(10);
  });

  it("gives urgency zero weight in the ranking score", () => {
    // Owner, 2026-08-29: "urgent does not go first, it's just go by when
    // they posted it." Urgency used to add a flat +0.5 here on top of a
    // separate hard override in useDashboardFilters — both are gone.
    // Same created_at/budget/coords means these two must score IDENTICALLY
    // regardless of urgent_fee, is_urgent, or an imminent date_needed.
    const base = makeJob({ id: "base", date_needed: "2026-06-20" });
    const urgent = makeJob({
      id: "urg",
      date_needed: "2026-05-21", // within the old 48h window
      urgent_fee: 25,
      is_urgent: true,
    });
    expect(smartScore(urgent, null, NOW)).toBe(smartScore(base, null, NOW));
  });

  it("adds the proximity bonus when helper has coords and job is nearby", () => {
    // Baton Rouge ≈ (30.45, -91.15). A job 2 miles away should clear the 10mi
    // tier (+0.3); a job ~20mi away should land in the 25mi tier (+0.15);
    // a job 100mi away gets no bonus.
    const helper: HelperLocation = { lat: 30.45, lng: -91.15 };
    const base = { created_at: new Date(NOW).toISOString(), date_needed: "2026-06-20", budget: 50 };

    const noCoords = makeJob({ id: "no-coords", ...base });
    const near = makeJob({ id: "near", latitude: 30.46, longitude: -91.14, ...base });
    const mid = makeJob({ id: "mid", latitude: 30.7, longitude: -91.1, ...base });
    const far = makeJob({ id: "far", latitude: 32.5, longitude: -93.7, ...base });

    const noCoordsScore = smartScore(noCoords, helper, NOW);
    const nearScore = smartScore(near, helper, NOW);
    const midScore = smartScore(mid, helper, NOW);
    const farScore = smartScore(far, helper, NOW);

    expect(nearScore - noCoordsScore).toBeCloseTo(0.3, 5);
    expect(midScore - noCoordsScore).toBeCloseTo(0.15, 5);
    expect(farScore - noCoordsScore).toBeCloseTo(0, 5);
  });

  it("is pure-recency-plus-budget when helper has no location", () => {
    // With helperLocation null, two jobs at identical timestamps and budgets
    // should score identically regardless of their geographic spread.
    const base = { created_at: new Date(NOW).toISOString(), date_needed: "2026-06-20", budget: 75 };
    const here = makeJob({ id: "here", latitude: 30.45, longitude: -91.15, ...base });
    const there = makeJob({ id: "there", latitude: 47.6, longitude: -122.3, ...base });
    expect(smartScore(here, null, NOW)).toBeCloseTo(smartScore(there, null, NOW), 6);
  });

  it("tolerates missing / malformed fields without throwing", () => {
    // EnrichedJob makes most fields optional via Partial<Job>. The score
    // function must survive nulls and bogus values rather than crashing
    // a render. Score should be finite in all cases.
    const empty = makeJob({
      id: "empty",
      created_at: null as unknown as string,
      budget: null as unknown as number,
      date_needed: "",
    });
    const score = smartScore(empty, null, NOW);
    expect(Number.isFinite(score)).toBe(true);
  });
});

describe("sortJobsSmart", () => {
  it("returns a new array sorted by descending score, leaving the input untouched", () => {
    const old = makeJob({
      id: "old",
      created_at: new Date(NOW - 6 * 24 * 60 * 60 * 1000).toISOString(),
      budget: 30,
    });
    const fresh = makeJob({ id: "fresh", created_at: new Date(NOW).toISOString(), budget: 30 });
    const richUrgent = makeJob({
      id: "rich-urgent",
      created_at: new Date(NOW - 60 * 60 * 1000).toISOString(),
      budget: 500,
      urgent_fee: 50,
    });

    const input = [old, fresh, richUrgent];
    const result = sortJobsSmart(input, null, NOW);

    expect(result.map((j) => j.id)).toEqual(["rich-urgent", "fresh", "old"]);
    // Original array order preserved
    expect(input.map((j) => j.id)).toEqual(["old", "fresh", "rich-urgent"]);
  });

  it("uses proximity as a tiebreaker when other signals are equal", () => {
    const helper: HelperLocation = { lat: 30.45, lng: -91.15 };
    const base = { created_at: new Date(NOW).toISOString(), date_needed: "2026-06-20", budget: 50 };
    const far = makeJob({ id: "far", latitude: 32.5, longitude: -93.7, ...base });
    const near = makeJob({ id: "near", latitude: 30.46, longitude: -91.14, ...base });

    const result = sortJobsSmart([far, near], helper, NOW);
    expect(result.map((j) => j.id)).toEqual(["near", "far"]);
  });

  it("is stable for equal scores (preserves input order)", () => {
    const ts = new Date(NOW).toISOString();
    const a = makeJob({ id: "a", created_at: ts, budget: 50 });
    const b = makeJob({ id: "b", created_at: ts, budget: 50 });
    const c = makeJob({ id: "c", created_at: ts, budget: 50 });

    const result = sortJobsSmart([a, b, c], null, NOW);
    expect(result.map((j) => j.id)).toEqual(["a", "b", "c"]);
  });
});
