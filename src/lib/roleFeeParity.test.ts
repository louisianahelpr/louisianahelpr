// ROLE parity: the percentage a user is charged must not depend on which side
// of the job they are standing on.
//
// Product rule from the owner: "the percentage should be the same whether
// they're posting or helping." One user, one tier, one percent.
//
// The existing parity tests (`helperFees.parity.test.ts`, `posterFees.parity.test.ts`)
// guard the fee TABLE across the two RUNTIMES (client mirror ↔ Deno edge
// authority). Neither of them compares the two ROLES against each other, so a
// poster/helper split could open up without reddening either of them — and one
// nearly did: `posterFeePercentForTier` took `(tier, expiresAt)` while the
// helper-side `feePercentForTier` took only `(tier)`, so the poster resolver
// could see a lapsed subscription and the helper resolver structurally could
// not. Every helper-side caller happened to compare `subscription_expires_at`
// itself before calling in, so no wrong percent ever shipped — but the next
// caller to pass just the tier would have charged a lapsed Pro 10% as a helper
// and 12% as a poster.
//
// This file pins the rule directly: for every tier, at every expiry state, on
// both runtimes, poster percent === helper percent.

import { describe, it, expect } from "vitest";
import { posterFeePercentForTier as uiPosterFeePercent } from "./posterFees";
import { tierFeePercent as uiHelperFeePercent, TIER_PERKS, type SubscriptionTier } from "./subscriptionTiers";
import { feePercentForTier as edgeHelperFeePercent } from "../../supabase/functions/_shared/helperFees";
import { posterFeePercentForTier as edgePosterFeePercent } from "../../supabase/functions/_shared/posterFees";

// Every tier the app can put in `profiles.subscription_tier`, plus the values a
// real row can actually hold that are NOT tiers (null, junk, mixed case).
const LIVE_TIERS: SubscriptionTier[] = ["free", "basic", "pro", "elite"];
const RAW_VALUES: (string | null | undefined)[] = [
  ...LIVE_TIERS,
  "PRO",
  "Pro",
  "ELITE",
  // The `business` tier was retired on 2026-09-01. Both casings stay in the RAW
  // list on purpose: they are exactly the kind of legacy string a stale row or
  // a cached client could still send, and the two roles must agree that it is
  // now worth the free rate rather than the 6% the retired rung used to grant.
  "business",
  "Business",
  null,
  undefined,
  "",
  "nonsense",
  "premium", // a plausible future/legacy value that is not on the ladder
];

const PAST = new Date(Date.now() - 86_400_000).toISOString();
const FUTURE = new Date(Date.now() + 86_400_000).toISOString();
const EXPIRY_STATES: [label: string, value: string | null | undefined][] = [
  ["no expiry column", null],
  ["undefined expiry", undefined],
  ["active (future)", FUTURE],
  ["EXPIRED (past)", PAST],
];

describe("one user, one tier, one percent — poster === helper", () => {
  it("resolves the identical percent for both roles, every tier × every expiry state", () => {
    for (const tier of RAW_VALUES) {
      for (const [label, expiresAt] of EXPIRY_STATES) {
        const poster = edgePosterFeePercent(tier, expiresAt);
        const helper = edgeHelperFeePercent(tier, expiresAt);
        expect(
          helper,
          `edge role split for tier=${JSON.stringify(tier)} (${label}): poster ${poster}% vs helper ${helper}%`,
        ).toBe(poster);
      }
    }
  });

  it("holds on the CLIENT runtime too, so the shown percent matches for both roles", () => {
    for (const tier of RAW_VALUES) {
      for (const [label, expiresAt] of EXPIRY_STATES) {
        const poster = uiPosterFeePercent(tier, expiresAt);
        const helper = uiHelperFeePercent(tier, expiresAt);
        expect(
          helper,
          `client role split for tier=${JSON.stringify(tier)} (${label}): poster ${poster}% vs helper ${helper}%`,
        ).toBe(poster);
      }
    }
  });

  it("holds ACROSS runtimes as well — all four resolvers agree on one number", () => {
    for (const tier of RAW_VALUES) {
      for (const [, expiresAt] of EXPIRY_STATES) {
        const values = [
          edgePosterFeePercent(tier, expiresAt),
          edgeHelperFeePercent(tier, expiresAt),
          uiPosterFeePercent(tier, expiresAt),
          uiHelperFeePercent(tier, expiresAt),
        ];
        expect(new Set(values).size, `resolvers disagreed for ${JSON.stringify(tier)}: ${values.join(" / ")}`).toBe(1);
      }
    }
  });
});

