/*
 * Owner, 2026-09-25 (iPhone, Home search): "Recent search's should pop out in
 * front of that search. Like it shouldn't make that box it's in any bigger."
 *
 * The Recent list is portaled to <body> and fixed under the field, so the
 * card the field sits in never grows. Inside the modal filter panel
 * (`embedded`) it stays in the panel, because a portal outside a Radix modal
 * is inert.
 *
 * @mutate src/components/dashboard/browseTasksToolbar/BrowseSearchBar.tsx | const floatList = !embedded; | const floatList = false;
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

vi.mock("@/lib/searchHistory", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/searchHistory")>()),
  getRecentSearches: () => ["deck repair", "moving help"],
  pushRecentSearch: vi.fn(),
  clearRecentSearches: vi.fn(),
}));

import { BrowseSearchBar } from "@/components/dashboard/browseTasksToolbar/BrowseSearchBar";

const filters = {
  searchQuery: "",
  setSearchQuery: vi.fn(),
  setSearchOpen: vi.fn(),
} as unknown as Parameters<typeof BrowseSearchBar>[0]["filters"];

afterEach(cleanup);

describe("Recent searches open over the page, not inside the search card", () => {
  it("on Home the list is outside the component, so the card does not grow", () => {
    const { container } = render(<BrowseSearchBar filters={filters} />);
    fireEvent.focus(screen.getByRole("combobox"));
    const list = screen.getByRole("listbox", { name: "Recent searches" });
    expect(container.contains(list), "the Recent list is inside the search card and makes it taller").toBe(false);
    expect(document.body.contains(list)).toBe(true);
    expect(list.className).toMatch(/\bfixed\b/);
  });

  it("inside the filter panel (embedded) the list stays in the panel", () => {
    const { container } = render(<BrowseSearchBar filters={filters} embedded />);
    fireEvent.focus(screen.getByRole("combobox"));
    const list = screen.getByRole("listbox", { name: "Recent searches" });
    expect(container.contains(list)).toBe(true);
  });
});
