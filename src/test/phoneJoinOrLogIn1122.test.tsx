/**
 * GUARD (owner 11-22, from a screenshot of the signed-out phone bar: logo, Jobs icon, Declutter icon, Guides, Log in,
 * and the solid sign-up pill): "When you tap join there is a toggle for log in so should we remove log in open the
 * button on log in and change the name of the button. Since the button does both things once you're in? And it would
 * free up space on the phone? You can leave it how it is on the desktop". Her pop-up answer: the button says
 * "Join / Log in".
 *
 * On the shared public bar (Navbar, drawn by PublicLayout and AuthShell for the landing, the gift guides, guest Jobs
 * and Declutter and every other public page), signed out:
 *  - below md (768, the phone bar where "Guides" stands in for the full gift guides link) there is no separate Log in
 *    link: it is display none until md;
 *  - the sign-up pill shows "Join / Log in" below md and "Join free" from md up (one word set per width; display none
 *    leaves the other out of the accessible name); it still opens /signup, whose card starts with the
 *    Log in | Create account switch (AuthModeTabs), so Log in stays one tap away;
 *  - from md up nothing changed: Log in (/login) then Join free (/signup);
 *  - the pill keeps its 44px height and no text under 13px; Spanish has its own words;
 *  - index.html's prerendered landing bar (B100 shell) carries the phone words, so the first paint matches.
 * Signed in, the bar draws none of it (unchanged). The fit at 320-639 is src/test/navGiftGuidesOnPhone1118.test.tsx's.
 *
 * @mutate src/components/Navbar.tsx | className="hidden md:inline-flex rounded-full px-3 btn-press transition-colors duration-200 hover:text-[hsl(var(--bark))]"\n            >\n              <Link\n                to="/login" | className="rounded-full px-3 btn-press transition-colors duration-200 hover:text-[hsl(var(--bark))]"\n            >\n              <Link\n                to="/login"
 * @mutate src/components/Navbar.tsx | <span className="md:hidden" data-nav-join="phone">{wordInLang("g.joinOrLogIn", "Join / Log in")}</span> | <span className="md:hidden" data-nav-join="phone">{wordInLang("g.joinFree", "Join free")}</span>
 * @mutate src/components/Navbar.tsx | <span className="hidden md:inline" data-nav-join="wide"> | <span data-nav-join="wide">
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { blankComments } from "@/test/helpers/blankNonCode";

const auth = vi.hoisted(() => ({ user: null as null | { id: string } }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: auth.user, isReady: true }) }));

import Navbar from "@/components/Navbar";

afterEach(() => { cleanup(); auth.user = null; });

const ROOT = join(__dirname, "..", "..");
const cls = (el: Element | null) => (el?.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
const DISPLAY = new Set(["hidden", "block", "inline", "inline-block", "flex", "inline-flex", "grid", "contents"]);
const BREAKPOINT: Record<string, number> = { sm: 640, md: 768, lg: 1024, xl: 1280 };
/** Whether `el` is displayed at viewport width `w`, from its Tailwind display classes (base, max-[n], min-[n], sm/md/lg). */
function shownAt(el: Element, w: number): boolean {
  let best: { order: number; v: string } | null = null;
  for (const token of cls(el)) {
    const cut = token.lastIndexOf(":");
    const prefix = cut < 0 ? "" : token.slice(0, cut);
    const util = cut < 0 ? token : token.slice(cut + 1);
    if (!DISPLAY.has(util)) continue;
    let order: number;
    if (prefix === "") order = 0;
    else if (/^max-\[\d+px\]$/.test(prefix)) { if (w > Number(prefix.slice(5, -3))) continue; order = 1; }
    else if (/^max-(sm|md|lg|xl)$/.test(prefix)) { if (w >= BREAKPOINT[prefix.slice(4)]) continue; order = 1; }
    else if (/^min-\[\d+px\]$/.test(prefix)) { const n = Number(prefix.slice(5, -3)); if (w < n) continue; order = 2 + n / 1e5; }
    else if (prefix in BREAKPOINT) { if (w < BREAKPOINT[prefix]) continue; order = 2 + BREAKPOINT[prefix] / 1e5; }
    else continue;
    if (!best || order >= best.order) best = { order, v: util };
  }
  return best === null || best.v !== "hidden";
}

const PAGES: { path: string; landing: boolean }[] = [
  { path: "/", landing: true },
  { path: "/gift-guides/her", landing: false },
  { path: "/browse", landing: false },
  { path: "/declutter", landing: false },
  { path: "/help", landing: false },
];
const PHONE = [320, 360, 375, 390, 414, 430, 480, 600, 639, 640, 700, 767];
const WIDE = [768, 1024, 1440];

