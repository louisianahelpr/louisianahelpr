/**
 * Design audit A J1 (owner approved 11-08, change 2 of 5): Jobs Browse gets the category chips row under the search
 * bar, the same pattern as Declutter. "All" first, then the category groups that have a job in the feed, busiest
 * first; a chip sets the filter sheet's own category value; tapping the lit chip again shows everything; a feed of one
 * group draws no row. The phone header draws the row on Browse only (never under Posted / Working's back row).
 *
 * @mutate src/components/dashboard/JobCategoryChips.tsx | (n.get(b) ?? 0) - (n.get(a) ?? 0) \|\| | (n.get(a) ?? 0) - (n.get(b) ?? 0) \|\|
 * @mutate src/components/dashboard/JobCategoryChips.tsx | onChange(value === g.id ? null : g.id) | onChange(g.id)
 * @mutate src/components/dashboard/JobCategoryChips.tsx |   const shown = !(groups.length < 2 && !value); |   const shown = true;
 * @mutate src/pages/jobs/JobsSection.tsx |           {tab === "browse" && browse?.chips} |           {browse?.chips}
 * @mutate src/pages/home/Dashboard.tsx | { search: phoneBrowseSearch, chips: phoneBrowseChips } | { search: phoneBrowseSearch }
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { JobCategoryChips } from "@/components/dashboard/JobCategoryChips";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => blankComments(readFileSync(join(ROOT, p), "utf8"));

const jobs = [
  { category: "yard_work" },
  { category: "moving" },
  { category: "errands" },
  { category: "cleaning" },
  { category: "delivery" },
  { category: null },
];

const chipNames = () => screen.getAllByRole("button").map((b) => b.getAttribute("data-category-chip"));

describe("Jobs Browse category chips (design audit A J1)", () => {
  it("All first, then the groups with jobs, busiest first (moving+errands+delivery = 3, then home, yard by board order)", () => {
    render(<JobCategoryChips jobs={jobs} value={null} onChange={() => {}} />);
    const names = chipNames();
    expect(names.length).toBeGreaterThan(2);
    expect(names).toEqual(["all", "moving_errands", "home", "yard"]);
    expect(screen.getByRole("button", { name: "All" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("a chip sets the group id; the lit chip tapped again clears it", () => {
    const onChange = vi.fn();
    const { rerender } = render(<JobCategoryChips jobs={jobs} value={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Yard/ }));
    expect(onChange).toHaveBeenLastCalledWith("yard");
    rerender(<JobCategoryChips jobs={jobs} value="yard" onChange={onChange} />);
    expect(screen.getByRole("button", { name: /Yard/ }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /Yard/ }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("the chosen group stays even with no job in it; one group and nothing chosen draws no row", () => {
    const { container, rerender } = render(<JobCategoryChips jobs={[{ category: "yard_work" }]} value={null} onChange={() => {}} />);
    expect(container.innerHTML).toBe("");
    rerender(<JobCategoryChips jobs={[{ category: "yard_work" }]} value="pets" onChange={() => {}} />);
    expect(chipNames()).toEqual(["all", "yard", "pets"]);
  });

  it("the phone header draws the row under the tabs on Browse only, fed by the feed's own filter", () => {
    const section = read("src/pages/jobs/JobsSection.tsx");
    const feed = read("src/pages/home/Dashboard.tsx");
    expect(section).toContain('{tab === "browse" && browse?.chips}');
    expect(section.indexOf('{tab === "browse" && browse?.chips}')).toBeGreaterThan(section.lastIndexOf("<SectionTabs"));
    expect(feed).toContain("<JobCategoryChips jobs={allJobs} value={filters.selectedCategory} onChange={filters.setSelectedCategory} />");
    expect(feed).toContain("{ search: phoneBrowseSearch, chips: phoneBrowseChips }");
  });
});
