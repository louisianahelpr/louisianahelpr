import { test, expect, FAKE_HELPER, installSupabaseMocks, mockTable, mockRpc } from "./fixtures";

// THE EARNINGS TAB HAS A LENGTH BUDGET, AND IT IS MEASURED.
//
// Owner, 2026-08-28: "Earnings and payout tab is also entirely too long."
// The tab was split into four views (Money · History · Insights · Payouts) with
// only the selected one mounted. `earnings-views.spec.ts` pins that structure;
// this spec pins the RESULT, against a helpr who actually has money — the case
// the complaint was about, and the one an empty mock cannot show.
//
// Measured on this fixture at 393x852:
//   before the split, one column:  5382px  (6.3 screens)
//   after — Money (the landing):   1013px  (1.2 screens)
//           History (the longest): 2653px  (3.1 screens)
//           Insights:              1472px  (1.7 screens)
//           Payouts:                840px  (1.0 screens)
//
// Two traps this spec exists to avoid, both of which produced wrong answers
// before it was written:
//
//  1. MEASURE THE SCROLL CONTAINER, NOT THE DOCUMENT. Profile is an AppShell
//     page: the document is locked to 100dvh and scrolling happens in an
//     internal container, so `documentElement.scrollHeight` is *always* exactly
//     the viewport height and reports no difference between a one-screen view
//     and a six-screen one.
//  2. SEED `helper_fee_percent`. Without it the take-home helpers resolve to a
//     fallback that left every figure at $0, so the tab rendered its empty
//     state and looked short for the wrong reason.

const JOB_COUNT = 12;

const jobs = Array.from({ length: JOB_COUNT }, (_, i) => ({
  id: `00000000-0000-4000-8000-0000000000${String(i).padStart(2, "0")}`,
  customer_id: "33333333-3333-4333-8333-333333333333",
  helper_id: FAKE_HELPER.id,
  title: `Completed job ${i + 1}`,
  status: "completed",
  category: i % 3 === 0 ? "moving" : i % 3 === 1 ? "cleaning" : "yardwork",
  budget: 100 + i * 10,
  helper_fee_percent: 12,
  created_at: new Date(Date.now() - (i + 1) * 86_400_000).toISOString(),
  helper_completed_at: new Date(Date.now() - (i + 1) * 86_400_000).toISOString(),
  poster_completed_at: new Date(Date.now() - (i + 1) * 86_400_000).toISOString(),
  is_group_job: false,
  helpers_needed: 1,
  urgent_fee: 0,
  // "released" — the transfer fired. NOT "paid", which this fixture carried
  // until 2026-09-07 and which the database has never accepted: the
  // `jobs_payment_status_check` constraint admits exactly unpaid, escrow,
  // payout_pending, released, refunded, cancelled, abandoned, failed,
  // chargeback and cancelling. A row shaped like the old one could not be
  // inserted into prod.
  //
  // It went unnoticed because the code under test ignored the column — the
  // earnings screen counted any job with `status === "completed"`, so the
  // fixture's impossible value never had to mean anything. Both halves were
  // wrong in the same direction and agreed. The moment `payment_status`
  // started deciding what counts as earned, the fixture stopped describing a
  // job that could exist and the count went to zero.
  payment_status: "released",
}));

const transfers = Array.from({ length: 8 }, (_, i) => ({
  id: `tr_${i}`,
  job_id: jobs[i].id,
  helper_id: FAKE_HELPER.id,
  amount_cents: 12_000,
  fee_cents: 1_440,
  status: "paid",
  stripe_transfer_id: `tr_stripe_${i}`,
  created_at: new Date(Date.now() - i * 86_400_000).toISOString(),
}));

/** Per-view ceilings, in viewport-heights, with headroom over the measured
 *  values above. A view that doubles will trip this; normal drift will not. */
const BUDGET_SCREENS: Record<string, number> = {
  Money: 2.0,
  History: 4.0,
  Insights: 2.6,
  Payouts: 2.0,
};

