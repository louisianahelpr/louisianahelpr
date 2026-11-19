/**
 * GUARD (gift guides holistic review, 11-18 9:41 PM, owner: "this needs to be super easy for users or they won't use it
 * at all"): the UI half of the review's findings.
 *  - H1: the kids age guides sit two taps from the landing (a "Kids by age" block in For kids: Babies 0–1 to Big kids
 *    8–12, each with Girls, Boys and Gender-neutral), and Niece, Nephew and Cousins carry BY AGE chips.
 *  - H4: every item has a visible "Shop at <store> ›" pill, a 44px shared Button, apart from the heart.
 *  - H5: search knows meaning (fishing, "4 year old niece", tween, cheap, christmas, under $25), drops filler words
 *    ("gift for mom" is Mom, not 18 Life moments guides), reads product names from a lazily loaded index kept current by
 *    scripts/gift-guide-search-index.mjs, and shows each guide's cover.
 *  - M9: quick-pick chips under the search; L3: the item count; L6: no back arrow on the landing; L1: no repeated name
 *    under a cover, and the heart under the cover; L2: the phone banner is short.
 *
 * @mutate src/content/giftGuideCatalog.ts |   { words: ["fishing", "fish", | {   words: ["xfishing", "fish",
 * @mutate src/content/giftGuideCatalog.ts |     if (BAND_WORDS[w]) { |     if (BAND_WORDS[w] && false) {
 * @mutate src/content/giftGuideCatalog.ts |   const words = meaningful.length ? meaningful : all; |   const words = all;
 * @mutate src/content/giftGuideCatalog.ts |     return rest.every((w) => hay.includes(w) \|\| (label.get(g.row) ?? []).includes(w)); |     return rest.every((w) => hay.includes(w) \|\| (label.get(g.row) ?? []).join(" ").includes(w));
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx |       <AgeChips slug={guide.slug} /> |
 * @mutate src/pages/info/giftGuides/GiftGuideLanding.tsx |         {row === "for-kids" && !group && <KidsByAge />} |
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx |       <Button asChild variant="outline" size="sm" className="gg-shop-btn"> |       <Button asChild variant="outline" size="inline" className="gg-shop-btn">
 * @mutate src/pages/info/GiftGuides.tsx | hideBack={!guide && !myList && !group} | hideBack={false}
 * @mutate src/pages/info/giftGuides/GiftGuideTile.tsx | className={label ? "gg-name" : "gg-name sr-only"} | className="gg-name"
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { GUIDES, guideBySlug, loadAllGuidePicks, searchGuides, searchItems, type SearchItem } from "@/content/giftGuideCatalog";
import ITEMS from "@/content/giftGuideSearchIndex.json";
// @ts-expect-error -- a plain .mjs generator with no .d.mts; only this test imports it
import { buildIndex, indexText } from "../../scripts/gift-guide-search-index.mjs";

vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children, hideBack, backTo }: { children: React.ReactNode; hideBack?: boolean; backTo?: string }) => (
    <main><div data-test-back={hideBack ? "hidden" : backTo} />{children}</main>
  ),
}));
import GiftGuides from "@/pages/info/GiftGuides";
import { GIFT_GUIDES_CSS } from "@/pages/info/giftGuides/giftGuidesStyles";
import { QUICK_PICKS } from "@/pages/info/giftGuides/GiftGuideLanding";

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
  it("fishing finds the fishing guides, not only a store", () => {
    // The review: "fishing" returned only the Simms store.
    const hits = slugs("fishing");
    expect(hits.slice(0, 2)).toEqual(["fishermen", "fish-lover"].filter(live));
    expect(slugs("something for my husband who fishes")).toEqual(expect.arrayContaining(["fishermen", "boyfriend-or-husband"].filter(live)));
  });

  it("an age finds the age guides; a niece's age finds the girls' guide first; a budget finds its Under $X guide", () => {
    expect(slugs("4 year old")).toEqual(expect.arrayContaining(["girls-little-kids", "boys-little-kids", "gender-neutral-little-kids"].filter(live)));
    const niece = slugs("gift for my 4 year old niece under $25");
    expect(niece[0]).toBe("girls-little-kids");
    expect(niece).toEqual(expect.arrayContaining(["under-25", "niece"].filter(live)));
    expect(niece).not.toContain("boys-little-kids");
    expect(slugs("10 yo nephew")[0]).toBe("boys-big-kids");
    expect(slugs("toddler")).toEqual(expect.arrayContaining(["girls-toddlers", "boys-toddlers"]));
    expect(slugs("under 30")[0]).toBe("under-30");
    expect(slugs("$22")[0]).toBe("under-25");
  });

  it("tween, cheap and christmas find guides (each found nothing)", () => {
    expect(slugs("tween")).toEqual(expect.arrayContaining(["girls-big-kids", "girls-teens"].filter(live)));
    expect(slugs("cheap")).toEqual(expect.arrayContaining(["under-10", "under-25"].filter(live)));
    expect(slugs("christmas")).toContain("stocking-stuffers");
    expect(slugs("stocking")[0]).toBe("stocking-stuffers");
  });

  it("filler words are dropped: 'gift for mom' is Mom, and no guide matches through 'Life moments'", () => {
    const mom = searchGuides("gift for mom");
    expect(mom[0].slug).toBe("mom");
    expect(mom.filter((g) => !/mom/i.test(g.title))).toEqual([]);
    expect(slugs("gifts")).not.toEqual([]);
  });

  it("product names are searched from the item index, which matches the picks exactly (two-way)", () => {
    const items = ITEMS as unknown as SearchItem[];
    expect(items.length).toBeGreaterThan(1000);
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
    const input = container.querySelector<HTMLInputElement>("[data-gift-search]")!;
    fireEvent.change(input, { target: { value: "mom" } });
    const first = container.querySelector("a[data-gift-found]")!;
    expect(first.getAttribute("href")).toBe("/gift-guides/mom");
    expect(first.querySelector("img.gg-search-thumb")?.getAttribute("src")).toBe(guideBySlug("mom")!.cover);
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
    expect(item!.getAttribute("href")).toBe(`/gift-guides/${item!.getAttribute("data-gift-found-item")}`);
  });
});

describe("H1: the kids age guides are two taps from the landing", () => {
  it("the For kids row carries Kids by age: four bands, each with its Girls, Boys and Gender-neutral guides", () => {
    const { container } = renderAt("/gift-guides");
    const row = container.querySelector("[data-gift-row='for-kids']")!;
    const ages = row.querySelector("[data-gift-ages]")!;
    expect(ages).not.toBeNull();
    expect([...ages.querySelectorAll("[data-gift-age-band]")].map((b) => b.getAttribute("data-gift-age-band"))).toEqual(["babies", "toddlers", "little-kids", "big-kids"]);
    expect(ages.querySelector("[data-gift-age-band='little-kids'] .gg-age-name")?.textContent).toBe("Little kids 4–7");
    const links = [...ages.querySelectorAll("a[data-gift-age-link]")].map((a) => a.getAttribute("href"));
    const want = ["babies", "toddlers", "little-kids", "big-kids"].flatMap((t) => ["girls", "boys", "gender-neutral"].map((h) => `${h}-${t}`)).filter(live);
    expect(links).toEqual(want.map((s) => `/gift-guides/${s}`));
    expect(links.length).toBeGreaterThan(8);
  });

  it("Niece, Nephew and Cousins carry BY AGE chips to their hub's age guides; Mom has none", () => {
    for (const [slug, hub] of [["niece", "girls"], ["nephew", "boys"], ["cousins", "gender-neutral"]] as const) {
      if (!live(slug)) continue;
      const { container } = renderAt(`/gift-guides/${slug}`);
      const chips = container.querySelector(`[data-gift-age-chips='${hub}']`)!;
      expect(chips, slug).not.toBeNull();
      const hrefs = [...chips.querySelectorAll("a")].map((a) => a.getAttribute("href"));
      expect(hrefs.length, slug).toBeGreaterThan(3);
      for (const h of hrefs) expect(h, slug).toMatch(new RegExp(`^/gift-guides/${hub}-`));
      cleanup();
    }
    expect(renderAt("/gift-guides/mom").container.querySelector("[data-gift-age-chips]")).toBeNull();
  });
});

describe("H4: every item has a visible Shop pill", () => {
  it("'Shop at <store> ›', a 44px shared Button (h-11), its own link apart from the heart, opening the same shop", () => {
    const { container } = renderAt("/gift-guides/mom");
    const rows = [...container.querySelectorAll("[data-gift-list] > li")];
    expect(rows.length).toBeGreaterThan(10);
    for (const li of rows) {
      const pill = li.querySelector("a.gg-shop-btn")!;
      expect(pill).not.toBeNull();
      expect(pill.className.split(/\s+/)).toContain("h-11");
      expect(pill.querySelector("[data-gift-shop]")?.textContent).toMatch(/^Shop( at .+)?$/);
      expect(pill.textContent).toContain("›");
      expect(pill.getAttribute("href")).toBe(li.querySelector("a.gg-item")!.getAttribute("href"));
      expect(pill.getAttribute("rel")).toBe("sponsored noopener");
      expect(pill.contains(li.querySelector("[data-gift-heart]"))).toBe(false);
    }
    expect(rows.some((li) => /^Shop at /.test(li.querySelector("[data-gift-shop]")!.textContent!))).toBe(true);
    // The pill is never hidden (the old Shop word was display:none on every width).
    expect(GIFT_GUIDES_CSS).not.toMatch(/\.gg-shop-btn\{[^}]*display:none/);
    expect(GIFT_GUIDES_CSS).not.toMatch(/\.gg-shop\{/);
  });
});

describe("M9, L1, L2, L3, L6: the landing and guide page are quick to use", () => {
  it("quick picks sit under the search, one tap each, every chip to a guide that holds picks or a group", () => {
    const { container } = renderAt("/gift-guides");
    const chips = [...container.querySelectorAll("[data-gift-quick-picks] a")];
    expect(chips.map((a) => a.textContent)).toEqual(QUICK_PICKS.filter((c) => !c.slug || live(c.slug)).map((c) => c.label));
    expect(chips.length).toBeGreaterThan(5);
    for (const a of chips) expect(a.className.split(/\s+/)).toContain("h-11");
    expect(chips.map((a) => a.getAttribute("href"))).toEqual(expect.arrayContaining(["/gift-guides/under-25", "/gift-guides?group=for-kids", "/gift-guides?group=louisiana"]));
  });

  it("the landing has no back arrow; a guide's goes to the landing", () => {
    expect(renderAt("/gift-guides").container.querySelector("[data-test-back]")?.getAttribute("data-test-back")).toBe("hidden");
    cleanup();
    expect(renderAt("/gift-guides/mom").container.querySelector("[data-test-back]")?.getAttribute("data-test-back")).toBe("/gift-guides");
    cleanup();
    expect(renderAt("/gift-guides?group=by-budget").container.querySelector("[data-test-back]")?.getAttribute("data-test-back")).toBe("/gift-guides");
  });

  it("a cover tile does not repeat its cover's name, and its heart sits after the cover, not on it", () => {
    const { container } = renderAt("/gift-guides");
    const tiles = [...container.querySelectorAll("[data-gift-row='by-person'] li.gg-tile-li")];
    expect(tiles.length).toBeGreaterThan(5);
    for (const li of tiles) {
      expect(li.querySelector("[data-gift-tile-name]")?.classList.contains("sr-only")).toBe(true);
      expect(li.lastElementChild?.hasAttribute("data-gift-heart")).toBe(true);
    }
    expect(GIFT_GUIDES_CSS).not.toMatch(/\.gg-heart-tile\{[^}]*position:absolute/);
  });

  it("a guide shows how many gifts it holds; the phone banner is at most 96px tall", () => {
    const { container } = renderAt("/gift-guides/mom");
    expect(container.querySelector("[data-gift-item-count]")?.textContent).toBe(`${guideBySlug("mom")!.picks.length} gifts`);
    const phone = GIFT_GUIDES_CSS.slice(GIFT_GUIDES_CSS.lastIndexOf("@media (max-width:767px){"));
    const h = Number(/\.gg-banner\{height:(\d+)px/.exec(phone)?.[1]);
    expect(h).toBeGreaterThan(0);
    expect(h).toBeLessThanOrEqual(96);
    expect(GUIDES.length).toBeGreaterThan(100);
  });
});
