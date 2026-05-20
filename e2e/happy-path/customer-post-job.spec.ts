import { test, expect, FAKE_CUSTOMER, mockTable, mockRpc, installSupabaseMocks, checkA11y } from "./fixtures";

// Customer happy path: landing → signup CTA → (with a pre-seeded authed
// session) post-job page renders → activity list surfaces a posted job.
//
// We deliberately do NOT drive the live multi-step Signup form. See
// fixtures.ts → "Why we pre-seed an authed session…" for the rationale.
// The contract this spec asserts:
//   1. The marketing landing page renders with a Sign Up CTA
//   2. /signup loads without crashing (the public-form route entry-point)
//   3. An authed customer can reach /post-job and see the form step
//   4. /my-posts surfaces a job the customer "posted" (mocked select)

test.describe("customer post-job happy path", () => {
  test("landing → signup CTA → signup page renders", async ({ page }) => {
    // Stub Supabase even though we're unauthenticated — the marketing
    // page still calls a handful of public RPCs that would otherwise
    // 404 against vite preview and noise up the logs.
    await installSupabaseMocks(page);

    await page.goto("/");

    // Marketing hero — fail loudly if the landing page doesn't paint.
    await expect(page).toHaveTitle(/Helpr/i);
    await expect(page.locator("h1").first()).toBeVisible({ timeout: 10_000 });

    // Axe check at the most critical anonymous surface — the landing
    // page must remain accessible because it gates every new signup.
    await checkA11y(page);

    // The landing page has a "Sign up" link in the navbar/hero. We use a
    // role-based query rather than a brittle CSS selector so a copy
    // tweak doesn't break the test.
    const signupLink = page
      .getByRole("link", { name: /sign\s*up|join|get started/i })
      .first();
    await signupLink.waitFor({ timeout: 10_000 });
    await signupLink.click();

    await page.waitForURL("**/signup", { timeout: 10_000 });
    // Signup page must render at least one input — if the bundle is
    // broken or the route is misconfigured this fails immediately.
    await expect(page.locator("input").first()).toBeVisible({ timeout: 10_000 });
  });

  test("authed customer can reach /post-job and see the form", async ({ customerPage: page }) => {
    // Open-job-limit check uses this RPC — return 0 so the limit doesn't
    // gate the form.
    await installSupabaseMocks(page, {
      user: FAKE_CUSTOMER,
      rules: [
        mockRpc("get_public_platform_settings", [{ helper_fee_percent: 10 }]),
        // Customer has no open jobs yet, so the limit notice stays hidden.
        mockTable("jobs", []),
      ],
    });

    await page.goto("/post-job");

    // ProtectedRoute does an async profile fetch + Big-7 gate before it
    // renders children. Allow extra time for that bootstrap.
    await expect(page.getByRole("heading", { name: /what do you need done/i })).toBeVisible({
      timeout: 15_000,
    });

    // The page must NOT redirect to /login (auth seeding worked).
    expect(page.url()).toContain("/post-job");
  });

  test("/my-posts shows a posted job for the authed customer", async ({ customerPage: page }) => {
    const postedJob = {
      id: "11111111-1111-4111-8111-111111111111",
      customer_id: FAKE_CUSTOMER.id,
      title: "Smoke job: yard cleanup",
      description: "Twenty character description so the card renders normally.",
      category: "yard_work",
      budget: 75,
      date_needed: new Date(Date.now() + 86_400_000).toISOString(),
      start_time: "10:00",
      location: "New Orleans, LA",
      status: "open",
      payment_status: "pending",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      is_urgent: false,
      urgent_fee: 0,
      is_flexible_schedule: true,
      is_recurring: false,
      is_group_job: false,
      helpers_needed: 1,
      estimated_hours: 2,
      special_requirements: null,
      photos: [],
      expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      boosted_at: null,
      boost_expires_at: null,
      recurrence_interval: null,
      recurrence_end_date: null,
      parent_job_id: null,
      helper_id: null,
      offered_to_helper_id: null,
      direct_offer_status: null,
    };

    await installSupabaseMocks(page, {
      user: FAKE_CUSTOMER,
      rules: [
        // Activity tab fetches jobs by customer_id. The most-specific
        // matcher needs to win, so we shape the rule to match any
        // /rest/v1/jobs read regardless of filters.
        mockTable("jobs", [postedJob]),
        mockTable("applications", []),
        mockTable("job_checkins", []),
        mockTable("tips", []),
        mockTable("reviews", []),
        mockTable("user_violations", []),
        mockRpc("get_safe_profiles", []),
      ],
    });

    await page.goto("/my-posts");

    // Heading must render — ActivityHeader uses "My Posts" as the title.
    await expect(
      page.getByText(postedJob.title, { exact: false }),
    ).toBeVisible({ timeout: 15_000 });

    // Spot-check accessibility on the customer's activity surface — this
    // is the page customers will return to most often, so it must stay
    // accessible.
    await checkA11y(page);
  });
});
