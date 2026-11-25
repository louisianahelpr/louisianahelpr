// @mutate src/components/declutter/DeclutterSkeletons.tsx |         <Skeleton className="h-11 w-16 shrink-0 rounded-full" /> |         <Skeleton className="h-10 w-16 shrink-0 rounded-full" />
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";

vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => false }));
vi.mock("@/components/sections/SectionScreen", () => ({
  SectionScreen: ({ search, tabs, children }: { search?: React.ReactNode; tabs: React.ReactNode; children: React.ReactNode }) => (
    <div>
      <div data-slot="search">{search}</div>
      <div data-slot="tabs">{tabs}</div>
      <div data-slot="body">{children}</div>
    </div>
  ),
}));
import { DeclutterHomeSkeleton } from "@/components/declutter/DeclutterSkeletons";

/**
 * Q1695 (loading-states refresh 2026-11-03 19:40Z, bot PR #3963, 375, customer and anon): /declutter's loading
 * frame drew a phone search row under the tabs that the page did not have, so the body started 43px lower than the
 * page that replaced it ("row 672px -> 715px"). Since the Vinted header (owner 11-08) the phone search is IN the bar
 * and (owner 11-25: the category chips moved into Filters) a guest's row under it is the "Jobs | Declutter ... + Sell"
 * switch: the frame draws exactly that, the search's bone in the bar's slot and one 44px row of switch bones, and no
 * second row. A member's slot is the tab row's bones (memberDeclutterEarly).
 */
describe("Q1695: /declutter's loading frame draws the page's own phone header rows, no extra search row", () => {
  it("at 375 (a guest): the search bone goes to the bar, and the slot under it is ONE 44px row of switch bones", () => {
    const r = render(<MemoryRouter><DeclutterHomeSkeleton /></MemoryRouter>);
    const search = r.container.querySelector("[data-slot='search']") as HTMLElement;
    expect(search.children).toHaveLength(1);
    // Owner 11-21 (search is just the icon): the bar's bones are the magnifier and Filters, 44px each, not a pill.
    const icons = Array.from(search.children[0].children) as HTMLElement[];
    expect(icons.map((c) => /\bh-11\b/.test(c.className) && /\bw-11\b/.test(c.className))).toEqual([true, true]);
    expect(search.querySelector(".w-full")).toBeNull();
    const slot = r.container.querySelector("[data-slot='tabs']") as HTMLElement;
    expect(slot.children).toHaveLength(1);
    // The real row's box (DeclutterGuestHome): a pb-2 row of 44px pills, the switch's two and "+ Sell" (44 + 8 = 52px).
    const row = slot.children[0] as HTMLElement;
    expect(row.className).toMatch(/\bpb-2\b/);
    const pills = Array.from(row.children[0].children) as HTMLElement[];
    expect(pills.length).toBe(2);
    for (const c of [...pills, row.children[1] as HTMLElement]) expect(c.className).toMatch(/\bh-11\b/);
    expect(r.container.querySelector("[data-slot='body'] [role='status']")).not.toBeNull();
  });

  it("the real phone Browse header hands the bar its search, with no chip row under it (the premise above)", () => {
    const view = blankComments(readFileSync(resolve(__dirname, "../components/declutter/DeclutterBrowseView.tsx"), "utf8"));
    expect(view).toMatch(/search: \(\s*<SectionSearchBar /);
    expect(view).not.toMatch(/chips: /);
    expect(blankComments(readFileSync(resolve(__dirname, "../components/declutter/DeclutterGuestHome.tsx"), "utf8"))).toContain('<div className="flex items-center justify-between gap-2 pb-2"><GuestSectionSwitch');
    expect(view).toMatch(/search=\{head\.search\}[^>]*tabs=\{head\.tabs\}/);
  });
});
