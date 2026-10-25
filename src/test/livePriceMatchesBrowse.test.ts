/**
 * The same job reads the same number on the home page and on /browse (owner
 * 2026-10-25, option A, no caption). Measured before: home's Live now showed the
 * poster's price ($30, $150, $60) while /browse showed the Helpr's take-home
 * ($27, $141, $56) for the same three jobs.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computeNet } from "@/components/dashboard/JobPrice";
import { liveJobPrice } from "@/components/landing/LiveJobsSection";

describe("home Live now shows the /browse take-home", () => {
  it("a flat-fee job reads its floored take-home, the /browse figure", () => {
    for (const [budget, want] of [[30, "$27"], [150, "$141"], [60, "$56"]] as const) {
      const job = { budget, helper_fee_flat_cents: 70 };
      const net = computeNet(budget, 0, 0, 1, 0, job).netEarnings;
      expect(liveJobPrice({ budget, pricing_mode: null, take_home: net })).toBe(want);
    }
  });

  it("without a computed take-home the set price shows; a quotes job names no price", () => {
    expect(liveJobPrice({ budget: 60, pricing_mode: null })).toBe("$60");
    expect(liveJobPrice({ budget: 60, pricing_mode: "quotes", take_home: 56 })).toBe("Get quotes");
  });

  it("the section computes the take-home with computeNet for flat-stamped jobs", () => {
    const src = readFileSync("src/components/landing/LiveJobsSection.tsx", "utf8");
    // @mutate src/components/landing/LiveJobsSection.tsx | return { ...j, take_home: Number.isFinite(net) ? net : null }; | return j;
    expect(src).toMatch(/return \{ \.\.\.j, take_home: Number\.isFinite\(net\) \? net : null \};/);
    expect(src).toMatch(/await import\("@\/components\/dashboard\/JobPrice"\)/);
  });
});
