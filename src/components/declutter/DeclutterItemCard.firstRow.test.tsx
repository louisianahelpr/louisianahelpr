import { readFileSync } from "node:fs";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ItemCard } from "./DeclutterItemCard";
import { declutterFirstRowCount } from "./DeclutterSkeletons";

// @mutate src/components/declutter/DeclutterItemCard.tsx | {...(firstRow ? FIRST_ROW_PHOTO : LATER_PHOTO)} | {...LATER_PHOTO}
// @mutate src/components/declutter/DeclutterItemCard.tsx | {...(firstRow ? FIRST_ROW_PHOTO : LATER_PHOTO)} | {...FIRST_ROW_PHOTO}
// @mutate src/components/declutter/DeclutterBrowseView.tsx | firstRow={index < declutterFirstRowCount(desktop && !mapVisible, window.innerWidth)} | firstRow={false}

const item = {
  id: "i9", seller_id: "u2", status: "live", title: "Oak rocking chair", category: "furniture", condition_stars: 4,
  price_cents: 4000, current_price_cents: 4000, area_label: "Mid-City", area_lat: 30.45, area_lng: -91.15,
} as never;

const photo = (firstRow?: boolean) => {
  const r = render(
    <MemoryRouter>
      <ItemCard item={item} photoPath="u2/declutter/i9/a.png" miles={null} approximate={false} firstRow={firstRow} />
    </MemoryRouter>,
  );
  const img = r.container.querySelector("img")!;
  const attrs = { loading: img.getAttribute("loading"), fetchpriority: img.getAttribute("fetchpriority") };
  r.unmount();
  return attrs;
};

describe("Declutter's card photos", () => {
  it("the first row's photos load at once, ahead of the rest", () => {
    expect(photo(true)).toEqual({ loading: "eager", fetchpriority: "high" });
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

  it("Browse hands the first row to its cards", () => {
    const src = readFileSync("src/components/declutter/DeclutterBrowseView.tsx", "utf8");
    expect(src).toContain("firstRow={index < declutterFirstRowCount(desktop && !mapVisible, window.innerWidth)}");
  });
});
