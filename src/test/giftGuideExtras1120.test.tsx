/**
 * Gift guides big batch 1120 extras (owner approved 11-19 ~9:05-9:10 PM): the gift finder always returns a list (owner
 * 11-20: Mom + Under $25 + Trendy said "Nothing fits"), exact matches then close ones, and shares it by URL; the shipping-deadline chip shows through a store's order-by day and
 * hides after it; the 25 Days banner and the Declutter link stay OFF until the lead flips their flags; the budget filter
 * inside a guide keeps only picks within the budget; a merged guide's section links open their section.
 *
 * Owner 11-21 ("launch the 3 guides remove the rest that are live"): the gift finder is off the landing and the
 * merged guides are retired (src/content/giftGuideLive.mjs), so their tests are gone.
 *
 * @mutate src/content/giftGuideExtras1120.ts |   if (!d \|\| today > d.orderBy) return null; |   if (!d) return null;
 * @mutate src/content/giftGuideExtras1120.ts |   giveawayBanner: { on: false, from: "2026-11-22" }, |   giveawayBanner: { on: true, from: "2026-11-22" },
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx | export const withinBudget = (picks: CatalogPick[], budget: number \| null) => (budget ? picks.filter((p) => p.band !== undefined && p.band <= budget) : picks); | export const withinBudget = (picks: CatalogPick[], budget: number \| null) => picks;
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { guideBySlug, loadAllGuidePicks, type CatalogPick } from "@/content/giftGuideCatalog";
import { GIFT_GUIDE_FLAGS, SHIP_DEADLINES, deadlineChip, declutterTieInOn, giveawayBannerOn } from "@/content/giftGuideExtras1120";
vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
import GiftGuides from "@/pages/info/GiftGuides";
import { BUDGETS, withinBudget } from "@/pages/info/giftGuides/GiftGuideView";
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
    // For Him (For Her is the owner's own flat list since 11-21: no bands, so no budget chips; checked below).
    const all = picksOf("him");
    expect(BUDGETS).toEqual([25, 50, 100]);
    for (const b of BUDGETS) for (const p of withinBudget(all, b)) expect(p.band!, p.name).toBeLessThanOrEqual(b);
    expect(withinBudget(all, null)).toBe(all);
    expect(all.filter((p) => p.store === "amazon").every((p: CatalogPick) => p.band === undefined)).toBe(true);
    const { container } = renderAt("/gift-guides/him");
    const choices = container.querySelectorAll("[data-gift-budget-choice]");
    expect(choices.length).toBe(4);
    fireEvent.click(container.querySelector('[data-gift-budget-choice="25"]')!);
    const shown = container.querySelectorAll("[data-gift-list] li[data-gift-pick]").length;
    expect(shown).toBe(Math.min(withinBudget(all, 25).length, 56));
    const her = renderAt("/gift-guides/her").container;
    expect(her.querySelectorAll("[data-gift-budget-choice]").length).toBe(0);
  });
});
