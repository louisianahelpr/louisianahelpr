/**
 * Q1918 + Q2148 (2) part 2: the admin "Sales tax corrections" CSV the owner
 * files with. Each line says how much to subtract from Stripe's Tax report.
 *
 * @mutate src/lib/salesTaxCorrectionsCsv.ts |       dollars(Math.max(0, -Number(r.adjustment_cents))), |       dollars(Number(r.adjustment_cents)),
 * @mutate src/lib/salesTaxCorrectionsCsv.ts |     const month = Number.isNaN(when.getTime()) ? "" : when.toISOString().slice(0, 7); |     const month = "";
 * @mutate src/lib/salesTaxCorrectionsCsv.ts |   const from = new Date(Date.UTC(now.getUTCFullYear(), 0, 1)); |   const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
 * @mutate src/components/admin/AdminExport.tsx |     const { data, error } = await supabase.rpc("admin_sales_tax_adjustments", { p_from: from, p_to: to }); |     const { data, error } = { data: [], error: null };
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SALES_TAX_CORRECTIONS_HEADER, salesTaxCorrectionLines, salesTaxCorrectionsPeriod } from "@/lib/salesTaxCorrectionsCsv";
import { blankComments } from "./helpers/blankNonCode";

const ROWS = [
  { occurred_at: "2026-11-04T12:00:00.000Z", kind: "dispute_lost", flow: "job", job_id: "job-1", stripe_payment_intent_id: "pi_1", stripe_charge_id: "ch_1", state_code: "LA", postal_code: "70501", tax_reported_cents: 900, tax_collected_cents: 0, adjustment_cents: -900 },
  { occurred_at: "2026-12-01T00:00:00.000Z", kind: "partial_capture", flow: "shop_order", job_id: null, stripe_payment_intent_id: "pi_2", stripe_charge_id: null, state_code: "LA", postal_code: null, tax_reported_cents: 900, tax_collected_cents: 270, adjustment_cents: -630 },
];

describe("sales-tax corrections CSV", () => {
  it("one line per correction, with the month, the reason in words and the amount to subtract", () => {
    const lines = salesTaxCorrectionLines(ROWS);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines).toEqual([
      '"2026-11","2026-11-04T12:00:00Z","Lost chargeback","job","LA","70501","job-1","pi_1","ch_1","9.00","0.00","9.00"',
      '"2026-12","2026-12-01T00:00:00Z","Card hold captured in part","shop_order","LA","","","pi_2","","9.00","2.70","6.30"',
    ]);
    expect(SALES_TAX_CORRECTIONS_HEADER.split(",")).toHaveLength(lines[0].split('","').length);
  });

  it("covers this year so far, through today (UTC)", () => {
    expect(salesTaxCorrectionsPeriod(new Date("2026-11-04T23:30:00Z"))).toEqual({ from: "2026-01-01T00:00:00.000Z", to: "2026-11-05T00:00:00.000Z" });
  });

  it("the admin Data Exports screen reads the admin-only RPC (live, non-seed rows only, server side)", () => {
    const src = blankComments(readFileSync(join(__dirname, "../components/admin/AdminExport.tsx"), "utf8"));
    expect(src).toMatch(/supabase\.rpc\("admin_sales_tax_adjustments", \{ p_from: from, p_to: to \}\)/);
    expect(src).toMatch(/downloadCSV\("sales-tax-corrections", SALES_TAX_CORRECTIONS_HEADER, salesTaxCorrectionLines\(rows\)\)/);
  });
});
