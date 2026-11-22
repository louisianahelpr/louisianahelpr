/**
 * GUARD (owner 11-22, two screenshots of the signed-out phone bar at 375: the landing's "logo · Guides | Log in | Join
 * free", and a guide page's "logo · Jobs icon · Declutter icon · Guides (underlined) · Log in · Join free"):
 * "Once those click into guide you don't need to show guide at the top top anymore the icon is fine. On the landing
 * there is no icon for job or declutter".
 *
 * On the shared public bar (Navbar), signed out, below 480 (where Jobs and Declutter were already icons):
 *  - the gift guides link is the gift icon alone, like Jobs and Declutter, named "Gift guides" (sr-only), on every
 *    page including the guides themselves; from 480 to md it is the icon and "Guides", from md the full words;
 *  - the landing's bar is the SAME bar as every other page's: logo · Jobs · Declutter · gift guides · Join / Log in,
 *    same classes, order and spacing (it used to hide Jobs and Declutter on a phone, D021 11-10);
 *  - each icon link is a 44px-wide target (min-w-11 under h-11), and the current one keeps a visible mark under its
 *    icon (a 2px bar in its own colour, shown by aria-current; a text underline draws nothing under an icon);
 *  - from md up nothing changed. The fit at 320-639 is src/test/navGiftGuidesOnPhone1118.test.tsx's.
 *
 * @mutate src/components/Navbar.tsx | const NAV_ICON_LINK = "group relative max-[479px]:min-w-11"; | const NAV_ICON_LINK = "group relative";
 * @mutate src/components/Navbar.tsx | rounded-full bg-current opacity-0 group-aria-[current=page]:opacity-100 min-[480px]:hidden"; | rounded-full bg-current opacity-0 min-[480px]:hidden";
 * @mutate src/components/Navbar.tsx |                 <Gift aria-hidden />\n                <span aria-hidden className={NAV_ICON_CURRENT_BAR} /> |                 <Gift aria-hidden />
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: null, isReady: true }) }));

import Navbar from "@/components/Navbar";

afterEach(cleanup);

const cls = (el: Element | null) => (el?.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
const BREAKPOINT: Record<string, number> = { sm: 640, md: 768, lg: 1024 };
/** The value of the last class matching `pick` that applies at width `w` (base, then max-[n], then min-[n]/sm/md/lg). */
function at(el: Element, w: number, pick: (util: string) => string | null): string | null {
  let best: { order: number; v: string } | null = null;
  for (const token of cls(el)) {
    const cut = token.lastIndexOf(":");
    const prefix = cut < 0 ? "" : token.slice(0, cut);
    const util = cut < 0 ? token : token.slice(cut + 1);
    const v = pick(util);
    if (v === null) continue;
    let order: number;
    if (prefix === "") order = 0;
    else if (/^max-\[\d+px\]$/.test(prefix)) { if (w > Number(prefix.slice(5, -3))) continue; order = 1; }
    else if (/^min-\[\d+px\]$/.test(prefix)) { const n = Number(prefix.slice(5, -3)); if (w < n) continue; order = 2 + n / 1e5; }
    else if (prefix in BREAKPOINT) { if (w < BREAKPOINT[prefix]) continue; order = 2 + BREAKPOINT[prefix] / 1e5; }
    else continue;
    if (!best || order >= best.order) best = { order, v };
  }
  return best?.v ?? null;
}
const shown = (el: Element, w: number) => at(el, w, (u) => (["hidden", "block", "inline", "flex", "inline-flex"].includes(u) ? u : null)) !== "hidden";
const srOnly = (el: Element, w: number) => at(el, w, (u) => (u === "sr-only" || u === "not-sr-only" ? u : null)) === "sr-only";
const minW44 = (el: Element, w: number) => at(el, w, (u) => (u === "min-w-11" ? u : null)) === "min-w-11";

const PAGES: { path: string; landing: boolean }[] = [
  { path: "/", landing: true },
  { path: "/gift-guides/her", landing: false },
  { path: "/gift-guides", landing: false },
  { path: "/browse", landing: false },
  { path: "/declutter", landing: false },
];
const ICON_WIDTHS = [320, 360, 375, 390, 414, 430, 479];
const ICONS = [
  { href: "/browse", name: "Jobs", icon: "lucide-briefcase", testid: null },
  { href: "/declutter", name: "Declutter", icon: "lucide-sofa", testid: null },
  { href: "/gift-guides", name: "Gift guides", icon: "lucide-gift", testid: "nav-gift-guides-phone" },
] as const;

