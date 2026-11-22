/**
 * Gift guides polish (owner-approved 2026-11-18, Builder 7 items 2 and 3):
 *   - "Trending": a small olive pill (text, sentence case) on the first three picks of a guide in its featured order;
 *     never on a store page's list and never on pick #4 on;
 *   - "Last-minute gifts": a section at the top of the landing from Dec 15 through Dec 25 (America/Chicago), with the
 *     Gift cards and Subscriptions tiles and an "Arrives by Christmas" note carrying the shipping pill's words; hidden
 *     before Dec 15 and after Dec 25.
 *
 * Owner 11-21: store pages and the landing's Last-minute row are retired with every guide but Her, Him and Kids
 * (src/content/giftGuideLive.mjs); their tests are gone, the date window stays for its return.
 *
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx | ?.filter((b) => !SPONSORS_PAGE_HIDDEN_BADGES.includes(b)) : pick.badges; | ?.filter((b) => !SPONSORS_PAGE_HIDDEN_BADGES.includes(b)) : ["trending" as const, ...(pick.badges ?? [])];
 * @mutate src/content/giftGuideShipping.ts |   return month === 12 && day >= 15 && day <= 25; |   return month === 12 && day >= 14 && day <= 25;
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { guideBySlug, loadAllGuidePicks } from "@/content/giftGuideCatalog";
import { LAST_MINUTE, lastMinuteOn } from "@/content/giftGuideShipping";
vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
import GiftGuides from "@/pages/info/GiftGuides";
import { resetGiftListForTests } from "@/pages/info/giftGuides/giftList";

await loadAllGuidePicks();

afterEach(() => {
  cleanup();
  vi.useRealTimers();
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

/** Each list row's badge words, in order. */
const rowBadges = (root: HTMLElement) =>
  [...root.querySelectorAll("[data-gift-list] > li[data-gift-pick]")].map((li) => [...li.querySelectorAll("[data-gift-badge]")].map((b) => b.textContent));

describe("gift guides: Trending only where the pick is trending (big batch 1120)", () => {
  // Owner 11-19 ~6:40 PM: every guide sorts by commission, so "the first three" is no featured order any more; a pick
  // wears Trending, or "Trending on TikTok" (owner-approved 9:05 PM), only from its own flag, at most one of the two.
  it.each(["him", "kids", "her"])("%s: each row wears Trending only from its own flag, never two", (slug) => {
    const picks = guideBySlug(slug)!.picks;
    expect(picks.length).toBeGreaterThan(5);
    const { container } = renderAt(`/gift-guides/${slug}`);
    const rows = rowBadges(container);
    expect(rows.length).toBeGreaterThan(5);
    for (const [i, words] of rows.entries()) {
      const n = words.filter((w) => w === "Trending" || w === "Trending on TikTok").length;
      const own = (picks[i].badges ?? []).filter((b) => b === "trending" || b === "tiktok").length;
      expect(n, `${slug} #${i + 1}`).toBe(own);
      expect(n, `${slug} #${i + 1}`).toBeLessThanOrEqual(1);
    }
  });
  it("some guide shows a Trending on TikTok pill, drawn as a badge", () => {
    const slug = ["him", "her", "mom", "dad", "healthcare", "game-day", "brother"].find((s) => guideBySlug(s)?.picks.some((p) => p.badges?.includes("tiktok")));
    // Owner 11-21: only Her, Him and Kids are live, each her own saved list, and none of her saves carries the TikTok
    // badge today; the pill is checked whenever a live guide has one.
    if (!slug) { expect(["him", "her", "kids"].some((s) => guideBySlug(s)?.picks.some((p) => p.badges?.includes("tiktok")))).toBe(false); return; }
    const { container } = renderAt(`/gift-guides/${slug}`);
    const pill = container.querySelector('[data-gift-badge="tiktok"]')!;
    expect(pill.tagName).toBe("I");
    expect(pill.className).toContain("gg-bdg");
    expect(pill.textContent).toBe("Trending on TikTok");
  });

  it("the pill is the site's olive, not its own colour", async () => {
    const { GIFT_GUIDES_CSS } = await import("@/pages/info/giftGuides/giftGuidesStyles").then((m) => ({ GIFT_GUIDES_CSS: Object.values(m).filter((v) => typeof v === "string").join("\n") }));
    expect(GIFT_GUIDES_CSS).toContain(".gg-bdg{");
    expect(GIFT_GUIDES_CSS).toMatch(/\.gg-bdg\{[^}]*background:#eef2e6;color:#3f5a1c/);
    expect(GIFT_GUIDES_CSS).not.toMatch(/\.gg-bdg-trending\{/);
  });
});

describe("gift guides: Last-minute gifts, Dec 15-25 in Louisiana", () => {
  // Noon Chicago time is 18:00Z (CST, UTC-6).
  it("the window follows the date in Louisiana", () => {
    expect(lastMinuteOn(new Date("2026-12-14T18:00:00Z"))).toBe(false);
    expect(lastMinuteOn(new Date("2026-12-15T06:30:00Z"))).toBe(true); // 12:30 AM Dec 15 in Louisiana
    expect(lastMinuteOn(new Date("2026-12-15T05:30:00Z"))).toBe(false); // 11:30 PM Dec 14 in Louisiana
    expect(lastMinuteOn(new Date("2026-12-25T18:00:00Z"))).toBe(true);
    expect(lastMinuteOn(new Date("2026-12-26T18:00:00Z"))).toBe(false);
    expect(lastMinuteOn(new Date("2026-11-18T18:00:00Z"))).toBe(false);
  });

  const at = (iso: string) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(iso));
  };

  it("hidden before Dec 15", () => {
    at("2026-12-14T18:00:00Z");
    const { container } = renderAt("/gift-guides");
    expect(container.querySelector("[data-gift-browse]")).not.toBeNull();
    expect(container.querySelector("[data-gift-last-minute]")).toBeNull();
    expect(container.textContent).not.toContain(LAST_MINUTE.title);
  });

  it("hidden after Dec 25", () => {
    at("2026-12-26T18:00:00Z");
    expect(renderAt("/gift-guides").container.querySelector("[data-gift-last-minute]")).toBeNull();
  });

  // Holiday audit 1121 #14: the group "See all" pages are gone (an old ?group= link opens the landing), so there is no
  // group page to keep the card off; src/test/giftGuideHolidayPolish1121b.test.tsx guards the redirect.
});
