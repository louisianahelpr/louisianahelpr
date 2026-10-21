/**
 * Owner, 2026-10-21: "Templates: leave the price EMPTY (no prefill)." A
 * template's typical_price is typed into src/data/sampleJobs.ts, not measured,
 * so it never becomes the poster's budget.
 *
 * @mutate src/pages/post-job/useJobEntry.ts | not one measured from jobs (truth rule), so the poster names their own.\n    setBudget(""); | not one measured from jobs (truth rule), so the poster names their own.\n    setBudget(String(sample.typical_price));
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(__dirname, "../pages/post-job/useJobEntry.ts"), "utf8");
const body = src.slice(src.indexOf("const applyTemplateFields"), src.indexOf("const clearOffer"));

describe("a template leaves the price empty", () => {
  it("applyTemplateFields clears the budget and never reads typical_price", () => {
    expect(body.length).toBeGreaterThan(50);
    expect(body).toContain('setBudget("")');
    expect(body.replace(/\/\/.*$/gm, "")).not.toMatch(/typical_price/);
  });
});
