import { readFileSync } from "node:fs";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ItemCard } from "./DeclutterItemCard";
import { declutterAboveFoldCount, declutterFirstRowCount } from "./DeclutterSkeletons";
import { resetFirstRowPhotoGate } from "./firstRowPhotoGate";

// @mutate src/components/declutter/DeclutterItemCard.tsx | {...(firstRow ? FIRST_ROW_PHOTO : aboveFold ? ABOVE_FOLD_PHOTO : LATER_PHOTO)} | {...LATER_PHOTO}
// @mutate src/components/declutter/DeclutterItemCard.tsx | {...(firstRow ? FIRST_ROW_PHOTO : aboveFold ? ABOVE_FOLD_PHOTO : LATER_PHOTO)} | {...FIRST_ROW_PHOTO}
// @mutate src/components/declutter/DeclutterItemCard.tsx | {...(firstRow ? FIRST_ROW_PHOTO : aboveFold ? ABOVE_FOLD_PHOTO : LATER_PHOTO)} | {...(firstRow ? FIRST_ROW_PHOTO : LATER_PHOTO)}
// @mutate src/components/declutter/DeclutterItemCard.tsx |   const early = !!firstRow \|\| !!aboveFold; |   const early = !!firstRow;
// @mutate src/components/declutter/DeclutterBrowseView.tsx | aboveFold={index < declutterAboveFoldCount(desktop && !mapVisible, window.innerWidth, window.innerHeight)} | aboveFold={false}
// @mutate src/components/declutter/DeclutterSkeletons.tsx |   while (rows < MAX_FOLD_ROWS && GRID_TOP_PX | while (rows < 1 && GRID_TOP_PX
// @mutate src/components/declutter/DeclutterBrowseView.tsx | firstRow={index < declutterFirstRowCount(desktop && !mapVisible, window.innerWidth)} | firstRow={false}

const item = {
  id: "i9", seller_id: "u2", status: "live", title: "Oak rocking chair", category: "furniture", condition_stars: 4,
  price_cents: 4000, current_price_cents: 4000, area_label: "Mid-City", area_lat: 30.45, area_lng: -91.15,
} as never;

const photo = (firstRow?: boolean, aboveFold?: boolean) => {
  const r = render(
    <MemoryRouter>
      <ItemCard item={item} photoPath="u2/declutter/i9/a.png" miles={null} approximate={false} firstRow={firstRow} aboveFold={aboveFold} />
    </MemoryRouter>,
  );
  const img = r.container.querySelector("img");
  const attrs = { loading: img?.getAttribute("loading") ?? "none yet", fetchpriority: img?.getAttribute("fetchpriority") ?? null };
  r.unmount();
  return attrs;
};

describe("Declutter's card photos", () => {
  it("the first row's photos load at once, ahead of the rest", () => {
    expect(photo(true)).toEqual({ loading: "eager", fetchpriority: "high" });
  });

  // Q2705 (11-07): at 375x812 the 3rd card, on the second row, was the largest paint (10.9 s live, Slow 4G + 4x).
  it("a later row above the fold loads at once too, at the browser's own priority, and does not wait on the first row", () => {
    resetFirstRowPhotoGate();
    // A first-row card holds the gate (its photo is in flight); an above-the-fold card still draws its photo at once.
    const first = render(<MemoryRouter><ItemCard item={item} photoPath="u2/declutter/i9/a.png" miles={null} approximate={false} firstRow /></MemoryRouter>);
    expect(photo(false, true)).toEqual({ loading: "eager", fetchpriority: null });
    expect(photo(false, false)).toEqual({ loading: "none yet", fetchpriority: null });
    first.unmount(); // its photo is done: the gate opens for the tests below
  });

  it("every other photo stays lazy", () => {
    expect(photo(false)).toEqual({ loading: "lazy", fetchpriority: null });
    expect(photo()).toEqual({ loading: "lazy", fetchpriority: null });
  });

  it("the first row is as wide as the grid at each width", () => {
    expect(declutterFirstRowCount(false, 375)).toBe(2);
    expect(declutterFirstRowCount(false, 768)).toBe(3);
    expect(declutterFirstRowCount(true, 1000)).toBe(4);
    expect(declutterFirstRowCount(true, 1440)).toBe(5);
  });

  it("the cards above the fold are every row whose photo is at least half on screen", () => {
    expect(declutterAboveFoldCount(false, 375, 812)).toBe(4);
    expect(declutterAboveFoldCount(false, 390, 844)).toBe(4);
    expect(declutterAboveFoldCount(false, 375, 667)).toBe(2);
    expect(declutterAboveFoldCount(false, 375, 400)).toBe(2);
    expect(declutterAboveFoldCount(false, 768, 1024)).toBe(6);
    expect(declutterAboveFoldCount(true, 1440, 900)).toBe(10);
    expect(declutterAboveFoldCount(false, 375, 5000)).toBe(8);
  });

  it("Browse hands the first row to its cards", () => {
    const src = readFileSync("src/components/declutter/DeclutterBrowseView.tsx", "utf8");
    expect(src).toContain("firstRow={index < declutterFirstRowCount(desktop && !mapVisible, window.innerWidth)}");
    expect(src).toContain("aboveFold={index < declutterAboveFoldCount(desktop && !mapVisible, window.innerWidth, window.innerHeight)}");
  });
});
