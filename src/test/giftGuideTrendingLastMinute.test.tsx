/**
 * Gift guides polish (owner-approved 2026-11-18, Builder 7 items 2 and 3):
 *   - "Trending": a small olive pill (text, sentence case) on the first three picks of a guide in its featured order;
 *     never on a store page's list and never on pick #4 on;
 *   - "Last-minute gifts": a section at the top of the landing from Dec 15 through Dec 25 (America/Chicago), with the
 *     Gift cards and Subscriptions tiles and an "Arrives by Christmas" note carrying the shipping pill's words; hidden
 *     before Dec 15 and after Dec 25.
 *
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx |   const badges = pick.badges; |   const badges = ["trending" as const, ...(pick.badges ?? [])];
 * @mutate src/content/giftGuideShipping.ts |   return month === 12 && day >= 15 && day <= 25; |   return month === 12 && day >= 14 && day <= 25;
 * @mutate src/pages/info/giftGuides/GiftGuideLanding.tsx |       {!group && <LastMinute />} |       {null}
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { guideBySlug, loadAllGuidePicks } from "@/content/giftGuideCatalog";
import { LAST_MINUTE, SHIP_LINES, lastMinuteOn } from "@/content/giftGuideShipping";
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
  it.each(["mom", "dad", "her"])("%s: each row wears Trending only from its own flag, never two", (slug) => {
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
    expect(slug).toBeTruthy();
    const { container } = renderAt(`/gift-guides/${slug}`);
    const pill = container.querySelector('[data-gift-badge="tiktok"]')!;
    expect(pill.tagName).toBe("I");
    expect(pill.className).toContain("gg-bdg");
    expect(pill.textContent).toBe("Trending on TikTok");
  });

  it("a store page's list wears no Trending pill", () => {
    const { container } = renderAt("/gift-guides/store-walmart");
    expect(rowBadges(container).length).toBeGreaterThan(3);
    expect(container.querySelector('[data-gift-badge="trending"]')).toBeNull();
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
    expect(container.querySelector("[data-gift-rows]")).not.toBeNull();
    expect(container.querySelector("[data-gift-last-minute]")).toBeNull();
    expect(container.textContent).not.toContain(LAST_MINUTE.title);
  });

  it("hidden after Dec 25", () => {
    at("2026-12-26T18:00:00Z");
    expect(renderAt("/gift-guides").container.querySelector("[data-gift-last-minute]")).toBeNull();
  });

  it("shows at the top on Dec 18, with the Gift cards and Subscriptions tiles and the shipping note", () => {
    at("2026-12-18T18:00:00Z");
    const { container } = renderAt("/gift-guides");
    const sec = container.querySelector<HTMLElement>("[data-gift-last-minute]")!;
    expect(sec).not.toBeNull();
    expect(sec.querySelector("h2")?.textContent).toBe("Last-minute gifts");
    const tiles = [...sec.querySelectorAll("[data-gift-tile]")].map((a) => a.getAttribute("data-gift-tile"));
    // Follow-up 1120: the memberships and advent calendars (every 0% gift card out) are a section of Gifts by Budget.
    expect(tiles).toEqual(expect.arrayContaining(["gifts-by-budget"]));
    for (const t of sec.querySelectorAll("[data-gift-tile]")) expect(t.getAttribute("href")).toBe(`/gift-guides/${t.getAttribute("data-gift-tile")}`);
    expect(sec.querySelector("[data-gift-last-minute-note]")?.textContent).toBe(`Arrives by Christmas: ${SHIP_LINES.late}`);
    // Above every guide row.
    const firstRow = container.querySelector("[data-gift-rows]")!;
    expect(sec.compareDocumentPosition(firstRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("on Dec 23 the note carries the instant-gift line", () => {
    at("2026-12-23T18:00:00Z");
    const { container } = renderAt("/gift-guides");
    expect(container.querySelector("[data-gift-last-minute-note]")?.textContent).toBe(`Arrives by Christmas: ${SHIP_LINES.instant}`);
  });

  it("not on a group's See all page", () => {
    at("2026-12-18T18:00:00Z");
    expect(renderAt("/gift-guides?group=by-person").container.querySelector("[data-gift-last-minute]")).toBeNull();
  });
});
