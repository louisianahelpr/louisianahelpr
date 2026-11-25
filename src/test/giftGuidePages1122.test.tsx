/**
 * The owner's live gift guides edits of 2026-11-22 for the guides' sub-pages.
 *
 * #13 ("gifts tags and all the other sections should have the same top section as the guides and the deals"; her right
 *     example Small Business Saturday, her wrong one Free gift tags): every /gift-guides/* page and the Holiday Hub open
 *     on ONE top, GuidesTop: the head row (back arrow + "Holiday gift guides", the icons), then the
 *     gingham banner holding the page's h1 (a small italic lead, the serif title) in the guides' red / green / beige,
 *     then the menu and the page. It replaces the morning's plain left serif sub-page title. Routes are read from App.tsx,
 *     so a new guides route without the banner fails here.
 *     Owner 11-22 ("Same row, icons off there"): the printables' head row has no icons (no search, heart or Share,
 *     her 11-21 call), and the Holiday Hub's has no gift search (one magnifier: the Hub's own lights search).
 *     Owner 11-22 7:49 PM (desktop screenshot of the Hub's head row): "remove order by and the heart at the top ... i
 *     thought we didnt do that for this section?": the Hub's row is back arrow, title and Share only, no My list heart
 *     anywhere on the page; every other page keeps its icons. Owner 2026-11-24 ~8:30 PM ("Remove by Dec 15
 *     everywhere"): no page shows the "Order by Dec 15" shipping pill (guard: giftGuideNoShipPill1124.test.tsx).
 * #14 ("polish this. separate each book in its own box take them out of the 1 box"): on Coloring books, the one card
 *     holding both covers is two cards, each with its own bigger cover, title, one line and a plain download link (#15's
 *     style); side by side from 560px, stacked on a phone.
 * #15 ("remove the circles around the print buttons. put print it as below the buttons next to the print at walgreens
 *     button"): on Banners, "12x18 print" and "Wide banner" are plain text links like "Print at Walgreens ›", all three on
 *     one row, each 44px tall (the shared link Button, no pill outline).
 * #16 ("should show the pictures here"): Swipe's end screen ("You saved 8 ideas for Her") shows each saved gift as the
 *     guides' own card (PickRow, the Top 10's card: cutout photo, name, price, link) in a grid, 2 across on a phone and 4
 *     from 768px; one primary button (Another round) and plain links for the rest.
 * #17 ("remove"): the Gift planner's grey "Tip: tap Bought when you get a gift, and we'll add up what you've spent."
 *     box with its × is gone, with its copy (the planner's lead already says what Bought does).
 *
 * @mutate src/pages/info/giftGuides/fun/GiftPlanner.tsx |       <p className="gg-fun-lead">{W.plannerLead}</p>\n |       <p className="gg-fun-lead">{W.plannerLead}</p>\n      <p data-gift-hint="fun-planner">Tip: tap Bought when you get a gift.</p>\n
 * @mutate src/pages/info/giftGuides/GuidesTop.tsx |       {banner && <GiftGuidesWords | {false && <GiftGuidesWords
 * @mutate src/pages/info/GiftGuides.tsx |     : myList ? G.pageBanners.myList | : myList ? null
 * @mutate src/pages/info/GiftGuides.tsx |     : sidePage === "finder" ? G.pageBanners.finder | : sidePage === "finder" ? null
 * @mutate src/pages/info/holidays/HolidayHub.tsx | path="/holidays" banner={G.pageBanners["/holidays"]} | path="/holidays" banner={{ lead: "", title: W.hubTitle, tint: "red" }}
 * @mutate src/pages/info/giftGuides/printables/Printables.tsx | <FunBody title={words.title} path={path} tools="none"> | <FunBody title={words.title} path={path}>
 * @mutate src/pages/info/holidays/HolidayHub.tsx | banner={G.pageBanners["/holidays"]} tools="share" | banner={G.pageBanners["/holidays"]}
 * @mutate src/pages/info/giftGuides/fun/FunPage.tsx | heart={tools !== "share"} | heart
 * @mutate src/pages/info/giftGuides/fun/SwipeGifts.tsx | guide={p.guide} similar={false} /> | guide={p.guide} />
 * @mutate src/pages/info/giftGuides/GiftGuideShare.tsx |       {heart && <MyListIcon current={myList} />} |       <MyListIcon current={myList} />
 * @mutate src/pages/info/giftGuides/GiftGuideShare.tsx |       {search && ( |       {true && (
 * @mutate src/pages/info/giftGuides/printables/Printables.tsx | <Button key={f.href} type="button" variant="link" size="inline" className="pr-link" | <Button key={f.href} type="button" variant="outline" size="sm" className="pr-link"
 * @mutate src/pages/info/giftGuides/printables/Printables.tsx |   const books = booksOf(p);\n |   const books = null as Book[] \| null;\n
 * @mutate src/pages/info/giftGuides/printables/Printables.tsx | .pr-books{grid-template-columns:repeat(2,minmax(0,1fr))} | .pr-books{grid-template-columns:minmax(0,1fr)}
 * @mutate src/pages/info/giftGuides/printables/Printables.tsx | .pr-book{align-items:center} | .pr-book{flex-direction:column;padding:16px}
 * @mutate src/pages/info/giftGuides/printables/Printables.tsx |               <h2 className="pr-card-title">{b.title}</h2>\n |               <h2 className="pr-card-title">{b.title}</h2>\n              <p>A cover and 20 Christmas pages to color.</p>\n
 * @mutate src/pages/info/giftGuides/fun/SecretSanta.tsx |           <p className="gg-fun-lead">{W.santaLead}</p>\n |           <p className="gg-fun-lead">{W.santaLead}</p>\n          <p data-gift-hint="fun-santa">Tip: we never ask for emails or phone numbers. You send each link yourself.</p>\n
 * @mutate src/pages/info/giftGuides/fun/SwipeGifts.tsx | {saved.map((p) => <PickRow key={p.href} pick={p} guide={p.guide} similar={false} />)} | {saved.map((p) => <li key={p.href}>{p.name}</li>)}
 * @mutate src/pages/info/giftGuides/fun/FunPage.tsx | @media (min-width:768px){.gg .gg-top10.gg-swipe-saved{grid-template-columns:repeat(4,minmax(0,1fr)); | @media (min-width:768px){.gg .gg-top10.gg-swipe-saved{grid-template-columns:repeat(5,minmax(0,1fr));
 * @mutate src/pages/info/giftGuides/fun/SwipeGifts.tsx | {savedTo === "planner" && <Button asChild variant="link" size="inline" className="gg-link"> | {savedTo === "planner" && <Button asChild variant="outline">
 * @mutate src/pages/info/giftGuides/printables/Printables.tsx | .pr-card-btns>.pr-link{flex:none;white-space:nowrap} | .pr-card-btns>.pr-link{flex:none}
 * @mutate src/pages/info/giftGuides/printables/Printables.tsx | .pr-card .pr-link{display:inline-flex;align-items:center;justify-content:flex-start;min-height:44px; | .pr-card .pr-link{display:inline-flex;align-items:center;justify-content:flex-start;min-height:32px;
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
  // A day the old "Order by Dec 15" pill showed (owner 11-24 removed it everywhere), so its absence is not a date's.
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
    // The icons: on the head row, or (a guide on a phone, the 25 Days sponsors page) on the count row right under the
    // banner, as the owner put them there on 2026-11-21.
    const top = [row, container.querySelector("[data-gift-countrow]")].filter(Boolean) as Element[];
    // The icons (owner 11-22, "Same row, icons off there"): none on the printables, no gift search on the Hub; the Hub
    // has no heart either (owner 11-22 7:49 PM), anywhere on the page.
    const printables = url.startsWith("/gift-guides/printables");
    const hub = url === "/holidays";
    // Owner 2026-11-24 ~8:30 PM ("Remove by Dec 15 everywhere"): no "Order by Dec 15" shipping pill on any page.
    expect(container.querySelectorAll("[data-gift-ship]").length, url).toBe(0);
    if (hub) expect(container.querySelectorAll("[data-gift-my-list-link]").length).toBe(0);
    expect(top.some((el) => el.querySelector("[data-gift-quick]")), url).toBe(!printables);
    expect(top.some((el) => el.querySelector("[data-gift-my-list-link]")), url).toBe(!printables && !hub);
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

describe("#14 each coloring book in its own card", () => {
  // Owner 11-22 later (iPhone): "Put the title of the right of the image and the rest of the stuff on the right of the
  // image to save space. You can remove a cover and whatever else it said. Not needed": each card is a row, the cover
  // left and the title and Download on its right, with no description line.
  it("two cards, each a row: its own cover on the left, its title and a plain download link on the right, no description line; two across from 560px, stacked below", async () => {
    const { container } = renderAt("/gift-guides/printables/coloring-books");
    await waitFor(() => expect(container.querySelector('[data-printable-card="coloring-book"]')).not.toBeNull());
    const books = [...container.querySelectorAll("[data-printable-book]")];
    expect(books.length).toBe(2);
    for (const b of books) {
      expect(b.matches("article.pr-card.pr-book")).toBe(true);
      expect(b.querySelectorAll("img").length).toBe(1);
      expect(b.querySelectorAll(".pr-card-title").length).toBe(1);
      expect(b.querySelectorAll(".pr-card-body > p").length).toBe(0);
      expect(b.textContent).not.toMatch(/A cover and 20/);
      // The cover first, then the words beside it (one flex row: .pr-card is display:flex, .pr-book no longer a column).
      expect(b.firstElementChild?.tagName).toBe("IMG");
      expect(b.children[1]?.classList.contains("pr-card-body")).toBe(true);
      const links = b.querySelectorAll("[data-printable-download]");
      expect(links.length).toBe(1);
      expect(links[0].className).toMatch(/\blink-standard\b.*\bpr-link\b|\bpr-link\b.*\blink-standard\b/);
      expect(links[0].textContent).toBe("Download\u00a0›");
      // Neither card holds the other's cover or link.
      expect(books.filter((x) => x !== b).some((x) => b.contains(x))).toBe(false);
    }
    expect(books.map((b) => b.querySelector("img")?.getAttribute("src"))).toEqual(["/printables/coloring-book/preview-girls.webp", "/printables/coloring-book/preview-boys.webp"]);
    expect(books.map((b) => b.querySelector(".pr-card-title")?.textContent)).toEqual(["Girls coloring book", "Boys coloring book"]);
    const css = [...container.querySelectorAll("style")].map((x) => x.textContent ?? "").join("\n");
    expect(css).toContain(".pr-books{grid-column:1/-1;display:grid;grid-template-columns:minmax(0,1fr);gap:12px;list-style:none}");
    expect(css).toMatch(/@media \(min-width:560px\)\{[^}]*\}[^@]*\.pr-books\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}\.pr-book \.pr-book-img\{width:140px\}/);
    expect(css).toContain(".pr-book .pr-book-img{width:120px;max-width:40%}");
    expect(css).toContain(".pr-card{display:flex;gap:12px;");
    expect(css).toContain(".pr-book{align-items:center}");
    expect(css).not.toMatch(/\.pr-book\{[^}]*flex-direction:column/);
  });
});

describe("#15 the banner's downloads are plain links on one row with Print at Walgreens", () => {
  it("12x18 print ›  Wide banner ›  Print at Walgreens ›: one row, the shared link Button, 44px tall, no pill", async () => {
    const { container } = renderAt("/gift-guides/printables/banners");
    await waitFor(() => expect(container.querySelector('[data-printable-card="thanksgiving-banner"]')).not.toBeNull());
    const row = container.querySelector('[data-printable-links="thanksgiving-banner"]')!;
    const links = [...row.children];
    expect(links.map((l) => l.textContent?.replace(" (opens in a new tab)", ""))).toEqual(["12x18 print\u00a0›", "Wide banner\u00a0›", "Print at Walgreens\u00a0›"]);
    for (const l of links) {
      expect(l.className).toMatch(/\blink-standard\b/);
      expect(l.className).toMatch(/\bpr-link\b/);
      expect(l.className).not.toMatch(/\bborder-\[|ctl-tint|btn-grad-primary|\bh-11\b/);
    }
    expect(links.map((l) => l.tagName)).toEqual(["BUTTON", "BUTTON", "A"]);
    const css = [...container.querySelectorAll("style")].map((x) => x.textContent ?? "").join("\n");
    expect(css).toMatch(/\.pr-card \.pr-link\{display:inline-flex;[^}]*min-height:44px;[^}]*background:none;border:0;box-shadow:none\}/);
    // Each link on one line; one that does not fit drops whole to the next row (lead 11-22: no split "Print at / Walgreens").
    expect(css).toContain(".pr-card-btns{display:flex;flex-wrap:wrap;align-items:center;gap:0 16px}");
    expect(css).toContain(".pr-card-btns>.pr-link{flex:none;white-space:nowrap}");
  });
});

describe("#16 Swipe's end screen shows the saved gifts as the guides' cards", () => {
  it("a grid of PickRow cards (photo, name, price, link), 2 across / 4 from 768px; one primary button, the rest plain links", async () => {
    const { fireEvent } = await import("@testing-library/react");
    const { container } = renderAt("/gift-guides/swipe");
    fireEvent.click(container.querySelector('[data-swipe-who="her"]')!);
    await waitFor(() => expect(container.querySelector("[data-swipe-budget]")).not.toBeNull(), { timeout: 5000 });
    fireEvent.click([...container.querySelectorAll("[data-swipe-budget]")].pop()!);
    fireEvent.click(container.querySelector("[data-swipe-start]")!);
    await waitFor(() => expect(container.querySelector("[data-swipe-card]")).not.toBeNull(), { timeout: 5000 });
    const hrefs: string[] = [];
    for (let i = 0; i < 40 && !container.querySelector("[data-swipe-done]"); i++) {
      await waitFor(() => expect(container.querySelector("[data-swipe-save]")?.hasAttribute("disabled")).toBe(false));
      hrefs.push(container.querySelector("[data-swipe-card]")!.getAttribute("data-swipe-card")!);
      fireEvent.click(container.querySelector("[data-swipe-save]")!);
    }
    const done = container.querySelector("[data-swipe-done]")!;
    expect(done).not.toBeNull();
    expect(hrefs.length).toBeGreaterThan(2);
    const grid = done.querySelector("[data-swipe-saved-grid]")!;
    expect(grid.matches("ul.gg-list.gg-top10.gg-swipe-saved")).toBe(true);
    const cards = [...grid.querySelectorAll(":scope > li[data-gift-pick]")];
    expect(cards.length).toBe(hrefs.length);
    // Not a guide list: no "shop similar" here (owner 2026-11-24 10:36 AM: only in the guides, not the Top 10), though
    // the saved Her gifts include picks with similar items (floor).
    const { guideBySlug } = await import("@/content/giftGuideCatalog");
    expect(hrefs.filter((h) => guideBySlug("her")!.picks.find((p) => p.href === h)?.dupes?.length).length).toBeGreaterThan(0);
    expect(grid.querySelectorAll("[data-gift-dupe]")).toHaveLength(0);
    cards.forEach((li, i) => {
      const link = li.querySelector<HTMLAnchorElement>("a[data-gift-title-link]")!;
      expect(link.getAttribute("href")).toBe(hrefs[i]);
      expect(link.querySelector(".gg-photo, .gg-thumb, [data-gift-letter]")).not.toBeNull();
      expect(link.querySelector(".gg-nm-name")?.textContent?.trim()).not.toBe("");
      expect(link.querySelector(".gg-nm-meta")).not.toBeNull();
    });
    // One primary; every other way on is a plain link (the shared link Button), none an outlined pill.
    const acts = [...done.querySelectorAll("button, a")].filter((el) => !grid.contains(el) && !el.closest("[data-gift-prices-as-of]"));
    expect(acts.filter((el) => el.className.includes("btn-grad-primary")).map((el) => el.textContent)).toEqual(["Another round"]);
    for (const el of acts.filter((x) => !x.className.includes("btn-grad-primary"))) {
      expect(el.className, el.textContent ?? "").toMatch(/\blink-standard\b/);
      expect(el.className, el.textContent ?? "").not.toMatch(/ctl-tint/);
    }
    const css = [...container.querySelectorAll("style")].map((x) => x.textContent ?? "").join("\n");
    expect(css).toContain(".gg .gg-top10.gg-swipe-saved{grid-auto-flow:row;grid-auto-columns:auto;grid-template-columns:repeat(2,minmax(0,1fr));");
    expect(css).toContain("@media (min-width:768px){.gg .gg-top10.gg-swipe-saved{grid-template-columns:repeat(4,minmax(0,1fr));");
  });
});

describe("the Secret Santa draw has no tip box (owner 11-22: 'delete the box that says it')", () => {
  // Owner 2026-11-22 (iPhone): "The words under the box and the words in the box are repetitive delete the box that says
  // it": the grey "Tip: we never ask for emails or phone numbers. You send each link yourself." box (with its ✕) is gone;
  // the sentence under the banner stays.
  it("draws no hint and no 'never ask for emails' tip; the lead stays; the copy is gone", () => {
    const { container } = renderAt("/gift-guides/draw-names");
    const form = container.querySelector("[data-santa-form]");
    expect(form).not.toBeNull();
    expect(container.querySelector("[data-gift-hint]")).toBeNull();
    expect(container.textContent).not.toMatch(/never ask for emails/i);
    expect(form!.querySelector(".gg-fun-lead")?.textContent).toBe(FUN_WORDS.santaLead);
    expect(Object.keys(FUN_WORDS)).not.toContain("hintSanta");
    expect(blankComments(readFileSync("src/pages/info/giftGuides/fun/SecretSanta.tsx", "utf8"))).not.toMatch(/<Hint\b/);
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
