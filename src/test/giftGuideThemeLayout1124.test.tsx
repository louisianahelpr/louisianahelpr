/**
 * THE THEMED KIDS GUIDES ARE SET UP AS FOR KIDS (owner 2026-11-24 ~7 PM, a phone screenshot of /gift-guides/monster-jam
 * with its "Jump to a section:" chips: "Remove these buttons and add a filter like the main 3 guides. They should also be
 * sorted like the main 3 guides: stocking stuffer 10, 10-25, 25-75, 75-100, 100+ or whatever the main 3 guides are").
 * On every live theme (Monster Jam, Bluey ... whichever `node scripts/theme-guide-import.mjs` has added):
 *  - no "Jump to a section" chips;
 *  - the toolbar is Kids': search, Filter, heart, share (no separate Sort icon), and the Filter holds Sort, Age (when the
 *    theme's research gave ages), Price and For, narrowing the list the way Kids' does;
 *  - the picks sit in the main guides' price sections (src/lib/pickPriceShown.mjs PRICE_SECTIONS: Stocking stuffers under
 *    $10, Under $25, $25 to $50, $50 to $75, $75 to $100, $100 and up), in that order, every one open on arrival;
 *  - data-driven: the chunk the generator AND the import write (scripts/giftGuideThemePicks.mjs themeChunkPicks) has no
 *    category section, runs cheapest first with priceRank, and carries the research's age in years; the Filter's tags load
 *    on the theme's page only (src/content/giftGuideThemeTags.ts, off the /gift-guides/:slug critical path);
 *  - an item the owner sent herself (`ownerAdd`, lead 11-24) goes on even where a style rule would keep it off.
 *
 * @mutate src/pages/info/GiftGuides.tsx |   const kidsPage = guide?.slug === KIDS_FILTER_GUIDE \|\| themePage; |   const kidsPage = guide?.slug === KIDS_FILTER_GUIDE;
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx |   const sortable = isOwnerList(guide.slug) \|\| isThemeGuide(guide.slug); |   const sortable = isOwnerList(guide.slug);
 * @mutate scripts/giftGuideThemePicks.mjs |     const { id: _id, was: _was, age, section: _section, sectionId: _sectionId, ownerAdd: _ownerAdd, sortPrice: _sp, ...p } = row; |     const { id: _id, was: _was, age, ownerAdd: _ownerAdd, sortPrice: _sp, ...p } = row;
 * @mutate scripts/theme-guide-import.mjs |   const picks = themeChunkPicks(slug, rows); |   const picks = rows.map(({ id: _i, was: _w, age: _a, ...p }) => ({ ...p, ownerPick: true, from: slug }));
 * @mutate src/content/giftGuideThemeTags.ts |   return girls === boys ? "everyone" : girls ? "girls" : "boys"; |   return "everyone";
 * @mutate scripts/theme-guide-import.mjs | export const breaksStyleRule = (slug, it, href) => !it.ownerAdd && ownerStyleOff( | export const breaksStyleRule = (slug, it, href) => ownerStyleOff(
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: null }) }));
vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

import GiftGuides from "@/pages/info/GiftGuides";
import { THEME_GUIDES_1124 } from "@/content/giftGuideLive.mjs";
import { guideBySlug, loadAllGuidePicks } from "@/content/giftGuideCatalog";
import { NO_KIDS_SELECTION, filterKids, type KidsSelection } from "@/content/giftGuideKidsFilter";
import { tagsFromPicks } from "@/content/giftGuideThemeTags";
import { breaksStyleRule } from "../../scripts/theme-guide-import.mjs";
import { PRICE_SECTIONS, priceSectionId } from "@/lib/pickPriceShown.mjs";
import { themeAge, themeChunkPicks } from "../../scripts/giftGuideThemePicks.mjs";
import { themePicks1124, themeRows1124 } from "../../scripts/giftGuideThemes1124.mjs";
import { blankComments } from "./helpers/blankNonCode";

await loadAllGuidePicks();
afterEach(() => { cleanup(); vi.useRealTimers(); });

// The newest price-read day (LEGO's rows were read 11-24 night into 11-25); a row priced after "today" shows "price soon".
const TODAY = "2026-11-25";
const renderAt = async (url: string) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-25T18:00:00Z"));
  let out!: ReturnType<typeof render>;
  await act(async () => {
    out = render(
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/gift-guides/:slug" element={<GiftGuides />} />
        </Routes>
      </MemoryRouter>,
    );
  });
  return out.container;
};
const rows = (c: HTMLElement) => c.querySelectorAll("[data-gift-list] [data-gift-pick]").length;
const sel = (s: Partial<KidsSelection>): KidsSelection => ({ ...NO_KIDS_SELECTION, ...s });
type Chunk = { picks: { name: string; href: string; price: number; section?: string; sectionId?: string; priceRank?: number; ageMin?: number; ageMax?: number }[] };
const chunkOf = (slug: string) => (JSON.parse(readFileSync(`src/content/giftGuidePicks/${slug}.json`, "utf8")) as Chunk).picks;

describe("a theme's age, in years, from the research's own words (never a guess)", () => {
  it.each([
    ["3+", { ageMin: 3 }],
    ["4-12", { ageMin: 4, ageMax: 12 }],
    ["18-36m", { ageMin: 1.5, ageMax: 3 }],
    ["12m-5T", { ageMin: 1, ageMax: 5 }],
    ["18m-12", { ageMin: 1.5, ageMax: 12 }],
    ["18m+", { ageMin: 1.5 }],
    ["toddler", { ageMin: 1, ageMax: 3 }],
    ["teens", { ageMin: 13, ageMax: 17 }],
    ["kids", {}],
    ["all", {}],
    ["adult sizes", {}],
    ["toddler-big kid", {}],
    [undefined, {}],
  ])("%s", (age, want) => {
    expect(themeAge(age)).toEqual(want);
  });
});

describe("the data: one chunk rule for the generator and the import", () => {
  it("the import writes its chunk with themeChunkPicks, the generator's own rule", () => {
    const src = blankComments(readFileSync("scripts/theme-guide-import.mjs", "utf8"));
    expect(src).toContain("const picks = themeChunkPicks(slug, rows);");
    expect(src).toMatch(/import \{ themeChunkPicks \} from "\.\/giftGuideThemePicks\.mjs";/);
  });

  it.each([...THEME_GUIDES_1124])("%s: no category section, cheapest first with priceRank, ages from the research", (slug) => {
    const chunk = chunkOf(slug);
    expect(chunk).toEqual(JSON.parse(JSON.stringify(themeChunkPicks(slug, themeRows1124(slug)))));
    expect(chunk).toEqual(JSON.parse(JSON.stringify(themePicks1124(slug))));
    expect(chunk.length).toBeGreaterThan(5);
    for (const p of chunk) expect([p.section, p.sectionId], p.name).toEqual([undefined, undefined]);
    expect(chunk.map((p) => p.priceRank)).toEqual(chunk.map((_, i) => i + 1));
    // The Filter shows Age on every theme (as on Kids), so every theme must have aged picks to show under it.
    expect(chunk.filter((p) => typeof p.ageMin === "number").length, slug).toBeGreaterThan(2);
    const byHref = new Map(themeRows1124(slug).map((r) => [r.href, r]));
    for (const p of chunk) {
      const want = themeAge(byHref.get(p.href)?.age);
      expect({ ageMin: p.ageMin, ageMax: p.ageMax }, p.name).toEqual({ ageMin: want.ageMin, ageMax: want.ageMax });
    }
  });
});

describe.each([...THEME_GUIDES_1124])("the %s page is set up as For Kids", (slug) => {
  it("no section chips; the main guides' price sections in order, all open; the toolbar is search, Filter, heart, share", async () => {
    const c = await renderAt(`/gift-guides/${slug}`);
    const picks = guideBySlug(slug)!.picks;
    expect(rows(c)).toBe(picks.length);
    expect(c.querySelector("[data-gift-section-nav]")).toBeNull();
    expect(c.textContent).not.toContain("Jump to a section");
    const toggles = [...c.querySelectorAll<HTMLButtonElement>("[data-gift-section-toggle]")].map((t) => {
      expect(t.getAttribute("aria-expanded")).toBe("true");
      return t.getAttribute("data-gift-section-toggle");
    });
    const allIds = PRICE_SECTIONS.map((s) => s.id);
    expect(toggles).toEqual(allIds.filter((id) => picks.some((p) => priceSectionId(p.price) === id)));
    if (picks.some((p) => priceSectionId(p.price) === "stocking-stuffers")) expect(toggles[0]).toBe("stocking-stuffers");
    const quick = c.querySelector("[data-gift-quick]")!;
    const order = [...quick.querySelectorAll("[data-gift-search-button], [data-gift-filter-button], .gg-mylist-icon, [aria-haspopup='menu']")]
      .map((el) => (el.hasAttribute("data-gift-search-button") ? "search" : el.hasAttribute("data-gift-filter-button") ? "filter" : el.classList.contains("gg-mylist-icon") ? "heart" : "share"));
    expect(order).toEqual(["search", "filter", "heart", "share"]);
    expect(quick.querySelector("[data-gift-sort-button]")).toBeNull();
  });
});

describe("the Monster Jam Filter narrows the list as Kids' does", () => {
  it("Sort, Age, Price and For; a price chip, then an age chip, narrow the rows; Clear resets", async () => {
    const c = await renderAt("/gift-guides/monster-jam");
    const picks = guideBySlug("monster-jam")!.picks;
    const tags = tagsFromPicks(chunkOf("monster-jam"));
    const button = c.querySelector<HTMLButtonElement>("[data-gift-quick] [data-gift-filter-button]")!;
    act(() => { fireEvent.click(button); });
    // Age and For arrive with the theme's own tags (loaded on its page only).
    await waitFor(() => expect(c.querySelector("[data-gift-filter-group='age']")).not.toBeNull());
    expect([...c.querySelectorAll("[data-gift-filter-panel] [role='group']")].map((g) => g.getAttribute("aria-label"))).toEqual(["Sort", "Age", "Price", "For"]);
    const chip = (id: string) => c.querySelector<HTMLButtonElement>(`[data-gift-filter-chip='${id}']`)!;
    act(() => { fireEvent.click(chip("price:under-10")); });
    const under10 = filterKids(picks, sel({ prices: ["under-10"] }), tags, TODAY).length;
    expect(under10).toBeGreaterThan(0);
    expect(under10).toBeLessThan(picks.length);
    expect(rows(c)).toBe(under10);
    act(() => { fireEvent.click(chip("price:under-10")); });
    act(() => { fireEvent.click(chip("age:baby")); });
    const baby = filterKids(picks, sel({ ages: ["baby"] }), tags, TODAY).length;
    expect(baby).toBeGreaterThan(0);
    expect(baby).toBeLessThan(picks.length);
    expect(rows(c)).toBe(baby);
    act(() => { fireEvent.click(c.querySelector<HTMLButtonElement>("[data-gift-filter-clear]")!); });
    expect(rows(c)).toBe(picks.length);
  });

  it("For names Girls or Boys only where the product's own name does", () => {
    const tags = tagsFromPicks([
      { href: "https://walmrt.us/a", name: "Bluey Girls Holiday Cozy Crew Socks" },
      { href: "https://walmrt.us/b", name: "Monster Jam Boys' Pajama Set" },
      { href: "https://walmrt.us/c", name: "Monster Jam Grave Digger Truck" },
      { href: "https://walmrt.us/d", name: "Boys and Girls Hoodie" },
    ]);
    expect(Object.values(tags).map((t) => t.gender)).toEqual(["girls", "boys", "everyone", "everyone"]);
  });
});

describe("an item the owner sent herself goes on (owner-decides-guide-items)", () => {
  it("a style rule keeps a research row off, but never one marked ownerAdd", () => {
    const neon = { name: "Hot Wheels Monster Trucks Neon Smashers 4 Trucks + 5 Cars", image: "https://x/neon.jpg" };
    expect(breaksStyleRule("hot-wheels", neon, "https://walmrt.us/x")).toBe(true);
    expect(breaksStyleRule("hot-wheels", { ...neon, ownerAdd: true }, "https://walmrt.us/x")).toBe(false);
  });

  it("every ownerAdd row in a theme's rows file is on its page with the owner's own link", () => {
    let n = 0;
    for (const slug of THEME_GUIDES_1124) {
      const hrefs = new Set(chunkOf(slug).map((p) => p.href));
      for (const r of themeRows1124(slug).filter((x) => x.ownerAdd)) {
        n++;
        expect(hrefs.has(r.href), `${slug} ${r.id}`).toBe(true);
      }
    }
    expect(n).toBeGreaterThan(40);
  });
});
