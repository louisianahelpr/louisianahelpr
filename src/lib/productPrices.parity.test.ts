import { describe, it, expect } from "vitest";
import {
  BOOST_FEE_CENTS,
  BGC_FEE_CENTS,
  BOOST_DURATION_HOURS,
  BOOST_DISCOUNT_PCT,
  boostPriceForTier,
  formatFeeUsd,
} from "./productPrices";
// The edge source lives in the Deno functions tree. It is plain TS (no Deno
// imports at module scope), so vitest can import it directly. This test is the
// guard that keeps the duplicated fixed-price constants in sync across the two
// runtimes — the price a user sees can never drift from what Stripe charges.
import {
  BOOST_FEE_CENTS as EDGE_BOOST_FEE_CENTS,
  BGC_FEE_CENTS as EDGE_BGC_FEE_CENTS,
  BOOST_DURATION_HOURS as EDGE_BOOST_DURATION_HOURS,
} from "../../supabase/functions/_shared/productPrices";

describe("fixed Stripe product-price parity (UI ↔ edge)", () => {
  it("boost fee matches across UI and edge", () => {
    expect(BOOST_FEE_CENTS).toBe(EDGE_BOOST_FEE_CENTS);
  });

  it("background-check fee matches across UI and edge", () => {
    expect(BGC_FEE_CENTS).toBe(EDGE_BGC_FEE_CENTS);
  });

  it("boost duration matches across UI and edge", () => {
    expect(BOOST_DURATION_HOURS).toBe(EDGE_BOOST_DURATION_HOURS);
  });

  it("encodes the agreed prices ($3 boost / $34.99 BGC / 24h)", () => {
    expect(BOOST_FEE_CENTS).toBe(300);
    expect(BGC_FEE_CENTS).toBe(3499);
    expect(BOOST_DURATION_HOURS).toBe(24);
  });

  it("formats round dollars without cents and fractional with two decimals", () => {
    expect(formatFeeUsd(BOOST_FEE_CENTS)).toBe("$3");
    expect(formatFeeUsd(BGC_FEE_CENTS)).toBe("$34.99");
  });
});

// The boost DISCOUNT rule lives inline in create-boost-payment/index.ts rather
// than in _shared, so it cannot be imported here the way the fixed prices are.
// These cases therefore transcribe the server's branches literally; if that
// function's tier set or percentage ever changes, this file changes with it.
//
// Server rule (create-boost-payment/index.ts):
//   active elite            → free, no Checkout session
//   active basic | pro      → max(round(BOOST_FEE_CENTS * 80 / 100), 100)
//   everything else         → BOOST_FEE_CENTS
describe("job-boost price by tier (UI mirror of create-boost-payment)", () => {
  it("mirrors the server's 20% subscriber discount", () => {
    expect(BOOST_DISCOUNT_PCT).toBe(20);
  });

  it("charges an active Elite poster nothing", () => {
    expect(boostPriceForTier("elite", true)).toEqual({ free: true });
  });

  it("charges active Basic and Pro the discounted $2.40, not the $3 list price", () => {
    for (const tier of ["basic", "pro"]) {
      const price = boostPriceForTier(tier, true);
      expect(price).toEqual({ free: false, cents: 240, discounted: true });
      expect(formatFeeUsd(240)).toBe("$2.40");
    }
  });

  it("charges Free and Business posters the full list price", () => {
    for (const tier of ["free", "business", "nonsense", null, undefined]) {
      expect(boostPriceForTier(tier, true)).toEqual({
        free: false,
        cents: BOOST_FEE_CENTS,
        discounted: false,
      });
    }
  });

  it("charges full price once a subscription has lapsed, as the server does", () => {
    for (const tier of ["elite", "pro", "basic"]) {
      expect(boostPriceForTier(tier, false)).toEqual({
        free: false,
        cents: BOOST_FEE_CENTS,
        discounted: false,
      });
    }
  });
});
