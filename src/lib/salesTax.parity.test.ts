import { describe, it, expect } from "vitest";
import {
  estimatedSalesTax,
  hasTaxableLine as uiHasTaxableLine,
  isLaborTaxable as uiIsLaborTaxable,
  salesTaxCents as uiSalesTaxCents,
  TAXABLE_CATEGORIES as uiTaxableCategories,
} from "./salesTax";
// The edge module is plain TS (no Deno imports at module scope), so vitest can
// import it directly. This is the guard that keeps the quoted tax identical to
// the charged tax — the exact drift that made the checkout screen show a total
// ~10% higher than what Stripe billed.
import {
  hasTaxableLine as edgeHasTaxableLine,
  isLaborTaxable as edgeIsLaborTaxable,
  salesTaxCents as edgeSalesTaxCents,
  TAXABLE_CATEGORIES as edgeTaxableCategories,
} from "../../supabase/functions/_shared/salesTax";
import { categoryLabels } from "@/components/activity/activityConstants";

const ALL_CATEGORIES = Object.keys(categoryLabels);

describe("sales-tax classification parity (UI ↔ edge)", () => {
  it("classifies every real category identically on both runtimes", () => {
    for (const c of [...ALL_CATEGORIES, null, undefined, "", "not_a_category"]) {
      expect(uiIsLaborTaxable(c)).toBe(edgeIsLaborTaxable(c));
      expect(uiHasTaxableLine(c)).toBe(edgeHasTaxableLine(c));
    }
  });

  it("computes the same tax in cents across a grid of budgets, categories and rates", () => {
    for (const budgetCents of [100, 2500, 10_000, 19_999, 250_000]) {
      for (const c of ALL_CATEGORIES) {
        for (const rate of [0, 4.45, 8.45, 9.95, 10.5, 11]) {
          expect(uiSalesTaxCents(budgetCents, c, rate)).toBe(edgeSalesTaxCents(budgetCents, c, rate));
        }
      }
    }
  });
});

describe("LA taxability rules", () => {
  it("taxes assembly and nothing else — the create-payment tax_code list", () => {
    expect([...uiTaxableCategories]).toEqual(["assembly"]);
    expect([...edgeTaxableCategories]).toEqual([...uiTaxableCategories]);
    for (const c of ALL_CATEGORIES) {
      expect(uiIsLaborTaxable(c), `${c}`).toBe(c === "assembly");
    }
  });

  it("quotes exactly $0 tax for an exempt category, at any parish rate", () => {
    // The regression: the screen used to quote ~10% of the whole charge here.
    expect(estimatedSalesTax(200, "cleaning", 10.45)).toBe(0);
    expect(estimatedSalesTax(200, "yard_work", null)).toBe(0);
  });

  it("taxes ONLY the labor line for a taxable category — never the fees", () => {
    // $200 budget at 10% = $20, regardless of the service fee riding alongside.
    expect(estimatedSalesTax(200, "assembly", 10)).toBe(20);
  });

  it("returns null for a taxable category whose parish rate isn't known yet", () => {
    expect(estimatedSalesTax(200, "assembly", null)).toBeNull();
  });
});
