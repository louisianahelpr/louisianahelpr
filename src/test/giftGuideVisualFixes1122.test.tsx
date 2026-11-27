/**
 * Gift guides visual-design audit, Sun Nov 22 night (~/Desktop/Louisiana Helpr Work/Gift guides and affiliate/
 * Guide-audit-visual-design-1122-night.md), items #1, #3, #4 and #7:
 *  #1 phone rows: a name runs to three lines (four under 360px) before it clips, so different gifts never read the same
 *     (measured on www 3ef4589beb: 48 Her/Him/Kids rows at 320 and 4 at 375 showed the same clipped name as another gift,
 *     "Smathers & Bran..." on row after row; with this CSS injected on the same pages: 0 and 0). Tablet, desktop and the
 *     Top 10 cards keep two lines.
 *  #3 the phone's guides menu sheet: a hairline under the "Gift guides" title, the rows scrolling beneath it.
 *  #4 Black Friday / Cyber Monday Sales cards: one per row under 480px (photo left, deals beside it); 480px and up the
 *     shared 2/3/4-column deal grid is unchanged.
 *  Lead 11-22 night: a deal card's heart over a full-bleed store logo (Oriental Trading, The Home Depot) is readable:
 *     white inside its rose outline when unsaved, a firmer white edge and a soft shadow; still no circle (owner 11-21).
 *  #7 the Holiday Hub's "Get featured free" and Hire a Helpr's "Christmas lights and holiday events" wear the guides'
 *     text-link look (olive, semibold, "›").
 *
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | @media (max-width:1023px){.gg-list:not(.gg-top10) .gg-nm-name{-webkit-line-clamp:3}} | @media (max-width:1023px){.gg-list:not(.gg-top10) .gg-nm-name{-webkit-line-clamp:2}}
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | @media (max-width:359px){.gg-list:not(.gg-top10) .gg-nm-name{-webkit-line-clamp:4}} | @media (max-width:359px){.gg-list:not(.gg-top10) .gg-nm-name{-webkit-line-clamp:2}}
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-sheet-menu .gg-sheet-menu-body{margin-top:8px;border-top:1px solid var(--gg-line);padding-top:16px} | .gg-sheet-menu .gg-sheet-menu-body{margin-top:0}
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | mask-image:linear-gradient(to bottom,#000 1px,transparent 1px,#000 17px)} | }
 * @mutate src/pages/info/giftGuides/GiftGuideDealCards.tsx | .gg-deal-grid[data-gift-sales]{grid-template-columns:minmax(0,1fr)} | .gg-deal-grid[data-gift-sales]{}
 * @mutate src/pages/info/holidays/HolidayHire.tsx | className="link-standard inline-flex min-h-11 items-center font-semibold text-[hsl(var(--bark))]" data-holiday-hire-hub-link=""> | className="link-standard inline-flex min-h-11 items-center" data-holiday-hire-hub-link="">
 * @mutate src/pages/info/giftGuides/giftWishStyles.ts | .gg-deal .gg-heart-deal[aria-pressed="false"] path{fill:#fff} | .gg-deal .gg-heart-deal[aria-pressed="false"] path{}
 * @mutate src/pages/info/holidays/HolidayHub.tsx | <span className="whitespace-nowrap">{SHOP_SMALL_GO}&nbsp;›</span> | <span>{SHOP_SMALL_GO}</span>
 */
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

vi.mock("@/lib/analytics", () => ({ track: vi.fn(), AhaEvent: new Proxy({}, { get: (_t, k) => String(k) }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: null }) }));
vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ title, children }: { title: string; children: React.ReactNode }) => <main><h1>{title}</h1>{children}</main>,
}));

import { GIFT_GUIDES_CSS } from "@/pages/info/giftGuides/giftGuidesStyles";
import { CARD_CSS } from "@/pages/info/giftGuides/GiftGuideDealCards";
import { GIFT_WISH_CSS } from "@/pages/info/giftGuides/giftWishStyles";
import HolidayHub from "@/pages/info/holidays/HolidayHub";
import HolidayHire from "@/pages/info/holidays/HolidayHire";

const ROOT = resolve(__dirname, "../..");
const read = (f: string) => blankComments(readFileSync(resolve(ROOT, f), "utf8"));

describe("visual audit 1122-night #1: phone rows show enough of a name to tell gifts apart", () => {
  const sheet = GIFT_GUIDES_CSS;
  it("three lines on a phone and a tablet (guide visual 1123b #6), four under 360px; desktop keeps two", () => {
    expect(sheet).toContain("@media (max-width:1023px){.gg-list:not(.gg-top10) .gg-nm-name{-webkit-line-clamp:3}}");
    expect(sheet).toContain("@media (max-width:359px){.gg-list:not(.gg-top10) .gg-nm-name{-webkit-line-clamp:4}}");
    // The base (1024px and up) stays two lines.
    expect(sheet).toContain(".gg-nm-name{display:-webkit-box;-webkit-line-clamp:2;");
    const clamps = [...sheet.matchAll(/\.gg-nm-name\{[^}]*-webkit-line-clamp:(\d)/g)];
    expect(clamps.length).toBeGreaterThan(2);
    // The 4-line rule comes after the 3-line one, so it wins under 360px.
    expect(sheet.indexOf("(max-width:359px){.gg-list:not(.gg-top10)")).toBeGreaterThan(sheet.indexOf("(max-width:1023px){.gg-list:not(.gg-top10)"));
  });
});

