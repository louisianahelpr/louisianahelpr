/**
 * THE SAM'S CLUB BLACK FRIDAY DEALS GUIDE (owner 2026-11-25 ~4:55 PM: "Can you make a gift guide with the Sam's Club
 * Black Friday deals"). Built by the themed-guide import (scripts/theme-guide-import.mjs; the per-theme checks in
 * giftGuideThemes1124.test.tsx cover its photos, prices, cover and card), but it is a store DEALS guide, not a kids guide
 * (giftGuideLive.mjs DEAL_THEME_TITLES_1125):
 *  - its page opens with the "Join Sam's Club" card (the deals are for members) linking our Later link to
 *    samsclub.com/join, with the membership prices, before the first gift; every gift shows its price, links our Later
 *    link (mavely.app.link) on the Sam's Club store, and its line says when its price runs;
 *  - it is NOT on the /gift-guides landing tiles (owner 11-24: only Her, Him and Kids), NOT in the Kids page's green
 *    cover row, NOT under Kids in the menu; its menu row sits in Deals, right after Black Friday;
 *  - the Black Friday page has a card that opens it;
 *  - its search words say "deals", never "for kids".
 *
 * @mutate src/content/giftGuideLive.mjs | export const KIDS_THEME_GUIDES_1124 = THEME_GUIDES_1124.filter((s) => !isDealTheme(s)); | export const KIDS_THEME_GUIDES_1124 = THEME_GUIDES_1124;
 * @mutate src/pages/info/GiftGuides.tsx | {guide.slug === SAMS_BF_SLUG && <SamsJoinCard />} | {null}
 * @mutate src/pages/info/giftGuides/GiftGuideDeals.tsx |       {day.id === "black-friday" && <SamsBlackFridayFeature />} |       {null}
 * @mutate src/content/themeGuideSearch.mjs |   const head = deals ? | const head = false ?
 * @mutate src/pages/info/GiftGuides.tsx |   const tagsKey = slug && isKidsTheme(slug) ? slug : "kids"; |   const tagsKey = slug && isThemeGuide(slug) ? slug : "kids";
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: null }) }));
vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/lib/sbsFeaturedApi", () => ({ listFeaturedLocal: async () => [], sbsLogoUrl: () => "" }));

import GiftGuides from "@/pages/info/GiftGuides";
import { DEAL_THEME_TITLES_1125, KIDS_THEME_GUIDES_1124, THEME_GUIDES_1124, isDealTheme, isKidsTheme, themeTitle } from "@/content/giftGuideLive.mjs";
import { SAMS_BF_SLUG, SAMS_MEMBERSHIP } from "@/content/samsClubBlackFriday1125";
import { loadAllGuidePicks } from "@/content/giftGuideCatalog";
import { giftGuidePageMeta } from "@/lib/giftGuidePageMeta.mjs";

await loadAllGuidePicks();
afterEach(() => { cleanup(); vi.useRealTimers(); });

type Pick = { name: string; href: string; store: string; price: number; line: string };
const chunk = (JSON.parse(readFileSync(`src/content/giftGuidePicks/${SAMS_BF_SLUG}.json`, "utf8")) as { picks: Pick[] }).picks;

const renderAt = async (url: string) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-25T23:00:00Z"));
  let out!: ReturnType<typeof render>;
  await act(async () => {
    out = render(
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/gift-guides" element={<GiftGuides />} />
          <Route path="/gift-guides/:slug" element={<GiftGuides />} />
        </Routes>
      </MemoryRouter>,
    );
  });
  return out.container;
};

describe("the Sam's Club Black Friday deals guide (owner 2026-11-25)", () => {
  it("is a store deals guide: a themed guide, never a kids theme", () => {
    expect(isDealTheme(SAMS_BF_SLUG)).toBe(true);
    expect(THEME_GUIDES_1124).toContain(SAMS_BF_SLUG);
    expect(KIDS_THEME_GUIDES_1124).not.toContain(SAMS_BF_SLUG);
    expect(isKidsTheme(SAMS_BF_SLUG)).toBe(false);
    expect(themeTitle(SAMS_BF_SLUG)).toBe(DEAL_THEME_TITLES_1125[SAMS_BF_SLUG]);
    // Inventory floor: the kids themes are all still kids themes (Monster Jam at least).
    expect(KIDS_THEME_GUIDES_1124.length).toBeGreaterThan(0);
    for (const s of KIDS_THEME_GUIDES_1124) expect(isKidsTheme(s)).toBe(true);
  });

  it("every gift has a price, our Later link on the Sam's Club store, and a line saying when its price runs", () => {
    expect(chunk.length).toBeGreaterThan(25);
    for (const p of chunk) {
      expect(p.price, p.name).toBeGreaterThan(0);
      expect(p.store, p.name).toBe("store-sams-club");
      expect(new URL(p.href).hostname, p.name).toBe("mavely.app.link");
      expect(p.line, p.name).toMatch(/(Nov|Dec|Jan) \d/);
    }
  });

  it("opens with the Join Sam's Club card, before the first gift, linking our Later membership link", async () => {
    const c = await renderAt(`/gift-guides/${SAMS_BF_SLUG}`);
    const card = c.querySelector("[data-gift-sams-join]");
    expect(card).not.toBeNull();
    const link = card!.querySelector<HTMLAnchorElement>("a[data-gift-sams-join-link]");
    expect(link?.getAttribute("href")).toBe(SAMS_MEMBERSHIP.href);
    expect(new URL(SAMS_MEMBERSHIP.href).hostname).toBe("mavely.app.link");
    expect(card!.textContent).toContain(`$${SAMS_MEMBERSHIP.clubPerYear}`);
    expect(card!.textContent).toContain(`$${SAMS_MEMBERSHIP.plusPerYear}`);
    const first = c.querySelector("li[data-gift-pick]");
    expect(first).not.toBeNull();
    expect(card!.compareDocumentPosition(first!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(c.querySelectorAll("li[data-gift-pick]").length).toBe(chunk.length);
    expect(c.textContent).toContain(themeTitle(SAMS_BF_SLUG));
    // No Kids Filter on a deals page (its Age and For chips are for kids): the price sort only.
    const quick = c.querySelector("[data-gift-quick]")!;
    expect(quick.querySelector("[data-gift-filter-button]")).toBeNull();
    expect(quick.querySelector("[data-gift-sort-button]")).not.toBeNull();
  });

  it("sits in the menu's Deals group after Black Friday, never under Kids, and has no landing tile", async () => {
    const c = await renderAt("/gift-guides");
    const deals = c.querySelector("[data-gift-sidebar] [data-gift-side-deals-group]");
    const row = deals?.querySelector(`[data-gift-side="${SAMS_BF_SLUG}"]`);
    expect(row).not.toBeNull();
    const items = [...(deals?.querySelectorAll(":scope > li") ?? [])];
    const bf = items.findIndex((li) => li.querySelector("[data-gift-side-deals='black-friday']"));
    expect(items[bf + 1]?.querySelector(`[data-gift-side="${SAMS_BF_SLUG}"]`)).not.toBeNull();
    expect(c.querySelector(`[data-gift-sidebar] [data-gift-side-themes] [data-gift-side="${SAMS_BF_SLUG}"]`)).toBeNull();
    expect(c.querySelector(`[data-gift-live-guides] a[href="/gift-guides/${SAMS_BF_SLUG}"]`)).toBeNull();
  });

  it("is not in the Kids page's green cover row", async () => {
    const c = await renderAt("/gift-guides/kids");
    await waitFor(() => expect(c.querySelector("[data-gift-theme-row]")).not.toBeNull());
    const row = c.querySelector("[data-gift-theme-row]")!;
    expect(row.querySelector(`a[href="/gift-guides/${KIDS_THEME_GUIDES_1124[0]}"]`)).not.toBeNull();
    expect(row.querySelector(`a[href="/gift-guides/${SAMS_BF_SLUG}"]`)).toBeNull();
  });

  it("the Black Friday page has a card that opens it", async () => {
    const c = await renderAt("/gift-guides/black-friday");
    await waitFor(() => expect(c.querySelector("[data-gift-deal-day-page]")).not.toBeNull());
    expect(c.querySelector(`a[data-gift-sams-feature][href="/gift-guides/${SAMS_BF_SLUG}"]`)).not.toBeNull();
  });

  it("its search words say deals, never for kids", () => {
    const rows = chunk.map((p) => ({ name: p.name, price: p.price, priceAt: "2026-11-25", store: "Sam's Club" }));
    const meta = giftGuidePageMeta(SAMS_BF_SLUG, "", [], rows.length, rows, "2026-11-25");
    expect(meta.title).toMatch(/deals/i);
    expect(`${meta.title} ${meta.description}`).not.toMatch(/for kids/i);
  });
});
