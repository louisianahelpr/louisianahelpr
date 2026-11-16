/**
 * M10 (iOS design audit 11-16): Declutter's Filters sheet stacked seven titled sections (View, Sort, Distance, How
 * you get it, Price, Condition, Category with about 32 chips, Show) and measured about 2,164px tall at 375, against
 * the 1,200px sheet budget. Now the shared FilterSheet folds any section marked `more` behind ONE "More filters" row:
 * Sort (with List | Map on its title line) and Distance show; the rest open on a tap, or from the start when one
 * of them is filtering the list, so a filter in effect is never hidden.
 *
 * @mutate src/components/dashboard/FilterSheet.tsx |   const shown = sections.filter((s) => !s.more); |   const shown = sections;
 * @mutate src/components/dashboard/FilterSheet.tsx |   const [moreOpen, setMoreOpen] = useState(() => folded.some((s) => s.active)); |   const [moreOpen, setMoreOpen] = useState(() => false);
 * @mutate src/components/declutter/DeclutterFilterPanel.tsx |       active: !!filters.category, |       active: false,
 * @mutate src/components/declutter/DeclutterBrowseBar.tsx |   const all: FilterSheetSection[] = view && sections.length > 0 |   const all: FilterSheetSection[] = false
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => false }));

const { declutterFilterSections } = await import("@/components/declutter/DeclutterFilterPanel");
const { DeclutterFilterSheet } = await import("@/components/declutter/DeclutterBrowseBar");
const { NO_FILTERS } = await import("@/lib/declutter/browseFilters");
type Filters = typeof NO_FILTERS;

function sheet(filters: Filters, view = true) {
  const sections = declutterFilterSections({
    filters,
    onChange: () => {},
    maxMiles: null,
    onMaxMiles: () => {},
    ask: { origin: { status: "pending" }, asked: false, asking: false, canAskAgain: false, deviceNote: null, askDevice: () => {} },
    showDrops: true,
  } as Parameters<typeof declutterFilterSections>[0]);
  render(
    <DeclutterFilterSheet
      open
      onOpenChange={() => {}}
      sections={sections}
      filterCount={0}
      shown={3}
      onClearAll={() => {}}
      view={view ? { value: "list", set: () => {} } : undefined}
    />,
  );
  return sections;
}

const eyebrows = () => Array.from(document.querySelectorAll("p.uppercase")).map((p) => p.textContent);

afterEach(cleanup);

describe("M10: Declutter's Filters sheet opens short", () => {
  it("shows Sort and Distance; the rest wait behind one More filters row", () => {
    const sections = sheet(NO_FILTERS);
    // Inventory floor: the sheet still offers every section (nothing was dropped, only folded).
    expect(sections.length).toBeGreaterThan(6);
    expect(sections.filter((s) => s.more).map((s) => s.key)).toEqual(["handover", "price", "condition", "category", "show"]);
    expect(eyebrows()).toEqual(["Sort", "Distance"]);
    const more = screen.getByRole("button", { name: "More filters" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Like new" })).toBeNull();
    fireEvent.click(more);
    expect(more).toHaveAttribute("aria-expanded", "true");
    expect(eyebrows()).toEqual(["Sort", "Distance", "How you get it", "Price", "Condition", "Category", "Show"]);
    expect(screen.getByRole("button", { name: "Like new" })).toBeTruthy();
  });

  it("List | Map rides on Sort's title line, not a View section of its own", () => {
    sheet(NO_FILTERS);
    expect(screen.getByRole("radiogroup", { name: "Feed view" })).toBeTruthy();
    expect(eyebrows()).not.toContain("View");
  });

  it("a folded filter in effect opens the More filters row from the start", () => {
    sheet({ ...NO_FILTERS, category: "furniture" });
    expect(screen.getByRole("button", { name: "More filters" })).toHaveAttribute("aria-expanded", "true");
    expect(eyebrows()).toContain("Category");
  });
});
