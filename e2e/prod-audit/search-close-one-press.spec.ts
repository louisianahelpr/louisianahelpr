/**
 * ONE PRESS OF THE ✕ CLOSES THE HOME SEARCH, with the RECENT list showing.
 *
 * Owner, 2026-10-01, phone: on /home, with the search open ("Search jobs..."
 * field, RECENT list under it, ✕ on the right), the ✕ had to be pressed TWICE
 * to close it. expanding-search-geometry.spec.ts already presses the ✕ once,
 * but on an account with no recent searches, so the floating RECENT list was
 * never on screen; this spec seeds the list first, which is the owner's state.
 *
 * Driven by TAPS (touch context, 375x812) in Chromium AND WebKit, against the
 * real backend as the shared poster. No writes: the recent list is local
 * storage only.
 *
 * Why the order of events is asserted, not only the end state: Playwright's
 * tap delivers the click even when the press first blurs the field, so on the
 * old code the end state alone passed in both engines. On a real iPhone that
 * blur is what costs the press: it drops the keyboard, the visual viewport
 * resizes under the finger and the RECENT list starts to go, and the click
 * that should follow is lost (the owner's "press it twice"). The search's own
 * suggestion rows already keep focus with a mousedown preventDefault and close
 * in one tap; the ✕ must do the same. So: the field must NOT blur before the
 * ✕'s click arrives.
 */
// Shown able to fail: without the press guard the field blurs before the click.
// @mutate src/components/dashboard/browseTasksToolbar/BrowseSearchBar.tsx | onMouseDown={(e) => e.preventDefault()} | data-press-guard-removed
import { test, expect, webkit, type Browser } from "../prodTest";
import { getSession, type Session } from "./harness";
import { AUTH_STORAGE_KEY } from "../journeys/fixtures";

const RECENT = ["lawn mowing", "move a couch", "gutter cleaning"];

let poster: Session;
test.beforeAll(async ({ request }) => {
  poster = await getSession(request, "poster");
});

for (const engine of ["chromium", "webkit"] as const) {
  test(`home search: one tap on the ✕ closes it while RECENT is showing (${engine})`, async ({ browser: defaultBrowser }, info) => {
    test.setTimeout(2 * 60_000);
    const browser: Browser = engine === "chromium" ? defaultBrowser : await webkit.launch();
    try {
      const ctx = await browser.newContext({
        baseURL: info.project.use.baseURL,
        viewport: { width: 375, height: 812 },
        hasTouch: true,
        isMobile: engine === "chromium",
        serviceWorkers: "block",
      });
      await ctx.addInitScript(
        ({ key, val, recent }) => {
          try {
            localStorage.setItem(key, val);
            localStorage.setItem("helpr_onboarding", JSON.stringify({ completed: true, currentStep: 0, completedSteps: [] }));
            localStorage.setItem("helpr:search-history", JSON.stringify(recent));
          } catch {
            /* signed out: the trigger assertion below fails visibly */
          }
        },
        { key: AUTH_STORAGE_KEY, val: JSON.stringify(poster), recent: RECENT },
      );
      const page = await ctx.newPage();
      await page.goto("/home", { waitUntil: "domcontentloaded" });
      const trigger = page.locator("[data-search-trigger]").first();
      await expect(trigger).toBeVisible({ timeout: 45_000 });
      await page.waitForTimeout(700);
      await trigger.tap();

      const field = page.locator('input[aria-label="Search jobs"]');
      const recent = page.getByRole("listbox", { name: "Recent searches" });
      await expect(field).toBeVisible();
      await expect(field).toBeFocused();
      // The owner's state: the RECENT list is open under the field.
      await expect(recent).toBeVisible();

      // Record what the press does, in order: does the field lose focus (the
      // keyboard dropping) BEFORE the ✕'s click is delivered?
      await page.evaluate(() => {
        const w = window as unknown as { __closeOrder: string[] };
        w.__closeOrder = [];
        const input = document.querySelector('input[aria-label="Search jobs"]');
        const x = document.querySelector('button[aria-label="Close search"]');
        input?.addEventListener("blur", () => w.__closeOrder.push("blur"));
        x?.addEventListener("click", () => w.__closeOrder.push("click"), { capture: true });
      });
      await page.locator('button[aria-label="Close search"]').tap();
      const order = await page.evaluate(() => (window as unknown as { __closeOrder: string[] }).__closeOrder);
      expect(order[0], `${engine}: the ✕ press blurred the field (dropping the keyboard) before its click arrived: ${order.join(" > ")}`).toBe("click");
      // ONE tap. No second press is ever made: if the first did nothing, the
      // field is still here after the wait and this fails.
      await expect(field, `${engine}: the first tap on the ✕ did not close the search`).toHaveCount(0, { timeout: 3_000 });
      await expect(recent).toHaveCount(0);
      await expect(trigger).toBeVisible();
      await page.screenshot({ path: info.outputPath(`search-closed-${engine}.png`) });
      await ctx.close();
    } finally {
      if (engine !== "chromium") await browser.close();
    }
  });
}
