/**
 * Screenshot the apply step for lh-design-holes, in the four combinations the
 * house rules require: 375 and 1440, light and dark.
 *
 * Lives inside the repo on purpose — running from a scratch dir fails with
 * ERR_MODULE_NOT_FOUND: playwright (no node_modules to resolve against).
 */
import { chromium } from "playwright";
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:8083";
const OUT = process.env.OUT ?? "/tmp/claude-501/-Users-lexilombas-louisianahelpr/e0241cf9-a362-473b-a66a-f80d4cd37af9/scratchpad/shots";
const TAG = process.env.TAG ?? "after";
mkdirSync(OUT, { recursive: true });

const session = JSON.parse(
  execSync("node scripts/test-signin-link.mjs helper --session --json", { encoding: "utf8" }),
);

const VIEWPORTS = [
  { name: "375", width: 375, height: 812 },
  { name: "1440", width: 1440, height: 900 },
];
const THEMES = ["light", "dark"];

for (const vp of VIEWPORTS) {
  for (const theme of THEMES) {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      colorScheme: theme,
      deviceScaleFactor: 2,
    });
    // Session + the onboarding key together, before first paint. Without the
    // second one the tour opens 1.5s in, blurs the page and eats the clicks.
    await ctx.addInitScript(
      ([k, v, t]) => {
        localStorage.setItem(k, v);
        localStorage.setItem(
          "helpr_onboarding",
          JSON.stringify({ completed: true, currentStep: 0, completedSteps: [] }),
        );
        // The app persists the choice here AND stamps data-theme on <html>;
        // Playwright's colorScheme alone only drives prefers-color-scheme.
        localStorage.setItem("theme", t);
      },
      [session.key, session.value, theme],
    );
    const page = await ctx.newPage();
    const label = `${TAG}-${vp.name}-${theme}`;
    try {
      await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(3500);

      // Open the first job card, then step to the apply form inside the sheet.
      const card = page.locator('[data-testid="job-card"], article, [role="button"]').first();
      await card.click({ timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(1800);

      // The detail sheet's CTA is "Continue"; the apply FORM is its second
      // step (JobDetailDialog's applyStep). Clicking the first Apply-ish
      // button lands on the detail screen, not the form — so step through.
      const cont = page.locator('button:has-text("Continue")').first();
      if (await cont.count()) {
        await cont.click({ timeout: 10000 }).catch(() => {});
        await page.waitForTimeout(1800);
      }
      // Some entry points go straight to the form; harmless if absent.
      const applyBtn = page.locator('button:has-text("Book Now")').first();
      if (await applyBtn.count()) {
        await applyBtn.click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(1500);
      }

      await page.screenshot({ path: `${OUT}/${label}.png`, fullPage: false });
      const notice = await page
        .locator("text=/can't be hired yet/i")
        .count()
        .catch(() => 0);
      console.log(`${label}: notice_present=${notice > 0}`);
    } catch (e) {
      console.log(`${label}: ERROR ${e.message.slice(0, 120)}`);
      await page.screenshot({ path: `${OUT}/${label}-err.png` }).catch(() => {});
    }
    await browser.close();
  }
}
