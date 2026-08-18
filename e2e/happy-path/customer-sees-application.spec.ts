import { test, expect, FAKE_CUSTOMER, mockTable, mockRpc, installSupabaseMocks, checkA11y } from "./fixtures";
import { settleAnimations } from "./auditRoutes";

// Customer sees an application: an authed customer with one posted job
// that has one helper application on it navigates to /my-posts and sees
// the applicant-count badge surface ("1 applicant") next to the job.
//
// The contract this spec asserts:
//   1. /my-posts loads for an authed customer
//   2. The posted job renders
//   3. The applicant-count surface shows up because a mocked
//      applications.select returned a row for that job

const POSTED_JOB_ID = "44444444-4444-4444-8444-444444444444";
const HELPER_ID = "55555555-5555-4555-8555-555555555555";

const POSTED_JOB = {
  id: POSTED_JOB_ID,
  customer_id: FAKE_CUSTOMER.id,
  title: "Smoke job: deep-clean kitchen",
  description: "Standard cleaning job with at least 20 chars of description.",
  category: "cleaning",
  budget: 120,
  date_needed: new Date(Date.now() + 3 * 86_400_000).toISOString(),
  start_time: "09:00",
  location: "New Orleans, LA",
  status: "open",
  payment_status: "paid",
  created_at: new Date(Date.now() - 60_000).toISOString(),
  updated_at: new Date().toISOString(),
  is_urgent: false,
  urgent_fee: 0,
  is_flexible_schedule: true,
  is_recurring: false,
  is_group_job: false,
  helpers_needed: 1,
  estimated_hours: 3,
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

const APPLICATION_ROW = {
  id: "66666666-6666-4666-8666-666666666666",
  job_id: POSTED_JOB_ID,
  helper_id: HELPER_ID,
  message: "Available tomorrow morning if it suits.",
  status: "pending",
  created_at: new Date().toISOString(),
};

test.describe("customer sees helper application", () => {
  test("/my-posts surfaces the applicant count when a helper has applied", async ({ customerPage: page }) => {
    await installSupabaseMocks(page, {
      user: FAKE_CUSTOMER,
      rules: [
        mockRpc("get_public_platform_settings", [{ helper_fee_percent: 10 }]),
        // ActivityData reads jobs (posted), applications (applicant
        // counts), and helper profiles via get_safe_profiles. Returning
        // one application row for the posted job makes applicantCounts
        // = { [POSTED_JOB_ID]: 1 }, which PostedJobCard surfaces on its
        // primary "Applicants (1)" button.
        mockTable("jobs", [POSTED_JOB]),
        mockTable("applications", [APPLICATION_ROW]),
        mockTable("job_checkins", []),
        mockTable("tips", []),
        mockTable("reviews", []),
        mockTable("user_violations", []),
        mockRpc("get_safe_profiles", [
          { user_id: HELPER_ID, full_name: "Smoke Helper", avatar_url: null },
        ]),
      ],
    });

    await page.goto("/my-posts");

    // 1. Posted job title surfaces.
    await expect(page.getByText(POSTED_JOB.title)).toBeVisible({ timeout: 15_000 });

    // 2. Applicant-count surface — the "customer sees that a helper has
    //    applied" contract. The count lives on the primary button, which is
    //    also the control that acts on it.
    const applicantsButton = page.getByRole("button", { name: /^Applicants \(1\)$/ });
    await expect(applicantsButton).toBeVisible({ timeout: 10_000 });

    // ...and it appears EXACTLY once on the card. An open job with applicants
    // used to state the same number three times within ~120px — this button,
    // a "1 applicant" meta chip, and a "1 applicant · pick someone" state pill
    // — which is what the owner reported. The chip is gone and the pill now
    // reads "Pick someone", so a second copy of the tally is a regression.
    await expect(page.getByText(/\d+\s+applicants?\b/i)).toHaveCount(0);
    await expect(page.getByText("Pick someone")).toBeVisible();

    // Axe at the customer's see-applications surface — this is a high
    // signal page (decision-making happens here) so a11y matters most.
    //
    // settleAnimations FIRST. This page fires the customer-first-bid push
    // nudge, and scanning while that toast is still fading in measured its
    // action button mid-opacity as 1.91:1 — a transitional state no user ever
    // sees, and exactly the load-dependent false finding this helper exists to
    // stop. Settled, the same button passes.
    await settleAnimations(page);
    await checkA11y(page);
  });
});