/** Measures the tallest scroll container — see trap 1 in the header note. */
const MEASURE_SCROLLER = () => {
  let best = 0;
  for (const el of document.querySelectorAll("*")) {
    const cs = getComputedStyle(el);
    if ((cs.overflowY === "auto" || cs.overflowY === "scroll") && el.scrollHeight > best) {
      best = el.scrollHeight;
    }
  }
  return best || document.documentElement.scrollHeight;
};

test("each earnings view stays within its length budget", async ({ helperPage: page }) => {
  await installSupabaseMocks(page, {
    user: { ...FAKE_HELPER },
    rules: [
      mockTable("jobs", jobs),
      mockTable("payout_transfers", transfers),
      mockRpc("get_user_credential_tier", 2),
    ],
  });
  // A CONNECTED wallet with a real payout history — the state the tab is long
  // in. The shared edge-function stub answers every function with
  // `{success:true}`, which reads as "not connected" and hides the wallet, the
  // payout history and the whole Payouts view.
  await page.route("**/functions/v1/stripe-payouts", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        connected: true,
        payouts_enabled: true,
        available: [{ amount: 24_500, currency: "usd" }],
        pending: [{ amount: 8_000, currency: "usd" }],
        payouts: Array.from({ length: 8 }, (_, i) => ({
          id: `po_${i}`,
          amount: 12_000,
          currency: "usd",
          status: "paid",
          arrival_date: Math.floor((Date.now() - i * 86_400_000) / 1000),
          created: Math.floor((Date.now() - i * 86_400_000) / 1000),
        })),
      }),
    }),
  );
  await page.addInitScript(() => {
    try {
      localStorage.setItem("helpr_onboarding", JSON.stringify({ seen: true, completed: true }));
    } catch { /* no-storage guard */ }
  });
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto("/profile?tab=earnings");
  await page.getByRole("tab").first().waitFor({ timeout: 20_000 });
  await page.waitForTimeout(3_000);

  // The fixture really did produce a funded wallet — otherwise every
  // assertion below would pass against an empty state.
  await expect(page.getByText(/\$245\.00/).first()).toBeVisible({ timeout: 10_000 });

  for (const [name, budget] of Object.entries(BUDGET_SCREENS)) {
    await page.getByRole("tab", { name }).click();
    await page.waitForTimeout(1_500);
    const px = await page.evaluate(MEASURE_SCROLLER);
    const screens = px / 852;
    expect(
      screens,
      `"${name}" view is ${screens.toFixed(1)} screens (${px}px) — budget is ${budget}`,
    ).toBeLessThanOrEqual(budget);
  }
});

test("lifetime take-home is stated in exactly one place", async ({ helperPage: page }) => {
  // It used to appear three times on one screen: the Money "Net" tile,
  // HeroSummary in the analytics dashboard, and "Total earned" in the payout
  // settings — two of them computed by different paths, so they could and did
  // disagree. Each figure has one home now.
  await installSupabaseMocks(page, {
    user: { ...FAKE_HELPER },
    rules: [
      mockTable("jobs", jobs),
      mockTable("payout_transfers", transfers),
      mockRpc("get_user_credential_tier", 2),
    ],
  });
  await page.addInitScript(() => {
    try {
      localStorage.setItem("helpr_onboarding", JSON.stringify({ seen: true, completed: true }));
    } catch { /* no-storage guard */ }
  });
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto("/profile?tab=earnings");
  await page.getByRole("tab").first().waitFor({ timeout: 20_000 });
  await page.waitForTimeout(3_000);

  // "N jobs" / "N completed" is the tell — the count that rode alongside the
  // money figure in all three places. Exactly one view may claim it.
  const claims: Record<string, number> = {};
  for (const name of ["Money", "History", "Insights", "Payouts"]) {
    await page.getByRole("tab", { name }).click();
    await page.waitForTimeout(1_200);
    const text = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    claims[name] = (text.match(new RegExp(`${JOB_COUNT} (jobs|completed)`, "g")) || []).length;
  }
  const total = Object.values(claims).reduce((a, b) => a + b, 0);
  expect(total, `lifetime completed-jobs count claimed by: ${JSON.stringify(claims)}`).toBe(1);
  expect(claims.Money, "the Money view's Net tile is its one home").toBe(1);
});
