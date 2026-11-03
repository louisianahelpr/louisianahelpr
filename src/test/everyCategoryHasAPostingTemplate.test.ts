/**
 * Every job category has a posting template, so the description field's
 * "Tip: ..." prompts show for every category (Q1834, trades lane 2026-10-15:
 * the 12 trades and Declutter help fell back to nothing).
 *
 * The template table is total over the job_category enum's own label table
 * (src/lib/jobCategories.ts), and every template's checklist has prompts.
 * Templates never carry prices (owner rule: never guess prices).
 *
 * @mutate src/lib/postingTemplates.ts |   plumbing: { |   plumbing_x: {
 * @mutate src/lib/postingTemplates.ts | "Do any need cleaning or testing before photos?", | 
 */
import { describe, expect, it } from "vitest";
import { categoryTemplates } from "@/lib/postingTemplates";
import { JOB_CATEGORY_VALUES } from "@/lib/jobCategories";

describe("every job category has a posting template (Q1834)", () => {
  it("reads the real category list", () => {
    expect(JOB_CATEGORY_VALUES.length).toBeGreaterThan(20);
  });

  it("no category is missing a template", () => {
    expect(JOB_CATEGORY_VALUES.filter((c) => !categoryTemplates[c])).toEqual([]);
  });

  it("no template is left over for a category that no longer exists", () => {
    expect(Object.keys(categoryTemplates).filter((k) => !(JOB_CATEGORY_VALUES as string[]).includes(k))).toEqual([]);
  });

  it("every template has at least four checklist prompts and no prices", () => {
    for (const c of JOB_CATEGORY_VALUES) {
      const tpl = categoryTemplates[c];
      if (!tpl) continue;
      expect(tpl.checklist.length, c).toBeGreaterThan(3);
      expect(JSON.stringify(tpl), c).not.toMatch(/\$\s?\d/);
    }
  });
});
