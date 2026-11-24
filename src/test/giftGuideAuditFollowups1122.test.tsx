/**
 * GIFT GUIDE CONSISTENCY AUDIT FOLLOW-UPS (2026-11-22, Guide-consistency-audit-1122.md).
 *
 * #1 The 25 Days sponsors page's sections (Louisiana Shops & Makers, Louisiana Experiences & Events, National Brands)
 *    were plain 15px h2s. They wear the Her/Him/Kids band header now (GuideSectionHead: the page's tint, "(n)", chevron),
 *    open on arrival, and a tap closes and reopens each.
 * #13 Black Friday / Cyber Monday: every Sales card and every Discount codes card carries the wish-list heart (only the
 *    Top deals cards had one): the same Heart, place (.gg-heart-deal) and save as a Top deal.
 * Audit item 5: a code chip never breaks a code mid-word ("SHOWSTOPPER3 / 0" at 375): the code is one unbroken line,
 *    and a chip too narrow for the code and its copy icon puts the icon under the code (flex-wrap) instead.
 *
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx |   const bandHeads = sortable \|\| guide.slug === SPONSORS_PAGE \|\| guide.slug === MONSTER_JAM_PAGE; |   const bandHeads = sortable \|\| guide.slug === MONSTER_JAM_PAGE;
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx |   if (bandHeads) for (const p of picks) sectionCount |   if (sortable) for (const p of picks) sectionCount
 * @mutate src/pages/info/giftGuides/GiftGuideDealCards.tsx |       <CardHeart href={href} name={name} store={store} /> |       {null}
 * @mutate src/pages/info/giftGuides/GiftGuideDealCards.tsx | heartTapped(togglePick({ href, name, guide: DEALS_SLUG, id })); | heartTapped("added");
 * @mutate src/pages/info/giftGuides/GiftGuideDealCards.tsx | letter-spacing:0;white-space:nowrap;text-align:left} | letter-spacing:0;overflow-wrap:anywhere;text-align:left}
 * @mutate src/pages/info/giftGuides/GiftGuideDealCards.tsx | .gg-code-chip{display:inline-flex;flex-wrap:wrap; | .gg-code-chip{display:inline-flex;
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
// The "save for" picker loads in its own chunk after the page draws, and once it is mounted a heart opens it instead
// of saving (saveForPeople.ts requestSaveFor). Whether the tap below beat that load was a race (green locally, red on
// CI shard 5 for #4896), so the picker is a stub here: the heart's own save is tested; the picker path is
// savePerPerson1121.test.tsx's.
vi.mock("@/pages/info/giftGuides/SaveForSomeone", () => ({ SaveForSomeone: () => null, SAVE_FOR_CSS: "" }));

import GiftGuides from "@/pages/info/GiftGuides";
import { guideBySlug, loadAllGuidePicks } from "@/content/giftGuideCatalog";
import { CARD_CSS } from "@/pages/info/giftGuides/GiftGuideDealCards";

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

describe("#13 hearts on every Sales and Discount codes card; audit item 5 codes never break mid-word", () => {
  it("Black Friday and Cyber Monday: every code card and sale card has the deal heart, and a tap saves and unsaves it", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-21T18:00:00Z"));
    try {
      localStorage.clear();
      let cards = 0;
      for (const slug of ["black-friday", "cyber-monday"]) {
        const c = await renderGuide(slug);
        await waitFor(() => expect(c.querySelectorAll("li[data-gift-sale-store]").length, slug).toBeGreaterThan(0));
        // The deal cards load in their own chunk and redraw the page when they arrive (a code a deal card already shows
        // loses its code card, polish audit 1122 #12). Wait for them so the taps below run on the settled page.
        await waitFor(() => expect(c.querySelectorAll("[data-gift-deal-list] [data-gift-deal]").length, slug).toBeGreaterThan(0));
        expect(c.querySelectorAll("li[data-gift-code-store]").length, slug).toBeGreaterThan(0);
        const list = [...c.querySelectorAll<HTMLElement>("li[data-gift-sale-store], li[data-gift-code-store]")];
        for (const li of list) {
          const heart = li.querySelector<HTMLButtonElement>(":scope > button.gg-heart.gg-heart-deal[data-gift-heart]");
          expect(heart, `${slug} ${li.getAttribute("data-gift-sale-store") ?? li.getAttribute("data-gift-code-store")}`).not.toBeNull();
          expect(heart!.getAttribute("aria-label")).toBeTruthy();
          cards++;
        }
        // A tap fills the heart (saved to My Wish List) and a second tap empties it.
        // The heart is found again before each tap and each check (by its card's store), so a redraw between the taps
        // (red on CI shard 5 for #4942: "true" after the second tap, green locally) taps and reads the heart on the page.
        const sel = list[0].hasAttribute("data-gift-code-store")
          ? `li[data-gift-code-store="${list[0].getAttribute("data-gift-code-store")}"]`
          : `li[data-gift-sale-store="${list[0].getAttribute("data-gift-sale-store")}"]`;
        const heartNow = () => c.querySelector<HTMLButtonElement>(`${sel} > button.gg-heart-deal`)!;
        expect(heartNow().getAttribute("aria-pressed")).toBe("false");
        await act(async () => { fireEvent.click(heartNow()); });
        await waitFor(() => expect(heartNow().getAttribute("aria-pressed")).toBe("true"));
        await act(async () => { fireEvent.click(heartNow()); });
        await waitFor(() => expect(heartNow().getAttribute("aria-pressed")).toBe("false"));
        cleanup();
      }
      expect(cards).toBeGreaterThan(30);
    } finally {
      vi.useRealTimers();
    }
  });

  it("the code chip keeps the code on one line (no overflow-wrap/word-break) and wraps its copy icon instead", () => {
    const body = (sel: string) => {
      const at = CARD_CSS.indexOf(`${sel}{`);
      expect(at, sel).toBeGreaterThan(0);
      return CARD_CSS.slice(at, CARD_CSS.indexOf("}", at));
    };
    const code = body(".gg-code-chip code");
    expect(code).toContain("white-space:nowrap");
    expect(code).not.toMatch(/overflow-wrap|word-break/);
    const chip = body(".gg-code-chip");
    expect(chip).toContain("flex-wrap:wrap");
    expect(chip).toContain("min-width:0");
  });
});
