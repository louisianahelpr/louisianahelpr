/**
 * Every Stripe line item carries a tax code, from ONE place (ME-043).
 *
 * The finding: an `assembly` job (a category our own rule taxes) billed to a
 * Baton Rouge address came back Tax $0.00 on the Stripe test account, and
 * nothing in the app could tell that apart from the correct $0 on an exempt
 * job. Which half of that is Stripe configuration (a Louisiana registration)
 * and which is classification (the labor tax code) is the CPA review on
 * docs/OPEN.md Q374. The code-side CLASS this guards:
 *
 *   1. every `product_data` in supabase/functions carries a `tax_code`, and
 *      every Stripe Tax calculation line does too. A line with none takes the
 *      account's default code, which is a dashboard setting, not a decision;
 *   2. no `txcd_` literal outside _shared/salesTax.ts, so the CPA answer is a
 *      one-line change instead of a hunt through three functions;
 *   3. every function that turns on `automatic_tax` saves the address Checkout
 *      collects (`customer_update.address = "auto"`) and pins `tax_behavior`
 *      on every price. Without the first, an existing Stripe Customer with no
 *      address makes Stripe refuse the session (`customer_tax_location_invalid`,
 *      proved on create-pro-checkout 2026-09-06); boost, gift card and
 *      background check were all still missing it;
 *   4. every real job category maps to a code: the taxable ones to the taxable
 *      labor code, every other one to Nontaxable;
 *   5. the webhook's "taxable but $0 in Louisiana" signal fires on exactly that
 *      case, and stripe-webhook calls it.
 *
 * @mutate supabase/functions/create-bgc-payment/index.ts | ...(customerId ? { customer_update: { address: "auto" as const } } : {}), | ...({}),
 * @mutate supabase/functions/create-payment/index.ts | description: "Added so your Helpr receives the full tip.", tax_code: NONTAXABLE_TAX_CODE }, | description: "Added so your Helpr receives the full tip." },
 * @mutate supabase/functions/calculate-tax/index.ts | tax_code: TAXABLE_LABOR_TAX_CODE, | tax_code: "txcd_20030000",
 * @mutate supabase/functions/create-gift-card-checkout/index.ts |           tax_behavior: "exclusive",\n | \n
 * @mutate supabase/functions/_shared/salesTax.ts |   return isLaborTaxable(category) ? TAXABLE_LABOR_TAX_CODE : NONTAXABLE_TAX_CODE; |   return NONTAXABLE_TAX_CODE;
 * @mutate supabase/functions/_shared/salesTax.ts |     && (billingState ?? "").trim().toUpperCase() === "LA"; |     && billingState === "Louisiana";
 * @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts | if (taxedZeroOnTaxableLouisianaLabor(sessionTaxCents, | if (false && taxedZeroOnTaxableLouisianaLabor(sessionTaxCents,
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import {
  laborTaxCode,
  NONTAXABLE_TAX_CODE,
  TAXABLE_CATEGORIES,
  TAXABLE_LABOR_TAX_CODE,
  taxedZeroOnTaxableLouisianaLabor,
} from "../../supabase/functions/_shared/salesTax";
import { categoryLabels } from "@/components/job-card/activityConstants";
import { blankComments } from "./helpers/blankNonCode";
import { walkSource } from "./helpers/walkSource";

const ROOT = resolve(__dirname, "../..");
const TAX_MODULE = "supabase/functions/_shared/salesTax.ts";

const sources = walkSource([resolve(ROOT, "supabase/functions")], [".ts"])
  .filter((f) => !/\.test\.ts$/.test(f))
  .map((f) => ({ file: relative(ROOT, f), src: blankComments(readFileSync(f, "utf8")) }));

/** Each balanced `{…}` (or `(…)`) that follows `needle`, needle included. */
function blocksAfter(src: string, needle: string, open: "{" | "("): string[] {
  const close = open === "{" ? "}" : ")";
  const out: string[] = [];
  let i = src.indexOf(needle);
  while (i >= 0) {
    let j = src.indexOf(open, i + needle.length - 1);
    const start = i;
    let depth = 0;
    for (; j < src.length; j++) {
      if (src[j] === open) depth++;
      else if (src[j] === close && --depth === 0) break;
    }
    out.push(src.slice(start, j + 1));
    i = src.indexOf(needle, j);
  }
  return out;
}

