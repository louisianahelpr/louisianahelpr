import { describe, it, expect } from "vitest";
import {
  estimatedSalesTax,
  hasTaxableLine as uiHasTaxableLine,
  isLaborTaxable as uiIsLaborTaxable,
  salesTaxCents as uiSalesTaxCents,
  TAXABLE_CATEGORIES as uiTaxableCategories,
  TAXED_KINDS as uiTaxedKinds,
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
  TAXED_KINDS as edgeTaxedKinds,
  laborTaxCode as edgeLaborTaxCode,
  CLEANING_TPP_TAX_CODE,
  CLOTHES_CLEANING_TAX_CODE,
  GARMENT_ALTERATIONS_TAX_CODE,
  NONTAXABLE_TAX_CODE,
  TAXABLE_LABOR_TAX_CODE,
} from "../../supabase/functions/_shared/salesTax";
import { readdirSync, readFileSync } from "node:fs";
import { blankSqlComments } from "@/test/helpers/blankNonCode";
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
// @mutate supabase/migrations/20261102152453_q2083_job_tax_kind.sql | ARRAY['auto_repair', 'appliance_repair']), false) | ARRAY['auto_repair', 'appliance_repair', 'handyman']), false)
// @mutate supabase/migrations/20261102152453_q2083_job_tax_kind.sql |      AND (COALESCE(OLD.category::text, '') | (COALESCE(OLD.category, '')
// @mutate supabase/migrations/20261102152453_q2083_job_tax_kind.sql | ARRAY['auto_repair', 'appliance_repair'];\n  taxed_kinds | ARRAY['auto_repair'];\n  taxed_kinds
// Q2083 part 2: the poster's taxed-kind answer (owner Option 1).
// @mutate supabase/migrations/20261102152453_q2083_job_tax_kind.sql |   taxed_kinds CONSTANT text[] := ARRAY['item_repair', 'fabric_cleaning', 'clothes_cleaning', 'clothing_alterations']; |   taxed_kinds CONSTANT text[] := ARRAY['item_repair', 'fabric_cleaning', 'clothing_alterations'];
// @mutate supabase/migrations/20261102152453_q2083_job_tax_kind.sql |       OR COALESCE(_tax_kind = ANY (ARRAY['item_repair', 'fabric_cleaning', 'clothes_cleaning', 'clothing_alterations']), false); |       OR false;
// @mutate supabase/migrations/20261102152453_q2083_job_tax_kind.sql |   BEFORE UPDATE OF category, tax_kind ON public.jobs |   BEFORE UPDATE OF category ON public.jobs
// @mutate supabase/functions/_shared/salesTax.ts |   if (taxKind === "clothing_alterations") return GARMENT_ALTERATIONS_TAX_CODE; |
// @mutate supabase/functions/_shared/salesTax.ts |   if (taxKind === "clothes_cleaning") return CLOTHES_CLEANING_TAX_CODE; |
// @mutate supabase/functions/_shared/salesTax.ts |   if (taxKind === "fabric_cleaning") return CLEANING_TPP_TAX_CODE; |
// @mutate supabase/functions/_shared/salesTax.ts |   "fabric_cleaning",\n  "clothes_cleaning",\n | "fabric_cleaning",\n
// @mutate src/lib/salesTax.ts |   return TAXABLE_CATEGORIES.has(category ?? "") \|\| TAXED_KINDS.has(taxKind ?? ""); |   return TAXABLE_CATEGORIES.has(category ?? "");

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

