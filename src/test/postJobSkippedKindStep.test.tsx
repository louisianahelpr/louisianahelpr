/**
 * F115 (UI audit 2026-11-09): picking "Yard" on step 1 jumps to step 3, and step 2 "Kind of job" was ticked
 * although it was never shown. The numbers stay fixed (owner 2026-10-21, postJobScreens.ts), so the skipped
 * step shows as skipped: a dash on the desktop rail, an unfilled segment on the phone bar, never a tick.
 * Inventory: every one-category group (Yard, Something else) is checked, and a group with choices keeps its tick.
 * @mutate src/components/postjob/PostJobStepRail.tsx |           const done = n < step && !skipped; |           const done = n < step;
 * @mutate src/components/postjob/PostJobStepHeader.tsx |             if (skipped) return | if (false) return
 * @mutate src/components/postjob/postJobScreens.ts |   return !!id && JOB_CATEGORY_GROUPS.find((g) => g.id === id)?.items.length === 1; |   return false;
 * @mutate src/pages/post-job/FormStep.tsx |       <PostJobStepRail screen={screenOfFormPage(page, !!openGroup)} canPick={canPickStep} onPick={pickStep} category={form.category} /> |       <PostJobStepRail screen={screenOfFormPage(page, !!openGroup)} canPick={canPickStep} onPick={pickStep} />
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { PostJobStepRail } from "@/components/postjob/PostJobStepRail";
import { PostJobStepHeader } from "@/components/postjob/PostJobStepHeader";
import { kindIsAutoFilled } from "@/components/postjob/postJobScreens";
import { JOB_CATEGORY_GROUPS } from "@/lib/jobCategoryGroups";

const singles = JOB_CATEGORY_GROUPS.filter((g) => g.items.length === 1).map((g) => g.items[0].value);
const multi = JOB_CATEGORY_GROUPS.find((g) => g.items.length > 1)!.items[0].value;

describe("F115: a skipped 'Kind of job' is never ticked", () => {
  it("the one-category groups are auto-filled; a group with choices is not", () => {
    expect(singles.length).toBeGreaterThan(0);
    expect(singles).toContain("yard_work");
    for (const c of singles) expect(kindIsAutoFilled(c)).toBe(true);
    expect(kindIsAutoFilled(multi)).toBe(false);
    expect(kindIsAutoFilled("")).toBe(false);
  });

  it("desktop rail: Yard shows step 2 as skipped (dash, no tick, no reopen button); a real kind pick keeps its tick", () => {
    for (const c of singles) {
      const { container, unmount } = render(<PostJobStepRail screen="details" category={c} onPick={() => {}} />);
      const items = screen.getAllByRole("listitem");
      expect(items[1].querySelector("[data-step-skipped]")?.textContent).toBe("–");
      expect(items[1].querySelector("svg")).toBeNull();
      expect(items[1].textContent).toContain("not needed");
      expect(items[0].querySelector("svg")).not.toBeNull();
      expect(container.querySelectorAll("[data-step-skipped]").length).toBe(1);
      unmount();
    }
    const { unmount } = render(<PostJobStepRail screen="details" category={multi} onPick={() => {}} />);
    expect(screen.getAllByRole("listitem")[1].querySelector("svg")).not.toBeNull();
    expect(document.querySelector("[data-step-skipped]")).toBeNull();
    unmount();
  });

  it("phone bar: Yard leaves segment 2 unfilled on Details; the count still reads 3 of 6", () => {
    const { unmount } = render(<PostJobStepHeader screen="details" question="q" helper="h" category="yard_work" />);
    const bar = screen.getByRole("progressbar");
    expect(bar.children[1].hasAttribute("data-step-skipped")).toBe(true);
    expect(bar.querySelectorAll("[data-done]").length).toBe(2);
    expect(bar.getAttribute("aria-valuetext")).toBe("Step 3 of 6");
    unmount();
    render(<PostJobStepHeader screen="details" question="q" helper="h" category={multi} />);
    expect(screen.getByRole("progressbar").querySelectorAll("[data-done]").length).toBe(3);
  });

  it("every rail and header in the flow is given the category", () => {
    const form = readFileSync("src/pages/post-job/FormStep.tsx", "utf8");
    const review = readFileSync("src/pages/post-job/CheckoutStepView.tsx", "utf8");
    const tags = [...form.matchAll(/<PostJobStep(?:Rail|Header)\b[^>]*?\/>/gs), ...review.matchAll(/<PostJobStep(?:Rail|Header)\b[\s\S]*?\/>/g)].map((m) => m[0]);
    expect(tags.length).toBeGreaterThan(6);
    for (const t of tags) expect(t, t.slice(0, 80)).toContain("category={form.category}");
  });
});
