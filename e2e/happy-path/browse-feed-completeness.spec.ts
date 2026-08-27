import { test, expect, installSupabaseMocks, seedAuthedSession, FAKE_CUSTOMER } from "./fixtures";
import type { MockRule } from "./fixtures";

const OTHER = "00000000-0000-4000-8000-0000000000aa";
const AGO = (m: number) => new Date(Date.now() - m * 60000).toISOString();

// 6 jobs in the user's own city (no skill match) + 3 out-of-town jobs that DO
// match the user's declared skill. Recommended scoring: skill match = 3,
// location match = 2, top 5 wins. nearbyJobs = first 5 location matches.
const JOBS = [
  ...Array.from({ length: 6 }, (_, i) => mk(`NOLA-${i + 1}`, "cleaning", "New Orleans, LA", i)),
  ...Array.from({ length: 3 }, (_, i) => mk(`MOVE-${i + 1}`, "moving", "Shreveport, LA", 6 + i)),
];

function mk(tag: string, category: string, location: string, i: number) {
  return {
    id: `30000000-0000-4000-8000-00000000000${i + 1}`,
    title: `JOB ${tag}`, description: `Task ${tag} description.`,
    category, budget: 100 + i, date_needed: "2026-09-20",
    customer_id: OTHER, status: "open", created_at: AGO(60 + i * 10), updated_at: AGO(60 + i * 10),
    is_urgent: false, urgent_fee: 0, is_flexible_schedule: false, is_recurring: false,
    is_group_job: false, helpers_needed: 1, estimated_hours: 2, special_requirements: null,
    photos: [], boosted_at: null, boost_expires_at: null, expires_at: null, start_time: "09:00",
    recurrence_interval: null, recurrence_end_date: null, parent_job_id: null,
    payment_status: "unpaid", location, pricing_mode: "fixed", applicant_count: 0,
  };
}

const PROFILE = {
  id: `${FAKE_CUSTOMER.id}-profile`, user_id: FAKE_CUSTOMER.id, full_name: FAKE_CUSTOMER.fullName,
  avatar_url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  bio: "Smoke-test profile bio with at least twenty characters.", date_of_birth: "1990-01-01",
  phone: "5045550100", location: "New Orleans, LA",
  id_document_url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  approval_status: "approved", ban_status: "active", is_legacy_user: true, subscription_tier: "free",
  subscription_expires_at: null, referral_code: "SMOKE", is_verified: true, role: "customer",
  skills: "moving", created_at: AGO(9999), updated_at: AGO(1),
};

const rules: MockRule[] = [
  { match: (u, m) => m === "GET" && u.pathname === "/rest/v1/open_jobs_browse", handle: () => ({ status: 200, body: JOBS }) },
  { match: (u, m) => m === "GET" && u.pathname === "/rest/v1/profiles", handle: () => ({ status: 200, body: [PROFILE] }) },
  { match: (u, m) => m === "POST" && u.pathname === "/rest/v1/rpc/get_safe_profiles",
    handle: () => ({ status: 200, body: [{ user_id: OTHER, full_name: "Other Poster", avatar_url: null, is_verified: true, location: "Shreveport, LA" }] }) },
];

// Regression guard: every open job the backend returns must be rendered by
// SOME section of the browse feed. The feed used to subtract
// `filters.nearbyJobs` from the "everything else" list on the grounds that a
// "Nearby" band already rendered them — that band no longer exists, so the
// subtraction silently deleted open jobs with nothing showing them instead.
// This fixture is shaped to pull `nearbyJobs` and `recommendedJobs` apart
// (skill score 3 beats location score 2), which is the condition that made
// jobs vanish.
test("every open job the API returns is rendered somewhere", async ({ page, context, baseURL }) => {
  test.setTimeout(180_000);
  await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
  await context.addInitScript(() => {
    try {
      localStorage.setItem("helpr.onboarding_tour_dismissed_at", new Date().toISOString());
      localStorage.setItem("helpr_welcomed", "1");
    } catch { /* noop */ }
  });
  await installSupabaseMocks(page, { user: FAKE_CUSTOMER, seed: true, rules });
  const errs: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 200)); });
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);

  const shown = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[aria-label^="View JOB"]')).map((e) => (e.getAttribute("aria-label") ?? "").replace("View ", "").split(" —")[0]));
  const all = JOBS.map((j) => j.title);
  const missing = all.filter((t) => !shown.includes(t));
  console.log("SERVER RETURNED :", all.join(", "));
  console.log("RENDERED        :", shown.join(", "));
  console.log("MISSING FROM UI :", missing.join(", ") || "(none)");
  console.log("ERRORS:", errs);
  
  expect(missing, `open jobs returned by the API but rendered nowhere: ${missing.join(", ")}`).toEqual([]);
});
