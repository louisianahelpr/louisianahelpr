/**
 * The Holiday Gift Guides banner (owner mockup A, 2026-11-18): a pink banner on Home and Declutter that a member can
 * close. It links to /gift-guides, stays closed once closed, draws nothing after Dec 25, and loads lazily, so neither
 * screen's first chunk grows. Declutter's sits LAST in its list; Home's is the slim strip under the greeting (owner
 * 11-21), its slot held while it loads (src/test/homeGiftStripAndSideBox1121.test.tsx).
 *
 * @mutate src/components/GiftGuidesPromo.tsx |       window.localStorage.setItem(GIFT_PROMO_KEY, "1"); |       void GIFT_PROMO_KEY;
 * @mutate src/components/GiftGuidesPromo.tsx |   if (closed \|\| giftPromoOver(now)) return null; |   if (closed) return null;
 * @mutate src/components/GiftGuidesPromo.tsx |       <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: "hsl(var(--cat-tint-rose-fg))", | <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: "#b26862",
 * @mutate src/components/declutter/DeclutterBrowseView.tsx | {!preview && <Suspense fallback={null}><GiftGuidesPromo where="declutter" /></Suspense>} | {null}
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import GiftGuidesPromo from "@/components/GiftGuidesPromo";
import { GIFT_PROMO_KEY } from "@/components/giftGuidesPromoGate";
import { blankComments } from "@/test/helpers/blankNonCode";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const draw = (now = new Date(2026, 10, 18)) => render(<MemoryRouter><GiftGuidesPromo where="home" now={now} /></MemoryRouter>).container;

describe("Holiday Gift Guides banner (owner mockup A)", () => {
  it("links to the gift guides, and once closed stays closed on this device", () => {
    const c = draw();
    expect(c.querySelector("[data-gift-promo-link]")?.getAttribute("href")).toBe("/gift-guides");
    expect(c.textContent).toContain("Holiday Gift Guides");
    fireEvent.click(c.querySelector("[data-gift-promo-close]")!);
    expect(c.querySelector("[data-gift-promo]")).toBeNull();
    expect(window.localStorage.getItem(GIFT_PROMO_KEY)).toBe("1");
    cleanup();
    expect(draw().querySelector("[data-gift-promo]")).toBeNull();
  });

  it("shows through Dec 25 and draws nothing after it", () => {
    expect(draw(new Date(2026, 11, 25)).querySelector("[data-gift-promo]")).not.toBeNull();
    cleanup();
    expect(draw(new Date(2026, 11, 26)).querySelector("[data-gift-promo]")).toBeNull();
  });

  it("is lazy on Home and Declutter, and last in Declutter's list", () => {
    const home = blankComments(readFileSync("src/pages/home/HomeDashboard.tsx", "utf8"));
    expect(home).toContain('const GiftGuidesPromo = lazy(() => import("@/components/GiftGuidesPromo"));');
    expect(home).not.toMatch(/^import .*from "@\/components\/GiftGuidesPromo"/m);
    const sites = [
      ["src/components/declutter/DeclutterBrowseView.tsx", '<GiftGuidesPromo where="declutter" />', "</div>"],
    ] as const;
    let checked = 0;
    for (const [file, tag, closer] of sites) {
      const code = blankComments(readFileSync(file, "utf8"));
      expect(code, file).toContain('const GiftGuidesPromo = lazy(() => import("@/components/GiftGuidesPromo"));');
      expect(code, file).not.toMatch(/^import .*GiftGuidesPromo/m);
      const at = code.indexOf(tag);
      expect(at, file).toBeGreaterThan(0);
      // Only the Suspense close (and the preview test's brace) sits between the banner and its column's end.
      const after = code.slice(at + tag.length, code.indexOf(closer, at));
      expect(after.replace(/\s+/g, ""), file).toMatch(/^<\/Suspense>\}?$/);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe("the banner's colours are the app's tokens (holiday audit 1121 #30)", () => {
  it("no hard-coded hex colour in the banner, so it follows the light and dark themes", () => {
    const code = blankComments(readFileSync("src/components/GiftGuidesPromo.tsx", "utf8"));
    expect(code.length).toBeGreaterThan(500);
    expect(code.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
    expect(code).toMatch(/--cat-tint-rose-bg/);
  });
});
