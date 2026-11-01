/**
 * POST-H2 (owner 10-31 ~9:35 PM, pop-up: "Have a Helpr list it shows a suggested price range based on item count,
 * still editable"). The posting audit's finding: the member had to invent a price with no help.
 *
 * Holds:
 *  - the ranges live in ONE constant (SELL_FOR_ME_PRICE_BANDS), climbing with the count, and cover every count;
 *  - the count is read from the "How many items" answer ("about 12", "10-15" reads the larger);
 *  - the price step of a Have-a-Helpr-list-it job shows the range and a one-tap "Use $X" inside it, which sets the
 *    price box; the box stays the poster's (the suggestion never sets a price on its own);
 *  - nothing shows for a count with no number, and FormStep mounts it only for that job's category.
 *
 * @mutate src/lib/declutter/sellForMe.ts |   return nums.length ? Math.max(...nums) : null; |   return nums.length ? nums[0] : null;
 * @mutate src/lib/declutter/sellForMe.ts |   const band = SELL_FOR_ME_PRICE_BANDS.find((b) => count <= b.upTo)!; |   const band = SELL_FOR_ME_PRICE_BANDS[0];
 * @mutate src/components/postjob/SellForMeBlanks.tsx | onClick={() => onUse(range.pick)} | onClick={() => onUse(range.high + 50)}
 * @mutate src/components/postjob/SellForMeBlanks.tsx |   if (!range \|\| count == null) return null; |   if (count == null) return null;
 * @mutate src/pages/post-job/FormStep.tsx |           {isSellForMeJob(form.category) && (\n            <div className="mt-4">\n              <SellForMePriceSuggestion | {false && (\n            <div className="mt-4">\n              <SellForMePriceSuggestion
 */
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { SellForMePriceSuggestion } from "@/components/postjob/SellForMeBlanks";
import {
  SELL_FOR_ME_BLANKS,
  SELL_FOR_ME_PRICE_BANDS,
  buildSellForMePrefill,
  fillSellForMeBlank,
  sellForMeItemCount,
  sellForMePriceRange,
} from "@/lib/declutter/sellForMe";

const withCount = (answer: string) => fillSellForMeBlank(buildSellForMePrefill().description, SELL_FOR_ME_BLANKS[0], answer);

describe("the ranges: one constant, climbing with the count", () => {
  it("every count lands in a band, and bigger jobs never suggest less", () => {
    expect(SELL_FOR_ME_PRICE_BANDS.length).toBeGreaterThan(2);
    expect(SELL_FOR_ME_PRICE_BANDS[SELL_FOR_ME_PRICE_BANDS.length - 1].upTo).toBe(Infinity);
    let prev = { low: 0, high: 0 };
    for (const b of SELL_FOR_ME_PRICE_BANDS) {
      expect(b.low).toBeLessThan(b.high);
      expect(b.low).toBeGreaterThanOrEqual(prev.low);
      expect(b.high).toBeGreaterThan(prev.high);
      prev = b;
    }
    for (const n of [1, 5, 6, 15, 16, 30, 31, 400]) {
      const r = sellForMePriceRange(n)!;
      expect(r.pick).toBeGreaterThanOrEqual(r.low);
      expect(r.pick).toBeLessThanOrEqual(r.high);
      expect(r.pick % 5).toBe(0);
    }
    expect(sellForMePriceRange(3)).toEqual({ low: 40, high: 60, pick: 50 });
    expect(sellForMePriceRange(12)).toEqual({ low: 60, high: 120, pick: 90 });
    expect(sellForMePriceRange(31)).toEqual({ low: 200, high: 300, pick: 250 });
  });

  it("the count comes from the answer as typed", () => {
    expect(sellForMeItemCount("12")).toBe(12);
    expect(sellForMeItemCount("about 20")).toBe(20);
    expect(sellForMeItemCount("10-15")).toBe(15);
    expect(sellForMeItemCount("lots")).toBeNull();
    expect(sellForMeItemCount("")).toBeNull();
    expect(sellForMePriceRange(null)).toBeNull();
  });
});

describe("the price step", () => {
  function Harness({ description, start = 0 }: { description: string; start?: number }) {
    const [budget, setBudget] = useState(start);
    return <><SellForMePriceSuggestion description={description} budget={budget} onUse={setBudget} /><output data-testid="price">{budget}</output></>;
  }

  it("shows the range for the count and a one-tap pick that sets the price", () => {
    render(<Harness description={withCount("about 12")} />);
    expect(screen.getByText("Suggested for about 12 items")).toBeTruthy();
    expect(screen.getByText("$60–$120")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use $90" }));
    expect(screen.getByTestId("price").textContent).toBe("90");
    // At the pick, the button goes; the price box above is still the poster's to change.
    expect(screen.queryByRole("button", { name: /^Use \$/ })).toBeNull();
  });

  it("never sets a price on its own", () => {
    const onUse = vi.fn();
    render(<SellForMePriceSuggestion description={withCount("3")} budget={0} onUse={onUse} />);
    expect(screen.getByText("$40–$60")).toBeTruthy();
    expect(onUse).not.toHaveBeenCalled();
  });

  it("nothing for a count with no number, or before the count is answered", () => {
    const { container, rerender } = render(<SellForMePriceSuggestion description={withCount("lots")} budget={0} onUse={vi.fn()} />);
    expect(container.querySelector("[data-sell-for-me-price]")).toBeNull();
    rerender(<SellForMePriceSuggestion description={buildSellForMePrefill().description} budget={0} onUse={vi.fn()} />);
    expect(container.querySelector("[data-sell-for-me-price]")).toBeNull();
  });

  it("Post a Job's price step mounts it for the Have-a-Helpr-list-it job only, wired to the price box", () => {
    const src = blankComments(readFileSync(resolve(process.cwd(), "src/pages/post-job/FormStep.tsx"), "utf8"));
    const at = src.indexOf("<SellForMePriceSuggestion");
    expect(at).toBeGreaterThan(src.indexOf('data-form-page="3"'));
    expect(src.slice(at - 120, at)).toContain("isSellForMeJob(form.category) && (");
    expect(src.slice(at, at + 200)).toContain("onUse={(d) => form.setBudget(String(d))}");
  });
});
