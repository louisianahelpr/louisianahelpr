import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Owner 2026-10-25 (pop-up): the Helpr's earnings tax export drops the
 * "Platform Fee" column; it shows the job's gross, parish tax and net payout
 * only, in the CSV, the PDF and the dialog's description.
 */
const src = readFileSync(resolve(__dirname, "EarningsExport.tsx"), "utf8");

describe("the earnings export shows no fee", () => {
  it("no fee column, figure or word in the CSV, the PDF or the description", () => {
    expect(src).not.toMatch(/Platform Fee|platform fee|"Fee"|r\.platform_fee|totals\.fee|totFee/);
  });
  it("still has gross, parish tax and net payout", () => {
    expect(src).toMatch(/"Gross Earnings \(USD\)", "Parish Tax Collected \(USD\)", "Net Payout \(USD\)"/);
    expect(src).toMatch(/"Gross", "Parish Tax", "Net Payout"/);
  });
});