function bar(path: string, landing: boolean) {
  const r = render(<MemoryRouter initialEntries={[path]}><Navbar landing={landing} /></MemoryRouter>);
  const nav = r.container.querySelector('nav[aria-label="Primary"]')!;
  const logIns = [...nav.querySelectorAll('a[href="/login"]')];
  const joins = [...nav.querySelectorAll('a[href="/signup"]')];
  return { r, nav, logIns, joins };
}

describe("owner 11-22: the phone bar has one Join / Log in button; the desktop bar is unchanged", () => {
  it.each(PAGES)("$path: below md no Log in link and the button reads Join / Log in; from md up Log in + Join free", ({ path, landing }) => {
    const { r, logIns, joins } = bar(path, landing);
    expect(logIns).toHaveLength(1);
    expect(joins).toHaveLength(1);
    const [logIn] = logIns;
    const [pill] = joins;
    const phoneWords = pill.querySelector('[data-nav-join="phone"]')!;
    const wideWords = pill.querySelector('[data-nav-join="wide"]')!;
    expect(phoneWords.textContent).toBe("Join / Log in");
    expect(wideWords.textContent).toBe("Join free");
    expect(logIn.textContent).toBe("Log in");
    for (const w of PHONE) {
      expect(shownAt(logIn, w), `${path} ${w}: no Log in link on a phone`).toBe(false);
      expect(shownAt(pill, w), `${path} ${w}: the button shows`).toBe(true);
      expect(shownAt(phoneWords, w), `${path} ${w}: Join / Log in`).toBe(true);
      expect(shownAt(wideWords, w), `${path} ${w}: not Join free`).toBe(false);
    }
    for (const w of WIDE) {
      expect(shownAt(logIn, w), `${path} ${w}: Log in on the desktop`).toBe(true);
      expect(shownAt(pill, w), `${path} ${w}: the button shows`).toBe(true);
      expect(shownAt(phoneWords, w), `${path} ${w}: not Join / Log in`).toBe(false);
      expect(shownAt(wideWords, w), `${path} ${w}: Join free`).toBe(true);
    }
    // The desktop order is unchanged: Log in, then the button.
    const links = [...r.container.querySelectorAll("a")];
    expect(links.indexOf(logIn as HTMLAnchorElement)).toBeLessThan(links.indexOf(pill as HTMLAnchorElement));
    // The 44px target (the shared Button's sm size is h-11) and no text under 13px.
    expect(cls(pill)).toContain("h-11");
    expect(cls(pill).filter((c) => /text-ds-(9|10|11|12)\b/.test(c))).toEqual([]);
  });

  it("the resolver can tell hidden from shown (not vacuous)", () => {
    const el = document.createElement("span");
    el.className = "hidden md:inline-flex";
    expect([shownAt(el, 767), shownAt(el, 768)]).toEqual([false, true]);
    el.className = "md:hidden";
    expect([shownAt(el, 767), shownAt(el, 768)]).toEqual([true, false]);
  });

  it("signed in, the bar has neither (unchanged)", () => {
    auth.user = { id: "u1" };
    const { nav } = bar("/gift-guides/her", false);
    expect(nav.querySelectorAll('a[href="/login"], a[href="/signup"]')).toHaveLength(0);
  });

  it("the button opens sign-up, whose card starts with the Log in | Create account switch", () => {
    const step1 = blankComments(readFileSync(join(ROOT, "src/pages/auth/signup/SignupStep1.tsx"), "utf8"));
    expect(step1).toMatch(/<AuthModeTabs active="signup" loginHref=\{loginHref\}/);
    expect(step1).toMatch(/const loginHref = [^;]*"\/login"/);
  });

  it("Spanish has its own words, and index.html's prerendered landing bar shows the phone words", () => {
    const en = readFileSync(join(ROOT, "src/lib/i18n/enCore.ts"), "utf8");
    const es = readFileSync(join(ROOT, "src/lib/i18n/es.ts"), "utf8");
    expect(en).toContain('"g.joinOrLogIn": "Join / Log in"');
    expect(es).toMatch(/"g\.joinOrLogIn": "Únase \/ [^"]+"/);
    const html = readFileSync(join(ROOT, "index.html"), "utf8");
    expect(html).toContain('<span class="md:hidden" data-nav-join="phone">Join / Log in</span>');
    expect(html).toContain('<span class="hidden md:inline" data-nav-join="wide">Join free</span>');
  });
});
