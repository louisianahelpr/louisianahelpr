/**
 * The Stripe Tax probe (scripts/stripe-tax-probe.mjs, Q1998/Q1918/Q2148) runs only in Stripe TEST mode: it refuses a
 * live or missing key before any call, and pays only a cs_test_ Checkout page.
 */
// @mutate scripts/stripe-tax-probe.mjs | if (!/^(sk\|rk)_test_/.test(k)) return | if (!/^(sk\|rk)_/.test(k)) return
// @mutate scripts/stripe-tax-probe.mjs | !/\/cs_test_[A-Za-z0-9]+/.test(url) | !/\/cs_[A-Za-z0-9_]+/.test(url)
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { form, refuseKey } from "../../scripts/stripe-tax-probe.mjs";
import { blankComments } from "@/test/helpers/blankNonCode";

describe("stripe-tax-probe stays in TEST mode", () => {
  it("refuses a live, restricted-live or missing key, accepts test keys", () => {
    for (const k of ["sk_live_x", "rk_live_x", "", "pk_test_x"]) expect(refuseKey(k), k).toBeTruthy();
    for (const k of ["sk_test_x", "rk_test_x"]) expect(refuseKey(k), k).toBeNull();
  });
  it("pays only a cs_test_ Checkout page", () => {
    const src = blankComments(readFileSync("scripts/stripe-tax-probe.mjs", "utf8"));
    expect(src).toContain('host !== "checkout.stripe.com" || !/\\/cs_test_[A-Za-z0-9]+/.test(url)');
  });
  it("form-encodes nested Stripe params", () => {
    expect(String(form({ a: { b: [{ c: 1 }] }, d: "x", e: undefined }))).toBe("a%5Bb%5D%5B0%5D%5Bc%5D=1&d=x");
  });
});
