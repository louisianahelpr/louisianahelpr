/**
 * GUARD (gift guides holistic review, 11-18 9:41 PM, owner: "this needs to be super easy for users or they won't use it
 * at all"): the UI half of the review's findings.
 *  - H1: the kids age guides sit two taps from the landing (a "Kids by age" block in For kids: Babies 0–1 to Big kids
 *    8–12, each with Girls, Boys and Gender-neutral), and Niece, Nephew and Cousins carry BY AGE chips.
 *  - H4: every item has a visible "Shop at <store> ›" link with a 44px tap area, apart from the heart (a plain text
 *    link since the owner's 11-20 "too busy looking"; it was an outlined pill Button).
 *  - H5: search knows meaning (fishing, "4 year old niece", tween, cheap, christmas, under $25), drops filler words
 *    ("gift for mom" is Mom, not 18 Life moments guides), reads product names from a lazily loaded index kept current by
 *    scripts/gift-guide-search-index.mjs, and shows each guide's cover.
 *  - M9: quick-pick chips under the search; L3: the item count; L6: no back arrow on the landing; L1: no repeated name
 *    under a cover, and the heart under the cover; L2: the phone banner is short.
 *
 * Owner 11-21: only Her, Him and Kids are live (src/content/giftGuideLive.mjs); the budget, Christmas and Kids-by-
 * age tests (all reaching retired guides or blocks) are gone.
 *
 * @mutate src/content/giftGuideCatalog.ts |     if (BAND_WORDS[w]) { |     if (BAND_WORDS[w] && false) {
 * @mutate src/content/giftGuideCatalog.ts |   const words = meaningful.length ? meaningful : all; |   const words = all;
 * @mutate src/content/giftGuideCatalog.ts | (label.get(g.row) ?? []).includes(w)); | (label.get(g.row) ?? []).some((x) => x.includes(w)));
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx |       <AgeChips slug={guide.slug} /> |
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx | <GiftOut href={pick.href} className="gg-item" data-gift-title-link=""> | <GiftOut href={pick.href} className="gg-item">
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx |         <GiftOut href={cart} className="gg-cart"> |         <GiftOut href={cart} className="gg-cart-other">
 * @mutate src/pages/info/GiftGuides.tsx | <GuidesTop backTo={backTo} | <GuidesTop backTo={guide ? backTo : "hidden"}
 * @mutate src/pages/info/giftGuides/GiftGuideTile.tsx | className={label ? "gg-name" : "gg-name sr-only"} | className="gg-name"
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { GUIDES, guideBySlug, loadAllGuidePicks, searchGuides, searchItems, type SearchItem } from "@/content/giftGuideCatalog";
import ITEMS from "@/content/giftGuideSearchIndex.json";
import { buildIndex, indexText } from "../../scripts/gift-guide-search-index.mjs";

vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children, hideBack, backTo }: { children: React.ReactNode; hideBack?: boolean; backTo?: string }) => (
    <main><div data-test-back={hideBack ? "hidden" : backTo} />{children}</main>
  ),
}));
import GiftGuides from "@/pages/info/GiftGuides";
import { GIFT_GUIDES_CSS } from "@/pages/info/giftGuides/giftGuidesStyles";
import { THEME_GUIDES_1124 } from "@/content/giftGuideLive.mjs";

afterEach(cleanup);
await loadAllGuidePicks();

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/gift-guides" element={<GiftGuides />} />
        <Route path="/gift-guides/:slug" element={<GiftGuides />} />
      </Routes>
    </MemoryRouter>,
  );
const slugs = (q: string) => searchGuides(q).map((g) => g.slug);
const live = (s: string) => !!guideBySlug(s) && !guideBySlug(s)!.empty;

describe("H5: search finds what shoppers type", () => {
  it("a sentence finds its person: 'something for my husband who fishes' finds Him", () => {
    // Owner 11-21: the fishing guides (Outdoors & Travel) are retired (src/content/giftGuideLive.mjs); the person stays.
    expect(slugs("something for my husband who fishes")).toEqual(expect.arrayContaining(["him"]));
    expect(slugs("fishing").filter((s) => s === "outdoors-and-travel" || s.startsWith("store-"))).toEqual([]);
  });

  it("an age finds the age guides; a niece's age finds the girls' guide first; a budget finds its Under $X guide", () => {
    expect(slugs("4 year old")).toEqual(expect.arrayContaining(["girls-little-kids", "boys-little-kids", "gender-neutral-little-kids"].filter(live)));
    const niece = slugs("gift for my 4 year old niece under $25");
    if (live("girls-little-kids")) expect(niece[0]).toBe("girls-little-kids");
    expect(niece).toEqual(expect.arrayContaining(["under-25", "niece"].filter(live)));
    expect(niece).not.toContain("boys-little-kids");
    if (live("boys-big-kids")) expect(slugs("10 yo nephew")[0]).toBe("boys-big-kids");
    expect(slugs("toddler")).toEqual(expect.arrayContaining(["girls-toddlers", "boys-toddlers"].filter(live)));
    if (live("under-30")) expect(slugs("under 30")[0]).toBe("under-30");
    if (live("under-25")) expect(slugs("$22")[0]).toBe("under-25");
  });

  it("filler words are dropped: 'gift for mom' is Her, and no guide matches through 'Life moments'", () => {
    const mom = searchGuides("gift for mom");
    expect(mom.map((g) => g.slug)).toEqual(["her"]); // owner 11-21: Mom is no guide; it opens Her
    expect(slugs("gifts")).not.toEqual([]);
  });

  it("product names are searched from the item index, which matches the picks exactly (two-way)", () => {
    const items = ITEMS as unknown as SearchItem[];
    expect(items.length).toBeGreaterThan(100); // owner 11-21: Her, Him, Kids and the sponsors page only (144 measured 2026-11-21)
    // The committed index is what the generator writes from today's picks; run `node scripts/gift-guide-search-index.mjs`.
    expect(readFileSync("src/content/giftGuideSearchIndex.json", "utf8")).toBe(indexText(buildIndex()));
    for (const [name, slug] of items.slice(0, 200)) {
      const g = guideBySlug(slug);
      expect(g, slug).toBeTruthy();
      expect(g!.picks.some((p) => p.name.trim().replace(/\s+/g, " ") === name), `${name} in ${slug}`).toBe(true);
    }
    const anyName = items[0][0];
    expect(searchItems(items, anyName).map((x) => x[0])).toContain(anyName);
    expect(searchItems(items, "gift for the")).toEqual([]);
    expect(searchItems(items, "xyzzy")).toEqual([]);
  });

  it("the results show each guide's cover and the matching items, each opening its guide", async () => {
    const { container } = renderAt("/gift-guides");
    // Owner 11-21 ("make search an icon always"): the field opens from the magnifier.
    fireEvent.click(container.querySelector("[data-gift-search-button]")!);
    const input = container.querySelector<HTMLInputElement>("[data-gift-search]")!;
    fireEvent.change(input, { target: { value: "mom" } });
    const first = container.querySelector("a[data-gift-found]")!;
    expect(first.getAttribute("href")).toBe("/gift-guides/her");
    expect(first.querySelector("img.gg-search-thumb")?.getAttribute("src")).toBe(guideBySlug("her")!.cover);
    const items = ITEMS as unknown as SearchItem[];
    const word = items[0][0].split(/\s+/).find((w) => w.length > 4)!;
    fireEvent.change(input, { target: { value: word } });
    const item = await new Promise<Element | null>((done) => {
      const t0 = Date.now();
      const poll = () => {
        const el = container.querySelector("a[data-gift-found-item]");
        if (el || Date.now() - t0 > 3000) done(el);
        else setTimeout(poll, 20);
      };
      poll();
    });
    expect(item, word).not.toBeNull();
    // Guide audit 1123 I2: the result opens its guide AT the gift (the row's #gift-... link).
    expect(item!.getAttribute("href")).toMatch(new RegExp(`^/gift-guides/${item!.getAttribute("data-gift-found-item")}#gift-[a-z0-9-]+$`));
  });
});

describe("H1: the kids age guides are two taps from the landing", () => {

  it("Niece, Nephew and Cousins carry BY AGE chips to their hub's age guides; Mom has none", () => {
    for (const [slug, hub] of [["niece", "girls"], ["nephew", "boys"], ["cousins", "gender-neutral"]] as const) {
      if (!live(slug)) continue;
      const { container } = renderAt(`/gift-guides/${slug}`);
      const chips = container.querySelector(`[data-gift-age-chips='${hub}']`)!;
      expect(chips, slug).not.toBeNull();
      const hrefs = [...chips.querySelectorAll("a")].map((a) => a.getAttribute("href"));
      expect(hrefs.length, slug).toBeGreaterThan(0); // one guide per product (owner 11-19): fewer age guides show
      for (const h of hrefs) expect(h, slug).toMatch(new RegExp(`^/gift-guides/${hub}-`));
      cleanup();
    }
    expect(renderAt("/gift-guides/mom").container.querySelector("[data-gift-age-chips]")).toBeNull();
  });
});

describe("H4: every item says tap to buy: its photo and name are the link", () => {
  // Owner 2026-11-21: "remove the shop at button, when they click the title of the image it will go there to the link".
  it("each row's photo and name are ONE outbound link (new tab, sponsored rel), with no Shop button; the heart is outside", () => {
    const { container } = renderAt("/gift-guides/mom");
    const rows = [...container.querySelectorAll("[data-gift-list] > li")];
    expect(rows.length).toBeGreaterThan(10);
    for (const li of rows) {
      // Owner 11-21 (Amazon Buy Now): an Amazon item also has its small cart link (src/test/cardCart1121.test.tsx); that
      // is the only other link a card may hold.
      const links = [...li.querySelectorAll("a")].filter((x) => !(x.classList.contains("gg-cart") && x.querySelector("[data-gift-cart]")));
      expect(links.length).toBe(1);
      const a = li.querySelector("a[data-gift-title-link]")!;
      expect(a).toBe(links[0]);
      expect(a.querySelector(".gg-nm-name")?.textContent?.length).toBeGreaterThan(2);
      expect(a.querySelector(".gg-photo, .gg-thumb")).not.toBeNull();
      expect(a.getAttribute("rel")).toBe("sponsored noopener");
      expect(a.getAttribute("target")).toBe("_blank");
      expect(a.contains(li.querySelector("[data-gift-heart]"))).toBe(false);
      expect(li.querySelector(".gg-shop-btn, [data-gift-shop]")).toBeNull();
    }
    expect(rows.some((li) => /\bShop\b/.test(li.textContent ?? ""))).toBe(false);
  });
});

describe("M9, L1, L2, L3, L6: the landing and guide page are quick to use", () => {
  it("one tap from the landing: its three tiles open Her, Him and Kids (owner 11-21; no chip strip since owner 11-20 PM)", () => {
    const { container } = renderAt("/gift-guides");
    expect(container.querySelector("[data-gift-quick-picks]")).toBeNull();
    const tiles = [...container.querySelectorAll("[data-gift-live-guides] a[data-gift-tile]")];
    expect(tiles.map((a) => a.getAttribute("href"))).toEqual(["/gift-guides/her", "/gift-guides/him", "/gift-guides/kids", ...THEME_GUIDES_1124.map((s) => `/gift-guides/${s}`)]);
  });

  // Owner 11-21 ("title on left with back arrow on the left of the title", like the other pages): the landing's back
  // arrow goes home; every other page's to the landing.
  it("the landing's back arrow goes home; a guide's goes to the landing", () => {
    expect(renderAt("/gift-guides").container.querySelector("[data-gift-back-to]")?.getAttribute("data-gift-back-to")).toBe("/");
    cleanup();
    expect(renderAt("/gift-guides/mom").container.querySelector("[data-gift-back-to]")?.getAttribute("data-gift-back-to")).toBe("/gift-guides");
    // Holiday audit 1121 #14: an old group link opens the landing, whose arrow goes home.
    cleanup();
    expect(renderAt("/gift-guides?group=by-person").container.querySelector("[data-gift-back-to]")?.getAttribute("data-gift-back-to")).toBe("/");
  });

  // Owner 11-21: "they don't need an option to heart the whole guide": no tile carries a heart.
  it("a cover tile has no heart, and one child (its link)", () => {
    // Holiday audit 1121 #14: the group pages are gone; the landing's tiles are the guide tiles.
    const { container } = renderAt("/gift-guides");
    const tiles = [...container.querySelectorAll("[data-gift-live-guides] li.gg-tile-li")];
    expect(tiles.length).toBeGreaterThanOrEqual(2); // owner 11-21: Her, Him and Kids (Mom, Dad ... are filters, not tiles)
    for (const li of tiles) {
      // The landing's tiles carry a visible "Her · 36 gifts" line (lead 11-21 landing polish); the group pages' tiles,
      // whose name was screen-reader only, are gone (holiday audit 1121 #14).
      expect(li.querySelector("[data-gift-tile-name]")?.textContent).toMatch(/ · /);
      expect(li.querySelector("[data-gift-heart]")).toBeNull();
      expect(li.children.length).toBe(1);
    }
    expect(GIFT_GUIDES_CSS).not.toMatch(/\.gg-heart-tile\b/);
  });

  it("a guide shows how many gifts it holds; the phone banner stays short (at most 190px)", () => {
    const { container } = renderAt("/gift-guides/her");
    expect(container.querySelector("[data-gift-item-count]")?.textContent).toBe(`${guideBySlug("her")!.picks.length} gifts`);
    // The phone banner height is the sheet's last .gg-banner height (inside the phone layout block; the phone nav, 11-21,
    // appends its own later @media (max-width:767px) block, so the last such block no longer holds it).
    const h = Number([...GIFT_GUIDES_CSS.matchAll(/\.gg-banner\{height:(\d+)px/g)].slice(-1)[0]?.[1]);
    expect(h).toBeGreaterThan(0);
    // Owner 11-21 ("the arches and letters are just small and squished together"): 96px -> 136px; pass 2 the same night
    // ("gifts for her is still too small text size and still close together"): 136px -> 184px, still under 190px.
    expect(h).toBeLessThanOrEqual(190);
    expect(GUIDES.length).toBe(5); // owner 11-21: Her, Him, Kids and the sponsors page (the relationship views are gone); 11-24 + Monster Jam
  });
});
