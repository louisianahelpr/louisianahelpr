/* TEMPORARY probe spec — created for the desktop top-bar work, deleted after
   the before/after comparison. Not part of the committed suite. */
import { test, expect, FAKE_HELPER, installSupabaseMocks, seedAuthedSession } from "./fixtures";
import { writeFileSync, mkdirSync } from "node:fs";
import type { Page } from "@playwright/test";

const OUT = process.env.PROBE_OUT || "/tmp/topbar-probe";
mkdirSync(OUT, { recursive: true });
const PHASE = process.env.PROBE_PHASE || "before";

const ROUTES = (process.env.PROBE_ROUTES || "/dashboard,/my-posts,/my-jobs,/messages,/profile,/browse").split(",");
const WIDTHS = [375, 899, 1000, 1440];

async function probe(page: Page, route: string, width: number) {
  await page.setViewportSize({ width, height: 900 });
  for (let attempt = 0; ; attempt++) {
    try {
      await page.goto(route, { waitUntil: "domcontentloaded", timeout: 30_000 });
      break;
    } catch (err) {
      if (attempt >= 3) throw err;
      await page.waitForTimeout(1000);
    }
  }
  // Let the SPA settle (queries + the matchMedia effects that set web-desktop).
  await page.waitForTimeout(Number(process.env.PROBE_SETTLE || 6000));
  return await page.evaluate(() => {
    const txt = (el: Element | null) => (el ? (el.textContent || "").replace(/\s+/g, " ").trim() : null);
    const rect = (el: Element | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const de = document.documentElement;
    const header = document.querySelector(".app-shell-header");
    const titleCard = document.querySelector("div.liquid-glass.shrink-0.px-5.py-4");
    const wide: string[] = [];
    document.querySelectorAll("*").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > de.clientWidth + 1) {
        wide.push(`${el.tagName.toLowerCase()}.${(el.className || "").toString().slice(0, 60)}=${Math.round(r.width)}`);
      }
    });
    return {
      htmlClass: de.className,
      url: location.pathname,
      h1s: [...document.querySelectorAll("h1")].map((h) => txt(h)),
      emblems: document.querySelectorAll('img[alt="Helpr"]').length,
      bells: document.querySelectorAll('button[aria-label="Notifications"]').length,
      visibleEmblems: [...document.querySelectorAll('img[alt="Helpr"]')].filter(
        (el) => (el as HTMLElement).getClientRects().length > 0,
      ).length,
      visibleBells: [...document.querySelectorAll('button[aria-label="Notifications"]')].filter(
        (el) => (el as HTMLElement).getClientRects().length > 0,
      ).length,
      header: rect(header),
      headerHTMLLen: header ? header.innerHTML.length : 0,
      headerText: txt(header),
      titleCard: rect(titleCard),
      titleCardText: txt(titleCard),
      titleCardInner: titleCard ? titleCard.innerHTML.replace(/\s+/g, " ").trim() : null,
      scrollWidth: de.scrollWidth,
      clientWidth: de.clientWidth,
      overflow: de.scrollWidth > de.clientWidth,
      wide: wide.slice(0, 8),
      bodyText: (document.body.innerText || "").replace(/\s+/g, " ").trim().slice(0, 300),
    };
  });
}

test("topbar probe", async ({ context, page, baseURL }) => {
  test.setTimeout(600_000);
  await seedAuthedSession(context, FAKE_HELPER, baseURL ?? "");
  await installSupabaseMocks(page, { user: FAKE_HELPER });
  const results: Record<string, unknown> = {};
  for (const route of ROUTES) {
    for (const width of WIDTHS) {
      results[`${route}@${width}`] = await probe(page, route, width);
    }
  }
  writeFileSync(`${OUT}/${PHASE}.json`, JSON.stringify(results, null, 2));
  expect(Object.keys(results).length).toBe(ROUTES.length * WIDTHS.length);
});
