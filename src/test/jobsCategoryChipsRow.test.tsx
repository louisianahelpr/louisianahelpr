/**
 * Jobs Browse's categories. History: design audit A J1 (owner 11-08) put a category chip row under the search bar; owner
 * 11-13 made it every Post a job group. Owner 11-25 ("move the category chips into the filter bc they take up too much
 * space here") took the row off Browse: the groups are the Filters sheet's FIRST section (Post a job's order and
 * words), and what is on shows under the tabs as small removable chips ("Yard ×"), on Browse only. A group alone on an
 * empty list still gets its own empty state ("No Yard jobs near you yet." + Post a job / Notify me), never "No jobs
 * match your filters." / a blank list.
 *
 * @mutate src/components/dashboard/JobFilters.tsx |       {JOB_CATEGORY_GROUPS.map((g) => { |       {JOB_CATEGORY_GROUPS.slice(0, 3).map((g) => {
 * @mutate src/components/dashboard/JobActiveFilters.tsx |   return isJobCategoryGroupId(value) ? wordInLang(`postJob.group.${value}`, categoryFilterLabel(value)) : categoryFilterLabel(value); |   return categoryFilterLabel(value);
 * @mutate src/lib/browseEmptyCopy.ts |   if (!i.groupLabel \|\| i.activeFilterCount !== 1 \|\| i.searchQuery.trim()) return null; |   if (!i.groupLabel) return null;
 * @mutate src/components/dashboard/BrowseTasksFeed.tsx |         const narrowed = filters.hasFilters && !groupTitle; |         const narrowed = filters.hasFilters;
 * @mutate src/pages/jobs/JobsSection.tsx | <ScrollAwayRows>{tab === "browse" && browse?.chips}</ScrollAwayRows> | <ScrollAwayRows>{browse?.chips}</ScrollAwayRows>
 * @mutate src/pages/home/Dashboard.tsx | { search: phoneBrowseSearch, chips: phoneBrowseChips } | { search: phoneBrowseSearch }
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { CategoryContent } from "@/components/dashboard/JobFilters";
import { JobActiveFilters } from "@/components/dashboard/JobActiveFilters";
import { JOB_CATEGORY_GROUPS } from "@/lib/jobCategoryGroups";
import { browseGroupEmptyTitle } from "@/lib/browseEmptyCopy";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => blankComments(readFileSync(join(ROOT, p), "utf8"));
const ALL_8 = ["home", "yard", "moving_errands", "auto", "pets", "events", "trades", "other"];

afterEach(() => { cleanup(); __resetLangForTests(); });

describe("Jobs categories live in Filters (owner 11-25)", () => {
  it("the sheet's Category offers every Post a job group in Post a job's order", () => {
    expect(JOB_CATEGORY_GROUPS.map((g) => g.id)).toEqual(ALL_8);
    render(<CategoryContent selectedCategory={null} setSelectedCategory={() => {}} />);
    const ids = [...document.querySelectorAll("[data-category-group]")].map((b) => b.getAttribute("data-category-group"));
    expect(ids).toEqual(ALL_8);
  });

  it("Spanish: the filters-on chip uses Post a job's own words", async () => {
    await act(async () => { setLang("es"); await ensureLangLoaded(); });
    render(<JobActiveFilters category="yard" onClearCategory={() => {}} />);
    expect(await screen.findByText("Jardín")).toBeTruthy();
  });

  it("a group with no jobs gets its own empty state, not the filtered one", () => {
    expect(browseGroupEmptyTitle({ groupLabel: "Yard", activeFilterCount: 1, searchQuery: "" })).toBe("No Yard jobs near you yet.");
    expect(browseGroupEmptyTitle({ groupLabel: "Yard", activeFilterCount: 2, searchQuery: "" })).toBeNull();
    expect(browseGroupEmptyTitle({ groupLabel: "Yard", activeFilterCount: 2, searchQuery: "rake" })).toBeNull();
    expect(browseGroupEmptyTitle({ groupLabel: null, activeFilterCount: 1, searchQuery: "" })).toBeNull();
    const feed = read("src/components/dashboard/BrowseTasksFeed.tsx");
    expect(feed).toContain("const narrowed = filters.hasFilters && !groupTitle;");
    // Not narrowed -> Post a job + Notify me (EmptyFeedActions), not "Clear filters".
    expect(feed).toMatch(/narrowed \? \([\s\S]*?<EmptyFeedActions onNotify=\{notifyWhenWorkLands\} \/>/);
  });

  it("the phone header draws the filters-on chips under the tabs on Browse only, fed by the feed's own filter", () => {
    const section = read("src/pages/jobs/JobsSection.tsx");
    const feed = read("src/pages/home/Dashboard.tsx");
    expect(section).toContain('{tab === "browse" && browse?.chips}');
    expect(section.indexOf('{tab === "browse" && browse?.chips}')).toBeGreaterThan(section.lastIndexOf("<SectionTabs"));
    expect(feed).toContain("{ search: phoneBrowseSearch, chips: phoneBrowseChips }");
  });
});
