// The tier DISPLAY names are rendered from two runtimes: the React app (via
// TIER_PERKS[tier].name) and the Deno edge functions (via tierDisplayName in
// supabase/functions/_shared/tierNames.ts, which the app re-exports). Both must
// print the same string, because a user can meet the same tier on a plan card,
// a profile badge, a Helpr Pass, and an expiry notification within one session
// — and the owner's naming rule (2026-08-24) is that the brand LEADS the tier
// name: "Basic / Pro / Elite" (bare — see the naming-rule test below).
//
// This is the same drift guard proTiers.parity.test.ts applies to the price
// map: one source, asserted from both directions so a future edit to either
// file fails the gate instead of shipping two names for one plan.

import { describe, it, expect } from "vitest";
import { TIER_PERKS, tierDisplayName, type SubscriptionTier } from "./subscriptionTiers";
import { TIER_DISPLAY_NAMES } from "../../supabase/functions/_shared/tierNames";

const ALL_TIERS: SubscriptionTier[] = ["free", "basic", "pro", "elite", "business"];

describe("tier display names (client TIER_PERKS <-> edge tierNames)", () => {
  it("gives every tier the same name on both sides", () => {
    for (const tier of ALL_TIERS) {
      expect(TIER_PERKS[tier].name).toBe(TIER_DISPLAY_NAMES[tier]);
      expect(tierDisplayName(tier)).toBe(TIER_PERKS[tier].name);
    }
  });

  it("carries the bare tier names (owner naming rule, 2026-08-27)", () => {
    // Tiers are named by the tier alone. This REVERSED an earlier rule that
    // prefixed every tier with "Helpr" — inside the app the brand is already
    // established by the app you are standing in. A rename in either
    // direction must update this test deliberately.
    expect(TIER_DISPLAY_NAMES.basic).toBe("Basic");
    expect(TIER_DISPLAY_NAMES.pro).toBe("Pro");
    expect(TIER_DISPLAY_NAMES.elite).toBe("Elite");
  });

  it("leaves Free and Business unprefixed on purpose", () => {
    // Free is the absence of a Helpr plan; Business is billed per-seat on the
    // businessSeatTiers ladder, not sold as a consumer "Helpr <tier>".
    expect(TIER_DISPLAY_NAMES.free).toBe("Free");
    expect(TIER_DISPLAY_NAMES.business).toBe("Business");
  });

  it("no 'Helpr ' prefix can creep back onto a consumer tier", () => {
    for (const tier of ["basic", "pro", "elite"] as const) {
      expect(TIER_PERKS[tier].name.startsWith("Helpr ")).toBe(false);
    }
  });

  it("falls back to Free for null / unknown / legacy ids, and normalizes case", () => {
    // Mirrors toSubscriptionTier's safe default: an unrecognized id must never
    // be printed back at the user raw (the bug this helper replaces rendered
    // "Your pro pass ended." straight from the column).
    expect(tierDisplayName(null)).toBe("Free");
    expect(tierDisplayName(undefined)).toBe("Free");
    expect(tierDisplayName("")).toBe("Free");
    expect(tierDisplayName("enterprise")).toBe("Free");
    expect(tierDisplayName("PRO")).toBe("Pro");
    expect(tierDisplayName("Elite")).toBe("Elite");
  });
});
