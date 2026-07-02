import { describe, it, expect } from "vitest";
import {
  BUSINESS_SEAT_TIERS,
  BUSINESS_SEAT_TIER_TO_PRICE,
  formatSeatPriceMonthly,
} from "./businessSeatTiers";
// The edge source lives in the Deno functions tree. It is plain TS (no Deno
// imports at module scope), so vitest can import it directly. This test guards
// the single source of truth for the business seat tiers — the seats/price a
// user sees on the marketing page, the in-app seat plan, and the tier→Stripe
// price the checkout charges can never silently diverge.
import {
  BUSINESS_SEAT_TIERS as EDGE_BUSINESS_SEAT_TIERS,
  BUSINESS_SEAT_TIER_TO_PRICE as EDGE_BUSINESS_SEAT_TIER_TO_PRICE,
} from "../../supabase/functions/_shared/businessSeatTiers";

describe("business seat-tier config (single source of truth)", () => {
  it("UI and edge derive the exact same tier array", () => {
    // The client module re-exports the edge module, so this is reference-equal;
    // asserting deep-equality still documents + locks the contract explicitly.
    expect(BUSINESS_SEAT_TIERS).toEqual(EDGE_BUSINESS_SEAT_TIERS);
  });

  it("UI and edge derive the same tier→price map", () => {
    expect(BUSINESS_SEAT_TIER_TO_PRICE).toEqual(EDGE_BUSINESS_SEAT_TIER_TO_PRICE);
  });

  it("encodes the canonical marketing figures (Starter/Crew/Team/Enterprise)", () => {
    const byKey = Object.fromEntries(BUSINESS_SEAT_TIERS.map((t) => [t.key, t]));

    expect(byKey.starter).toMatchObject({
      name: "Starter",
      seats: "1",
      priceLabel: "Free",
      priceCents: 0,
      featured: false,
      stripePriceId: null,
    });
    expect(byKey.crew).toMatchObject({
      name: "Crew",
      seats: "2",
      priceLabel: "$20",
      priceCents: 2000,
      featured: false,
    });
    expect(byKey.team).toMatchObject({
      name: "Team",
      seats: "3",
      priceLabel: "$30",
      priceCents: 3000,
      featured: true, // Team is the featured / most-popular tier.
    });
    expect(byKey.enterprise).toMatchObject({
      name: "Enterprise",
      seats: "4+",
      priceLabel: "$40",
      priceCents: 4000,
      featured: false,
    });
  });

  it("has exactly the four canonical tier keys in order", () => {
    expect(BUSINESS_SEAT_TIERS.map((t) => t.key)).toEqual([
      "starter",
      "crew",
      "team",
      "enterprise",
    ]);
  });

  it("exactly one tier is featured (Team)", () => {
    const featured = BUSINESS_SEAT_TIERS.filter((t) => t.featured);
    expect(featured).toHaveLength(1);
    expect(featured[0]?.key).toBe("team");
  });

  it("maps each PAID tier key to the correct existing Stripe Price ID; Free has none", () => {
    // These are the pre-existing Stripe Price IDs, kept as-is. See the ⚠️ caveat
    // in _shared/businessSeatTiers.ts: they still charge the OLD amounts until a
    // human updates the Stripe Price objects in the dashboard.
    expect(BUSINESS_SEAT_TIER_TO_PRICE).toEqual({
      crew: "price_1TQKGYKp2H4b7tECTmOd0rp7",
      team: "price_1TQKGZKp2H4b7tECwr664UEh",
      enterprise: "price_1TQKGaKp2H4b7tECp6ZNxarR",
    });
    // Starter/Free is intentionally absent — it has no checkout.
    expect(BUSINESS_SEAT_TIER_TO_PRICE.starter).toBeUndefined();
  });

  it("formats the in-app monthly price label from the canonical priceLabel", () => {
    expect(formatSeatPriceMonthly("Free")).toBe("Free");
    expect(formatSeatPriceMonthly("$20")).toBe("$20/mo");
    expect(formatSeatPriceMonthly("$30")).toBe("$30/mo");
    expect(formatSeatPriceMonthly("$40")).toBe("$40/mo");
  });
});
