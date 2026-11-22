/**
 * GUARD (owner 11-18, on the phone landing, whose bar showed only the logo, Log in and Join free): "Where am I suppose
 * to find the holiday guides here? Shouldn't it be on the top nav?" This overrides the 11-04 phone bar of only Jobs,
 * Declutter, Log in and Join free. Owner 11-19: "make sure the guides can be easily viewed and accessed when signed in
 * or out" (the signed-in half is src/test/giftGuidesSignedIn1119.test.tsx).
 *  - Below md the signed-out public bar has a short "Guides" link with the gift icon to /gift-guides, named "Holiday
 *    Gift Guides" (sr-only prefix, so the visible word is in the name: labelInName.test.tsx), before Log in;
 *  - it shows at every phone width on EVERY public page (11-18 it was hidden below 640 everywhere but the landing);
 *  - from md up the full "Holiday gift guides" link shows instead (never both at once);
 *  - the other pages' bar makes room: below 480 Jobs and Declutter are their section icons, named by their sr-only
 *    words; the landing's bar is unchanged (it never shows Jobs and Declutter on a phone, D021);
 *  - the bar FITS at 320, 360, 375, 390 and every phone width up to 639: the widths each link's classes give at that
 *    width (padding, gaps, gutter, which of icon and word show), with the words' widths measured in headless Chrome
 *    with the app's own Montserrat (700, 13px, -0.01em), add up to no more than the screen;
 *  - index.html's prerendered landing bar (B100 shell) carries it, so the first paint has it too.
 *
 * @mutate src/components/Navbar.tsx |   const tight = !landing; |   const tight = false;
 * @mutate src/components/Navbar.tsx |                 data-testid="nav-gift-guides-phone" |                 data-testid="nav-gift-guides-phone" hidden
 * @mutate src/components/Navbar.tsx |                 <span className="sr-only">Holiday gift guides</span> |
 * @mutate src/components/Navbar.tsx |                     <Sofa aria-hidden className="min-[480px]:hidden" />\n                    <span className="max-[479px]:sr-only">Declutter</span> |                     <Sofa aria-hidden className="hidden" />\n                    <span>Declutter</span>
 * @mutate src/components/Navbar.tsx | <Gift aria-hidden className={tight ? "max-[374px]:hidden" : undefined} /> | <Gift aria-hidden />
 * @mutate src/components/Navbar.tsx | "flex items-center gap-0 min-[480px]:gap-1 sm:gap-3" | "flex items-center gap-1 sm:gap-3"
 */
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Navbar from "@/components/Navbar";

afterEach(cleanup);

const bar = (landing: boolean, path = landing ? "/" : "/browse") => {
  const r = render(<MemoryRouter initialEntries={[path]}><Navbar landing={landing} /></MemoryRouter>);
  const links = screen.getAllByRole("link");
  return { r, links, phone: screen.getByTestId("nav-gift-guides-phone"), wide: screen.getByTestId("nav-gift-guides") };
};
const cls = (el: Element) => (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);

