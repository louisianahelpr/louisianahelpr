/**
 * GIFT GUIDE CONSISTENCY AUDIT FOLLOW-UPS (2026-11-22, Guide-consistency-audit-1122.md).
 *
 * #1 The 25 Days sponsors page's sections (Louisiana Shops & Makers, Louisiana Experiences & Events, National Brands)
 *    were plain 15px h2s. They wear the Her/Him/Kids band header now (GuideSectionHead: the page's tint, "(n)", chevron),
 *    open on arrival, and a tap closes and reopens each.
 *
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx |   const bandHeads = sortable \|\| guide.slug === SPONSORS_PAGE; |   const bandHeads = sortable;
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx |   if (bandHeads) for (const p of picks) sectionCount |   if (sortable) for (const p of picks) sectionCount
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

import GiftGuides from "@/pages/info/GiftGuides";
import { guideBySlug, loadAllGuidePicks } from "@/content/giftGuideCatalog";

await loadAllGuidePicks();
afterEach(cleanup);

const renderGuide = async (slug: string) => {
  let c!: HTMLElement;
  await act(async () => {
    c = render(
      <MemoryRouter initialEntries={[`/gift-guides/${slug}`]}>
        <Routes><Route path="/gift-guides/:slug" element={<GiftGuides />} /></Routes>
      </MemoryRouter>,
    ).container;
  });
  return c;
};

describe("#1 the 25 Days sponsors page's sections wear the Her/Him/Kids band header", () => {
  it("each section: h2.gg-sec-<tint> holding the toggle, title + (n) + chevron, open, and a tap closes and reopens it", async () => {
    const her = await renderGuide("her");
    const herToggle = her.querySelector<HTMLButtonElement>("button[data-gift-section-toggle]")!;
    const herShape = { h2: herToggle.closest("h2")!.className.replace(/gg-sec-\w+$/, ""), button: herToggle.className };
    cleanup();

    const slug = "25-days-sponsors";
    const tint = guideBySlug(slug)!.tint;
    const c = await renderGuide(slug);
    const toggles = [...c.querySelectorAll<HTMLButtonElement>("button[data-gift-section-toggle]")];
    expect(toggles.map((b) => b.dataset.giftSectionToggle)).toEqual(["louisiana-shops", "louisiana-experiences", "national-brands"]);
    let rows = 0;
    for (const b of toggles) {
      const h2 = b.closest("h2")!;
      expect(h2.className.replace(/gg-sec-\w+$/, "")).toBe(herShape.h2);
      expect(h2.classList.contains(`gg-sec-${tint}`)).toBe(true);
      expect(b.className).toBe(herShape.button);
      expect(b.querySelector("svg.gg-sec-chev")).not.toBeNull();
      expect(b.getAttribute("aria-expanded")).toBe("true");
      const n = b.closest("section")!.querySelectorAll("li[data-gift-pick]").length;
      expect(n).toBeGreaterThan(5);
      expect(b.querySelector("[data-gift-section-count]")!.textContent).toBe(` (${n})`);
      expect(b.textContent).toMatch(/^(Louisiana Shops & Makers|Louisiana Experiences & Events|National Brands) \(\d+\)$/);
      rows += n;
    }
    expect(rows).toBeGreaterThan(90);
    // A tap closes the first section (its rows go) and a second tap reopens it.
    const first = toggles[0];
    const section = first.closest("section")!;
    await act(async () => { fireEvent.click(first); });
    expect(first.getAttribute("aria-expanded")).toBe("false");
    expect(section.querySelectorAll("li[data-gift-pick]").length).toBe(0);
    await act(async () => { fireEvent.click(first); });
    expect(first.getAttribute("aria-expanded")).toBe("true");
    expect(section.querySelectorAll("li[data-gift-pick]").length).toBeGreaterThan(5);
  });
});
