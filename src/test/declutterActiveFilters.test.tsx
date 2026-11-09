// @mutate src/components/declutter/DeclutterActiveFilters.tsx |   if (f.porchOnly) out.push( |   if (f.porchOnly && f.ways.length === 0) out.push(
// @mutate src/components/declutter/DeclutterBrowseView.tsx |         <DeclutterActiveFilters filters={filters} maxMiles={maxMiles} onChange={(next) => { setFilters(next.filters); setMaxMiles(next.maxMiles); }} />\n |
/**
 * F055 (UI audit 11-09): after applying a filter only a tiny "1" on the filter icon said the list was filtered. Every
 * filter that is on now shows as a removable chip above the cards; the count on the icon and the chips agree.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DeclutterActiveFilters, activeFilterPills } from "@/components/declutter/DeclutterActiveFilters";
import { NO_FILTERS, activeFilterCount, type DeclutterFilters } from "@/lib/declutter/browseFilters";
import { blankComments } from "./helpers/blankNonCode";

afterEach(cleanup);

const ALL_ON: DeclutterFilters = { ...NO_FILTERS, minDollars: 5, maxDollars: 20, conditions: [5, 4], porchOnly: true, ways: ["meetup", "delivery"], dropsOnly: true, tradesOnly: true };

describe("F055: each filter that is on shows as a removable chip", () => {
  it("nothing on: no chips", () => {
    expect(activeFilterPills(NO_FILTERS, null)).toEqual([]);
  });

  it("every sheet filter but category and Free (they are pressed chips in the row above) has a chip", () => {
    const pills = activeFilterPills(ALL_ON, 10);
    expect(pills.map((p) => p.label)).toEqual(["Within 10 mi", "$5 to $20", expect.any(String), "Porch pickup", "Meet at a safe spot", "Helpr delivery", "Price drops", "Open to trades"]);
    // The filter icon's count counts the same filters (porch + ways are one group there).
    expect(activeFilterCount(ALL_ON, 10)).toBe(6);
  });

  it("a chip's × turns only that filter off", () => {
    const onChange = vi.fn();
    render(<DeclutterActiveFilters filters={ALL_ON} maxMiles={10} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove filter: Porch pickup" }));
    expect(onChange).toHaveBeenCalledWith({ filters: { ...ALL_ON, porchOnly: false }, maxMiles: 10 });
    fireEvent.click(screen.getByRole("button", { name: "Remove filter: Within 10 mi" }));
    expect(onChange).toHaveBeenLastCalledWith({ filters: ALL_ON, maxMiles: null });
  });

  it("Browse draws the chips above the cards", () => {
    const browse = blankComments(readFileSync(join(__dirname, "../components/declutter/DeclutterBrowseView.tsx"), "utf8"));
    expect(browse).toContain("<DeclutterActiveFilters filters={filters} maxMiles={maxMiles} onChange={(next) => { setFilters(next.filters); setMaxMiles(next.maxMiles); }} />");
  });
});
