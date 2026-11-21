/**
 * Audit 11-20 night #16: Edit job checks the title and description before it
 * saves (required; 32 and 1000, the jobs_title_length / jobs_description_length
 * CHECKs) and names the field, and both inputs carry maxLength.
 *
 * @mutate src/pages/posts/EditJobDialog.tsx | if (t === 0) return "Add a job title."; | 
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { editJobTextProblem } from "./EditJobDialog";

describe("Edit job: title and description checks", () => {
  it("names the field for blank and too-long text", () => {
    expect(editJobTextProblem("  ", "Mow the yard")).toBe("Add a job title.");
    expect(editJobTextProblem("Mow", "   ")).toBe("Add a description.");
    expect(editJobTextProblem("x".repeat(33), "ok")).toMatch(/job title to 32/);
    expect(editJobTextProblem("Mow", "x".repeat(1001))).toMatch(/description to 1000/);
  });
  it("passes text at the limits", () => {
    expect(editJobTextProblem("x".repeat(32), "y".repeat(1000))).toBeNull();
  });
  it("save() runs the check and both inputs carry maxLength", () => {
    const src = readFileSync(resolve(__dirname, "EditJobDialog.tsx"), "utf8");
    const save = src.slice(src.indexOf("const save = async"), src.indexOf("setSaving(true)"));
    expect(save).toContain("editJobTextProblem(title, description)");
    expect(src).toContain("maxLength={EDIT_JOB_TITLE_MAX}");
    expect(src).toContain("maxLength={EDIT_JOB_DESCRIPTION_MAX}");
  });
});
