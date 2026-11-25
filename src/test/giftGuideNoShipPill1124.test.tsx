/**
 * Owner 2026-11-24 ~8:30 PM: "Remove by Dec 15 everywhere". The guides' "Order by Dec 15 for Christmas delivery"
 * shipping pill (it read "By Dec 15" in a phone's count row) is gone from every guides page: the desktop head row, the
 * phone count row, the landing, the deals days, the 25 Days sponsors page, the wish lists, the free pages and the
 * Holiday Hub.
 *
 * The class guard: every /gift-guides/* route in App.tsx and /holidays (plus Find a gift and each live guide, Kids'
 * themed guides too) renders at a phone width (375) and a desktop width (1440) on a date the old pill showed, and none
 * draws [data-gift-ship] or any of the old pill's words; no source under src/pages draws the attribute or the class.
 *
 * @mutate src/pages/info/giftGuides/GuidesTop.tsx |         {toolsInRow && tools}\n |         {toolsInRow && tools}\n        <p className="gg-ship" data-gift-ship="">Order by Dec 15 for Christmas delivery</p>\n
 * @mutate src/pages/info/GiftGuides.tsx | <p className="gg-itemcount" data-gift-item-count="">{G.itemCount(guide.picks.length)}</p>} | <p className="gg-itemcount" data-gift-item-count="">{G.itemCount(guide.picks.length)}</p>}<p data-gift-ship="">By Dec 15</p>
 * @mutate src/pages/info/giftGuides/fun/FunPage.tsx |       <GuidesTop backTo="/gift-guides" banner={banner} |       <p>Order by Dec 15 for Christmas delivery</p><GuidesTop backTo="/gift-guides" banner={banner}
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { readFileSync } from "node:fs";
import { blankComments } from "./helpers/blankNonCode";
import { readdirSync } from "./helpers/trackedFiles";

vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn(), AhaEvent: new Proxy({}, { get: (_t, k) => String(k) }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: null }) }));
vi.mock("@/lib/sbsFeaturedApi", () => ({
  listFeaturedLocal: vi.fn(async () => []),
  sbsLogoUrl: (id: string) => `https://x.invalid/logo?${id}`,
  sbsDeviceId: () => "test-device-0001",
  submitFeaturedLocal: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/giftGuideFunApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/giftGuideFunApi")>()),
  revealSecretSanta: vi.fn(() => new Promise(() => {})),
}));
vi.mock("@/lib/giftWishListApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/giftWishListApi")>()),
  getSharedList: vi.fn(() => new Promise(() => {})),
}));

import GiftGuides from "@/pages/info/GiftGuides";
import Printables from "@/pages/info/giftGuides/printables/Printables";
import SwipeGifts from "@/pages/info/giftGuides/fun/SwipeGifts";
import SecretSanta from "@/pages/info/giftGuides/fun/SecretSanta";
import SecretSantaReveal from "@/pages/info/giftGuides/fun/SecretSantaReveal";
import GiftPlanner from "@/pages/info/giftGuides/fun/GiftPlanner";
import HolidayHub from "@/pages/info/holidays/HolidayHub";
import { loadAllGuidePicks } from "@/content/giftGuideCatalog";
import { THEME_GUIDES_1124 } from "@/content/giftGuideLive.mjs";

await loadAllGuidePicks();

/** Each guides route in App.tsx -> the URLs it is checked at. */
const ROUTES: Record<string, string[]> = {
  "/gift-guides": ["/gift-guides", "/gift-guides#gift-finder"],
  "/gift-guides/draw-names": ["/gift-guides/draw-names"],
  "/gift-guides/secret-santa/:code/:token": ["/gift-guides/secret-santa/ABCD/tok-1"],
  "/gift-guides/swipe": ["/gift-guides/swipe"],
  "/gift-guides/planner": ["/gift-guides/planner"],
  "/gift-guides/printables": ["/gift-guides/printables"],
  "/gift-guides/printables/gift-tags": ["/gift-guides/printables/gift-tags"],
  "/gift-guides/printables/coloring-books": ["/gift-guides/printables/coloring-books"],
  "/gift-guides/printables/banners": ["/gift-guides/printables/banners"],
  "/gift-guides/:slug": [
    "/gift-guides/her", "/gift-guides/him", "/gift-guides/kids",
    "/gift-guides/black-friday", "/gift-guides/small-business-saturday", "/gift-guides/cyber-monday",
    "/gift-guides/25-days-sponsors", "/gift-guides/my-list",
    ...THEME_GUIDES_1124.slice(0, 1).map((slug: string) => `/gift-guides/${slug}`),
  ],
  "/gift-guides/list/:code": ["/gift-guides/list/abc123def456"],
  "/holidays": ["/holidays"],
};
const URLS = Object.values(ROUTES).flat();

