import { describe, it, expect } from "vitest";
import {
  BOOST_FEE_CENTS,
  BGC_FEE_CENTS,
  BOOST_DURATION_HOURS,
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
