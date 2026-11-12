// @mutate src/components/declutter/DeclutterSkeletons.tsx |       <div className="flex gap-2 overflow-hidden pb-1"> |       <div className="flex flex-col gap-2 overflow-hidden pb-1"><Skeleton className="h-11 w-full rounded-full" />
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
 * and the row under it is the category chips: the frame draws exactly that, the search's bone in the bar's slot and
 * one 44px row of chip bones, and no second row.
 */
describe("Q1695: /declutter's loading frame draws the page's own phone header rows, no extra search row", () => {
  it("at 375: the search bone goes to the bar, and the slot under it is ONE 44px row of chip bones", () => {
    const r = render(<MemoryRouter><DeclutterHomeSkeleton /></MemoryRouter>);
    const search = r.container.querySelector("[data-slot='search']") as HTMLElement;
    expect(search.children).toHaveLength(1);
    expect((search.children[0] as HTMLElement).className).toMatch(/\bh-11\b/);
    const slot = r.container.querySelector("[data-slot='tabs']") as HTMLElement;
    expect(slot.children).toHaveLength(1);
    // Q2705 (11-09): the real row's box, a pb-2 row around a pb-1 row of 40px chips (44 + 8 = 52px, as measured).
    expect((slot.children[0] as HTMLElement).className).toMatch(/\bpb-0\b/); // owner 11-12: CHIPS_ROW_PAD, as Browse's row
    expect(slot.children[0].children).toHaveLength(1);
    const chips = Array.from(slot.children[0].children[0].children) as HTMLElement[];
    expect(chips.length).toBeGreaterThan(1);
    for (const c of chips) expect(c.className).toMatch(/\bh-10\b/);
    expect(r.container.querySelector("[data-slot='body'] [role='status']")).not.toBeNull();
  });

  it("the real phone Browse header hands the bar its search and puts the chips under it (the premise above)", () => {
    const view = blankComments(readFileSync(resolve(__dirname, "../components/declutter/DeclutterBrowseView.tsx"), "utf8"));
    expect(view).toMatch(/search: \(\s*<SectionSearchBar /);
    expect(view).toMatch(/chips: chipRow \? /);
    expect(view).toMatch(/search=\{head\.search\}[^>]*tabs=\{head\.tabs\}/);
  });
});
