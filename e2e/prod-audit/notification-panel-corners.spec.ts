/**
 * The notification panel's TOP corners are rounded like its BOTTOM corners.
 *
 * Owner, 2026-10-01, phone: the bell's panel ("Notifications", Unread / All)
 * had rounded bottom corners and square top ones. On the phone band the
 * surface comes from `screenPanelContentProps` (src/components/ui/anchoredPanel.tsx),
 * which rounded only the bottom pair; NotificationPanel now asks for the top
 * pair too.
 *
 * Measured, not read: the open panel's COMPUTED radii at 375, in Chromium AND
 * WebKit, light and dark, against the real backend as the shared poster. No
 * writes. A screenshot of the panel's top is kept per run.
 */
// Shown able to fail: without the option the top corners compute to 0px.
// @mutate src/components/NotificationPanel.tsx | screenPanelContentProps(band, { roundTopCorners: true, contentMaxWidth | screenPanelContentProps(band, { contentMaxWidth
import { test, expect, webkit, type Browser } from "../prodTest";
import { getSession, type Session } from "./harness";
import { AUTH_STORAGE_KEY } from "../journeys/fixtures";

let poster: Session;
test.beforeAll(async ({ request }) => {
  poster = await getSession(request, "poster");
});

for (const engine of ["chromium", "webkit"] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`notification panel: top corners rounded like the bottom ones at 375 (${engine}, ${theme})`, async ({ browser: defaultBrowser }, info) => {
      test.setTimeout(2 * 60_000);
      const browser: Browser = engine === "chromium" ? defaultBrowser : await webkit.launch();
      try {
        const ctx = await browser.newContext({
          baseURL: info.project.use.baseURL,
          viewport: { width: 375, height: 812 },
          hasTouch: true,
          isMobile: engine === "chromium",
          colorScheme: theme,
          serviceWorkers: "block",
        });
        await ctx.addInitScript(
          ({ key, val, theme }) => {
            try {
              localStorage.setItem(key, val);
              localStorage.setItem("helpr_onboarding", JSON.stringify({ completed: true, currentStep: 0, completedSteps: [] }));
              localStorage.setItem("theme", theme);
            } catch {
              /* signed out: the bell assertion below fails visibly */
            }
          },
          { key: AUTH_STORAGE_KEY, val: JSON.stringify(poster), theme },
        );
        const page = await ctx.newPage();
        await page.goto("/home", { waitUntil: "domcontentloaded" });
        const bell = page.getByRole("button", { name: "Notifications" }).first();
        await expect(bell).toBeVisible({ timeout: 45_000 });
        await page.waitForTimeout(700);
        await bell.tap();
        const panel = page.locator('[role="dialog"][aria-labelledby]');
        await expect(panel).toBeVisible({ timeout: 20_000 });
        await page.waitForTimeout(500); // entry animation done

        const r = await panel.evaluate((el) => {
          const cs = getComputedStyle(el);
          return {
            tl: cs.borderTopLeftRadius,
            tr: cs.borderTopRightRadius,
            bl: cs.borderBottomLeftRadius,
            br: cs.borderBottomRightRadius,
          };
        });
        const measure = `${engine} ${theme} 375: top ${r.tl} / ${r.tr}, bottom ${r.bl} / ${r.br}`;
        info.annotations.push({ type: "measure", description: measure });
        console.log(`[notification-panel-corners] ${measure}`);
        await page.screenshot({ path: info.outputPath(`panel-corners-${engine}-${theme}.png`) });

        expect(parseFloat(r.bl), "the bottom corners are not rounded at all: nothing to match").toBeGreaterThan(0);
        expect(r.tl, `${engine} ${theme}: top-left corner differs from bottom-left`).toBe(r.bl);
        expect(r.tr, `${engine} ${theme}: top-right corner differs from bottom-right`).toBe(r.br);
        await ctx.close();
      } finally {
        if (engine !== "chromium") await browser.close();
      }
    });
  }
}