describe("Stripe tax codes (ME-043)", () => {
  it("every product_data and every Stripe Tax calculation carries a tax_code", () => {
    const missing: string[] = [];
    let productData = 0;
    let calcs = 0;
    for (const { file, src } of sources) {
      for (const b of blocksAfter(src, "product_data: {", "{")) {
        productData++;
        if (!/\btax_code:/.test(b)) missing.push(`${file}: ${b.slice(0, 90).replace(/\s+/g, " ")}`);
      }
      for (const c of blocksAfter(src, "tax.calculations.create(", "(")) {
        calcs++;
        if (!/\btax_code:/.test(c)) missing.push(`${file}: tax.calculations.create without tax_code`);
      }
    }
    expect(missing).toEqual([]);
    // Inventory floors: the scan must actually find the lines it checks.
    expect(productData).toBeGreaterThan(10);
    expect(calcs).toBeGreaterThan(1);
  });

  it("no txcd_ literal outside _shared/salesTax.ts", () => {
    const offenders = sources
      .filter(({ file, src }) => file !== TAX_MODULE && /["'`]txcd_\d+/.test(src))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
    const own = sources.find((s) => s.file === TAX_MODULE);
    expect(own && /"txcd_\d+"/.test(own.src)).toBe(true);
  });

  it("every automatic_tax function saves the collected address and pins tax_behavior on every price", () => {
    const problems: string[] = [];
    let files = 0;
    for (const { file, src } of sources) {
      if (!/automatic_tax:\s*\{\s*enabled:\s*true/.test(src)) continue;
      files++;
      if (!/customer_update\s*(?::|=)\s*\{\s*address:\s*["']auto["']/.test(src)) {
        problems.push(`${file}: automatic_tax without customer_update.address = "auto"`);
      }
      for (const b of blocksAfter(src, "price_data: {", "{")) {
        if (!/\btax_behavior:/.test(b)) problems.push(`${file}: price_data without tax_behavior`);
      }
    }
    expect(problems).toEqual([]);
    expect(files).toBeGreaterThan(4);
  });

  it("every job category maps to a tax code: taxable ones to the labor code, the rest to Nontaxable", () => {
    const categories = Object.keys(categoryLabels);
    expect(categories.length).toBeGreaterThan(5);
    expect(TAXABLE_LABOR_TAX_CODE).not.toBe(NONTAXABLE_TAX_CODE);
    expect(NONTAXABLE_TAX_CODE).toBe("txcd_00000000");
    // A taxable category the app cannot post is a typo in the list.
    expect([...TAXABLE_CATEGORIES].filter((c) => !categories.includes(c))).toEqual([]);
    for (const c of categories) {
      expect(laborTaxCode(c), c).toBe(TAXABLE_CATEGORIES.has(c) ? TAXABLE_LABOR_TAX_CODE : NONTAXABLE_TAX_CODE);
    }
    for (const c of [null, undefined, "", "not_a_category"]) {
      expect(laborTaxCode(c)).toBe(NONTAXABLE_TAX_CODE);
    }
  });

  it("flags $0 tax on taxable labor billed to Louisiana, and nothing else", () => {
    expect(taxedZeroOnTaxableLouisianaLabor(0, 10_000, "assembly", "LA")).toBe(true);
    expect(taxedZeroOnTaxableLouisianaLabor(0, 10_000, "handyman", " la ")).toBe(true);
    expect(taxedZeroOnTaxableLouisianaLabor(1_000, 10_000, "assembly", "LA")).toBe(false);
    expect(taxedZeroOnTaxableLouisianaLabor(0, 10_000, "yard_work", "LA")).toBe(false);
    expect(taxedZeroOnTaxableLouisianaLabor(0, 10_000, "assembly", "TX")).toBe(false);
    expect(taxedZeroOnTaxableLouisianaLabor(0, 10_000, "assembly", null)).toBe(false);
    expect(taxedZeroOnTaxableLouisianaLabor(0, 0, "assembly", "LA")).toBe(false);
    const webhook = sources.find((s) => s.file === "supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts");
    expect(webhook?.src).toMatch(/if \(taxedZeroOnTaxableLouisianaLabor\(sessionTaxCents,/);
    expect(webhook?.src).toMatch(/const sessionTaxCents = session\.total_details\?\.amount_tax;/);
  });
});
