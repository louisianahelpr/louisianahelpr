/**
 * A3-68 (audit 2026-11-01): a bunch row's price box showed "$" only as the placeholder, so a filled box read a bare
 * "25". The "$" is now fixed inside the box, beside the typed price, filled or not.
 *
 * @mutate src/components/declutter/DeclutterBunchRow.tsx |             <span aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ds-15 text-muted-foreground">$</span> |
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { BunchRow } from "./DeclutterBunchRow";
import { blankItem } from "@/lib/declutter/bunch";

describe("bunch row price shows a fixed $ (A3-68)", () => {
  it("a filled price reads '$' + '25', not a bare 25", () => {
    const item = { ...blankItem(["p1"]), price: "25" };
    render(<ul><BunchRow item={item} index={0} url={undefined} open={false} nextPriceId={null} canDrop={false}
      onToggleOpen={() => {}} onPrice={() => {}} onPhotoDrop={() => {}}>{null}</BunchRow></ul>);
    const box = document.querySelector("[data-bunch-row-price]") as HTMLElement;
    expect(box.textContent).toBe("$");
    expect((box.querySelector("input") as HTMLInputElement).value).toBe("25");
    expect((box.querySelector("input") as HTMLInputElement).placeholder).toBe("");
  });
});
