// ROLE rule: what each side of a job pays (owner, 2026-10-11).
//
//   POSTER  pays NO platform percentage on any tier: only a service fee equal
//           to Stripe's card cost on the charge (posterFees.ts, both runtimes).
//   HELPR   pays the tier commission (12 / 11 / 10 / 9 / 8), deducted from
//           the payout (helperFees.ts edge, subscriptionTiers.ts client).
//
// Until 2026-10-11 the rule was "one user, one tier, one percent": the poster's
// service fee aliased the Helpr commission, and this file pinned poster ===
// helper. The owner removed the poster fee ("I'm worried no one will post when
// they can easily post for free on Facebook"), so this file now pins the NEW
// split: the poster side reads no tier at all, and the Helpr side keeps one
// resolver per runtime that must agree, tier by tier, at every expiry state.
//
// History kept because it explains the expiry tests below: the poster resolver
// once took `(tier, expiresAt)` while the helper-side `feePercentForTier` took
// only `(tier)`, so only one side could see a lapsed subscription.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { posterCardCostFeeCents as uiPosterFee, POSTER_SERVICE_FEE_PERCENT as UI_POSTER_PCT } from "./posterFees";
import { tierFeePercent as uiHelperFeePercent, TIER_PERKS, type SubscriptionTier } from "./subscriptionTiers";
import {
  feePercentForTier as edgeHelperFeePercent,
  TIER_FEE_PERCENT as EDGE_TIER_FEE_PERCENT,
} from "../../supabase/functions/_shared/helperFees";
import { posterCardCostFeeCents as edgePosterFee, POSTER_SERVICE_FEE_PERCENT as EDGE_POSTER_PCT } from "../../supabase/functions/_shared/posterFees";
import { stripeProcessingCostCents } from "./stripeFees";
import { blankComments } from "@/test/helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
// Every tier the app can put in `profiles.subscription_tier`, plus the values a
// real row can actually hold that are NOT tiers (null, junk, mixed case).
//
// DERIVED, NEVER HAND-LISTED. This list read `["free", "basic", "pro", "elite"]`
// — written out by hand — for the whole life of the file, which meant `plus`
// (restored 2026-09-05 with real live Stripe Prices, 9%) was in NEITHER ladder's
// coverage here. Every loop below silently skipped it, so the edge ladder's
// `plus` rung could have been set to any number at all — including below Elite's
// 8% — with this money guard fully green. The inventory now comes from the two
// ladders' OWN key sets, unioned, so a rung that exists on only one side is
// still walked (and fails loudly on the side that is missing it).
const LIVE_TIERS = [
  ...new Set([
    ...Object.keys(TIER_PERKS),
    ...Object.keys(EDGE_TIER_FEE_PERCENT),
  ]),
].sort() as SubscriptionTier[];
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

describe("the inventory this file walks is the app's own", () => {
  it("covers every rung on BOTH ladders, and is not a list someone has to remember", () => {
    // FLOOR: a derivation that silently produced nothing would make every
    // per-tier loop below pass vacuously.
    expect(LIVE_TIERS.length, "no tiers derived from either fee ladder").toBeGreaterThanOrEqual(5);
    // Named explicitly because this is the rung the hand-written list lost:
    // `plus` shipped, was pulled, and came back, and the list was never updated.
    expect(LIVE_TIERS).toContain("plus" as SubscriptionTier);
    // The two ladders must hold the SAME rungs. A tier on one side only is a
    // role split by construction: the runtime that lacks it charges the free
    // rate while the other charges the discounted one.
    expect(
      [...Object.keys(EDGE_TIER_FEE_PERCENT)].sort(),
      "the edge ladder and TIER_PERKS hold different tiers",
    ).toEqual([...Object.keys(TIER_PERKS)].sort());
  });
});

