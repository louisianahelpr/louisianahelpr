/**
 * The phone's one-line menu tip (owner 2026-11-22, 11:40 PM: visitors don't find the free printables, deals and the
 * Holiday Hub, "they don't even know what to do or look for"; the longer lists were "way too busy"; then "not as big as
 * the mockup"): a slim box "Tap [menu icon] for deals, free printables & more" with a Close.
 *   1. It is drawn on /gift-guides (under the greeting, above the Her, Him and Kids covers) and at the top of Her, Him and
 *      Kids; on no other guides page (the deals days, the 25 Days sponsors page, the wish list).
 *   2. Tapping its words opens the guides menu, exactly as the head row's three-line icon does (the same dialog, the
 *      icon's aria-expanded turns true).
 *   3. Close (named "Close") hides it, writes localStorage, and it stays hidden on every guides page after, including a
 *      fresh visit (the module's in-visit memory cleared).
 *   4. It shows only where the three-line icon shows: the CSS hides it by default and shows it only inside the very
 *      media query that shows the head row's icon (max-width:767px); from 768px the left menu is on screen.
 *   5. Slim: 38px tall with a 1px border and 14px words, but both controls tap 44px tall (a ::before reaching past the
 *      box) and Close 44px wide; ~12px above and below it (the landing's 28px block gap and the first section's 24px
 *      title margin are cut to 12px next to it).
 *   6. The phone head row's spacing (owner 11-22 11:40 PM: too much space under back + "Gift guides" + the three-line
 *      icon; 11:58 PM: "If you change that spacing for one page you need to do the other pages that are similar"): above
 *      the row stays the app's PageHeader standard (padding-top var(--shell-gap), untouched); below, ONE shared phone
 *      rule in GIFT_GUIDES_CSS puts the title's bottom 12px over the first content (5px of row padding under the 44px
 *      row whose title ends 6.6px above its bottom; no divider; no landing top padding), and every page with that row
 *      draws it from GuidesHeadRow with GIFT_GUIDES_CSS on the page: the landing, Her, Him,
 *      Kids, the three deals days, the 25 Days sponsors, My Wish List, Find a gift, every fun page and printables page
 *      (FunBody) and the Holiday Hub. No other stylesheet sets the row's padding.
 *
 * @mutate src/pages/info/giftGuides/GiftGuideLanding.tsx |       <GuidesMenuHint />\n      <LiveGuides /> |       <LiveGuides />\n      <GuidesMenuHint />
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx |       {MENU_HINT_GUIDES.has(guide.slug) && guide.slug !== "kids" && <GuidesMenuHint />}\n |
 * @mutate src/pages/info/giftGuides/GiftGuideMenuHint.tsx | new Set(["her", "him", "kids"]) | new Set(["her", "him"])
 * @mutate src/pages/info/giftGuides/GiftGuideMenuHint.tsx | onClick={openGuidesMenu} | onClick={() => undefined}
 * @mutate src/pages/info/giftGuides/GiftGuidesPhoneNav.tsx |     window.addEventListener(OPEN_MENU_EVENT, open); |
 * @mutate src/pages/info/giftGuides/GiftGuideMenuHint.tsx |   if (!showing) return null; |
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-menuhint{display:none}\n | .gg-menuhint{display:flex}\n
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-menuhint-x::before{left:-4px;right:-4px} | .gg-menuhint-x::before{left:0;right:0}
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-headrow{padding-bottom:5px}\n |
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-divider{display:none}\n | .gg-divider{margin-top:0}\n
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg .gg-landing>.gg-menuhint,.gg .gg-landing>.gg-menuhint+*{margin-top:12px} | .gg-landing>.gg-menuhint{margin-top:12px}
 * @mutate src/pages/info/holidays/HolidayHub.tsx |       <style>{GIFT_GUIDES_CSS}</style> |       <style>{""}</style>
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("@/lib/sbsFeaturedApi", () => ({ listFeaturedLocal: async () => [], sbsLogoUrl: () => "" }));
vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

vi.mock("@/lib/analytics", () => ({ track: vi.fn(), AhaEvent: new Proxy({}, { get: (_t, k) => String(k) }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: null }) }));

import GiftGuides from "@/pages/info/GiftGuides";
import HolidayHub from "@/pages/info/holidays/HolidayHub";
import { FunBody } from "@/pages/info/giftGuides/fun/FunPage";
import { PRINTABLE_PAGES } from "@/content/printables";
import { loadAllGuidePicks } from "@/content/giftGuideCatalog";
import { GIFT_GUIDES_CSS } from "@/pages/info/giftGuides/giftGuidesStyles";
import { resetHintsForTests } from "@/pages/info/giftGuides/GiftHint";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  resetHintsForTests();
});
await loadAllGuidePicks();

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/gift-guides" element={<GiftGuides />} />
        <Route path="/gift-guides/:slug" element={<GiftGuides />} />
      </Routes>
    </MemoryRouter>,
  );
const hintIn = (c: HTMLElement) => c.querySelector<HTMLElement>("[data-gift-menu-hint]");
const TIP = "Tap the menu for deals, free printables & more";

describe("gift guides: the phone's one-line menu tip (owner 11-22)", () => {
  it("is on /gift-guides under the greeting and above the Her, Him and Kids covers", () => {
    const { container } = renderAt("/gift-guides");
    const hint = hintIn(container)!;
    expect(hint).not.toBeNull();
    // The under-360px words (.gg-menuhint-s, hidden by CSS at every other width; giftGuideMenuHintFits1123.test.tsx) are left out.
    const open = hint.querySelector("[data-gift-menu-hint-open]")!.cloneNode(true) as HTMLElement;
    open.querySelectorAll(".gg-menuhint-s").forEach((x) => x.remove());
    expect(open.textContent!.replace(/\s+/g, " ").trim()).toBe(TIP);
    const greet = container.querySelector("[data-gift-greeting]")!;
    const covers = container.querySelector("[data-gift-live-guides]")!;
    expect(covers.querySelectorAll("li").length).toBeGreaterThan(2);
    expect(greet.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(hint.compareDocumentPosition(covers) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // Kids is the exception since 11-24 8:23 PM: its tip sits above the theme covers (owner: "Move the tap box above the
  // new guides"), right under the red banner; giftGuideKidsThemeRow1124 checks that order.
  it("on kids sits above the theme covers, not in the guide's column", () => {
    const { container } = renderAt("/gift-guides/kids");
    const article = container.querySelector('article[data-gift-guide="kids"]')!;
    expect(article.querySelector("[data-gift-menu-hint]")).toBeNull();
    expect(container.querySelectorAll("[data-gift-menu-hint]")).toHaveLength(1);
  });

  it.each(["her", "him"])("opens %s, first in the guide's column", (slug) => {
    const { container } = renderAt(`/gift-guides/${slug}`);
    const article = container.querySelector(`article[data-gift-guide="${slug}"]`)!;
    expect(article.firstElementChild?.hasAttribute("data-gift-menu-hint")).toBe(true);
  });

  it.each(["black-friday", "25-days-sponsors", "my-list"])("is not on %s", (slug) => {
    const { container } = renderAt(`/gift-guides/${slug}`);
    expect(container.querySelector("[data-gift-headrow]")).not.toBeNull();
    expect(hintIn(container)).toBeNull();
  });

  it("its words open the same guides menu as the three-line icon", async () => {
    const { container } = renderAt("/gift-guides/her");
    const icon = container.querySelector("[data-gift-head-menu]")!;
    expect(icon.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(async () => { fireEvent.click(container.querySelector("[data-gift-menu-hint-open]")!); });
    expect(icon.getAttribute("aria-expanded")).toBe("true");
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("Close hides it and it stays closed on every guides page, a fresh visit too", async () => {
    const first = renderAt("/gift-guides/her");
    const close = first.container.querySelector<HTMLButtonElement>("[data-gift-menu-hint-close]")!;
    expect(close.getAttribute("aria-label")).toBe("Close");
    await act(async () => { fireEvent.click(close); });
    expect(hintIn(first.container)).toBeNull();
    expect(window.localStorage.getItem("lh-gg-hint-menu")).toBe("1");
    cleanup();
    resetHintsForTests(); // a fresh visit: only localStorage remembers
    for (const url of ["/gift-guides", "/gift-guides/him", "/gift-guides/kids"]) {
      const { container, unmount } = renderAt(url);
      expect(container.querySelector("[data-gift-headrow]")).not.toBeNull();
      expect(hintIn(container), url).toBeNull();
      unmount();
    }
  });

  it("shows only where the three-line icon shows (up to 767px), and is slim with 44px taps", () => {
    const css = GIFT_GUIDES_CSS;
    // Hidden by default (desktop), as the head row's icon is.
    expect(css).toMatch(/\.gg-menuhint\{display:none\}/);
    expect(css).toMatch(/\.gg-head-phone\{display:none\}/);
    // Shown only inside a max-width:767px block, the same one kind that shows the icon.
    const blocks = [...css.matchAll(/@media \(max-width:767px\)\{([\s\S]*?)\n\}/g)].map((m) => m[1]);
    expect(blocks.length).toBeGreaterThan(1);
    const shows = (sel: string) => blocks.some((b) => new RegExp(`(^|\\n)${sel}\\{display:flex`).test(b));
    expect(shows("\\.gg-menuhint")).toBe(true);
    expect(shows("\\.gg-head-phone")).toBe(true);
    const outside = css.replace(/@media \(max-width:767px\)\{[\s\S]*?\n\}/g, "");
    expect(outside).not.toMatch(/\.gg-menuhint\{display:flex/);
    // Slim box, 14px words.
    expect(css).toMatch(/\.gg-menuhint\{display:flex;[^}]*height:38px;[^}]*border:1px solid/);
    expect(css).toMatch(/\.gg-menuhint-go\{[^}]*font:600 14px/);
    // 36px controls whose ::before reaches 4px past each side: 44px tall, Close 44px wide.
    expect(css).toMatch(/\.gg-menuhint-go,\.gg-menuhint-x\{position:relative;height:36px;/);
    expect(css).toMatch(/\.gg-menuhint-go::before,\.gg-menuhint-x::before\{content:"";position:absolute;top:-4px;bottom:-4px;/);
    expect(css).toMatch(/\.gg-menuhint-x::before\{left:-4px;right:-4px\}/);
    expect(css).toMatch(/\.gg-menuhint-x\{[^}]*width:36px/);
  });

  it("the phone head row's spacing is one shared rule, on every page that draws the row", () => {
    const css = GIFT_GUIDES_CSS;
    const blocks = [...css.matchAll(/@media \(max-width:767px\)\{([\s\S]*?)\n\}/g)].map((m) => m[1]);
    const phone = blocks.join("\n");
    // Above: the shared PageHeader gap, untouched on a phone (no padding-top or shorthand padding in the phone rule).
    expect(css).toMatch(/\.gg-headrow\{[^}]*padding:var\(--shell-gap,12px\) 0 12px\}/);
    expect(phone).toMatch(/(^|\n)\.gg-headrow\{padding-bottom:5px\}/);
    expect(phone).not.toMatch(/\.gg-headrow\{[^}]*padding(-top)?:/);
    // Below: no divider and no landing top padding, so the first content starts right under the row.
    expect(phone).toMatch(/(^|\n)\.gg-divider\{display:none\}/);
    expect(phone).toMatch(/(^|\n)\.gg \.gg-landing\{padding-top:0\}/);
    expect(phone).toMatch(/(^|\n)\.gg-main:has\(>\.gg-landing\)\{padding-top:0\}/);
    // Next to the tip: 12px, beating the landing's `.gg .gg-landing>*+*{margin-top:28px}` and the section title's 24px.
    expect(css).toMatch(/\.gg \.gg-landing>\*\+\*\{margin-top:28px\}/);
    expect(phone).toMatch(/\.gg \.gg-landing>\.gg-menuhint,\.gg \.gg-landing>\.gg-menuhint\+\*\{margin-top:12px\}/);
    expect(phone).toMatch(/article\[data-gift-guide\]>\.gg-menuhint\+section>\.gg-sec-title\{margin-top:12px\}/);
    // Every page with the row: the row is there, and the page carries the stylesheet holding the shared rule.
    const pages: [string, () => ReturnType<typeof render>][] = [
      ...["/gift-guides", "/gift-guides#gift-finder", "/gift-guides/her", "/gift-guides/him", "/gift-guides/kids", "/gift-guides/black-friday", "/gift-guides/small-business-saturday", "/gift-guides/cyber-monday", "/gift-guides/25-days-sponsors", "/gift-guides/my-list"]
        .map((u): [string, () => ReturnType<typeof render>] => [u, () => renderAt(u)]),
      ...(["/gift-guides/swipe", "/gift-guides/planner", "/gift-guides/draw-names", ...PRINTABLE_PAGES.map((p) => p.path)] as const)
        .map((u): [string, () => ReturnType<typeof render>] => [u, () => render(<MemoryRouter initialEntries={[u]}><FunBody title="t" path={u}><p /></FunBody></MemoryRouter>)]),
      ["/holidays", () => render(<MemoryRouter initialEntries={["/holidays"]}><HolidayHub /></MemoryRouter>)],
    ];
    expect(pages.length).toBeGreaterThan(15);
    for (const [url, draw] of pages) {
      const { container, unmount } = draw();
      expect(container.querySelectorAll("[data-gift-headrow]").length, url).toBe(1);
      expect(container.querySelector("[data-gift-head-menu]"), url).not.toBeNull();
      const styles = [...container.querySelectorAll("style")].map((x) => x.textContent ?? "").join("\n");
      expect(styles.includes(".gg-headrow{padding-bottom:5px}"), url).toBe(true);
      unmount();
    }
  });
});
