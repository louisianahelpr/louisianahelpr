/**
 * Owner 2026-11-22, the quiz's "Our picks for him" on her phone: "Move the cart to the bottom right under the notice and
 * the heart on the left of it like the other", and the results showed blank photo areas (FINICO headlamp, HOTO laser,
 * wood docking station, HOTO screwdriver). Every result is the guides' own row (PickRow inside an .gg-list, so the
 * phone line under the price is the same rule as Her/Him/Kids: cart left, heart right), every result shows its guide
 * photo, loaded at once, and no result row skips drawing (Safari left on-screen rows blank when the list arrived after
 * an answer tap; reproduced in WebKit before the fix, 2 of 5 rows blank).
 *
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-quiz-list>li{content-visibility:visible} | .gg-quiz-list>li{content-visibility:auto}
 * @mutate src/pages/info/giftGuides/GiftGuideFinder.tsx | <PickRow key={p.href} pick={p} guide={who!.guide} eager /> | <PickRow key={p.href} pick={p} guide={who!.guide} />
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx | loading={eager ? "eager" : "lazy"} | loading="lazy"
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx |         <PickThumb pick={pick} eager={eager} /> |         <PickThumb pick={pick} />
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

import GiftGuides from "@/pages/info/GiftGuides";
import { guideBySlug, loadGuidePicks } from "@/content/giftGuideCatalog";
import { GIFT_GUIDES_CSS } from "@/pages/info/giftGuides/giftGuidesStyles";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/gift-guides" element={<GiftGuides />} />
        <Route path="/gift-guides/:slug" element={<GiftGuides />} />
      </Routes>
    </MemoryRouter>,
  );

/** The phone block of the guides' stylesheet that holds the row's heart and cart line. */
const phoneLine = () => {
  const at = GIFT_GUIDES_CSS.indexOf(".gg-list>:where([data-gift-pick])>.gg-heart-pick{bottom:0;right:0");
  const open = GIFT_GUIDES_CSS.lastIndexOf("@media (max-width:767px){", at);
  return { at, open, block: GIFT_GUIDES_CSS.slice(open, GIFT_GUIDES_CSS.indexOf("\n}", at)) };
};

describe("the quiz's results are the guides' rows, each with its photo", () => {
  it("Him $25 to $50, Tools & cars: every result is a PickRow in an .gg-list, heart then cart, its guide photo loading at once", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-22T18:00:00Z"));
    await act(async () => { await loadGuidePicks("him"); });
    const { container } = renderAt("/gift-guides?who=him&budget=25-50&into=tools#gift-finder");
    await waitFor(() => expect(container.querySelector("[data-gift-finder-results]")).not.toBeNull(), { timeout: 5000 });
    const list = container.querySelector("[data-gift-finder-results] ol")!;
    expect(list.matches("ol.gg-list.gg-quiz-list")).toBe(true);
    const rows = [...list.querySelectorAll<HTMLLIElement>(":scope > li[data-gift-pick]")];
    expect(rows.length).toBeGreaterThan(2);
    const photos = new Map((guideBySlug("him")?.picks ?? []).map((p) => [p.href, p.image]));
    let amazon = 0;
    for (const li of rows) {
      const href = li.querySelector("a[data-gift-title-link]")!.getAttribute("href")!;
      const img = li.querySelector<HTMLImageElement>("img.gg-thumb");
      expect(img, href).not.toBeNull();
      expect(img!.getAttribute("src")).toBe(photos.get(href));
      expect(img!.getAttribute("loading")).toBe("eager");
      expect(li.querySelector("[data-gift-letter]")).toBeNull();
      // The same children as a guide row: the card link, then the heart, then (Amazon) the cart, all direct children.
      const kids = [...li.children].map((c) => (c.matches("[data-gift-title-link]") ? "link" : c.classList.contains("gg-heart-pick") ? "heart" : c.classList.contains("gg-cart") ? "cart" : "other"));
      expect(kids.slice(0, 2)).toEqual(["link", "heart"]);
      if (kids.includes("cart")) { amazon += 1; expect(kids).toEqual(["link", "heart", "cart"]); }
    }
    expect(amazon).toBeGreaterThan(0);
  });

  it("the phone line (cart left of the heart under the price) is the shared .gg-list rule, and no quiz row skips drawing", () => {
    const { at, open, block } = phoneLine();
    expect(at).toBeGreaterThan(0);
    expect(open).toBeGreaterThan(0);
    expect(block).toContain(".gg-list>:where([data-gift-pick])>.gg-cart{bottom:0;right:44px");
    // No quiz-only override moves the heart or the cart anywhere else.
    expect(GIFT_GUIDES_CSS).not.toMatch(/\.gg-quiz[^{]*\.gg-(heart-pick|cart)/);
    expect(GIFT_GUIDES_CSS).toContain(".gg-list>li{content-visibility:auto");
    expect(GIFT_GUIDES_CSS).toContain(".gg-quiz-list>li{content-visibility:visible}");
    expect(GIFT_GUIDES_CSS.indexOf(".gg-quiz-list>li{content-visibility:visible}")).toBeGreaterThan(GIFT_GUIDES_CSS.indexOf(".gg-list>li{content-visibility:auto"));
  });
});
