/**
 * LEAD-BUNCH-34-SLOW: the photos just picked show at once with "Adding N of M…" while they are made ready; before,
 * nothing showed until the first batch was sorted ("like it's not even accepting the pictures").
 * @mutate src/components/declutter/DeclutterBunchIntake.tsx |   if (total <= 0 \|\| ready >= total) return null; |   return null;
 * @mutate src/components/declutter/DeclutterBunchIntake.tsx |                 {url && <FallbackImg | {false && <FallbackImg
 * @mutate src/components/declutter/DeclutterBunchView.tsx |         {sorting && (\n          <BunchIntake |         {false && (\n          <BunchIntake
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { addingLine, BunchIntake } from "./DeclutterBunchIntake";
import { blankComments } from "@/test/helpers/blankNonCode";

describe("LEAD-BUNCH-34-SLOW: the photos being added show at once", () => {
  it("says Adding N of M until every photo is ready", () => {
    expect(addingLine(12, 34)).toBe("Adding 12 of 34 photos…");
    expect(addingLine(0, 1)).toBe("Adding 0 of 1 photo…");
    expect(addingLine(34, 34)).toBeNull();
    expect(addingLine(0, 0)).toBeNull();
  });

  it("shows a square per photo, with its picture as soon as it has one", () => {
    render(<BunchIntake keys={["a", "b", "c"]} urls={new Map([["a", "blob:a"]])} ready={1} total={3} />);
    expect(screen.getByRole("status").textContent).toBe("Adding 1 of 3 photos…");
    expect(document.querySelectorAll("[data-bunch-intake-photo]")).toHaveLength(3);
    expect(document.querySelectorAll("[data-bunch-intake-thumb]")).toHaveLength(1);
  });

  it("is on Sell a bunch while a sort runs, fed by each photo's small copy", () => {
    const view = blankComments(readFileSync(resolve(process.cwd(), "src/components/declutter/DeclutterBunchView.tsx"), "utf8"));
    expect(view).toMatch(/\{sorting && \(\s*<BunchIntake /);
    expect(view).toContain("onCleaned: (key, copy) => {");
    // The small copies live in useSortingThumbs (split out of the view, componentSizeRatchet).
    expect(view).toContain("useSortingThumbs(photos, !!sorting)");
    const hook = blankComments(readFileSync(resolve(process.cwd(), "src/components/declutter/useBunchThumbs.ts"), "utf8"));
    expect(hook).toContain("useBunchThumbs(photos, { paused: sorting, ready: copyUrls })");
  });
});
