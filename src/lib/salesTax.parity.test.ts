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
  /**
   * The taxable list is TWO categories, and the second is a judgement call.
   *
   * LA R.S. 47:301.3 enumerates ten taxable services; the one this app falls
   * under is "repairs and maintenance of tangible personal property", which
   * turns on MOVABLE vs IMMOVABLE. `assembly` is unambiguously movable.
   * `handyman` is both — repairing a lamp is taxable, replacing a kitchen
   * faucet is real property and is not — and the owner chose to collect on all
   * of it rather than miss the movable half (2026-08-23).
   *
   * Pinned as an exact list on purpose: adding a category here silently
   * changes what every poster in it is CHARGED, so it should never be possible
   * to do by accident. If this assertion fails, that is the point — confirm the
   * statutory basis before updating it.
   */
  const TAXABLE = ["assembly", "handyman"];

  it("taxes exactly the enumerated categories — the create-payment tax_code list", () => {
    expect([...uiTaxableCategories]).toEqual(TAXABLE);
    expect([...edgeTaxableCategories]).toEqual([...uiTaxableCategories]);
    for (const c of ALL_CATEGORIES) {
      expect(uiIsLaborTaxable(c), `${c}`).toBe(TAXABLE.includes(c));
    }
  });

  it("pet care is NOT taxable — it is not an enumerated service", () => {
    // Confirmed 2026-08-23 against R.S. 47:301.3: grooming and boarding appear
    // nowhere on the ten-service list, and LDR treats veterinary and grooming
    // as exempt. The module previously carried pet_care as "ambiguous".
    expect(uiIsLaborTaxable("pet_care")).toBe(false);
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
