/**
 * CLASS GUARD (DA-19, Declutter audit 2026-10-30): Browse's Filters sheet used pill chips everywhere except "Porch
 * pickup only" (and "Only items with nightly price drops"), which were square checkboxes. Owner rule: pill buttons.
 * Inventory from source: every section declutterFilterSections returns (with the drops section on), rendered. None
 * holds a checkbox; the two yes/no filters are pressed-state pill buttons that toggle the filter.
 * @mutate src/components/declutter/DeclutterFilterPanel.tsx | <Chip on={filters.porchOnly} onClick={() => onChange({ ...filters, porchOnly: !filters.porchOnly })}>{HANDOVER_TITLE.porch}</Chip> | <label><input type="checkbox" checked={filters.porchOnly} onChange={() => onChange({ ...filters, porchOnly: !filters.porchOnly })} />{HANDOVER_TITLE.porch}</label>
 * @mutate src/components/declutter/DeclutterFilterPanel.tsx | <Row><Chip on={filters.dropsOnly} onClick={() => onChange({ ...filters, dropsOnly: !filters.dropsOnly })}>Only items with nightly price drops</Chip></Row> | <label><input type="checkbox" checked={filters.dropsOnly} onChange={() => onChange({ ...filters, dropsOnly: !filters.dropsOnly })} />Only items with nightly price drops</label>
 */
import { describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { declutterFilterSections } from "./DeclutterFilterPanel";
import { NO_FILTERS, type DeclutterFilters } from "@/lib/declutter/browseFilters";

function renderSections(filters: DeclutterFilters, onChange: (f: DeclutterFilters) => void) {
  const sections = declutterFilterSections({
    filters,
    onChange,
    maxMiles: null,
    onMaxMiles: () => {},
    ask: { origin: { status: "pending" }, asked: false, asking: false, canAskAgain: false, deviceNote: null, askDevice: () => {} },
    showDrops: true,
  });
  render(<div>{sections.map((s) => <section key={s.key} aria-label={s.title}>{s.content}</section>)}</div>);
  return sections;
}

describe("Declutter Filters: pill buttons, never a square checkbox (DA-19)", () => {
  it("no section of the sheet holds a checkbox", () => {
    const sections = renderSections(NO_FILTERS, () => {});
    expect(sections.length).toBeGreaterThan(4);
    expect(screen.queryAllByRole("checkbox")).toEqual([]);
  });

  it("Porch pickup and the price-drops filter are pressed-state pills that toggle their filter", () => {
    for (const [name, key] of [["Porch pickup", "porchOnly"], ["Only items with nightly price drops", "dropsOnly"]] as const) {
      const onChange = vi.fn();
      renderSections(NO_FILTERS, onChange);
      const pill = screen.getByRole("button", { name });
      expect(pill).toHaveAttribute("aria-pressed", "false");
      fireEvent.click(pill);
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ [key]: true }));
      cleanup();
    }
  });
});
