// THE SECTION TAB ROW STAYS PUT WHEN THE PAGE SCROLLS (owner bug 2026-10-30, iPhone Safari on the live site:
// on Jobs and Declutter the tab words vanished on a scroll, leaving the row's border and, on Jobs, the icons beside
// it, and came back at the top).
//
// CAUSE (measured, WebKit 375 and 1440): the tablist was `overflow-x: auto`, which computes overflow-y to auto, and
// the selected tab's underline (::after, bottom -1px) made it 45px of content in a 44px box. So the row was a
// VERTICAL scroller: a wheel over it moved scrollTop 0 -> 1, and iOS rubber-banded the words out of the clip.
// Fixed in src/components/sections/SectionTabs.tsx (overflow-y: hidden).
//
// THE CHECK, per SectionTabs screen (inventory: SECTION_TAB_SCREENS, the four files that render <SectionTabs>,
// kept equal to source by src/test/sectionTabsStayPutCovers.test.tsx), at 375 and 1440, in Chromium AND WebKit
// (this directory's two projects; .github/workflows/a11y-webkit-prod.yml runs the WebKit one):
//   1. scroll with the pointer over the page content, then over the tab row itself;
//   2. the tablist has not moved vertically (scrollTop 0), cannot (overflow-y hidden, or no vertical overflow),
//      sits where it sat, and the ACTIVE tab is the element painted at its own centre (elementFromPoint).
// RED on main before the fix: the wheel over the row left scrollTop 1 on Jobs and Declutter at both widths, and
// overflow-y computed to auto (~/.lh-shots/b69-tab-row, before-* vs after-*).
//
// Read-only against prod: the poster account is signed in and looked at.

import { test, expect, type Browser, type Page } from "../prodTest";
import { AUTH_STORAGE_KEY, SUPABASE_URL, getSession, sessionAvailable, type Session } from "../journeys/fixtures";
import { OUTPUT_DIR } from "../happy-path/sweepCore";
import { abortProdWrites } from "./abortProdWrites";
import { SECTION_TAB_SCREENS } from "./sectionTabScreens";

const VIEWPORTS = [
  { tag: "375", width: 375, height: 812 },
  { tag: "1440", width: 1440, height: 900 },
] as const;

async function open(browser: Browser, session: Session, viewport: { width: number; height: number }, path: string): Promise<Page> {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport });
  // Read-only by construction: every request that could write prod is aborted and logged.
  await abortProdWrites(ctx, SUPABASE_URL, OUTPUT_DIR);
  await ctx.addInitScript(({ key, val }) => {
    try { window.localStorage.setItem(key, val); } catch { /* storage blocked: the screen renders signed out and the tablist wait below fails loudly */ }
  }, { key: AUTH_STORAGE_KEY, val: JSON.stringify(session) });
  const page = await ctx.newPage();
  await page.goto(path, { waitUntil: "load" });
  await page.getByRole("tablist").first().waitFor({ timeout: 60_000 });
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
  return page;
}

function rowState(page: Page) {
  return page.evaluate(() => {
    const list = document.querySelector<HTMLElement>('[role="tablist"]');
    if (!list) return null;
    const active = list.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    const r = active?.getBoundingClientRect();
    const hit = r ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
    return {
      scrollTop: list.scrollTop,
      overflowY: getComputedStyle(list).overflowY,
      verticalOverflow: list.scrollHeight - list.clientHeight,
      top: Math.round(list.getBoundingClientRect().top),
      activePainted: !!active && !!hit && (hit === active || active.contains(hit)),
      activeInView: !!r && r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth,
    };
  });
}

/**
 * Scroll by `dy` with the pointer (or finger) at (x, y). Chromium: a real wheel. Mobile WebKit (the iPhone 13 project)
 * has no wheel ("Mouse wheel is not supported in mobile WebKit", measured B76 2026-10-30) and Playwright has no swipe,
 * so there the scroll goes to what a finger at that point would move: the nearest ancestor of the element under it
 * that a person can scroll (overflow-y auto or scroll, with room to move), else the page. A tab row that is a vertical
 * scroller (the bug) is that element, so its scrollTop moves as the rubber-band did on the owner's iPhone.
 */
async function scrollAt(page: Page, x: number, y: number, dy: number): Promise<void> {
  await page.mouse.move(x, y);
  try {
    await page.mouse.wheel(0, dy);
    return;
  } catch (e) {
    if (!/not supported/i.test(String(e))) throw e;
  }
  await page.evaluate(({ px, py, d }) => {
    let el: Element | null = document.elementFromPoint(px, py);
    while (el && el !== document.documentElement) {
      const cs = getComputedStyle(el);
      if ((cs.overflowY === "auto" || cs.overflowY === "scroll") && el.scrollHeight > el.clientHeight) {
        el.scrollBy(0, d);
        return;
      }
      el = el.parentElement;
    }
    window.scrollBy(0, d);
  }, { px: x, py: y, d: dy });
}

let poster: Session | null = null;
test.beforeAll(async ({ request }) => {
  if (sessionAvailable("poster")) poster = await getSession(request, "poster");
});

test.describe("section tab rows stay put when the page scrolls (owner 2026-10-30)", () => {
  test("the inventory read something", () => {
    expect(SECTION_TAB_SCREENS.length).toBeGreaterThan(3);
  });

  for (const screen of SECTION_TAB_SCREENS) {
    for (const v of VIEWPORTS) {
      test(`${screen.name} (${v.tag})`, async ({ browser }) => {
        test.skip(!poster, "poster session unavailable (secrets not set)");
        const page = await open(browser, poster!, v, screen.path);
        const before = await rowState(page);
        expect(before, "no tablist on the screen").not.toBeNull();
        // 1. over the content, 2. over the tab row itself (where an iPhone swipe moved the words).
        await scrollAt(page, v.width / 2, v.height * 0.65, 800);
        await page.waitForTimeout(400);
        const box = await page.getByRole("tablist").first().boundingBox();
        expect(box).not.toBeNull();
        await scrollAt(page, box!.x + Math.min(40, box!.width / 2), box!.y + box!.height / 2, 800);
        await page.waitForTimeout(400);
        const after = await rowState(page);
        expect(after!.scrollTop, "the tab row scrolled vertically").toBe(0);
        expect(after!.overflowY === "hidden" || after!.verticalOverflow <= 0, `the tab row can scroll vertically (overflow-y ${after!.overflowY}, ${after!.verticalOverflow}px)`).toBe(true);
        expect(after!.top, "the tab row moved").toBe(before!.top);
        expect(after!.activeInView, "the active tab left the screen").toBe(true);
        expect(after!.activePainted, "the active tab is not what is painted at its centre").toBe(true);
        await page.context().close();
      });
    }
  }
});
