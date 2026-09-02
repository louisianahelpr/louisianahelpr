import { describe, it, expect } from "vitest";
import type { EnrichedJob } from "@/components/dashboard/types";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  MID_BONUS,
  NEAR_BONUS,
  POSTER_PLACEMENT_MAX_POINTS,
  posterPlacementBonus,
  smartScore,
  sortJobsSmart,
  type HelperLocation,
} from "./smartSort";

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

/**
 * POSTER PLACEMENT — the perk is real, and it is bounded. Both halves are
 * pinned here because they pull against each other.
 *
 * It shipped broken in BOTH directions at once: `useDashboardData` re-sorted
 * the page by an unbounded `tierWeight` that `sortJobsSmart` then discarded
 * (so the perk did nothing), while `useDashboardFilters` carried a hard
 * viewer-gated stratum that put every subscribed poster above every free one
 * (so where it DID act, it was a total override). The bound below is what
 * makes "bounded boost" durable rather than a comment someone later edits.
 */
describe("poster placement — bounded, never an override", () => {
  const at = (o: Partial<EnrichedJob>) =>
    makeJob({ id: "j", budget: 0, created_at: new Date(NOW).toISOString(), ...o });

  it("pays only the tiers that advertise priorityPlacement", () => {
    expect(posterPlacementBonus("elite")).toBe(POSTER_PLACEMENT_MAX_POINTS);
    expect(posterPlacementBonus("pro")).toBe(POSTER_PLACEMENT_MAX_POINTS / 2);
    // TIER_PERKS.basic.priorityPlacement === false.
    expect(posterPlacementBonus("basic")).toBe(0);
    expect(posterPlacementBonus("free")).toBe(0);
  });

  it("gives an unknown, absent, retired or expired tier nothing", () => {
    expect(posterPlacementBonus(null)).toBe(0);
    expect(posterPlacementBonus(undefined)).toBe(0);
    // Retired 2026-09-01. Unknown must lose a perk, never gain one.
    expect(posterPlacementBonus("business")).toBe(0);
    expect(posterPlacementBonus("gold-plated")).toBe(0);
    // An expired tier reaches the client as null (get_safe_profiles folds
    // expiry in server-side, migration 20260901022522), so it scores 0.
    expect(posterPlacementBonus("")).toBe(0);
  });

  it("is capped BELOW the smallest discrete signal this scorer awards", () => {
    // THE inequality. If someone raises the boost to "make the perk feel
    // stronger", this fails and names what they are about to sell: a paid
    // poster outranking a better-matched job in a helper's browse feed.
    expect(POSTER_PLACEMENT_MAX_POINTS).toBeLessThan(MID_BONUS);
    expect(POSTER_PLACEMENT_MAX_POINTS).toBeLessThan(NEAR_BONUS);
    // …and below a real budget step ($20 → $100) and the full recency span.
    const budgetStep = smartScore(at({ budget: 100 }), null, NOW) - smartScore(at({ budget: 20 }), null, NOW);
    expect(POSTER_PLACEMENT_MAX_POINTS).toBeLessThan(budgetStep);
    expect(POSTER_PLACEMENT_MAX_POINTS).toBeLessThan(1);
  });

  it("cannot outrank a genuinely closer job", () => {
    const here: HelperLocation = { lat: 30.45, lng: -91.19 };
    const eliteFar = at({ id: "elite-far", posterSubscriptionTier: "elite", latitude: 31.6, longitude: -92.5 });
    const freeNear = at({ id: "free-near", posterSubscriptionTier: null, latitude: 30.46, longitude: -91.2 });
    expect(smartScore(freeNear, here, NOW)).toBeGreaterThan(smartScore(eliteFar, here, NOW));
  });

  it("cannot outrank a genuinely fresher job", () => {
    // A free poster's job from 12h ago still beats an Elite job from 3 days
    // back: the boost is worth ~5h of freshness, not three days of it.
    const eliteOld = at({ id: "elite-old", posterSubscriptionTier: "elite", created_at: new Date(NOW - 3 * 864e5).toISOString() });
    const freeFresh = at({ id: "free-fresh", posterSubscriptionTier: null, created_at: new Date(NOW - 12 * 36e5).toISOString() });
    expect(smartScore(freeFresh, null, NOW)).toBeGreaterThan(smartScore(eliteOld, null, NOW));
  });

  it("DOES settle a near-tie in the paying poster's favour", () => {
    // The perk has to actually do something, or we are back to charging for
    // an ordering that gets discarded.
    const free = at({ id: "free", posterSubscriptionTier: null });
    const elite = at({ id: "elite", posterSubscriptionTier: "elite" });
    expect(smartScore(elite, null, NOW)).toBeGreaterThan(smartScore(free, null, NOW));
    const ranked = sortJobsSmart([free, elite], null, NOW);
    expect(ranked[0].id).toBe("elite");
  });

  it("buys about fifteen hours of head start against a brand-new job", () => {
    // Puts a human number on the cap, bracketed rather than exact so the
    // assertion tracks the intent and not the curve's third decimal.
    //
    // This scorer's recency is EXPONENTIAL (4-day half-life), so 0.1 near the
    // top of the curve is worth ~15h — not the ~5h the same 10% buys in
    // `get_ranked_open_jobs`, whose recency term is linear (50 - hours). Same
    // fraction of each feed's span, different wall-clock value; that is a
    // property of the two curves, not a disagreement between them.
    const freshFreeJob = smartScore(at({ posterSubscriptionTier: null }), null, NOW);
    const eliteAged = (hoursOld: number) =>
      smartScore(
        at({ posterSubscriptionTier: "elite", created_at: new Date(NOW - hoursOld * 36e5).toISOString() }),
        null,
        NOW,
      );
    expect(eliteAged(12)).toBeGreaterThan(freshFreeJob);
    expect(eliteAged(18)).toBeLessThan(freshFreeJob);
  });
});

