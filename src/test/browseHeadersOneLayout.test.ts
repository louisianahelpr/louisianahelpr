// @mutate src/components/sections/browseHeaderSpacing.ts | export const SEARCH_BAR_PAD = "pb-0.5"; | export const SEARCH_BAR_PAD = "pb-2";
// @mutate src/components/declutter/DeclutterBrowseView.tsx | <div className={BROWSE_EMPTY_SLOT} data-browse-empty-slot=""> | <div data-browse-empty-slot="">
// @mutate src/components/declutter/DeclutterCategoryChips.tsx | items.length === 0 ? CATEGORIES.slice(0, 3).map((c) => c.key) : | false ? [] :
/**
 * OWNER 11-12 (iPhone screenshots of Jobs and Declutter Browse, both empty):
 * 1. Both Browses have ONE layout: search + filter, tabs, a category chip row (Declutter's too, even with nothing for
 *    sale), then the shared empty state (BrowseEmptyState) in the same slot (BROWSE_EMPTY_SLOT), with the same icon
 *    circle, title, subline, primary pill and quiet link (EmptyStateActions; browseEmptyActionsOneLayout).
 * 2. Tighter header rhythm, shared: search -> tabs 6px, tabs -> chips 4px, chips -> content 8px (browseHeaderSpacing).
 * 3. The Declutter tabs have no "N more" pill: one sideways strip (sectionTabsNeverCutAWord).
 * 4. The light app background is near-white #FCFBF8 (lightGroundIsWarm).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const read = (f: string) => blankComments(readFileSync(resolve(__dirname, "../..", f), "utf8"));

describe("owner 11-12: Jobs and Declutter Browse share one layout", () => {
  it("both empty states sit in the shared slot and use the shared BrowseEmptyState", () => {
    for (const f of ["src/components/dashboard/BrowseTasksFeed.tsx", "src/components/declutter/DeclutterBrowseView.tsx"]) {
      const s = read(f);
      expect({ f, slot: s.includes("<div className={BROWSE_EMPTY_SLOT} data-browse-empty-slot=\"\">") }).toEqual({ f, slot: true });
      expect({ f, shared: s.includes("<BrowseEmptyState") }).toEqual({ f, shared: true });
    }
  });
  it("Declutter's chip row shows with nothing for sale (All and the first categories), as Jobs' does", () => {
    expect(read("src/components/declutter/DeclutterBrowseView.tsx")).toContain('const chipRow = itemsPhase !== "offline-empty" && (others.length > 0 || (!listLoading && !items.isError))');
    expect(read("src/components/declutter/DeclutterCategoryChips.tsx")).toContain("items.length === 0 ? CATEGORIES.slice(0, 3).map((c) => c.key) :");
  });
  it("the header gaps come from one file, used by the real bar and its skeletons", () => {
    const sp = read("src/components/sections/browseHeaderSpacing.ts");
    expect(sp).toContain('export const SEARCH_BAR_PAD = "pb-0.5";');
    expect(sp).toContain('export const CHIPS_ROW_PAD = "pb-0";');
    for (const f of ["src/components/sections/AppTopBar.tsx", "src/components/DashboardRouteSkeleton.tsx", "src/components/JobsSectionSkeleton.tsx"]) {
      expect({ f, pad: read(f).includes("${SEARCH_BAR_PAD} min-w-0") }).toEqual({ f, pad: true });
    }
    expect(read("src/components/declutter/DeclutterBrowseView.tsx")).toContain('<div data-declutter-chips-row="" className={CHIPS_ROW_PAD}>');
    expect(read("src/components/declutter/DeclutterSkeletons.tsx")).toContain("<div className={CHIPS_ROW_PAD} aria-hidden data-declutter-chip-bones=\"\">");
    expect(read("src/pages/home/Dashboard.tsx").match(/tightPanelGap/g)?.length).toBe(2);
  });
  it("the tab row has no 'more' pill or chevrons", () => {
    const tabs = read("src/components/sections/SectionTabs.tsx");
    expect(tabs).not.toMatch(/data-tabs-more-button|tabs\.nMore|data-tabs-less-button|ChevronRight/);
    expect(tabs).toContain('data-tabs-strip=""');
  });
  it("the light background token is the near-white #FCFBF8", () => {
    expect(read("src/index.css")).toMatch(/--parchment:\s+45 40% 98%;/);
    expect(readFileSync(resolve(__dirname, "../../index.html"), "utf8")).toContain('<meta name="theme-color" content="#FCFBF8" />');
  });
});
