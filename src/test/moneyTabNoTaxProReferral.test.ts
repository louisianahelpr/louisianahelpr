/**
 * JA-52 (audit 11-01): the Money tab's 1099-K note ended "talk to a tax professional about your situation". Owner rule
 * (no accountant or lawyer): never send people to a CPA or tax pro; state the published rule and cite it. The note keeps
 * the IRS link and says the IRS rule plainly (income is reportable whether or not a 1099-K is issued).
 *
 * @mutate src/components/profile/EarningsTab.tsx | for the current numbers. What you earn here is income you report whether or not a 1099-K is issued (IRS). | for the current numbers, and talk to a tax professional about your situation.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";

describe("the Money tab's tax note (JA-52)", () => {
  it("cites the IRS and never refers people to a tax professional or CPA", () => {
    const src = blankComments(readFileSync(resolve(__dirname, "../components/profile/EarningsTab.tsx"), "utf8"));
    expect(src).toContain("https://www.irs.gov/businesses/understanding-your-form-1099-k");
    expect(src).toContain("income you report whether or not a 1099-K is issued (IRS)");
    expect(src).not.toMatch(/tax professional|tax pro\b|accountant|\bCPA\b/i);
  });
});
