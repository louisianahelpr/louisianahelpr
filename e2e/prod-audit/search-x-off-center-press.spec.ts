/**
 * A SEARCH ✕ WORKS WHEN A HUMAN PRESSES IT, NOT ONLY ITS EXACT CENTRE.
 *
 * Owner, 2026-10-01: "the x button in jobs does not work", then the same X on
 * /profile?tab=saved_helpers at 1440 "does nothing when clicked".
 *
 * Every search clear-X is centred with `top-1/2 -translate-y-1/2` and wears
 * `.btn-press`, whose unlayered `:active { transform: scale(0.97) }` replaced
 * the translate on press: the X dropped ~14px (rect y 89 -> 103.42 on /jobs,
 * 156 -> 170.42 on saved_helpers), mouseup landed on the input, and no click
 * fired. Playwright's centre click still passed (the dropped box still covered
 * the centre point), which is why every existing spec was green.
 *
 * So this presses the way a person aiming at the top stroke does: 30% down the
 * glyph, holds, reads the rect while :active, then releases. The ✕ must not
 * move, and the press must act (field closed, or emptied where the ✕ clears).
 * Inventory: the six search clear-Xs in src/test/pressKeepsTranslate.test.ts,
 * which derives the list from source and fails when it drifts.
 *
 * Run: PLAYWRIGHT_WEB_SERVER=1 npx playwright test --project=prod-audit search-x-off-center-press
 */
// @mutate src/index.css | here to this. */\n  transform: translate(var(--tw-translate-x, 0), var(--tw-translate-y, 0)) scale(0.97); | here to this. */\n  transform: scale(0.97);

import { test, expect, webkit, type Browser } from "../prodTest";
import { getSession, type Session } from "./harness";
import { AUTH_STORAGE_KEY } from "../journeys/fixtures";

let poster: Session;
test.beforeAll(async ({ request }) => {
  poster = await getSession(request, "poster");
});

const CLOSE = 'button[aria-label="Close search"]';

const SURFACES: { name: string; url: string; trigger: string; field: string; close: string; minWidth?: number }[] = [
  { name: "jobs", url: "/jobs", trigger: "[data-search-trigger]", field: 'input[aria-label="Search jobs"]', close: CLOSE },
  { name: "posts", url: "/posts", trigger: "[data-search-trigger]", field: 'input[aria-label="Search jobs"]', close: CLOSE },
  {
    name: "saved-helprs",
    url: "/profile?tab=saved_helpers",
    trigger: 'button[aria-label="Search saved Helprs"]',
    field: 'input[aria-label="Search saved Helprs"]',
    close: CLOSE,
  },
  {
    name: "messages",
    url: "/messages",
    trigger: "[data-search-trigger]",
    field: 'input[aria-label="Search conversations"]',
    close: CLOSE,
  },
  {
    name: "browse-desktop-strip",
    url: "/home",
    trigger: "[data-feed-strip] [data-search-trigger]",
    field: '[data-feed-strip] input[aria-label="Search jobs"]',
    close: `[data-feed-strip] ${CLOSE}`,
    minWidth: 900,
  },
  {
    name: "legal",
    url: "/legal",
    trigger: 'button[aria-label="Search all policies"]',
    field: 'input[aria-label="Search all policies"]',
    close: CLOSE,
  },
];

for (const engine of ["chromium", "webkit"] as const) {
  for (const vw of [375, 1440] as const) {
    for (const s of SURFACES) {
      test(`${s.name}: an off-centre press on the ✕ acts and the ✕ stays put @${vw} ${engine}`, async ({ browser: def }, info) => {
        test.skip(!!s.minWidth && vw < s.minWidth, `${s.name} does not render at ${vw}`);
        test.setTimeout(120_000);
        const browser: Browser = engine === "chromium" ? def : await webkit.launch();
        const ctx = await browser.newContext({
          baseURL: info.project.use.baseURL,
          viewport: { width: vw, height: vw >= 900 ? 900 : 812 },
          serviceWorkers: "block",
        });
        try {
          await ctx.addInitScript(
            ({ key, val }) => {
              try {
                localStorage.setItem(key, val);
                localStorage.setItem("helpr_onboarding", JSON.stringify({ completed: true, currentStep: 0, completedSteps: [] }));
              } catch {
                /* signed out: the trigger wait below fails visibly */
              }
            },
            { key: AUTH_STORAGE_KEY, val: JSON.stringify(poster) },
          );
          const page = await ctx.newPage();
          await page.goto(s.url, { waitUntil: "domcontentloaded" });
          const trigger = page.locator(s.trigger).first();
          await trigger.waitFor({ state: "visible", timeout: 45_000 });
          await page.waitForTimeout(1000);
          await trigger.click();
          const field = page.locator(s.field).first();
          await field.fill("zzz");
          await page.waitForTimeout(450);
          const x = page.locator(s.close).first();
          const rest = await x.boundingBox();
          expect(rest, `${s.name}: no ✕ in the open field — nothing was pressed`).not.toBeNull();
          // A person aiming at the X's top stroke: 30% down the glyph.
          await page.mouse.move(rest!.x + rest!.width / 2, rest!.y + rest!.height * 0.3);
          await page.mouse.down();
          await page.waitForTimeout(150);
          const pressed = await x.boundingBox();
          await page.mouse.up();
          await page.waitForTimeout(600);
          const stillOpen = await field.count();
          const value = stillOpen ? await field.inputValue() : "";
          const msg = `${s.name}@${vw} ${engine}: rest y ${rest!.y.toFixed(2)}, pressed y ${pressed?.y.toFixed(2)}, field open after ${stillOpen}, value "${value}"`;
          info.annotations.push({ type: "press", description: msg });
          console.log(msg);
          // :active scales 0.97 about the centre, so y moves by ~0.4px; a
          // replaced translate moves it by half its height.
          expect(Math.abs((pressed?.y ?? Infinity) - rest!.y), `${msg} — the ✕ moved while pressed`).toBeLessThan(1);
          expect(stillOpen === 0 || value === "", `${msg} — the press did nothing`).toBe(true);
        } finally {
          await ctx.close();
          if (engine !== "chromium") await browser.close();
        }
      });
    }
  }
}