describe("the poster pays the card cost only; the Helpr pays the tier commission", () => {
  it("the poster-fee modules read NO tier: no tier import, no tier parameter, no percentage", () => {
    for (const file of ["src/lib/posterFees.ts", "supabase/functions/_shared/posterFees.ts"]) {
      const code = blankComments(readFileSync(resolve(ROOT, file), "utf8"));
      expect(code, `${file} imports a tier ladder`).not.toMatch(/helperFees|subscriptionTiers|tierPerks|TIER_|tierFeePercent|feePercentForTier/);
      expect(code, `${file} exports a tier resolver`).not.toMatch(/posterFeePercentForTier|subscription_tier/);
    }
    expect(UI_POSTER_PCT).toBe(0);
    expect(EDGE_POSTER_PCT).toBe(0);
    // Only the budget is required: there is no slot to pass a percent into.
    expect(uiPosterFee.length).toBe(1);
    expect(edgePosterFee.length).toBe(1);
  });

  it("the poster fee is Stripe's cost on the charge and never the tier percent, for every tier", () => {
    for (const tier of LIVE_TIERS) {
      const helperPct = TIER_PERKS[tier].platformFeePercent;
      for (const budget of [3000, 10_000, 25_000]) {
        const fee = edgePosterFee(budget);
        expect(uiPosterFee(budget)).toBe(fee);
        expect(fee, `${tier} $${budget / 100}`).not.toBe(Math.round((budget * helperPct) / 100));
        expect(fee).toBeGreaterThanOrEqual(stripeProcessingCostCents(budget + fee));
        expect(fee - stripeProcessingCostCents(budget + fee)).toBeLessThanOrEqual(1);
      }
    }
  });

  it("the Helpr commission resolves the identical percent on BOTH runtimes, every tier × every expiry state", () => {
    for (const tier of RAW_VALUES) {
      for (const [label, expiresAt] of EXPIRY_STATES) {
        const edge = edgeHelperFeePercent(tier, expiresAt);
        const ui = uiHelperFeePercent(tier, expiresAt);
        expect(ui, `runtime split for tier=${JSON.stringify(tier)} (${label}): edge ${edge}% vs client ${ui}%`).toBe(edge);
      }
    }
  });
});

describe("expiry is handled identically on both runtimes (the asymmetry that was fixed)", () => {
  it("a LAPSED paid tier reverts to the free rate on BOTH runtimes", () => {
      // DERIVED, never hand-listed. This literal omitted `plus` (restored
      // 2026-09-05), so the loop silently skipped that rung — the same shape
      // that let Plus's fee be set below Elite's guarded floor with every test
      // green. Object.keys(TIER_PERKS) grows on its own.
    // Paid tiers only — `free` has no rate to revert FROM.
    for (const tier of (Object.keys(TIER_PERKS) as (keyof typeof TIER_PERKS)[]).filter((t) => t !== "free")) {
      const free = TIER_PERKS.free.platformFeePercent; // 12
      expect(edgeHelperFeePercent(tier, PAST)).toBe(free);
      expect(uiHelperFeePercent(tier, PAST)).toBe(free);
    }
  });

  it("an ACTIVE paid tier keeps its discounted rate on BOTH runtimes", () => {
    for (const tier of LIVE_TIERS) {
      const rate = TIER_PERKS[tier].platformFeePercent;
      expect(edgeHelperFeePercent(tier, FUTURE)).toBe(rate);
      expect(uiHelperFeePercent(tier, FUTURE)).toBe(rate);
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

  it("a malformed expiry timestamp is NOT treated as expired, on both runtimes", () => {
    // NaN < Date.now() is false. Pinned so nobody 'fixes' it into re-rating a
    // paid user to 12% because their timestamp column got corrupted.
    expect(edgeHelperFeePercent("elite", "not-a-date")).toBe(8);
    expect(uiHelperFeePercent("elite", "not-a-date")).toBe(8);
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
      for (const resolve of [edgeHelperFeePercent, uiHelperFeePercent]) {
        expect(resolve(junk), `unknown tier ${JSON.stringify(junk)} under-charged`).toBe(free);
      }
    }
  });

  it("never resolves to 0 or 10 for an unknown tier (the two tempting wrong defaults)", () => {
    // 0 would be free money; 10 is the legacy global `platform_settings.helper_fee_percent`
    // that predates the tier ladder and under-charges every free-tier user by 2%.
    for (const resolve of [edgeHelperFeePercent, uiHelperFeePercent]) {
      expect(resolve("nonsense")).not.toBe(0);
      expect(resolve("nonsense")).not.toBe(10);
    }
  });
});

// MONEY. Move the edge ladder's Plus rung off the UI's 9% and the two runtimes
// charge the same person two different percentages. This directive is the whole
// reason the tier inventory above is derived rather than hand-listed: against
// the old hand-written `["free","basic","pro","elite"]` it SURVIVED — every
// loop skipped Plus, so its edge rate could be set to anything, 7% or 0%,
// with this file green.
// @mutate supabase/functions/_shared/helperFees.ts |   plus: 9, |   plus: 7,
// The poster-fee module growing a tier dependency again (the coupling the
// owner removed on 2026-10-11) fails the first role test above.
// @mutate supabase/functions/_shared/posterFees.ts | import { STRIPE_FLAT_CENTS, STRIPE_PCT, stripeProcessingCostCents } from "./stripeFees.ts"; | import { STRIPE_FLAT_CENTS, STRIPE_PCT, stripeProcessingCostCents } from "./stripeFees.ts";\nimport { TIER_FEE_PERCENT } from "./helperFees.ts";
