/**
 * THE DESKTOP SEARCH, OPEN, IS THE MOCK-UP'S "TODAY" PILL (owner 2026-10-28: "i like today but that's not what it
 * actually looks like on the website"; the live field at louisianahelpr.com/jobs was a 36px, 14px-corner translucent
 * box with 13px words, and every open field lost its border and gained a drop shadow to index.css's T2 `.bg-card`
 * rule).
 *
 * Class: every search that opens in place in a desktop tabs row (Jobs Browse's BrowseSearchBar; InlineListSearch on
 * Posted, Working and Declutter Browse) wears the ONE pill (searchPill.ts): 260px x 42px, fully round, a 1.5px
 * --border line, the card fill WITHOUT the `.bg-card` class, no shadow, 15px words, "<label>…" as the placeholder.
 * A phone keeps its own field.
 *
 * @mutate src/components/sections/searchPill.ts | bg-[hsl(var(--card))] shadow-none | bg-card shadow-none
 * @mutate src/components/sections/searchPill.ts | h-[42px] rounded-full | h-9 rounded-ds-md
 * @mutate src/components/dashboard/browseTasksToolbar/BrowseSearchBar.tsx | className={`w-full pl-10 pr-10 text-ds-15 text-foreground ${DESKTOP_SEARCH_PILL_SURFACE} | className={`w-full pl-10 pr-10 text-ds-15 text-foreground h-9 glass-field
 * @mutate src/components/sections/InlineListSearch.tsx |         placeholder={desktop ? `${label}…` : "Search"} |         placeholder="Search"
 * @mutate src/components/sections/InlineListSearch.tsx |             `${DESKTOP_SEARCH_PILL_SURFACE} ${DESKTOP_SEARCH_PILL_WIDTH} | `h-10 w-[clamp(200px,55vw,320px)] border border-border bg-card
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { blankComments } from "./helpers/blankNonCode";
import { trackedFiles } from "./helpers/trackedFiles";

const env = vi.hoisted(() => ({ desktop: true }));
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => env.desktop }));

import { InlineListSearch } from "@/components/sections/InlineListSearch";
import { BrowseSearchBar } from "@/components/dashboard/browseTasksToolbar/BrowseSearchBar";

afterEach(() => {
  cleanup();
  env.desktop = true;
});

const classes = (el: Element) => (el.getAttribute("class") ?? "").split(/\s+/);
function expectPill(el: Element) {
  const c = classes(el);
  for (const want of ["h-[42px]", "rounded-full", "border-[1.5px]", "border-border", "bg-[hsl(var(--card))]", "shadow-none"]) {
    expect(c, `pill class ${want}`).toContain(want);
  }
  // `.bg-card` would hand it T2's transparent border and drop shadow (index.css, !important).
  expect(c).not.toContain("bg-card");
}

describe("the desktop search pill (owner 2026-10-28, the mock-up's Today row)", () => {
  it("Jobs Browse: BrowseSearchBar is the 260px pill with 15px words and 'Search jobs…'", () => {
    const filters = { searchQuery: "", setSearchQuery: vi.fn(), setSearchOpen: vi.fn() } as unknown as Parameters<typeof BrowseSearchBar>[0]["filters"];
    const { container } = render(<BrowseSearchBar filters={filters} />);
    const input = screen.getByRole("combobox", { name: "Search jobs" });
    expectPill(input);
    expect(classes(input)).toContain("text-ds-15");
    expect(input.getAttribute("placeholder")).toBe("Search jobs…");
    expect(classes(container.firstElementChild!)).toContain("w-[260px]");
  });

  it("Posted / Working / Declutter: InlineListSearch opens into the same pill, '<label>…'", () => {
    render(<InlineListSearch value="" onChange={() => {}} label="Search items" />);
    fireEvent.click(screen.getByRole("button", { name: "Search items" }));
    const form = screen.getByRole("search", { name: "Search items" });
    expectPill(form);
    expect(classes(form)).toContain("w-[260px]");
    const input = screen.getByRole("searchbox", { name: "Search items" });
    expect(input.getAttribute("placeholder")).toBe("Search items…");
    expect(classes(input)).toContain("text-ds-15");
  });

  it("a phone keeps its own field ('Search', 16px words)", () => {
    env.desktop = false;
    render(<InlineListSearch value="" onChange={() => {}} label="Search items" />);
    fireEvent.click(screen.getByRole("button", { name: "Search items" }));
    const input = screen.getByRole("searchbox", { name: "Search items" });
    expect(input.getAttribute("placeholder")).toBe("Search");
    expect(classes(input)).toContain("text-ds-16");
  });

  it("every desktop in-place search mounts one of these two components (inventory from git)", () => {
    const mounts = trackedFiles("src")
      .filter((f) => /\.tsx$/.test(f) && !/\.test\.tsx$/.test(f) && !f.startsWith("src/test/"))
      .filter((f) => /<(InlineListSearch|BrowseSearchBar)\b/.test(blankComments(readFileSync(resolve(__dirname, "../..", f), "utf8"))));
    // Dashboard (Browse, desktop strip + phone row), embeddedActivity (Posted / Working), DeclutterBrowseView.
    expect(mounts.length).toBeGreaterThan(2);
    expect(mounts.sort()).toEqual(["src/components/declutter/DeclutterBrowseView.tsx", "src/components/job-card/embeddedActivity.tsx", "src/pages/home/Dashboard.tsx"]);
  });
});
