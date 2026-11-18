/**
 * The Holiday Gift Guides banner (owner mockup A, 2026-11-18): a pink banner on Home and Declutter that a member can
 * close. It links to /gift-guides, stays closed once closed, draws nothing after Dec 25, and loads lazily and LAST in
 * its column on both screens, so nothing below it moves and neither screen's first chunk grows.
 *
 * @mutate src/components/GiftGuidesPromo.tsx |       window.localStorage.setItem(GIFT_PROMO_KEY, "1"); |       void GIFT_PROMO_KEY;
 * @mutate src/components/GiftGuidesPromo.tsx |   if (closed \|\| todayIso(now) > GIFT_PROMO_LAST_DAY) return null; |   if (closed) return null;
 * @mutate src/pages/home/HomeDashboard.tsx |             <Suspense fallback={null}><GiftGuidesPromo where="home" /></Suspense>\n | \n
 * @mutate src/components/declutter/DeclutterBrowseView.tsx | {!preview && <Suspense fallback={null}><GiftGuidesPromo where="declutter" /></Suspense>} | {null}
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import GiftGuidesPromo, { GIFT_PROMO_KEY } from "@/components/GiftGuidesPromo";
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

  it("is lazy and last in its column on Home and Declutter", () => {
    const sites = [
      ["src/pages/home/HomeDashboard.tsx", '<GiftGuidesPromo where="home" />', "</section>"],
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
    expect(checked).toBeGreaterThan(1);
  });
});
