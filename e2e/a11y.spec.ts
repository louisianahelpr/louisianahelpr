import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Accessibility sweep on the two highest-friction public surfaces:
// /signup (every new user must clear it) and /post (the core action
// for paying customers). We don't gate CI on a11y violations yet — the
// run is informational so we can triage what's worth fixing first.
//
// Rules we explicitly skip:
//   color-contrast        — Garden District Stone palette is borderline
//                           on body text against parchment; design call
//                           to revisit, not a P0 blocker
//   region                — top-level <main> wrapping handled by App
//                           shell; Playwright sometimes navigates to a
//                           bare component in strict-mode-double-mount
//
// To re-enable strict mode locally:
//   PLAYWRIGHT_A11Y_STRICT=1 npx playwright test e2e/a11y.spec.ts
const STRICT = !!process.env.PLAYWRIGHT_A11Y_STRICT;

const skippedRules = STRICT ? [] : ["color-contrast", "region"];

async function runAxe(page: import("@playwright/test").Page, surfaceName: string) {
  const results = await new AxeBuilder({ page })
    .disableRules(skippedRules)
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();

  const critical = results.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious",
  );

  if (critical.length > 0) {
    const lines = critical.map(
      (v) => `  - [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node${v.nodes.length === 1 ? "" : "s"})`,
    );
    test.info().annotations.push({
      type: "a11y-violations",
      description: `${surfaceName}\n${lines.join("\n")}`,
    });
  }

  return critical;
}

test.describe("a11y — public forms", () => {
  test("/signup has no critical/serious violations", async ({ page }) => {
    await page.goto("/signup", { waitUntil: "domcontentloaded" });
    // Wait for first form input so we know the route mounted, not the splash.
    await page.locator("input").first().waitFor({ timeout: 10_000 });
    const critical = await runAxe(page, "/signup");
    expect(
      critical,
      "Critical/serious axe-core violations on /signup — see test annotation",
    ).toEqual([]);
  });

  test("/post (login redirect or form) has no critical/serious violations", async ({ page }) => {
    // /post-job is auth-gated — anonymous visitors get redirected to /signup.
    // Run axe on whatever page they actually land on; either way it's the
    // top-of-funnel surface a new customer sees.
    await page.goto("/post-job", { waitUntil: "domcontentloaded" });
    await page.locator("input,button").first().waitFor({ timeout: 10_000 });
    const critical = await runAxe(page, "/post-job (or its redirect)");
    expect(
      critical,
      "Critical/serious axe-core violations on /post-job — see test annotation",
    ).toEqual([]);
  });
});