// Q2083 part 2 (owner Option 1, 2026-10-25): Post a Job asks whether the job is
// repair of a movable item, cleaning of carpet / furniture / clothes, or
// alterations (jobs.tax_kind), and only those are taxed besides the two
// movable-repair categories. La. R.S. 47:301.3 items (5) and (7).
describe("the poster's taxed-kind answer taxes the labor (Q2083 part 2)", () => {
  const KINDS = [null, undefined, "", "item_repair", "fabric_cleaning", "clothes_cleaning", "clothing_alterations", "laundry", "other"];

  it("the kind lists are the same on both runtimes, exactly Option 1's four", () => {
    expect([...edgeTaxedKinds]).toEqual(["item_repair", "fabric_cleaning", "clothes_cleaning", "clothing_alterations"]);
    expect([...uiTaxedKinds]).toEqual([...edgeTaxedKinds]);
  });

  it("classifies every category x kind identically on both runtimes, and the same tax", () => {
    let n = 0;
    for (const c of [...ALL_CATEGORIES, null, ""]) {
      for (const k of KINDS) {
        expect(uiIsLaborTaxable(c, k)).toBe(edgeIsLaborTaxable(c, k));
        expect(uiHasTaxableLine(c, k)).toBe(edgeHasTaxableLine(c, k));
        expect(uiSalesTaxCents(10_000, c, 10.45, k)).toBe(edgeSalesTaxCents(10_000, c, 10.45, k));
        n++;
      }
    }
    expect(n).toBeGreaterThan(200);
  });

  it("any category is taxed with a taxed kind; with no kind only the movable-repair categories are", () => {
    expect(edgeIsLaborTaxable("cleaning", null)).toBe(false);
    expect(edgeIsLaborTaxable("cleaning", "fabric_cleaning")).toBe(true);
    expect(edgeIsLaborTaxable("cleaning", "clothes_cleaning")).toBe(true);
    expect(edgeIsLaborTaxable("handyman", "item_repair")).toBe(true);
    expect(edgeIsLaborTaxable("other", "clothing_alterations")).toBe(true);
    expect(edgeIsLaborTaxable("cleaning", "other")).toBe(false);
    // A house repair (no kind) stays untaxed: Option 1 stops taxing the trades.
    expect(edgeIsLaborTaxable("handyman", null)).toBe(false);
    expect(edgeIsLaborTaxable("plumbing", null)).toBe(false);
    expect(edgeIsLaborTaxable("auto_repair", null)).toBe(true);
    expect(estimatedSalesTax(200, "cleaning", 10, "fabric_cleaning")).toBe(20);
    expect(estimatedSalesTax(200, "cleaning", 10, null)).toBe(0);
  });

  it("the labor line's Stripe code: a taxed category keeps the repair code; a kind picks its own", () => {
    expect(edgeLaborTaxCode("auto_repair", null)).toBe(TAXABLE_LABOR_TAX_CODE);
    expect(edgeLaborTaxCode("appliance_repair", "fabric_cleaning")).toBe(TAXABLE_LABOR_TAX_CODE);
    expect(edgeLaborTaxCode("handyman", "item_repair")).toBe(TAXABLE_LABOR_TAX_CODE);
    expect(edgeLaborTaxCode("cleaning", "fabric_cleaning")).toBe(CLEANING_TPP_TAX_CODE);
    expect(edgeLaborTaxCode("cleaning", "clothes_cleaning")).toBe(CLOTHES_CLEANING_TAX_CODE);
    expect(edgeLaborTaxCode("other", "clothing_alterations")).toBe(GARMENT_ALTERATIONS_TAX_CODE);
    expect(CLOTHES_CLEANING_TAX_CODE).toBe("txcd_20090004");
    expect(edgeLaborTaxCode("other", "laundry")).toBe(NONTAXABLE_TAX_CODE);
    expect(edgeLaborTaxCode("handyman", null)).toBe(NONTAXABLE_TAX_CODE);
    expect(edgeLaborTaxCode("cleaning", "other")).toBe(NONTAXABLE_TAX_CODE);
  });

  const defs = latestFunctionDefs(resolve(__dirname, "../../supabase/migrations"));
  const quoted = (x: string) => [...x.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();

  it("is_job_labor_taxable names exactly TAXABLE_CATEGORIES and TAXED_KINDS", () => {
    const body = defs.get("is_job_labor_taxable")?.body ?? "";
    const arrays = [...body.matchAll(/ARRAY\[([^\]]*)\]/gi)].map((m) => quoted(m[1]));
    expect(arrays).toHaveLength(2);
    expect(arrays[0]).toEqual([...edgeTaxableCategories].sort());
    expect(arrays[1]).toEqual([...edgeTaxedKinds].sort());
  });

  it("enforce_funded_category_tax_class names exactly TAXED_KINDS and compares the kind on both sides", () => {
    const body = defs.get("enforce_funded_category_tax_class")?.body ?? "";
    const arr = body.match(/taxed_kinds\s+CONSTANT\s+text\[\]\s*:=\s*ARRAY\[([^\]]*)\]/i)?.[1] ?? "";
    expect(quoted(arr)).toEqual([...edgeTaxedKinds].sort());
    expect(body).toMatch(/COALESCE\(OLD\.tax_kind, ''\) = ANY \(taxed_kinds\)/);
    expect(body).toMatch(/COALESCE\(NEW\.tax_kind, ''\) = ANY \(taxed_kinds\)/);
  });

  it("the NEWEST trg_funded_category_tax_class fires on a tax_kind change too", () => {
    const dir = resolve(__dirname, "../../supabase/migrations");
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    const creating = files.filter((f) => /CREATE TRIGGER trg_funded_category_tax_class\b/.test(blankSqlComments(readFileSync(resolve(dir, f), "utf8"))));
    expect(creating.length).toBeGreaterThan(0);
    const sql = blankSqlComments(readFileSync(resolve(dir, creating[creating.length - 1]), "utf8"));
    expect(sql).toMatch(/CREATE TRIGGER trg_funded_category_tax_class\s+BEFORE UPDATE OF category, tax_kind ON public\.jobs/);
  });
});
