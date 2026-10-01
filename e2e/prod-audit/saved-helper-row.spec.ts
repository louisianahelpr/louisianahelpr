/**
 * A saved Helpr's actions sit on the SAME line as the name from md up.
 *
 * Owner, 2026-10-01, desktop 1440, /profile?tab=saved_helpers: "move offer a
 * job to the right along the same line as the name and the heart and note up
 * too". The card drew the avatar + name on one row and Offer a Job / note /
 * heart on a second row under it. SavedHelperCard.tsx is now a grid: from md
 * the action row is column 2 of the name's row; under md (a 277px card at 375
 * cannot fit name + ~230px of actions) it stays stacked under the name.
 *
 * Measured, not read: the rendered boxes of the name, Offer a Job, note and
 * heart, at 1440 and 375, against the real backend as the shared poster (who
 * has Hallie saved). Read-only: no writes. Fails if the poster has no saved
 * Helpr, rather than passing on nothing.
 */
// Shown able to fail: with the action row back in the card's first column, 1440 reds.
// @mutate src/components/profile/savedHelpersTab/SavedHelperCard.tsx | md:col-start-2 md:row-start-1 | md:col-start-1
import { test, expect } from "../prodTest";
import { getSession, type Session } from "./harness";
import { AUTH_STORAGE_KEY } from "../journeys/fixtures";

let poster: Session;
test.beforeAll(async ({ request }) => {
  poster = await getSession(request, "poster");
});

for (const width of [1440, 375] as const) {
  test(`saved helper card: actions ${width >= 768 ? "on the name's line" : "stacked under the name"} at ${width}`, async ({ browser }, info) => {
    test.setTimeout(2 * 60_000);
    const ctx = await browser.newContext({
      baseURL: info.project.use.baseURL,
      viewport: { width, height: 900 },
      serviceWorkers: "block",
    });
    await ctx.addInitScript(
      ({ key, val }) => {
        try {
          localStorage.setItem(key, val);
          localStorage.setItem("helpr_onboarding", JSON.stringify({ completed: true, currentStep: 0, completedSteps: [] }));
        } catch {
          /* signed out: the card assertion below fails visibly */
        }
      },
      { key: AUTH_STORAGE_KEY, val: JSON.stringify(poster) },
    );
    const page = await ctx.newPage();
    await page.goto("/profile?tab=saved_helpers", { waitUntil: "domcontentloaded" });
    const offer = page.getByRole("button", { name: "Offer a Job" }).first();
    await expect(offer, "the poster has no saved Helpr to measure").toBeVisible({ timeout: 45_000 });
    await page.waitForTimeout(500);

    const card = offer.locator("xpath=ancestor::div[contains(@class,'liquid-glass')][1]");
    const box = async (sel: string) => {
      const b = await card.locator(sel).first().boundingBox();
      expect(b, `${sel} not rendered`).not.toBeNull();
      return b!;
    };
    const name = await box("p.font-display");
    const o = (await offer.boundingBox())!;
    const note = await box('button[aria-label$="private note"]');
    const heart = await box('button[aria-label="Remove from saved"]');
    const cardBox = (await card.boundingBox())!;
    const mid = (b: { y: number; height: number }) => b.y + b.height / 2;
    const fit = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

    const measure = `${width}: name mid ${mid(name).toFixed(1)} right ${(name.x + name.width).toFixed(1)}; offer mid ${mid(o).toFixed(1)} left ${o.x.toFixed(1)}; note mid ${mid(note).toFixed(1)}; heart mid ${mid(heart).toFixed(1)} right ${(heart.x + heart.width).toFixed(1)}; card right ${(cardBox.x + cardBox.width).toFixed(1)}; fits ${fit}`;
    info.annotations.push({ type: "measure", description: measure });
    console.log(`[saved-helper-row] ${measure}`);
    await card.screenshot({ path: info.outputPath(`saved-helper-card-${width}.png`) });

    expect(fit, "page overflows horizontally").toBe(true);
    expect(heart.x + heart.width, "heart spills past the card").toBeLessThanOrEqual(cardBox.x + cardBox.width);
    // The three controls always share one line with each other.
    expect(Math.abs(mid(note) - mid(o))).toBeLessThanOrEqual(2);
    expect(Math.abs(mid(heart) - mid(o))).toBeLessThanOrEqual(2);
    if (width >= 768) {
      expect(Math.abs(mid(o) - mid(name)), "Offer a Job is not on the name's line").toBeLessThanOrEqual(8);
      expect(o.x, "Offer a Job is not to the right of the name").toBeGreaterThan(name.x + name.width);
    } else {
      expect(o.y, "at phone width the actions stay under the name").toBeGreaterThan(name.y + name.height);
    }
    await ctx.close();
  });
}
