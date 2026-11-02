/**
 * Q2260: Post a job's category search (J1 screen 1, JobCategoryGroups) is a live filter. It had no clear ✕, so a
 * poster who typed a word that matched nothing had to delete it by hand to get the groups back. It now has the
 * same "Clear search" ✕ as every permanent search field (SectionSearchRow), shown only while there is text, and
 * the browser press spec drives it at 375 and 1440 (e2e/prod-audit/search-x-off-center-press.spec.ts,
 * "post-job-category-search"; src/test/searchFieldsAllChecked.test.ts holds that wiring exact).
 *
 * @mutate src/components/postjob/JobCategoryGroups.tsx | onClick={() => setQuery("")} | onClick={() => undefined}
 * @mutate src/components/postjob/JobCategoryGroups.tsx |             {query ? (\n              // Q2260 |             {false ? (\n              // Q2260
 * @mutate src/components/postjob/JobCategoryGroups.tsx | [&::-webkit-search-cancel-button]:hidden"\n            />\n            {query | "\n            />\n            {query
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { JobCategoryGroups } from "@/components/postjob/JobCategoryGroups";
import { JOB_CATEGORY_GROUPS } from "@/lib/jobCategoryGroups";

vi.mock("@/components/SuggestCategory", () => ({ SuggestCategory: () => null }));
afterEach(cleanup);

const renderGrid = () =>
  render(<JobCategoryGroups category="" setCategory={vi.fn()} group={null} setGroup={vi.fn()} onPicked={vi.fn()} />);

describe("Post a job's category search clears with its own ✕ (Q2260)", () => {
  it("no ✕ while the box is empty; typing shows it; pressing it empties the box and brings the groups back", () => {
    expect(JOB_CATEGORY_GROUPS.length).toBeGreaterThan(7);
    renderGrid();
    const box = screen.getByRole("searchbox") as HTMLInputElement;
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
    fireEvent.change(box, { target: { value: "zzzz" } });
    expect(box.value).toBe("zzzz");
    expect(screen.getByText("Matches")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(box.value).toBe("");
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
    expect(screen.queryByText("Matches")).toBeNull();
  });

  it("the native WebKit ✕ is hidden on this field, so it never shows two", () => {
    const src = readFileSync(join(process.cwd(), "src/components/postjob/JobCategoryGroups.tsx"), "utf8");
    const input = /<input\s+type="search"[\s\S]*?\/>/.exec(src)?.[0] ?? "";
    expect(input).toContain("[&::-webkit-search-cancel-button]:hidden");
  });
});
