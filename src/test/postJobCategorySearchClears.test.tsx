/**
 * Q2260: Post a job's category search (screen 1) filtered the groups live with no way to clear it but deleting by
 * hand. It now has the app's "Clear search" ✕ once something is typed; the ✕ empties the box and the matches go. The press spec (e2e/prod-audit/search-x-off-center-press.spec.ts, surface "post-job-categories") presses it
 * at 375 and 1440, and searchFieldsAllChecked no longer lists the field on NO_X.
 *
 * @mutate src/components/postjob/JobCategoryGroups.tsx | {query && ( | {false && (
 * @mutate src/components/postjob/JobCategoryGroups.tsx | onClick={() => setQuery("")} | onClick={() => {}}
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { JobCategoryGroups } from "@/components/postjob/JobCategoryGroups";

vi.mock("@/components/SuggestCategory", () => ({ SuggestCategory: () => null }));

const MATCHES = "Matching categories";

describe("Q2260: the category search has a clear ✕", () => {
  it("no ✕ while empty; typing shows it; pressing it empties the box and drops the matches", () => {
    render(<JobCategoryGroups category="" setCategory={vi.fn()} group={null} setGroup={vi.fn()} onPicked={vi.fn()} />);
    const box = screen.getByRole("searchbox", { name: "Search categories" }) as HTMLInputElement;
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
    fireEvent.change(box, { target: { value: "zzz" } });
    expect(screen.getByRole("region", { name: MATCHES })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(box.value).toBe("");
    expect(screen.queryByRole("region", { name: MATCHES })).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
  });
});