describe("visual audit 1122-night #3: the phone menu sheet's rows scroll under a line, never half-cut under the title", () => {
  it("a hairline under the title, rows fading out under it, the first group 16px below it", () => {
    const sheet = GIFT_GUIDES_CSS;
    expect(sheet).toContain(".gg-sheet-menu .gg-sheet-menu-body{margin-top:8px;border-top:1px solid var(--gg-line);padding-top:16px}");
    // A row fades out in the 16px under the line (the list's own top padding at rest).
    expect(sheet).toContain(".gg-sheet-menu .gg-sheet-menu-body{-webkit-mask-image:linear-gradient(to bottom,#000 1px,transparent 1px,#000 17px);mask-image:linear-gradient(to bottom,#000 1px,transparent 1px,#000 17px)}");
    // The scrolling part is the body (the title sits outside it).
    expect(sheet).toMatch(/\.gg-sheet-menu \.gg-sheet-menu-body\{max-height:70dvh;overflow-y:auto/);
    expect(read("src/pages/info/giftGuides/GiftGuidesPhoneSheet.tsx")).toMatch(/<SheetHero title=\{G\.menuSheetTitle\} \/>\s*[\s\S]*?<div className="gg-sheet-menu-body"/);
  });
});

describe("visual audit 1122-night #4: Sales cards are one per row on a phone", () => {
  it("under 480px the Sales grid is one column with the photo beside the deals; the shared deal grid is unchanged", () => {
    const cards = CARD_CSS;
    const phone = cards.slice(cards.indexOf("@media (max-width:479px){"));
    expect(phone).toContain(".gg-deal-grid[data-gift-sales]{grid-template-columns:minmax(0,1fr)}");
    expect(phone).toContain("grid-template-columns:96px minmax(0,1fr)");
    expect(phone).toContain("[data-gift-sales]>.gg-store-card>.gg-deal-photo{grid-column:1;grid-row:1/span 3;align-self:start;height:96px}");
    const deals = read("src/pages/info/giftGuides/GiftGuideDeals.tsx");
    expect(deals).toContain(".gg-deal-grid{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}");
    expect(deals).toContain("@media (min-width:640px){.gg-deal-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}");
    // Only the Sales list takes the phone rule (codes keep two up).
    const rules = phone.match(/\[data-gift-sales\]/g) ?? [];
    expect(rules.length).toBeGreaterThan(3);
    expect(phone).not.toContain("[data-gift-codes]");
    // Polish audit 1127 #17: the Sales grid is the shared capped grid (CappedGrid), still marked data-gift-sales.
    expect(read("src/pages/info/giftGuides/GiftGuideDealCards.tsx")).toContain('<CappedGrid data={{ "data-gift-sales": "" }}');
  });
});

describe("lead 11-22 night: a deal card's heart reads over a full-bleed store logo, with no circle behind it", () => {
  it("unsaved: white inside the rose outline, white edge plus a soft shadow; same top-right spot", () => {
    expect(GIFT_WISH_CSS).toContain('.gg-deal .gg-heart-deal[aria-pressed="false"] path{fill:#fff}');
    expect(GIFT_WISH_CSS).toContain(".gg-deal .gg-heart-deal svg{filter:drop-shadow(0 0 1px #fff) drop-shadow(0 0 1px #fff) drop-shadow(0 1px 2px rgba(0,0,0,.35))}");
    expect(GIFT_WISH_CSS).toContain(".gg-deal .gg-heart-deal,.gg-sb .gg-heart-sb{position:absolute;top:6px;right:6px}");
    // Owner 11-21: no circle, fill or shadow box behind a card heart.
    const dealRules = GIFT_WISH_CSS.match(/[^}]*\.gg-heart-deal[^{]*\{[^}]*\}/g) ?? [];
    expect(dealRules.length).toBeGreaterThan(2);
    for (const r of dealRules) expect(r.slice(r.indexOf("{"))).not.toMatch(/background|border-radius|box-shadow/);
  });
});

describe("visual audit 1122-night #7: the Hub's and Hire a Helpr's closing links look like links", () => {
  const OLIVE = "text-[hsl(var(--bark))]";
  it("Holiday Hub: \"Get featured free ›\" olive and semibold, kept whole", () => {
    const { container } = render(<MemoryRouter initialEntries={["/holidays"]}><HolidayHub /></MemoryRouter>);
    const a = container.querySelector<HTMLAnchorElement>('[data-holiday-shop-small] a[href="/gift-guides/small-business-saturday#get-featured"]')!;
    expect(a).not.toBeNull();
    expect(a.className).toContain(OLIVE);
    expect(a.className).toMatch(/\bfont-semibold\b/);
    expect(a.className).toMatch(/\bmin-h-11\b/);
    expect(a.textContent).toBe("Own a Louisiana small business?Get featured free ›");
    expect(a.querySelector(".whitespace-nowrap")?.textContent).toBe("Get featured free ›");
  });
  it("Hire a Helpr: \"Christmas lights and holiday events ›\" olive and semibold", () => {
    const { container } = render(<MemoryRouter initialEntries={["/holidays/hire-a-helpr"]}><HolidayHire /></MemoryRouter>);
    const a = container.querySelector<HTMLAnchorElement>("[data-holiday-hire-hub-link]")!;
    expect(a).not.toBeNull();
    expect(a.getAttribute("href")).toBe("/holidays");
    expect(a.className).toContain(OLIVE);
    expect(a.className).toMatch(/\bfont-semibold\b/);
    expect(a.textContent).toBe("Christmas lights and holiday events ›");
  });
});
