/**
 * P2 (iOS design audit 11-16): the Sell setup's seven day chips wrapped 5 and 2. Every day-chip row is now the shared
 * DayChipGrid (four even columns: a week reads 4 over 3), and each chip fills its cell.
 *
 * @mutate src/components/declutter/DeclutterPickupTimes.tsx |   return <div className="grid grid-cols-4 gap-2" data-day-chip-grid="">{children}</div>; |   return <div className="flex flex-wrap gap-2" data-day-chip-grid="">{children}</div>;
 * @mutate src/components/declutter/SellPorchDays.tsx |           <DayChipGrid> |           <div className="flex flex-wrap gap-2">
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { blankComments } from "./helpers/blankNonCode";
import { DayChip, DayChipGrid } from "@/components/declutter/DeclutterPickupTimes";

const src = (p: string) => blankComments(readFileSync(join(process.cwd(), p), "utf8"));

afterEach(cleanup);

describe("P2: day chips sit in one even grid", () => {
  it("the grid is four even columns and each chip fills its cell", () => {
    render(<DayChipGrid>{[0, 1, 2, 3, 4, 5, 6].map((d) => <DayChip key={d} day={d} on={false} onToggle={() => {}} />)}</DayChipGrid>);
    const grid = document.querySelector("[data-day-chip-grid]") as HTMLElement;
    expect(grid.className.split(/\s+/)).toEqual(expect.arrayContaining(["grid", "grid-cols-4"]));
    const chips = grid.querySelectorAll("[data-day-chip]");
    expect(chips.length).toBe(7);
    for (const c of chips) expect(c.className.split(/\s+/)).toContain("w-full");
  });

  it("every file that draws DayChips puts them in DayChipGrid, never a wrapping flex row", () => {
    const files = ["src/components/declutter/DeclutterPickupTimes.tsx", "src/components/declutter/SellPorchDays.tsx"];
    let rows = 0;
    for (const f of files) {
      const s = src(f);
      for (let i = s.indexOf("<DayChip "); i !== -1; i = s.indexOf("<DayChip ", i + 1)) {
        rows++;
        const before = s.slice(Math.max(0, i - 300), i);
        expect(before.lastIndexOf("<DayChipGrid>"), `${f}: a DayChip outside DayChipGrid`).toBeGreaterThan(before.lastIndexOf("flex flex-wrap"));
      }
    }
    // Inventory floor: both rows are found.
    expect(rows).toBeGreaterThan(1);
  });
});