function bar(path: string, landing: boolean) {
  const r = render(<MemoryRouter initialEntries={[path]}><Navbar landing={landing} /></MemoryRouter>);
  const nav = r.container.querySelector('nav[aria-label="Primary"]')!;
  const link = (i: (typeof ICONS)[number]) =>
    (i.testid ? nav.querySelector(`[data-testid="${i.testid}"]`) : nav.querySelector(`a[href="${i.href}"]`)) as HTMLAnchorElement;
  return { r, nav, link };
}
/** What a phone below 480 sees in the bar, in order: each shown link's icon, or its visible words. */
function phoneRow(nav: Element, w: number): string[] {
  return [...nav.querySelectorAll("a")].filter((a) => shown(a, w)).map((a) => {
    const svg = a.querySelector("svg");
    const words = [...a.querySelectorAll("span")].filter((s) => s.children.length === 0 && s.textContent && shown(s, w) && !srOnly(s, w)).map((s) => s.textContent!.trim());
    const icon = svg && shown(svg, w) ? [...svg.classList].find((c) => c.startsWith("lucide-") && c !== "lucide") ?? "svg" : null;
    return [icon, ...words].filter(Boolean).join(" ") || "logo";
  });
}

describe("owner 11-22: the phone bar is icons (gift guides included), the same on the landing as everywhere", () => {
  it.each(PAGES)("$path: below 480 it reads logo · Jobs icon · Declutter icon · gift icon · Join / Log in", ({ path, landing }) => {
    const { nav } = bar(path, landing);
    for (const w of ICON_WIDTHS) {
      expect(phoneRow(nav, w), `${path} ${w}`).toEqual(["logo", "lucide-briefcase", "lucide-sofa", "lucide-gift", "Join / Log in"]);
    }
    // From 480 to md the words come back, the gift icon beside "Guides".
    expect(phoneRow(nav, 520)).toEqual(["logo", "Jobs", "Declutter", "lucide-gift Guides", "Join / Log in"]);
  });

  it.each(PAGES)("$path: each icon link keeps its name and is a 44px-wide target below 480", ({ path, landing }) => {
    const { link } = bar(path, landing);
    for (const i of ICONS) {
      const a = link(i);
      expect(a, i.name).toBeTruthy();
      expect(a.getAttribute("href")).toBe(i.href);
      expect(a).toHaveAccessibleName(i.name);
      expect(a.querySelector(`svg.${i.icon}`)?.getAttribute("aria-hidden"), i.name).toBe("true");
      expect(cls(a), i.name).toContain("h-11");
      for (const w of ICON_WIDTHS) expect(minW44(a, w), `${path} ${i.name} ${w}: 44px wide`).toBe(true);
      expect(minW44(a, 480), `${i.name}: words from 480 need no floor`).toBe(false);
    }
  });

  it("the landing's bar is the same bar as the guide pages' (same links, classes, order and spacing)", () => {
    const shape = (path: string, landing: boolean) => {
      const { r, nav } = bar(path, landing);
      const row = nav.firstElementChild!;
      const out = JSON.stringify({
        row: cls(row),
        group: cls(row.children[1]),
        items: [...row.children[1].children].map((c) => [c.tagName, c.getAttribute("href"), cls(c).filter((k) => k !== "aria-current"), [...c.querySelectorAll("*")].map((d) => cls(d).join(" "))]),
      });
      r.unmount();
      return out;
    };
    const landing = shape("/", true);
    expect(landing.length).toBeGreaterThan(500);
    expect(landing).toBe(shape("/gift-guides/her", false));
    expect(landing).toBe(shape("/browse", false));
  });

  it.each([
    ["/gift-guides/her", "Gift guides"], ["/browse", "Jobs"], ["/declutter/item/abc", "Declutter"],
  ] as const)("%s: the current icon wears a visible mark under it, the others none", (path, name) => {
    const { link } = bar(path, false);
    for (const i of ICONS) {
      const a = link(i);
      const isCurrent = i.name === name;
      expect(a.getAttribute("aria-current"), i.name).toBe(isCurrent ? "page" : null);
      expect(cls(a), i.name).toEqual(expect.arrayContaining(["group", "relative"]));
      const mark = [...a.querySelectorAll("span")].find((s) => cls(s).includes("absolute"))!;
      expect(mark, `${i.name}: the mark under its icon`).toBeTruthy();
      expect(mark.getAttribute("aria-hidden")).toBe("true");
      // Shown only by the link's aria-current, in the link's own colour (olive when current), below 480 only.
      expect(cls(mark)).toEqual(expect.arrayContaining(["opacity-0", "group-aria-[current=page]:opacity-100", "bg-current", "h-0.5", "bottom-1.5"]));
      for (const w of ICON_WIDTHS) expect(shown(mark, w)).toBe(true);
      expect(shown(mark, 480)).toBe(false);
    }
  });

  it("from md up nothing changed: the words, the full Holiday gift guides link, Log in and Join free", () => {
    const { nav } = bar("/gift-guides/her", false);
    const rows = [768, 1024, 1440].map((w) => [...nav.querySelectorAll("a")].filter((a) => shown(a, w)).map((a) =>
      [...a.querySelectorAll("span")].filter((s) => s.children.length === 0 && s.textContent && shown(s, w) && !srOnly(s, w)).map((s) => s.textContent!.trim()).join(" ") || a.textContent!.trim()));
    for (const r of rows) expect(r).toEqual(["", "Jobs", "Declutter", "Holiday gift guides", "Log in", "Join free"]);
  });
});
