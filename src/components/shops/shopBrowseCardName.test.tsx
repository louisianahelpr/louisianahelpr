/**
 * S2-040 (Shops audit 2): a Browse shop card's link has a short name (name, rating, category, open or not, place),
 * not the logo's letter and every line and badge run together ("TTEST Boudin shop 5 Bakery ... ID checked Permit").
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ShopBrowseCard } from "./ShopBrowseCard";

const shop = {
  id: "s1", name: "TEST Boudin shop", category: "bakery", area_label: "Broussard", pin_lat: 30, pin_lng: -92, paused: true,
  miles: 4.2, rating: 4.8, review_count: 12, logo_path: null,
  badges: { id_checked: true, licensed: false, insured: false, registered: false, permit: true },
};

describe("S2-040: shop card link name", () => {
  it("is short and leaves out the logo letter and the badges", () => {
    render(<MemoryRouter><ShopBrowseCard shop={shop} category="Bakery and cakes" group={null} /></MemoryRouter>);
    const link = screen.getByRole("link");
    expect(link.getAttribute("aria-label")).toBe("TEST Boudin shop, rated 4.8 from 12 reviews, Bakery and cakes, Paused for now, Broussard, 4 miles away");
    expect(screen.getByRole("link", { name: /^TEST Boudin shop,/ })).toBe(link);
  });
});
