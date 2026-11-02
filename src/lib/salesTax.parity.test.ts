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
import { categoryLabels } from "@/components/job-card/activityConstants";
import { resolve } from "node:path";
import { latestFunctionDefs } from "@/test/helpers/rpcErrorInventory";

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
   * Q2083 (owner Option 1, 2026-10-25): the taxable list is the tax memo's
   * set (its Q4 table is carried in docs/OPEN.md Q2083). La. R.S. 47:301.3
   * enumerates the taxable services; the one this app falls under is item 7,
   * "repairs and maintenance of tangible personal property", which turns on
   * MOVABLE vs IMMOVABLE: item 7(a) names automobiles and vehicles, item 7(b)
   * appliances, machinery and equipment, and work on a building or its
   * component parts (Civil Code art. 466) is outside it. So by category only
   * auto and appliance repair are taxed; house repairs and the real-property
   * trades are not (this reverses the 2026-08-23 handyman and 2026-10-17
   * Q1831 "covered either way" lists). The movable jobs inside handyman,
   * welding and assembly wait on the per-job posting answer (rest of Q2083).
   *
   * Pinned as an exact list on purpose: adding a category here silently
   * changes what every poster in it is CHARGED, so it should never be possible
   * to do by accident. If this assertion fails, that is the point — confirm the
   * statutory basis before updating it.
   */
  const TAXABLE = ["auto_repair", "appliance_repair"];

  // The memo's NOT-taxable column (Q2083): real property, plus assembly
  // (probably not, MEDIUM) and welding (depends on the job).
  const MEMO_NOT_TAXABLE = [
    "handyman", "electrical", "plumbing", "hvac", "roofing", "carpentry", "flooring",
    "concrete_masonry", "fencing", "pressure_washing", "assembly", "welding",
  ];

  it("Q2083: house repairs, the real-property trades, assembly and welding are not taxed by category", () => {
    for (const c of MEMO_NOT_TAXABLE) {
      expect(ALL_CATEGORIES, c).toContain(c);
      expect(uiIsLaborTaxable(c), `${c} (client)`).toBe(false);
      expect(edgeIsLaborTaxable(c), `${c} (edge)`).toBe(false);
      expect(edgeHasTaxableLine(c), `${c} (edge line)`).toBe(false);
    }
    expect(MEMO_NOT_TAXABLE.length).toBeGreaterThan(11);
  });

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
    expect(estimatedSalesTax(200, "auto_repair", 10)).toBe(20);
  });

  it("returns null for a taxable category whose parish rate isn't known yet", () => {
    expect(estimatedSalesTax(200, "appliance_repair", null)).toBeNull();
  });
});

// MONEY. The edge module is the authority create-payment imports to set each
// line's Stripe `tax_code`, so dropping a category here changes what real
// posters in real parishes are charged. The mutation is the exact shape that
// hid for 16 days elsewhere: a member quietly missing from a pinned list.
// Q2083: re-pointed at the memo's list and its newest migration. Red on a dropped
// member, on a house trade taxed again (the reversed Q1831 shape) and on either
// SQL list going stale.
// @mutate supabase/functions/_shared/salesTax.ts |   "auto_repair",\n  "appliance_repair",\n]); |   "auto_repair",\n]);
// @mutate supabase/functions/_shared/salesTax.ts |   "auto_repair",\n  "appliance_repair",\n]); |   "auto_repair",\n  "appliance_repair",\n  "handyman",\n]);
// @mutate src/lib/salesTax.ts |   "auto_repair",\n  "appliance_repair",\n]); |   "auto_repair",\n  "appliance_repair",\n  "plumbing",\n]);
// @mutate supabase/migrations/20261102033237_q2083_tax_movable_repairs_only.sql | ARRAY['auto_repair', 'appliance_repair']), false) | ARRAY['auto_repair', 'appliance_repair', 'handyman']), false)
// @mutate supabase/migrations/20261102033237_q2083_tax_movable_repairs_only.sql | (COALESCE(OLD.category::text, '') | (COALESCE(OLD.category, '')
// @mutate supabase/migrations/20261102033237_q2083_tax_movable_repairs_only.sql | ARRAY['auto_repair', 'appliance_repair'];\nBEGIN | ARRAY['auto_repair'];\nBEGIN

// Q1831/Q1833: the database holds the same list twice. enforce_funded_category_tax_class
// refuses a paid job crossing the taxed line, and is_category_taxable is the "Taxable"
// column of the Helpr earnings export (which said Taxable for cleaning, yard work,
// moving, painting and delivery — never taxed — until 20261017055441). Both are read
// from their NEWEST definition, so a later restatement with a stale list fails here.
describe("the database's taxable lists are TAXABLE_CATEGORIES (Q1831, Q1833)", () => {
  const defs = latestFunctionDefs(resolve(__dirname, "../../supabase/migrations"));
  const quoted = (s: string) => [...s.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();

  it("enforce_funded_category_tax_class names exactly TAXABLE_CATEGORIES", () => {
    const body = defs.get("enforce_funded_category_tax_class")?.body ?? "";
    const arr = body.match(/taxable\s+CONSTANT\s+text\[\]\s*:=\s*ARRAY\[([^\]]*)\]/i)?.[1] ?? "";
    expect(quoted(arr).length).toBeGreaterThan(1);
    expect(quoted(arr)).toEqual([...edgeTaxableCategories].sort());
  });

  it("is_category_taxable names exactly TAXABLE_CATEGORIES", () => {
    const body = defs.get("is_category_taxable")?.body ?? "";
    const arr = body.match(/ARRAY\[([^\]]*)\]/i)?.[1] ?? "";
    expect(quoted(arr).length).toBeGreaterThan(1);
    expect(quoted(arr)).toEqual([...edgeTaxableCategories].sort());
    // The export column reads only this function: no IN-list of enum literals left over.
    expect(body).not.toMatch(/::public\.job_category/);
  });

  // An enum `category` coalesced to '' casts '' to the enum and raises 22P02 on every
  // call: enforce_funded_category_tax_class did this from 20260924082243 until
  // 20261017055441, so no poster could change a job's category. Compare as ::text.
  it("no function coalesces a category column to '' without a ::text cast", () => {
    const bad = [...defs].flatMap(([name, d]) =>
      [...d.body.matchAll(/COALESCE\(\s*[\w.]*category\s*,\s*''\s*\)/gi)].map((m) => `${name} (${d.file}): ${m[0]}`),
    );
    expect(defs.size).toBeGreaterThan(500);
    expect(bad).toEqual([]);
  });
});