// ---- A small resolver for the Tailwind classes the bar uses: which value applies at a viewport width. ----
const SCREENS: Record<string, number> = { sm: 640, md: 768, lg: 1024 };
const SPACE: Record<string, number> = { "0": 0, "0.5": 2, "1": 4, "1.5": 6, "2": 8, "2.5": 10, "3": 12, "4": 16, "5": 20, "6": 24 };
/** The last class (in CSS order: base, then max-*, then min-* ascending) for `prop` that applies at width `w`. */
function at(el: Element, w: number, match: (util: string) => string | null): string | null {
  let best: { order: number; i: number; v: string } | null = null;
  cls(el).forEach((token, i) => {
    const cut = token.lastIndexOf(":");
    const prefix = cut < 0 ? "" : token.slice(0, cut);
    const util = cut < 0 ? token : token.slice(cut + 1);
    let order: number;
    if (prefix === "") order = 0;
    else if (/^max-\[\d+px\]$/.test(prefix)) { if (w > Number(prefix.slice(5, -3))) return; order = 1; }
    else if (/^min-\[\d+px\]$/.test(prefix)) { const n = Number(prefix.slice(5, -3)); if (w < n) return; order = 2 + n / 1e5; }
    else if (prefix in SCREENS) { if (w < SCREENS[prefix]) return; order = 2 + SCREENS[prefix] / 1e5; }
    else return; // hover:, [&_svg]: and the like never change the layout here
    const v = match(util);
    if (v === null) return;
    if (!best || order > best.order || (order === best.order && i > best.i)) best = { order, i, v };
  });
  return best ? (best as { v: string }).v : null;
}
const displayAt = (el: Element, w: number) => at(el, w, (u) => (["hidden", "block", "flex", "inline-flex"].includes(u) ? u : null));
const shown = (el: Element, w: number) => displayAt(el, w) !== "hidden";
const srOnlyAt = (el: Element, w: number) => at(el, w, (u) => (u === "sr-only" || u === "not-sr-only" ? u : null)) === "sr-only";
const spaceAt = (el: Element, w: number, key: "px" | "gap", fallback: number) => {
  const v = at(el, w, (u) => (u.startsWith(`${key}-`) && u.slice(key.length + 1) in SPACE ? u.slice(key.length + 1) : null));
  return v === null ? fallback : SPACE[v];
};
/** The bar's side gutter: pl-[max(<n>rem,var(--safe-area-left,0px))]. */
const gutterAt = (el: Element, w: number) => {
  const v = at(el, w, (u) => (/^pl-\[max\(([\d.]+)rem,/.test(u) ? u : null));
  return v ? Number(/^pl-\[max\(([\d.]+)rem,/.exec(v)![1]) * 16 : 0;
};

/** Each visible word's width (px) at 13px Montserrat 700, -0.01em, measured 2026-11-19 in headless Chrome with
 *  public/fonts/montserrat-normal-latin-core.woff2 (the bar's font; text-ds-13 and text-ds-14 are both 13px). */
const WORD_PX: Record<string, number> = { Jobs: 30.9, Declutter: 63, Guides: 46.2, "Log in": 41.2, "Join free": 57.9, "Join / Log in": 82.9 };
// "Join / Log in" (owner 11-22, the phone's one auth button): 82.9 measured 2026-11-22 in headless Chrome at 320 (81.2 at
// 375; the larger is used).
const ICON_PX = 18; // the shared Button's [&_svg]:size-[18px]
const LOGO_PX = 46.6; // the H emblem, h-10 (40px) at its 256x220 aspect
const BUTTON_GAP = 8; // the shared Button's gap-2, unless the link says otherwise

/** One link's width at `w`: its padding plus what shows inside it (icon, words), with its gap between them. */
function linkWidth(a: Element, w: number): number {
  const parts: number[] = [];
  for (const n of [...a.childNodes]) {
    if (n.nodeType === 3) { const t = n.textContent!.trim(); if (t) parts.push(WORD_PX[t] ?? NaN); continue; }
    const el = n as Element;
    if (!shown(el, w) || srOnlyAt(el, w)) continue; // sr-only is position:absolute: out of the flex row
    if (el.tagName.toLowerCase() === "svg") parts.push(ICON_PX);
    else parts.push(WORD_PX[el.textContent!.trim()] ?? NaN);
  }
  const gap = spaceAt(a, w, "gap", BUTTON_GAP);
  return spaceAt(a, w, "px", 16) * 2 + parts.reduce((s, x) => s + x, 0) + gap * Math.max(0, parts.length - 1);
}
/** The whole bar's width at `w`: gutters, the logo and every shown link, divider and gap. */
function barWidth(nav: Element, w: number): number {
  const row = nav.firstElementChild!;
  const group = row.children[1];
  const items = [...group.children].filter((c) => shown(c, w));
  const widths = items.map((c) => (c.tagName.toLowerCase() === "a" ? linkWidth(c, w) : 1 + 8 /* w-px mx-1 */));
  return gutterAt(row, w) * 2 + LOGO_PX + widths.reduce((s, x) => s + x, 0) + spaceAt(group, w, "gap", 0) * Math.max(0, items.length - 1);
}
const PHONE_WIDTHS = [320, 360, 374, 375, 390, 399, 400, 414, 430, 479, 480, 520, 600, 639];

describe("the public top bar has the gift guides on a phone (owner 11-18, 11-19)", () => {
  it("the landing: a short 'Guides' link, named Holiday gift guides, to /gift-guides, before the auth links, at every phone width", () => {
    const { links, phone } = bar(true);
    expect(links.length).toBeGreaterThan(3);
    expect(phone.getAttribute("href")).toBe("/gift-guides");
    expect(phone).toHaveAccessibleName("Holiday gift guides");
    // The visible word is "Guides" (the full name is sr-only) beside the gift icon.
    const visible = [...phone.children].filter((n) => !n.classList.contains("sr-only") && n.tagName !== "svg").map((n) => n.textContent).join("").trim();
    expect(visible).toBe("Guides");
    expect(phone.querySelector("svg.lucide-gift")).toBeTruthy();
    expect(cls(phone)).toContain("md:hidden");
    expect(cls(phone)).not.toContain("hidden");
    for (const w of PHONE_WIDTHS) expect(shown(phone, w), `landing ${w}`).toBe(true);
    const at = (el: Element) => links.indexOf(el as HTMLElement);
    expect(at(phone)).toBeLessThan(at(screen.getByRole("link", { name: "Log in" })));
    // Owner 11-22: on a phone the auth link is the one "Join / Log in" button (phoneJoinOrLogIn1122.test.tsx); Guides
    // stays before it.
    expect(at(phone)).toBeLessThan(links.findIndex((a) => a.getAttribute("href") === "/signup"));
  });

  it("every other public page: 'Guides' shows at every phone width too, and the wide link only from md", () => {
    for (const path of ["/browse", "/declutter", "/help", "/gift-guides"]) {
      const { r, phone, wide } = bar(false, path);
      expect(phone.getAttribute("href")).toBe("/gift-guides");
      expect(phone).toHaveAccessibleName("Holiday gift guides");
      for (const w of PHONE_WIDTHS) {
        expect(shown(phone, w), `${path} ${w}: Guides`).toBe(true);
        expect(shown(wide, w), `${path} ${w}: no wide link`).toBe(false);
        // From 375 the word sits beside its gift icon; below it the word alone (room for Jobs and Declutter).
        const gift = phone.querySelector("svg.lucide-gift")!;
        expect(shown(gift, w), `${path} ${w}: gift icon`).toBe(w >= 375);
      }
      expect(shown(phone, 768)).toBe(false);
      expect(shown(wide, 768)).toBe(true);
      expect(wide.textContent).toBe("Holiday gift guides");
      r.unmount();
    }
  });

  it("other public pages: below 480 Jobs and Declutter are their icons, still named Jobs and Declutter", () => {
    bar(false);
    for (const [name, icon] of [["Jobs", "lucide-briefcase"], ["Declutter", "lucide-sofa"]] as const) {
      const a = screen.getByRole("link", { name });
      const svg = a.querySelector(`svg.${icon}`)!;
      const word = [...a.querySelectorAll("span")].find((s) => s.textContent === name)!;
      expect(svg, name).toBeTruthy();
      expect(svg.getAttribute("aria-hidden")).toBe("true");
      for (const w of [320, 375, 479]) { expect(shown(svg, w)).toBe(true); expect(srOnlyAt(word, w)).toBe(true); }
      for (const w of [480, 639, 1024]) { expect(shown(svg, w)).toBe(false); expect(srOnlyAt(word, w)).toBe(false); }
    }
  });

  it("the bar fits the screen at every phone width, on the landing and on the other pages", () => {
    for (const landing of [true, false]) {
      const { r } = bar(landing);
      const nav = r.container.querySelector('nav[aria-label="Primary"]')!;
      for (const w of PHONE_WIDTHS) {
        const need = barWidth(nav, w);
        expect(Number.isNaN(need), `${landing ? "landing" : "/browse"} ${w}: a word without a measured width`).toBe(false);
        expect(need, `${landing ? "landing" : "/browse"} at ${w}px needs ${need.toFixed(1)}px`).toBeLessThanOrEqual(w);
      }
      r.unmount();
    }
    // The resolver is not vacuous: at 320 the other pages' bar needs nearly all of it (315.8 of 320 on 2026-11-19; 291.7
    // since owner 11-22 took Log in off the phone bar and the button reads "Join / Log in": the room it freed stays as
    // breathing room).
    const { r } = bar(false);
    expect(barWidth(r.container.querySelector('nav[aria-label="Primary"]')!, 320)).toBeGreaterThan(285);
  });

  it("marks the page it is on", () => {
    const { phone } = bar(false, "/gift-guides/her");
    expect(phone.getAttribute("aria-current")).toBe("page");
  });

  it("index.html's prerendered landing bar has it", () => {
    const html = readFileSync(join(process.cwd(), "index.html"), "utf8");
    expect(html).toContain('data-testid="nav-gift-guides-phone"');
    expect(html).toContain('<span class="sr-only">Holiday gift guides</span><span aria-hidden="true">Guides</span></a>');
  });
});