/** Every line the pill ever showed (giftGuideShipping.ts's SHIP_LINES until 11-24), and its phone form. */
const OLD_WORDS = [/Order by Dec 15/i, /\bBy Dec 15\b/, /Christmas delivery/i, /Last days for Christmas shipping/i, /Too late to ship\?/i];

const WIDTH = window.innerWidth;
// 2026-11-22, a day the old pill showed (Nov 1 through Dec 25), so its absence is not the calendar's.
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-22T12:00:00-06:00"));
});
afterAll(() => vi.useRealTimers());
afterEach(() => {
  cleanup();
  Object.defineProperty(window, "innerWidth", { configurable: true, value: WIDTH });
});

const renderAt = async (url: string, width: number) => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  let out!: ReturnType<typeof render>;
  await act(async () => {
    out = render(
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/gift-guides" element={<GiftGuides />} />
          <Route path="/gift-guides/printables" element={<Printables />} />
          <Route path="/gift-guides/printables/*" element={<Printables />} />
          <Route path="/gift-guides/swipe" element={<SwipeGifts />} />
          <Route path="/gift-guides/draw-names" element={<SecretSanta />} />
          <Route path="/gift-guides/secret-santa/:code/:token" element={<SecretSantaReveal />} />
          <Route path="/gift-guides/planner" element={<GiftPlanner />} />
          <Route path="/gift-guides/:slug" element={<GiftGuides />} />
          <Route path="/gift-guides/list/:code" element={<GiftGuides />} />
          <Route path="/holidays" element={<HolidayHub />} />
        </Routes>
      </MemoryRouter>,
    );
  });
  await waitFor(() => expect(out.container.querySelector("[data-gift-headrow]"), url).not.toBeNull());
  return out.container;
};

describe('no "Order by Dec 15" shipping pill on any guides page (owner 2026-11-24 ~8:30 PM)', () => {
  it("the route inventory: every /gift-guides/* route and /holidays in App.tsx is checked here", () => {
    const app = blankComments(readFileSync("src/App.tsx", "utf8"));
    const routes = [...app.matchAll(/<Route path="(\/gift-guides(?:\/[^"]*)?|\/holidays)"/g)].map((m) => m[1]);
    expect(routes.length).toBeGreaterThan(10); // inventory floor: 12 on 2026-11-24
    expect(routes.filter((r) => !(r in ROUTES))).toEqual([]);
    expect(THEME_GUIDES_1124.length).toBeGreaterThan(0);
  });

  const cases = URLS.flatMap((url) => [375, 1440].map((width) => [url, width] as const));
  it.each(cases)("%s at %i: no [data-gift-ship], none of the pill's words", async (url, width) => {
    const c = await renderAt(url, width);
    // The page drew its top (the head row, and on a phone guide its count row), so the check is not of an empty page.
    expect(c.querySelector("[data-gift-head-name]")?.textContent, url).toBe("Holiday gift guides");
    expect(c.querySelectorAll("[data-gift-ship]").length, `${url}@${width}`).toBe(0);
    const text = c.textContent ?? "";
    for (const words of OLD_WORDS) expect(text, `${url}@${width} ${words}`).not.toMatch(words);
  });

  it("a phone guide's count row is the count on the left and the icons on the right, nothing between", async () => {
    for (const url of ["/gift-guides/her", "/gift-guides/kids", "/gift-guides/25-days-sponsors"]) {
      const c = await renderAt(url, 375);
      const row = c.querySelector("[data-gift-countrow]")!;
      expect(row, url).not.toBeNull();
      const kids = [...row.children];
      expect(kids.length, url).toBe(2);
      expect([...kids[0].children].map((k) => k.getAttribute("data-gift-item-count") !== null ? "count" : k.outerHTML.slice(0, 40)), url).toEqual(["count"]);
      expect(kids[1].matches("[data-gift-quick]"), url).toBe(true);
      cleanup();
    }
  });

  it("no source under src/pages draws the pill's attribute or class", () => {
    const files = readdirSync("src/pages", { recursive: true }).map((f) => `src/pages/${f}`).filter((f) => /\.(tsx?|css)$/.test(f));
    expect(files.length).toBeGreaterThan(100);
    const hits = files.filter((f) => /data-gift-ship=|\bgg-ship(?:-order)?\b(?!-)/.test(blankComments(readFileSync(f, "utf8"))));
    expect(hits).toEqual([]);
  });
});
