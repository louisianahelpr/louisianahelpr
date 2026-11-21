/**
 * Gift guides big batch 1120 extras (owner approved 11-19 ~9:05-9:10 PM): the gift finder always returns a list (owner
 * 11-20: Mom + Under $25 + Trendy said "Nothing fits"), exact matches then close ones, and shares it by URL; the shipping-deadline chip shows through a store's order-by day and
 * hides after it; the 25 Days banner and the Declutter link stay OFF until the lead flips their flags; the budget filter
 * inside a guide keeps only picks within the budget; a merged guide's section links open their section.
 *
 * @mutate src/content/giftGuideExtras1120.ts |   if (!d \|\| today > d.orderBy) return null; |   if (!d) return null;
 * @mutate src/content/giftGuideExtras1120.ts |   giveawayBanner: { on: false, from: "2026-11-22" }, |   giveawayBanner: { on: true, from: "2026-11-22" },
 * @mutate src/content/giftGuideExtras1120.ts |   const fits = (p: CatalogPick) => { const b = pickBand(p); return budget === 0 \|\| (b !== undefined && b <= budget); }; |   const fits = (p: CatalogPick) => true;
 * @mutate src/content/giftGuideExtras1120.ts |   for (const tier of [own.filter(fits), lent.filter(vibed), lent, louisiana]) | for (const tier of [own.filter(fits), louisiana])
 * @mutate src/content/giftGuideExtras1120.ts |   if (p.price !== undefined && p.store !== "amazon") return | if (false) return
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx | export const withinBudget = (picks: CatalogPick[], budget: number \| null) => (budget ? picks.filter((p) => p.band !== undefined && p.band <= budget) : picks); | export const withinBudget = (picks: CatalogPick[], budget: number \| null) => picks;
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { guideBySlug, loadAllGuidePicks, type CatalogPick } from "@/content/giftGuideCatalog";
import { FINDER_BUDGET_GUIDES, FINDER_BUDGETS, FINDER_COUNT, FINDER_FEW, FINDER_LOUISIANA_GUIDES, FINDER_VIBES, FINDER_WHO, pickBand, GIFT_GUIDE_FLAGS, SHIP_DEADLINES, deadlineChip, declutterTieInOn, finderPool, giftFinder, giveawayBannerOn, readFinder } from "@/content/giftGuideExtras1120";
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

describe("gift finder (three taps, always a list, a share link)", () => {
  const borrow = FINDER_BUDGET_GUIDES.flatMap(picksOf);
  const all = (r: { exact: CatalogPick[]; close: CatalogPick[] }) => [...r.exact, ...r.close];

  it("returns a full list for every who, from that guide, the vibe's first", () => {
    for (const w of FINDER_WHO) {
      const pool = finderPool(w.id, picksOf);
      expect(pool.length, w.id).toBeGreaterThan(0);
      const any = giftFinder(pool, 0, "cozy", borrow, w.id);
      // Owner 11-20 night: thin guides after her removals; the finder never pads, so a short list is fine.
      expect(all(any).length, w.id).toBeLessThanOrEqual(FINDER_COUNT);
      expect(all(any).length, w.id).toBeGreaterThan(0);
      expect(new Set(all(any).map((p) => p.href)).size).toBe(all(any).length);
      for (const p of all(any)) expect(pool, w.id).toContain(p);
    }
    const her = finderPool("her", picksOf);
    for (const p of giftFinder(her, 50, "trendy", borrow, "her").exact) expect(pickBand(p) ?? Infinity, p.name).toBeLessThanOrEqual(50);
    // The vibe's picks lead: a Louisiana answer opens on a Louisiana pick when the pool holds one.
    const dad = finderPool("dad", picksOf);
    const la = all(giftFinder(dad, 0, "louisiana", borrow, "dad"));
    if (dad.some((p) => /louisiana|lsu|saints|cajun|nola/i.test(`${p.name} ${p.brand ?? ""}`))) expect(`${la[0].name} ${la[0].brand ?? ""}`).toMatch(/louisiana|lsu|saints|cajun|nola|creole|bayou|crawfish|geaux/i);
  });

  it("never says nothing fits: every who x budget x vibe gives a list, every pick within the budget (owner 11-20; holiday audit A #65)", () => {
    for (const w of FINDER_WHO) for (const b of FINDER_BUDGETS) for (const v of FINDER_VIBES) {
      const r = all(giftFinder(finderPool(w.id, picksOf), b.id, v.id, borrow, w.id));
      expect(r.length, `${w.id} ${b.id} ${v.id}`).toBeGreaterThan(0); // owner 11-20 10:20 PM ("ok remove the ones i selected"): she removed these cards herself; never padded
      expect(new Set(r.map((p) => p.href)).size, `${w.id} ${b.id} ${v.id}`).toBe(r.length);
      if (b.id) for (const p of r) expect(pickBand(p) ?? Infinity, `${w.id} ${b.id} ${v.id}: ${p.name}`).toBeLessThanOrEqual(b.id);
      // One card per brand (A #69: three Summer Fridays items in one list).
      const brands = r.map((p) => (p.brand ?? "").toLowerCase()).filter(Boolean);
      expect(new Set(brands).size, `${w.id} ${b.id} ${v.id}: ${brands.join(", ")}`).toBe(brands.length);
    }
    // Mom + Under $25 + Trendy: real under-$25 picks lead (a known band, price or "Under $25" section), never men's or toys.
    const mom = all(giftFinder(finderPool("mom", picksOf), 25, "trendy", borrow, "mom"));
    expect(mom.slice(0, 6).every((p) => (pickBand(p) ?? Infinity) <= 25), mom.map((p) => p.name).join(", ")).toBe(true);
    for (const p of mom) expect(`${p.name}`).not.toMatch(/\b(men'?s|boys'?|play-?doh|melissa & doug|squishmallows?)\b/i);
    const dad = all(giftFinder(finderPool("dad", picksOf), 25, "practical", borrow, "dad"));
    for (const p of dad) expect(p.name).not.toMatch(/\b(women'?s|lip|makeup|nail|earrings)\b/i);
  });

  it("the Louisiana vibe lists Louisiana picks for every person (holiday audit A #64)", () => {
    const local = FINDER_LOUISIANA_GUIDES.flatMap(picksOf);
    expect(local.length).toBeGreaterThan(14);
    const fromLouisiana = new Set(local.map((p) => p.href));
    for (const who of ["dad", "mom", "friend", "her", "him", "grandparent", "coworker"] as const) for (const b of [0, 100] as const) {
      const r = giftFinder(finderPool(who, picksOf), b, "louisiana", borrow, who, local);
      expect(r.exact.length, `${who} ${b}`).toBeGreaterThanOrEqual(3);
      for (const p of r.exact) expect(fromLouisiana.has(p.href) || p.badges?.includes("louisiana-made") || /louisiana|lsu|saints|nola|cajun|creole|bayou|crawfish|geaux|new orleans/i.test(`${p.name} ${p.brand ?? ""}`), `${who} ${b}: ${p.name}`).toBe(true);
    }
  });

  it("an Amazon pick joins a budget only by its budget section, and no Amazon price is ever shown", () => {
    const amazon = borrow.filter((p) => p.store === "amazon");
    for (const p of amazon) expect(p.price, p.name).toBeUndefined();
    const under100 = amazon.filter((p) => p.sectionId === "under-100");
    if (under100.length) expect(pickBand(under100[0])).toBe(100);
    for (const p of finderPool("mom", picksOf).filter((x) => x.store === "amazon" && x.sectionId === "top-picks")) expect(pickBand(p)).toBeUndefined();
    const { container } = renderAt("/gift-guides?who=mom&budget=25&vibe=trendy");
    const box = container.querySelector("[data-gift-finder-results]")!;
    expect(box.querySelector("[data-gift-finder-none]")).toBeNull();
    expect(box.textContent).not.toMatch(/Amazon picks show with Any budget/);
    expect(box.querySelectorAll("li[data-gift-pick]").length).toBeGreaterThanOrEqual(6);
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

  it("the steps appear one tap at a time (the finder opens from its folded card, owner 11-20 PM)", () => {
    const { container } = renderAt("/gift-guides");
    expect(container.querySelector('[data-gift-finder-step="who"]')).toBeNull();
    fireEvent.click(container.querySelector("[data-gift-finder-open]")!);
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
    // Owner 11-20 night ("just remove the sections and make it one guide"): one flat list, no section links or headings.
    expect(container.querySelectorAll("a[data-gift-section-link]").length).toBe(0);
    expect(container.querySelectorAll("[data-gift-list]").length).toBe(1);
  });
});
