/**
 * Q2083 (b) / Q1727 (a): a job's sales tax is priced at the JOB ADDRESS.
 * jobTaxAddress is the one gate every job-tax Stripe call (create-payment,
 * calculate-tax, charge-recurring-visits) sends through, and sessionJobTaxCents
 * is how the webhook reads the tax a job-site session charged.
 */
import { describe, it, expect } from "vitest";
import { jobTaxAddress, sessionJobTaxCents, JOB_TAX_ADDRESS_SOURCE } from "../../supabase/functions/_shared/jobTaxAddress";

// @mutate supabase/functions/_shared/jobTaxAddress.ts | const LA_ZIP_RE = /^(?:70\d\|71[0-4])\d{2}$/; | const LA_ZIP_RE = /^\d{5}$/;
// @mutate supabase/functions/_shared/jobTaxAddress.ts | calc.startsWith("taxcalc_") && typeof raw | true && typeof raw
describe("jobTaxAddress", () => {
  it("accepts every Louisiana ZIP prefix (700-714) and refuses the rest", () => {
    const accepted: string[] = [];
    for (let p = 690; p <= 720; p++) if (jobTaxAddress(`${p}01`)) accepted.push(String(p));
    expect(accepted.length).toBeGreaterThan(10);
    expect(accepted).toEqual(["700", "701", "702", "703", "704", "705", "706", "707", "708", "709", "710", "711", "712", "713", "714"]);
  });

  it("returns the one address shape, and a ZIP+4 as its five digits", () => {
    expect(jobTaxAddress("70503")).toEqual({ postal_code: "70503", state: "LA", country: "US" });
    expect(jobTaxAddress(" 70112-1234 ")).toEqual({ postal_code: "70112", state: "LA", country: "US" });
    expect(JOB_TAX_ADDRESS_SOURCE).toBe("billing");
  });

  it("refuses no ZIP, a short or junk ZIP, and a ZIP+4 with junk after it", () => {
    for (const z of [null, undefined, "", "7050", "abcde", 70503, "77002", "70503x", "70503-12"]) {
      expect(jobTaxAddress(z), String(z)).toBeNull();
    }
  });
});

describe("sessionJobTaxCents", () => {
  it("a job-site session's tax is its job_tax_cents; any other session reads Stripe's figure; none is null", () => {
    expect(sessionJobTaxCents({ metadata: { tax_calculation_id: "taxcalc_1", job_tax_cents: "1100" }, total_details: { amount_tax: 0 } })).toBe(1100);
    expect(sessionJobTaxCents({ metadata: { tax_calculation_id: "", job_tax_cents: "" }, total_details: { amount_tax: 263 } })).toBe(263);
    expect(sessionJobTaxCents({ metadata: { tax_calculation_id: "taxcalc_1", job_tax_cents: "-5" }, total_details: { amount_tax: 0 } })).toBe(0);
    // A calculation id that is not Stripe's taxcalc_ is not a job-site session.
    expect(sessionJobTaxCents({ metadata: { tax_calculation_id: "x", job_tax_cents: "1100" }, total_details: { amount_tax: 7 } })).toBe(7);
    expect(sessionJobTaxCents({ metadata: null, total_details: null })).toBeNull();
    expect(sessionJobTaxCents(undefined)).toBeNull();
  });
});
