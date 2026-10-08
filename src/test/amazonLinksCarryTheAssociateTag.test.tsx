/**
 * Owner, 2026-10-08 ("should we do an affiliate amazon link so i would get
 * money back"; Associates ID louisianahelp-20): every Amazon "Shop" link in
 * You Might Need carries Helpr's tag, and the panel shows the Associates
 * Program's required disclosure.
 *
 * @mutate src/components/postjob/MaterialsPanel.tsx | href={amazonAffiliateUrl(item.searchUrl)} | href={item.searchUrl}
 * @mutate src/components/postjob/MaterialsPanel.tsx |             {AMAZON_ASSOCIATE_DISCLOSURE} |             Helpr may earn a small commission.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MaterialsPanel } from "@/components/postjob/MaterialsPanel";
import { AMAZON_ASSOCIATE_DISCLOSURE, amazonAffiliateUrl, categoryMaterials } from "@/lib/materialsGuide";

describe("Amazon links carry the Associates tag", () => {
  it("amazonAffiliateUrl sets tag=louisianahelp-20 and keeps the search", () => {
    const u = new URL(amazonAffiliateUrl("https://www.amazon.com/s?k=moving+boxes"));
    expect(u.searchParams.get("tag")).toBe("louisianahelp-20");
    expect(u.searchParams.get("k")).toBe("moving boxes");
    expect(new URL(amazonAffiliateUrl("https://www.amazon.com/s?k=x&tag=other-20")).searchParams.get("tag")).toBe("louisianahelp-20");
    expect(amazonAffiliateUrl("https://example.com/x")).toBe("https://example.com/x");
  });

  it("every category's Shop links render tagged, under the required disclosure", () => {
    const categories = Object.keys(categoryMaterials);
    expect(categories.length).toBeGreaterThan(3);
    for (const category of categories) {
      const { unmount } = render(<MaterialsPanel category={category} />);
      const toggle = screen.queryByRole("button", { name: /you might need/i });
      if (toggle && !screen.queryAllByRole("link", { name: /shop/i }).length) fireEvent.click(toggle);
      const links = screen.getAllByRole("link", { name: /shop/i });
      expect(links.length).toBe(categoryMaterials[category].length);
      for (const a of links) expect(new URL(a.getAttribute("href")!).searchParams.get("tag"), category).toBe("louisianahelp-20");
      expect(screen.getByText(AMAZON_ASSOCIATE_DISCLOSURE)).toBeTruthy();
      unmount();
    }
  });
});
