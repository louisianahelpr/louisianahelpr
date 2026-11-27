/**
 * Owner 2026-11-17: a Browse job ROW showed its category icon twice, in the thumbnail tile and again, small, before
 * the category name on its place line. The row keeps the tile and its label draws no icon (JobCategoryTab
 * icon={false}); the raw-HTML shell (browseShellCards.mjs) draws the same label with no icon slot. The photo hero and
 * the activity cards keep the small icon (they have no category tile). A short list also sat ~80px above the footer
 * (PublicHeaderPage pb-16 plus the feed's pb-4): the page now pads pb-4.
 *
 * @mutate src/components/dashboard/JobCard.tsx | <JobCategoryTab category={job.category} icon={false} tinted className="shrink-0" /> | <JobCategoryTab category={job.category} tinted className="shrink-0" />
 * @mutate src/components/job/JobCategoryTab.tsx |       {icon && ( |       {true && (
 * @mutate src/pages/home/DashboardGuest.tsx |       bottomPaddingClassName="pb-4" |       bottomPaddingClassName="pb-16"
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { JobCategoryTab } from "@/components/job/JobCategoryTab";
import { blankComments } from "./helpers/blankNonCode";

const src = (p: string) => blankComments(readFileSync(p, "utf8"));

describe("a Browse row names its category without repeating the tile's icon", () => {
  it("JobCategoryTab draws the icon by default and none with icon={false}", () => {
    const on = render(<JobCategoryTab category="cleaning" />);
    expect(on.container.querySelectorAll("svg").length).toBe(1);
    on.unmount();
    const off = render(<JobCategoryTab category="cleaning" icon={false} />);
    expect(off.container.querySelectorAll("svg").length).toBe(0);
    expect(off.container.textContent).toMatch(/clean/i);
  });

  it("the feed row passes icon={false}; the photo hero keeps the icon", () => {
    const card = src("src/components/dashboard/JobCard.tsx");
    const tabs = card.match(/<JobCategoryTab [^>]*\/>/g) ?? [];
    expect(tabs.length).toBe(2);
    // Owner 2026-11-27: the row's label is tinted (its tile's colour); still no icon.
    expect(tabs).toContain('<JobCategoryTab category={job.category} icon={false} tinted className="shrink-0" />');
    expect(tabs).toContain("<JobCategoryTab category={job.category} flexible />");
  });

  it("the raw-HTML shell's label has no icon slot, and the page pads pb-4 under a short list", () => {
    const shell = src("src/lib/browseShellCards.mjs");
    expect(shell).toContain('<span class="${c.catLabel}" style="color:${jobCategoryTint(job.category).color}"><span class="font-sans truncate">');
    expect(src("src/pages/home/DashboardGuest.tsx")).toContain('bottomPaddingClassName="pb-4"');
    expect(shell).toContain('<div class="px-5 sm:px-8 lg:px-12 pb-4"><div class="mx-auto page-measure">');
  });
});
