import { describe, it, expect } from "vitest";
import {
  HELPER_FEE_LEGACY_FALLBACK_PERCENT,
  helperFeePercentOrLegacy,
} from "./legacyFeeFallback";

describe("helperFeePercentOrLegacy — a comped 0% is a real fee", () => {
  // The bug this replaces, in one line:
  //   (Number(j.helper_fee_percent) || HELPER_FEE_LEGACY_FALLBACK_PERCENT)
  // On a comped $200 job stamped 0%, `Number(0) || 10` is 10, so the admin
  // user list reported the helper's pay as $200 x 0.90 = $180 — $20 less than
  // the transfer they actually received.
  it("trusts a stamped 0%", () => {
    expect(helperFeePercentOrLegacy(0)).toBe(0);
    expect(200 * (1 - helperFeePercentOrLegacy(0) / 100)).toBe(200);
    // what the old `||` produced:
    expect(200 * (1 - (Number(0) || HELPER_FEE_LEGACY_FALLBACK_PERCENT) / 100)).toBe(180);
  });

  it("falls back only when the column is genuinely absent", () => {
    expect(helperFeePercentOrLegacy(null)).toBe(HELPER_FEE_LEGACY_FALLBACK_PERCENT);
    expect(helperFeePercentOrLegacy(undefined)).toBe(HELPER_FEE_LEGACY_FALLBACK_PERCENT);
    expect(helperFeePercentOrLegacy("")).toBe(HELPER_FEE_LEGACY_FALLBACK_PERCENT);
    expect(helperFeePercentOrLegacy("garbage")).toBe(HELPER_FEE_LEGACY_FALLBACK_PERCENT);
  });

  it("passes through real percentages, including string-typed numerics", () => {
    expect(helperFeePercentOrLegacy(12)).toBe(12);
    expect(helperFeePercentOrLegacy("8")).toBe(8);
    expect(helperFeePercentOrLegacy(11.5)).toBe(11.5);
  });
});
