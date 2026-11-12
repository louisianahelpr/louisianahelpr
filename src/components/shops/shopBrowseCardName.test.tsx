/**
 * S2-043 (Shops audit 2): on phones the card is a compact row (logo, then the lines); the photo card is sm and up.
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

describe("S2-043: compact row on phones", () => {
  it("phones get a row with a round logo; the cover and badges are sm and up only", () => {
    render(<MemoryRouter><ShopBrowseCard shop={shop} category="Bakery and cakes" group={null} /></MemoryRouter>);
    const link = screen.getByRole("link");
    const cls = link.className.split(/\s+/);
    expect(cls).toContain("flex");
    expect(cls).toContain("sm:block");
    const rowLogo = link.querySelector("[data-shop-logo-row]") as HTMLElement;
    expect(rowLogo.className.split(/\s+/)).toContain("sm:hidden");
    expect(rowLogo.textContent).toBe("T");
    const cover = (link.querySelector("[data-shop-logo]") as HTMLElement).parentElement as HTMLElement;
    expect(cover.className.split(/\s+/)).toEqual(expect.arrayContaining(["hidden", "sm:block"]));
    expect(screen.getByText("ID checked").closest(".hidden")).not.toBeNull();
  });
});
