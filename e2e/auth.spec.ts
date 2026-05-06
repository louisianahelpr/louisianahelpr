import { test, expect } from "@playwright/test";

// Authenticated smoke tests. Insurance against RLS or auth-flow
// regressions on the most-used signed-in paths.
//
// REQUIRES env vars to run (test is skipped otherwise so CI doesn't
// block on missing credentials):
//   PLAYWRIGHT_TEST_USER_EMAIL    — pre-created customer account
//   PLAYWRIGHT_TEST_USER_PASSWORD — that account's password
//
// To set up the test user:
//   1. Sign up at https://www.louisianahelpr.com/signup as a customer
//      with a dedicated address (e.g. playwright-customer@helpr.test)
//   2. Verify the email
//   3. Set the env vars locally:
//      export PLAYWRIGHT_TEST_USER_EMAIL=playwright-customer@helpr.test
//      export PLAYWRIGHT_TEST_USER_PASSWORD=<your password>
//   4. Run: npx playwright test e2e/auth.spec.ts
//
// The test is read-only — it signs in, checks dashboard renders, signs
// out. No data mutations. Safe to run against production.

const BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL ||
  process.env.VERCEL_URL ||
  "https://www.louisianahelpr.com";

const TEST_EMAIL = process.env.PLAYWRIGHT_TEST_USER_EMAIL;
const TEST_PASSWORD = process.env.PLAYWRIGHT_TEST_USER_PASSWORD;

const haveCreds = !!TEST_EMAIL && !!TEST_PASSWORD;

test.describe("authenticated flows", () => {
  test.skip(
    !haveCreds,
    "PLAYWRIGHT_TEST_USER_EMAIL + PLAYWRIGHT_TEST_USER_PASSWORD not set — skipping",
  );

  test("sign in lands on dashboard or complete-profile", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
    await page.locator("#email").fill(TEST_EMAIL!);
    await page.locator("#password").fill(TEST_PASSWORD!);

    // Click submit + wait for navigation. Both /dashboard and
    // /complete-profile are valid landing destinations (the latter for
    // first-time users who haven't filled out their profile).
    await Promise.all([
      page.waitForURL(/\/(dashboard|complete-profile)/, { timeout: 15_000 }),
      page.locator('button[type="submit"]').click(),
    ]);

    // Sanity: page rendered something authenticated-looking
    await expect(page.locator("body")).toBeVisible();

    expect(
      errors,
      "Uncaught JS errors after sign-in:\n  " + errors.join("\n  "),
    ).toEqual([]);
  });

  test("authenticated user can read profile via RLS", async ({ page }) => {
    // Verifies the wrapped RLS policies (auth.uid() → (SELECT auth.uid()))
    // still let an authenticated user read their own profile. If the
    // Profile page fails to render any content, the wrap migration broke
    // the SELECT path.

    await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
    await page.locator("#email").fill(TEST_EMAIL!);
    await page.locator("#password").fill(TEST_PASSWORD!);
    await Promise.all([
      page.waitForURL(/\/(dashboard|complete-profile)/, { timeout: 15_000 }),
      page.locator('button[type="submit"]').click(),
    ]);

    await page.goto(`${BASE_URL}/profile`, { waitUntil: "networkidle" });

    // Profile page should at minimum show the user's email somewhere.
    // If RLS is broken, the profile fetch returns no rows and the page
    // renders an empty/error state.
    await expect(page.locator("body")).toContainText(TEST_EMAIL!.split("@")[0], {
      timeout: 10_000,
    });
  });
});
