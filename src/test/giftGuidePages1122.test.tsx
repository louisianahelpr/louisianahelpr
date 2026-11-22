/**
 * The owner's live gift guides edits of 2026-11-22 for the guides' sub-pages.
 *
 * #13 ("gifts tags and all the other sections should have the same top section as the guides and the deals"; her right
 *     example Small Business Saturday, her wrong one Free gift tags): every /gift-guides/* page and the Holiday Hub open
 *     on ONE top, GuidesTop: the head row (back arrow + "Holiday gift guides", the shipping pill, the icons), then the
 *     gingham banner holding the page's h1 (a small italic lead, the serif title) in the guides' red / green / beige,
 *     then the menu and the page. It replaces the morning's plain left serif sub-page title. Routes are read from App.tsx,
 *     so a new guides route without the banner fails here.
 *     Owner 11-22 ("Same row, icons off there"): the printables' head row is the pill alone (no search, heart or Share,
 *     her 11-21 call), and the Holiday Hub's has no gift search (one magnifier: the Hub's own lights search).
 * #17 ("remove"): the Gift planner's grey "Tip: tap Bought when you get a gift, and we'll add up what you've spent."
 *     box with its × is gone, with its copy (the planner's lead already says what Bought does).
 *
 * @mutate src/pages/info/giftGuides/fun/GiftPlanner.tsx |       <p className="gg-fun-lead">{W.plannerLead}</p>\n |       <p className="gg-fun-lead">{W.plannerLead}</p>\n      <p data-gift-hint="fun-planner">Tip: tap Bought when you get a gift.</p>\n
 * @mutate src/pages/info/giftGuides/GuidesTop.tsx |       {banner && <GiftGuidesWords | {false && <GiftGuidesWords
 * @mutate src/pages/info/GiftGuides.tsx |     : myList ? G.pageBanners.myList | : myList ? null
 * @mutate src/pages/info/GiftGuides.tsx |     : sidePage === "finder" ? G.pageBanners.finder | : sidePage === "finder" ? null
 * @mutate src/pages/info/holidays/HolidayHub.tsx | path="/holidays" banner={G.pageBanners["/holidays"]} | path="/holidays" banner={{ lead: "", title: W.hubTitle, tint: "red" }}
 * @mutate src/pages/info/giftGuides/GuidesTop.tsx |         {pillInRow && pill}\n | \n
 * @mutate src/pages/info/giftGuides/printables/Printables.tsx | <FunBody title={words.title} path={path} tools="none"> | <FunBody title={words.title} path={path}>
 * @mutate src/pages/info/holidays/HolidayHub.tsx | banner={G.pageBanners["/holidays"]} tools="no-search" | banner={G.pageBanners["/holidays"]}
 * @mutate src/pages/info/giftGuides/GiftGuideShare.tsx |       {search && ( |       {true && (
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
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
import { FUN_WORDS } from "@/content/giftGuideFun1120";
import { giftGuides as G } from "@/content/giftGuides";
import { shippingLine } from "@/content/giftGuideShipping";

afterEach(cleanup);

const B = G.pageBanners;
/**
 * Each guides route in App.tsx -> the URLs it is checked at, with the banner's words (lead, title) each must show. The
 * guides and the deals days keep their own words (catalog / deals data); the rest come from G.pageBanners.
 */
