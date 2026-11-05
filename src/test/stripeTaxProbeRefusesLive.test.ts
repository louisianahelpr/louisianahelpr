/**
 * The Stripe Tax probe (scripts/stripe-tax-probe.mjs, Q1998/Q1918/Q2148) runs only in Stripe TEST mode: it refuses a
 * live or missing key before any call, and pays only a cs_test_ Checkout page.
 */
// @mutate scripts/stripe-tax-probe.mjs | if (!/^(sk\|rk)_test_/.test(k)) return | if (!/^(sk\|rk)_/.test(k)) return
// @mutate scripts/stripe-tax-probe.mjs | !/\/cs_test_[A-Za-z0-9]+/.test(url) | !/\/cs_[A-Za-z0-9_]+/.test(url)
// @mutate scripts/stripe-tax-probe.mjs |     return t >= from && t <= to; |     return t >= from;
// @mutate scripts/stripe-tax-probe.mjs |       if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } |       if (false) { /* doubled quote dropped */ }
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cellSeconds, csvFields, form, refuseKey, rowsInWindow } from "../../scripts/stripe-tax-probe.mjs";
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
  it("finds report rows by the probe's hour, since Tax reports never name the charge (run 41950902906)", () => {
    expect(csvFields('"a","b, c","d""e",4')).toEqual(["a", "b, c", 'd"e', "4"]);
    expect(cellSeconds("1793833331")).toBe(1793833331);
    expect(cellSeconds("2026-11-04 23:02:11")).toBe(1793833331);
    expect(cellSeconds("2026-11-04T23:02:11Z")).toBe(1793833331);
    expect(Number.isNaN(cellSeconds("soon"))).toBe(true);
    const csv = ['"id","type","transaction_date","tax_amount"', '"tax_1","transaction","2026-11-04 23:03:24","9.00"',
      '"tax_2","reversal","2026-11-04 23:40:00","-4.50"', '"tax_3","transaction","2026-11-04 21:00:00","9.00"',
      '"tax_4","transaction","2026-11-05 01:00:00","9.00"', ""].join("\n");
    expect(rowsInWindow(csv, 1793833331 - 60, 1793833331 + 3600).map((l) => csvFields(l)[0])).toEqual(["tax_1", "tax_2"]);
    expect(rowsInWindow('"id","when"\n"x","2026-11-04 23:03:24"', 0, 2e9)).toEqual([]);
  });
});
