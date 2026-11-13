/**
 * Design audit A J1 (owner approved 11-08, change 2 of 5): Jobs Browse gets the category chips row under the search
 * bar, the same pattern as Declutter. Owner 2026-11-13 ("Where are the other categories from post a job?") replaced the
 * old "only groups with a job, busiest first, never opens an empty list" rule: "All" first, then ALL 8 Post a job
 * groups in JOB_CATEGORY_GROUPS order, always, as one scroll row, even with an empty feed. The row reads no jobs, so
 * the viewer's own (Browse-hidden) jobs cannot count toward it. A group alone on an empty list gets its own empty
 * state ("No Yard jobs near you yet." + Post a job / Notify me), never "No jobs match your filters." / a blank list.
 * A chip sets the filter sheet's own category value; tapping the lit chip again shows everything. The phone header
 * draws the row on Browse only (never under Posted / Working's back row). Labels are Post a job's t("postJob.group.*").
 *
 * @mutate src/components/dashboard/JobCategoryChips.tsx |       {JOB_CATEGORY_GROUPS.map((g) => { |       {JOB_CATEGORY_GROUPS.slice(0, 3).map((g) => {
 * @mutate src/components/dashboard/JobCategoryChips.tsx | onChange(value === g.id ? null : g.id) | onChange(g.id)
 * @mutate src/components/dashboard/JobCategoryChips.tsx |   return w && w !== key ? w : groupTileLabel(g); |   return groupTileLabel(g);
 * @mutate src/lib/browseEmptyCopy.ts |   if (!i.groupLabel \|\| i.activeFilterCount !== 1 \|\| i.searchQuery.trim()) return null; |   if (!i.groupLabel) return null;
 * @mutate src/components/dashboard/BrowseTasksFeed.tsx |         const narrowed = filters.hasFilters && !groupTitle; |         const narrowed = filters.hasFilters;
 * @mutate src/pages/jobs/JobsSection.tsx |           {tab === "browse" && browse?.chips} |           {browse?.chips}
 * @mutate src/pages/home/Dashboard.tsx | { search: phoneBrowseSearch, chips: phoneBrowseChips } | { search: phoneBrowseSearch }
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { JobCategoryChips } from "@/components/dashboard/JobCategoryChips";
import { JOB_CATEGORY_GROUPS } from "@/lib/jobCategoryGroups";
import { browseGroupEmptyTitle } from "@/lib/browseEmptyCopy";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => blankComments(readFileSync(join(ROOT, p), "utf8"));

const chipNames = () => screen.getAllByRole("button").map((b) => b.getAttribute("data-category-chip"));
const ALL_8 = ["home", "yard", "moving_errands", "auto", "pets", "events", "trades", "other"];

afterEach(() => { cleanup(); __resetLangForTests(); });

describe("Jobs Browse category chips (design audit A J1; owner 11-13: all 8 groups)", () => {
  it("All first, then all 8 Post a job groups in Post a job's order, with no jobs to go on", () => {
    expect(JOB_CATEGORY_GROUPS.map((g) => g.id)).toEqual(ALL_8);
    render(<JobCategoryChips value={null} onChange={() => {}} />);
    expect(chipNames()).toEqual(["all", ...ALL_8]);
    expect(screen.getByRole("button", { name: "All" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /Moving & errands/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Something else/ })).toBeTruthy();
    const row = document.querySelector("[data-chip-row='job-categories']")!;
    expect(row.className).toContain("overflow-x-auto"); // one scroll row, Declutter's layout
  });

  it("a chip sets the group id; the lit chip tapped again clears it", () => {
    const onChange = vi.fn();
    const { rerender } = render(<JobCategoryChips value={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Yard/ }));
    expect(onChange).toHaveBeenLastCalledWith("yard");
    rerender(<JobCategoryChips value="yard" onChange={onChange} />);
    expect(screen.getByRole("button", { name: /Yard/ }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /Yard/ }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("the chips read no jobs: Dashboard passes none, so the viewer's own hidden jobs cannot count", () => {
    const feed = read("src/pages/home/Dashboard.tsx");
    expect(feed).toContain("<JobCategoryChips value={filters.selectedCategory} onChange={filters.setSelectedCategory}");
    expect(feed).not.toMatch(/<JobCategoryChips[^>]*jobs=/);
  });

  it("Spanish: the chips use Post a job's own words", async () => {
    await act(async () => { setLang("es"); await ensureLangLoaded(); });
    render(<JobCategoryChips value={null} onChange={() => {}} />);
    expect(await screen.findByRole("button", { name: /Jardín/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Mudanzas y mandados/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Todo" })).toBeTruthy();
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

  it("the phone header draws the row under the tabs on Browse only, fed by the feed's own filter", () => {
    const section = read("src/pages/jobs/JobsSection.tsx");
    const feed = read("src/pages/home/Dashboard.tsx");
    expect(section).toContain('{tab === "browse" && browse?.chips}');
    expect(section.indexOf('{tab === "browse" && browse?.chips}')).toBeGreaterThan(section.lastIndexOf("<SectionTabs"));
    expect(feed).toContain("{ search: phoneBrowseSearch, chips: phoneBrowseChips }");
  });
});