const ROUTES: Record<string, [url: string, title: RegExp][]> = {
  "/gift-guides/draw-names": [["/gift-guides/draw-names", /^make it fun Secret Santa Name Draw$/]],
  "/gift-guides/secret-santa/:code/:token": [["/gift-guides/secret-santa/ABCD/tok-1", /^shh, it's a secret Your Secret Santa$/]],
  "/gift-guides/swipe": [["/gift-guides/swipe", /^make it fun Swipe to Find Gifts$/]],
  "/gift-guides/planner": [["/gift-guides/planner", /^make it fun Gift Planner$/]],
  "/gift-guides/printables": [["/gift-guides/printables", /^free printables Gift Tags$/]], // forwards to Gift tags
  "/gift-guides/printables/gift-tags": [["/gift-guides/printables/gift-tags", /^free printables Gift Tags$/]],
  "/gift-guides/printables/coloring-books": [["/gift-guides/printables/coloring-books", /^free printables Coloring Books$/]],
  "/gift-guides/printables/banners": [["/gift-guides/printables/banners", /^free printables Banners$/]],
  "/gift-guides/:slug": [
    ["/gift-guides/her", /Her$/],
    ["/gift-guides/black-friday", /Black Friday/],
    ["/gift-guides/small-business-saturday", /^shop small Small Business Saturday$/],
    ["/gift-guides/cyber-monday", /Cyber Monday/],
    ["/gift-guides/25-days-sponsors", /25 Days Sponsors/],
    ["/gift-guides/my-list", /^your saved gifts My Wish List$/],
  ],
  "/gift-guides/list/:code": [["/gift-guides/list/abc123def456", /^shared with you Wish List$/]],
  "/holidays": [["/holidays", /^lights & events Louisiana Holiday Hub$/]],
};
/** Find a gift is the landing's finder view (/gift-guides#gift-finder), not a route of its own. */
const FINDER: [url: string, title: RegExp] = ["/gift-guides#gift-finder", /^make it fun Find a Gift$/];

const renderAt = (url: string) =>
  render(
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

describe("#13 every guides page opens on the guides' one top: head row, then the gingham banner with its h1", () => {
  const cases = [...Object.values(ROUTES).flat(), FINDER];
  // A day the shipping pill shows (it goes away after the last order day), so the pill check never goes vacuous.
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-22T12:00:00-06:00"));
  });
  afterAll(() => vi.useRealTimers());

  it("the route inventory: every /gift-guides/* route and /holidays in App.tsx is checked here", () => {
    const app = blankComments(readFileSync("src/App.tsx", "utf8"));
    const routes = [...app.matchAll(/<Route path="(\/gift-guides\/[^"]*|\/holidays)"/g)].map((m) => m[1]);
    expect(routes.length).toBeGreaterThan(9); // inventory floor: 11 on 2026-11-22
    expect(routes.filter((r) => !(r in ROUTES))).toEqual([]);
    expect(cases.length).toBeGreaterThan(14);
  });

  it.each(cases)("%s", async (url, title) => {
    const { container } = renderAt(url);
    await waitFor(() => expect(container.querySelector("[data-gift-banner] h1")).not.toBeNull());
    const rows = container.querySelectorAll("[data-gift-headrow]");
    expect(rows.length).toBe(1);
    const row = rows[0];
    expect(row.querySelector("[data-gift-head-name]")?.textContent).toBe("Holiday gift guides");
    expect(row.querySelector("[data-gift-back-to]")?.getAttribute("data-gift-back-to")).toBe("/gift-guides");
    // The shipping pill and the icons: on the head row, or (a guide on a phone, the 25 Days sponsors page) on the count
    // row right under the banner, as the owner put them there on 2026-11-21.
    const top = [row, container.querySelector("[data-gift-countrow]")].filter(Boolean) as Element[];
    expect(shippingLine(new Date())).not.toBeNull();
    expect(top.some((el) => el.querySelector("[data-gift-ship]"))).toBe(true);
    // The icons (owner 11-22, "Same row, icons off there"): none on the printables, no gift search on the Hub.
    const printables = url.startsWith("/gift-guides/printables");
    const hub = url === "/holidays";
    expect(top.some((el) => el.querySelector("[data-gift-quick]")), url).toBe(!printables);
    expect(top.some((el) => el.querySelector("[data-gift-my-list-link]")), url).toBe(!printables);
    expect(top.some((el) => el.querySelector("[data-gift-share]")), url).toBe(!printables);
    expect(top.some((el) => el.querySelector("[data-gift-search-button]")), url).toBe(!printables && !hub);
    if (hub) expect(container.querySelectorAll("[data-gift-search-button], [data-holiday-search-button]").length).toBe(1);
    // One banner, after the head row and outside the menu + page grid, in one of the guides' three ginghams.
    const banners = container.querySelectorAll("[data-gift-banner]");
    expect(banners.length).toBe(1);
    const banner = banners[0];
    expect(["red", "green", "oat"]).toContain(banner.getAttribute("data-gift-banner"));
    expect(banner.querySelector(".gg-banner.gg-check .gg-arch .gg-lead")).not.toBeNull();
    expect(row.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector(".gg-layout")?.contains(banner)).toBe(false);
    // Its h1 is the page's only h1: the lead (read once, sr-only) and the title.
    const h1s = container.querySelectorAll("h1");
    expect(h1s.length).toBe(1);
    expect(banner.contains(h1s[0])).toBe(true);
    expect(h1s[0].textContent?.replace(/\s+/g, " ").trim()).toMatch(title);
    // The menu beside the page.
    expect(container.querySelector(".gg-layout [data-gift-sidebar]")).not.toBeNull();
  });

  it("the banner words: a lead and a title for each page, in the guides' red / green / beige by menu group", () => {
    const entries = Object.entries(B);
    expect(entries.length).toBeGreaterThan(9); // inventory floor: 11 on 2026-11-22
    for (const [key, b] of entries) {
      expect(b.lead.trim(), key).not.toBe("");
      expect(b.title.trim(), key).not.toBe("");
      expect(["red", "green", "oat"], key).toContain(b.tint);
    }
    const tintOf = (keys: string[]) => [...new Set(keys.map((k) => B[k as keyof typeof B].tint))];
    expect(tintOf(["/gift-guides/printables/gift-tags", "/gift-guides/printables/coloring-books", "/gift-guides/printables/banners"])).toEqual(["red"]);
    expect(tintOf(["finder", "/gift-guides/swipe", "/gift-guides/draw-names", "/gift-guides/planner", "reveal"])).toEqual(["oat"]);
    expect(tintOf(["/holidays"])).toEqual(["green"]);
  });

  it("one top component: only GuidesTop draws the banner and the head row; the pages reach it through it", () => {
    const files = [...readdirSync("src/pages/info/giftGuides", { recursive: true }).map((f) => `src/pages/info/giftGuides/${f}`), "src/pages/info/GiftGuides.tsx", "src/pages/info/holidays/HolidayHub.tsx"].filter((f) => f.endsWith(".tsx"));
    expect(files.length).toBeGreaterThan(20); // inventory floor: ~45 .tsx files on 2026-11-22
    const read = (f: string) => blankComments(readFileSync(f, "utf8"));
    expect(files.filter((f) => /<GiftGuidesWords\b/.test(read(f)))).toEqual(["src/pages/info/giftGuides/GuidesTop.tsx"]);
    expect(files.filter((f) => /<GuidesTop\b/.test(read(f))).sort()).toEqual(["src/pages/info/GiftGuides.tsx", "src/pages/info/giftGuides/fun/FunPage.tsx"]);
    expect(read("src/pages/info/holidays/HolidayHub.tsx")).toMatch(/<GuidesFrame\b/);
  });

  it("a sub-page's banner title takes Small Business Saturday's sizes (60px desktop, up to 3 lines on a phone)", async () => {
    const { GIFT_GUIDES_CSS } = await import("@/pages/info/giftGuides/giftGuidesStyles");
    const css = blankComments(GIFT_GUIDES_CSS);
    expect(css).toContain("@media (min-width:768px){.gg-banner-sub .gg-banner h1{font-size:60px;line-height:1.04}}");
    expect(css).toContain("@media (max-width:767px){.gg-banner-sub .gg-banner h1{-webkit-line-clamp:3;font-size:clamp(25px,8vw,34px);line-height:1.05}}");
    const { container } = renderAt("/gift-guides/printables/gift-tags");
    await waitFor(() => expect(container.querySelector("[data-gift-banner]")).not.toBeNull());
    expect(container.querySelector("[data-gift-banner]")?.classList.contains("gg-banner-sub")).toBe(true);
    cleanup();
    const her = renderAt("/gift-guides/her").container;
    expect(her.querySelector("[data-gift-banner]")?.classList.contains("gg-banner-sub")).toBe(false);
    // Under My Wish List's banner (its own hairline) the empty list draws no second rule.
    const { GIFT_WISH_CSS } = await import("@/pages/info/giftGuides/giftWishStyles");
    expect(blankComments(GIFT_WISH_CSS)).toContain(".gg [data-gift-my-list-empty]{border-top:0;margin-top:0}");
  });
});

describe("#17 the Gift planner has no tip box (owner 11-22: 'remove')", () => {
  it("draws no hint and no 'tap Bought' tip; the copy is gone", () => {
    const { container } = renderAt("/gift-guides/planner");
    expect(container.querySelector("[data-gift-fun]")).not.toBeNull();
    expect(container.querySelector("[data-gift-hint]")).toBeNull();
    expect(container.textContent).not.toMatch(/tap Bought/i);
    expect(Object.keys(FUN_WORDS)).not.toContain("hintPlanner");
    expect(blankComments(readFileSync("src/pages/info/giftGuides/fun/GiftPlanner.tsx", "utf8"))).not.toMatch(/<Hint\b/);
  });
});