describe("poster placement — client/SQL parity", () => {
  const SQL = readFileSync(
    resolve(__dirname, "../../supabase/migrations/20260901031421_bounded_poster_placement_in_ranked_open_jobs.sql"),
    "utf8",
  );
  const BODY = SQL.slice(SQL.indexOf("AS $function$"));

  it("uses the same 10% / 5%-of-the-recency-span ratio on both scales", () => {
    // SQL recency span is 0–50; the client's is 0–1. Elite must be 10% of
    // each, Pro 5%, or the public /jobs board and the signed-in dashboard
    // move a paid poster different distances — the inconsistency this fixed.
    const elite = BODY.match(/subscription_tier = 'elite' THEN ([\d.]+)/);
    const pro = BODY.match(/subscription_tier = 'pro'\s+THEN ([\d.]+)/);
    expect(elite, "elite branch missing from rank_score").not.toBeNull();
    expect(pro, "pro branch missing from rank_score").not.toBeNull();
    const SQL_RECENCY_SPAN = 50;
    expect(Number(elite![1]) / SQL_RECENCY_SPAN).toBeCloseTo(POSTER_PLACEMENT_MAX_POINTS / 1, 10);
    expect(Number(pro![1]) / SQL_RECENCY_SPAN).toBeCloseTo(POSTER_PLACEMENT_MAX_POINTS / 2, 10);
  });

  it("stays below every other term in rank_score", () => {
    const elite = Number(BODY.match(/subscription_tier = 'elite' THEN ([\d.]+)/)![1]);
    for (const term of [1000 /* boost */, 500 /* parish */, 100 /* urgent */, 50 /* recency span */]) {
      expect(elite).toBeLessThan(term);
    }
  });

  it("grants no placement to an expired tier, or to the retired 'business'", () => {
    expect(BODY).toMatch(
      /WHEN pp\.subscription_expires_at IS NOT NULL\s*\n?\s*AND pp\.subscription_expires_at <= now\(\) THEN 0/,
    );
    expect(BODY).not.toMatch(/'business'/);
    expect(BODY).not.toMatch(/subscription_tier = 'basic'/);
  });
});
