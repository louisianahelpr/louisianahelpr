/**
 * Gift guides big batch 1120 extras (owner approved 11-19 ~9:05-9:10 PM): the gift finder returns six picks from the
 * guides for three answers and shares them by URL; the shipping-deadline chip shows through a store's order-by day and
 * hides after it; the 25 Days banner and the Declutter link stay OFF until the lead flips their flags; the budget filter
 * inside a guide keeps only picks within the budget; a merged guide's section links open their section.
 *
 * @mutate src/content/giftGuideExtras1120.ts |   if (!d \|\| today > d.orderBy) return null; |   if (!d) return null;
 * @mutate src/content/giftGuideExtras1120.ts |   giveawayBanner: { on: false, from: "2026-11-22" }, |   giveawayBanner: { on: true, from: "2026-11-22" },
 * @mutate src/content/giftGuideExtras1120.ts |   const fits = (p: CatalogPick) => budget === 0 \|\| (p.band !== undefined && p.band <= budget); |   const fits = (p: CatalogPick) => true;
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx | export const withinBudget = (picks: CatalogPick[], budget: number \| null) => (budget ? picks.filter((p) => p.band !== undefined && p.band <= budget) : picks); | export const withinBudget = (picks: CatalogPick[], budget: number \| null) => picks;
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { guideBySlug, loadAllGuidePicks, type CatalogPick } from "@/content/giftGuideCatalog";
import { FINDER_COUNT, FINDER_WHO, GIFT_GUIDE_FLAGS, SHIP_DEADLINES, deadlineChip, declutterTieInOn, finderPool, giftFinder, giveawayBannerOn, readFinder } from "@/content/giftGuideExtras1120";
vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
import GiftGuides from "@/pages/info/GiftGuides";
import { BUDGETS, sectionNav, withinBudget } from "@/pages/info/giftGuides/GiftGuideView";
import { resetGiftListForTests } from "@/pages/info/giftGuides/giftList";

await loadAllGuidePicks();

afterEach(() => {
  cleanup();
  resetGiftListForTests();
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
const picksOf = (slug: string) => guideBySlug(slug)?.picks ?? [];

describe("gift finder (three taps, six picks, a share link)", () => {
  it("returns six picks for every who, from that guide, within the budget, the vibe's first", () => {
    for (const w of FINDER_WHO) {
      const pool = finderPool(w.id, picksOf);
      expect(pool.length, w.id).toBeGreaterThan(5);
      const any = giftFinder(pool, 0, "cozy");
      expect(any.length, w.id).toBe(FINDER_COUNT);
      expect(new Set(any.map((p) => p.href)).size).toBe(any.length);
      for (const p of any) expect(pool, w.id).toContain(p);
    }
    const her = finderPool("her", picksOf);
    for (const p of giftFinder(her, 50, "trendy")) expect(p.band ?? Infinity, p.name).toBeLessThanOrEqual(50);
    // The vibe's picks lead: a Louisiana answer opens on a Louisiana pick when the pool holds one.
    const dad = finderPool("dad", picksOf);
    const la = giftFinder(dad, 0, "louisiana");
    if (dad.some((p) => /louisiana|lsu|saints|cajun|nola/i.test(`${p.name} ${p.brand ?? ""}`))) expect(`${la[0].name} ${la[0].brand ?? ""}`).toMatch(/louisiana|lsu|saints|cajun|nola|creole|bayou|crawfish|geaux/i);
  });

  it("reads its answers from the link and draws the six on the landing", () => {
    expect(readFinder(new URLSearchParams("who=her&budget=50&vibe=cozy"))).toEqual({ who: "her", budget: 50, vibe: "cozy" });
    expect(readFinder(new URLSearchParams("who=nobody&budget=7&vibe=x"))).toEqual({});
    const { container } = renderAt("/gift-guides?who=him&budget=0&vibe=outdoorsy");
    const box = container.querySelector("[data-gift-finder-results]")!;
    expect(box).not.toBeNull();
    expect(box.querySelectorAll("li[data-gift-pick]").length).toBe(FINDER_COUNT);
    expect(box.querySelector("[data-gift-finder-share]")).not.toBeNull();
  });

  it("the steps appear one tap at a time", () => {
    const { container } = renderAt("/gift-guides");
    expect(container.querySelector('[data-gift-finder-step="budget"]')).toBeNull();
    fireEvent.click(container.querySelector('[data-gift-finder-choice="who:mom"]')!);
    expect(container.querySelector('[data-gift-finder-step="budget"]')).not.toBeNull();
  });
});

describe("shipping deadlines (a store's order-by day, hidden after it)", () => {
  it("shows through the day and hides after; the table holds only sourced rows", () => {
    const table = { amazon: { orderBy: "2026-12-18", method: "Prime", source: "https://example.com/holiday", readOn: "2026-11-20" } };
    expect(deadlineChip("amazon", "2026-12-01", table)).toBe("Order by Dec 18");
    expect(deadlineChip("amazon", "2026-12-18", table)).toBe("Order by Dec 18");
    expect(deadlineChip("amazon", "2026-12-19", table)).toBeNull();
    expect(deadlineChip("store-target", "2026-12-01", table)).toBeNull();
    for (const [store, d] of Object.entries(SHIP_DEADLINES)) {
      expect(d.source, store).toMatch(/^https:\/\//);
      expect(d.orderBy, store).toMatch(/^2026-12-\d\d$/);
      expect(d.readOn, store).toMatch(/^2026-\d\d-\d\d$/);
    }
  });
});

describe("the gated banners (OFF until the lead flips them on the owner's word)", () => {
  it("are off, and the 25 Days one never shows before Nov 22 even when on", () => {
    expect(GIFT_GUIDE_FLAGS.giveawayBanner.on).toBe(false);
    expect(GIFT_GUIDE_FLAGS.declutterTieIn.on).toBe(false);
    expect(giveawayBannerOn("2026-11-25")).toBe(false);
    expect(giveawayBannerOn("2026-11-21", { on: true, from: "2026-11-22" })).toBe(false);
    expect(giveawayBannerOn("2026-11-22", { on: true, from: "2026-11-22" })).toBe(true);
    expect(declutterTieInOn()).toBe(false);
    const { container } = renderAt("/gift-guides");
    expect(container.querySelector("[data-gift-giveaway-banner]")).toBeNull();
    expect(container.querySelector("[data-gift-declutter-link]")).toBeNull();
  });
});

describe("a guide's budget filter and section links", () => {
  it("keeps only picks within the budget; Amazon picks carry no band", () => {
    const all = picksOf("her");
    expect(BUDGETS).toEqual([25, 50, 100]);
    for (const b of BUDGETS) for (const p of withinBudget(all, b)) expect(p.band!, p.name).toBeLessThanOrEqual(b);
    expect(withinBudget(all, null)).toBe(all);
    expect(all.filter((p) => p.store === "amazon").every((p: CatalogPick) => p.band === undefined)).toBe(true);
    const { container } = renderAt("/gift-guides/her");
    const choices = container.querySelectorAll("[data-gift-budget-choice]");
    expect(choices.length).toBe(4);
    fireEvent.click(container.querySelector('[data-gift-budget-choice="25"]')!);
    const shown = container.querySelectorAll("[data-gift-list] li[data-gift-pick]").length;
    expect(shown).toBe(Math.min(withinBudget(all, 25).length, 56));
  });

  it("a merged guide lists its sections as links, each opening its section", () => {
    const nav = sectionNav(picksOf("healthcare"));
    expect(nav.length).toBeGreaterThan(3);
    const { container } = renderAt("/gift-guides/healthcare");
    const links = [...container.querySelectorAll("a[data-gift-section-link]")].map((a) => a.getAttribute("href"));
    expect(links).toEqual(nav.map((s) => `/gift-guides/healthcare#${s.id}`));
    fireEvent.click(container.querySelector(`a[data-gift-section-link="${nav[nav.length - 1].id}"]`)!);
    expect(container.querySelector(`#gg-sec-${nav[nav.length - 1].id}`)).not.toBeNull();
  });
});