describe("expiry is handled identically on both sides (the asymmetry that was fixed)", () => {
  it("a LAPSED paid tier reverts to the free rate for BOTH roles on BOTH runtimes", () => {
    for (const tier of ["basic", "pro", "elite"] as const) {
      const free = TIER_PERKS.free.platformFeePercent; // 12
      expect(edgeHelperFeePercent(tier, PAST)).toBe(free);
      expect(edgePosterFeePercent(tier, PAST)).toBe(free);
      expect(uiHelperFeePercent(tier, PAST)).toBe(free);
      expect(uiPosterFeePercent(tier, PAST)).toBe(free);
    }
  });

  it("an ACTIVE paid tier keeps its discounted rate for BOTH roles on BOTH runtimes", () => {
    for (const tier of LIVE_TIERS) {
      const rate = TIER_PERKS[tier].platformFeePercent;
      expect(edgeHelperFeePercent(tier, FUTURE)).toBe(rate);
      expect(edgePosterFeePercent(tier, FUTURE)).toBe(rate);
      expect(uiHelperFeePercent(tier, FUTURE)).toBe(rate);
      expect(uiPosterFeePercent(tier, FUTURE)).toBe(rate);
    }
  });

  it("the helper-side resolver ACCEPTS an expiry argument at all", () => {
    // The regression this whole file exists for: `feePercentForTier` used to
    // take one parameter, so a helper-side caller could not express expiry even
    // if it wanted to. Asserting on `.length` pins the signature, not just a
    // value — a future refactor that drops the parameter fails here loudly
    // instead of silently re-opening the split.
    expect(edgeHelperFeePercent.length).toBeGreaterThanOrEqual(2);
    expect(edgeHelperFeePercent("elite", PAST)).toBe(12);
    expect(edgeHelperFeePercent("elite")).toBe(8);
  });

  it("a malformed expiry timestamp is NOT treated as expired, on both roles", () => {
    // NaN < Date.now() is false. Pinned so nobody 'fixes' it into re-rating a
    // paid user to 12% because their timestamp column got corrupted.
    expect(edgeHelperFeePercent("elite", "not-a-date")).toBe(8);
    expect(edgePosterFeePercent("elite", "not-a-date")).toBe(8);
    expect(uiHelperFeePercent("elite", "not-a-date")).toBe(8);
    expect(uiPosterFeePercent("elite", "not-a-date")).toBe(8);
  });
});

describe("unknown tiers fall back to the FREE rate, never to a cheaper one", () => {
  it("never resolves below the free rate for a value that is not on the ladder", () => {
    const free = TIER_PERKS.free.platformFeePercent; // 12
    // "plus" AND "PLUS" both left this list on 2026-09-05, when the tier was
    // restored with real live Stripe Prices. Not just the lower-case form:
    // feePercentForTier lowercases before lookup, so every casing of a real
    // tier resolves to that tier's rate by design. "  pro  " stays precisely
    // because that normalisation does NOT trim, so a padded value is still
    // junk and must still fall back to the free rate.
    for (const junk of [null, undefined, "", "nonsense", "premium", "  pro  ", "business", "BUSINESS"]) {
      for (const resolve of [edgeHelperFeePercent, edgePosterFeePercent, uiHelperFeePercent, uiPosterFeePercent]) {
        expect(resolve(junk), `unknown tier ${JSON.stringify(junk)} under-charged`).toBe(free);
      }
    }
  });

  it("never resolves to 0 or 10 for an unknown tier (the two tempting wrong defaults)", () => {
    // 0 would be free money; 10 is the legacy global `platform_settings.helper_fee_percent`
    // that predates the tier ladder and under-charges every free-tier user by 2%.
    for (const resolve of [edgeHelperFeePercent, edgePosterFeePercent, uiHelperFeePercent, uiPosterFeePercent]) {
      expect(resolve("nonsense")).not.toBe(0);
      expect(resolve("nonsense")).not.toBe(10);
    }
  });
});
