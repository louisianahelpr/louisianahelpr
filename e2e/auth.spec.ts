import { test, expect } from "./prodTest";
import { LOCAL_BASE_URL } from "./localBase";
import { FORM_PASSWORD, answerPasswordGrantWithMintedSession, mintedSignInAvailable } from "./helpers/mintedPasswordGrant";

// Authenticated smoke tests. Insurance against RLS or auth-flow
// regressions on the most-used signed-in paths.
//
// REQUIRES (skipped otherwise): PLAYWRIGHT_TEST_USER_EMAIL, the pre-created
// customer account, and the service-role key. The login form is driven for
// real; its password grant is answered with a session minted for that account
// (e2e/helpers/mintedPasswordGrant.ts), because Supabase Auth CAPTCHA refuses a
// CI build's grant (docs/OPEN.md Q1420/Q1314). No password is read or typed.
//
// The test is read-only — it signs in, checks dashboard renders, signs
// out. No data mutations. Safe to run against production.

// This checkout's local build, never the deployed site (e2e/localBase.ts).
const BASE_URL = LOCAL_BASE_URL;

const TEST_EMAIL = process.env.PLAYWRIGHT_TEST_USER_EMAIL;
const haveCreds = mintedSignInAvailable(TEST_EMAIL);

test.describe("authenticated flows", () => {
  test.skip(
    !haveCreds,
    "PLAYWRIGHT_TEST_USER_EMAIL or the service-role key not set — skipping",
  );

  test("sign in lands on dashboard or complete-profile", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await answerPasswordGrantWithMintedSession(page, TEST_EMAIL!);
    await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
    await page.locator("#email").fill(TEST_EMAIL!);
    await page.locator("#password").fill(FORM_PASSWORD);

    // Click submit + wait for navigation. Both /home and
    // /complete-profile are valid landing destinations (the latter for
    // first-time users who haven't filled out their profile).
    await Promise.all([
      page.waitForURL(/\/(home|complete-profile)/, { timeout: 15_000 }),
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

    await answerPasswordGrantWithMintedSession(page, TEST_EMAIL!);
    await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
    await page.locator("#email").fill(TEST_EMAIL!);
    await page.locator("#password").fill(FORM_PASSWORD);
    await Promise.all([
      page.waitForURL(/\/(home|complete-profile)/, { timeout: 15_000 }),
      page.locator('button[type="submit"]').click(),
    ]);

    await page.goto(`${BASE_URL}/profile`, { waitUntil: "networkidle" });

    // If RLS is broken the profile fetch returns no rows and the page
    // renders "We couldn't load your account". A loaded profile renders its
    // Edit control and the Log Out action — neither exists in the error
    // state. This used to assert the EMAIL's local part appears on screen,
    // which the profile page has not shown for months (it shows the display
    // name), so the spec failed on a page that had rendered perfectly
    // (run 34169384242).
    await expect(page.locator("body")).not.toContainText(/couldn.t load your account/i, {
      timeout: 10_000,
    });
    await expect(page.getByRole("button", { name: /^log out$/i }).first()).toBeVisible({
      timeout: 10_000,
    });
  });
});

// CREDENTIAL-BLOCKED, not unfinished.
//
// @mutate-exempt Needs PLAYWRIGHT_TEST_USER_EMAIL/_PASSWORD, which exist ONLY as GitHub secrets — absent from .env, so every test.skip(!haveCreds) fires locally and the whole describe is gated (verified 2026-09-21). A local registration therefore returns SURVIVED for an environment reason, which convicts a working spec. SHOWN ABLE TO FAIL in the medium it actually runs in: the `auth + payment lifecycle` step of e2e-real-backend.yml runs it on its schedule (Sun/Mon/Wed/Fri), and that job's conclusion is FAILURE on the 2026-09-13 and 2026-09-14 scheduled runs and success on 2026-09-16/18/20/21 — a spec that has gone red and green on real changes. GAP, stated plainly: nothing has mutated it, so it is proven to fail, not proven to fail FOR THE REASON IT NAMES. What would close it is adding PLAYWRIGHT_TEST_USER_* to vacuity.yml's scheduled job, which is cheap here — this spec signs in and reads, and leaves no funded residue behind.
