import { test, expect, FAKE_HELPER, installSupabaseMocks } from "./fixtures";

// Does this app actually work on iPad?
//
// App Review rejected version 1.0 under guideline 2.1(a) — "the content didn't
// load after launched" — on an iPad Air 11-inch. The build was from April and
// predates the VITE_* env fix that caused a module-scope throw and a blank
// mount, so the specific bug may already be gone. What has NOT been checked is
// whether the app RENDERS SENSIBLY at iPad size at all: the whole product is
// phone-first with a desktop rail, and TARGETED_DEVICE_FAMILY is "1,2" with all
// four iPad orientations and UIRequiresFullScreen=false (so Split View too).
//
// This captures the sizes Apple actually reviews on, so the decision to keep or
// drop iPad support is made from screenshots rather than assumption.
const SIZES = [
  { name: "ipad-11-portrait", width: 834, height: 1194 },
  { name: "ipad-11-landscape", width: 1194, height: 834 },
  { name: "ipad-13-portrait", width: 1024, height: 1366 },
  { name: "ipad-splitview-half", width: 507, height: 1194 },
];

for (const size of SIZES) {
  test(`iPad render — ${size.name}`, async ({ helperPage: page }) => {
    await installSupabaseMocks(page, { user: FAKE_HELPER, rules: [] });
    await page.addInitScript(() => {
      try {
        localStorage.setItem("helpr_onboarding", JSON.stringify({ seen: true, completed: true }));
      } catch { /* no-storage guard */ }
    });
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto("/dashboard");
    // Content, not just a route: the rejection was specifically "content didn't
    // load", so assert something real rendered before judging the layout.
    await page.waitForTimeout(3000);
    const bodyText = (await page.textContent("body")) ?? "";
    await page.screenshot({ path: `e2e-artifacts/ipad/${size.name}.png`, fullPage: false });

    // Horizontal overflow is the classic phone-app-on-tablet failure.
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    console.log(`[${size.name}] chars=${bodyText.trim().length} scrollW=${overflow.scrollWidth} clientW=${overflow.clientWidth}`);
    expect(bodyText.trim().length, `${size.name} rendered no text — this is the 2.1(a) failure`).toBeGreaterThan(50);
    expect(overflow.scrollWidth, `${size.name} scrolls horizontally`).toBeLessThanOrEqual(overflow.clientWidth + 1);
  });
}
