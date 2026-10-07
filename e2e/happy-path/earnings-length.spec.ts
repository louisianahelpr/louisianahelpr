import type { Page } from "@playwright/test";
import { test, expect, FAKE_HELPER, installSupabaseMocks, mockTable, mockRpc } from "./fixtures";

// THE MONEY TAB'S EARNED HALF HAS A LENGTH BUDGET, AND IT IS MEASURED.
//
// Owner, 2026-08-28: "Earnings and payout tab is also entirely too long."
// The tab was split into views with only the selected one mounted; the
// owner called the Earnings | Payouts split "messy and repeat itself a lot"
// (2026-10-01) and it became Money: Earned | Spent (Q1177), with the three
// money lists merged into one on Earned. `earnings-views.spec.ts` pins that
// structure; this spec pins the RESULT, against a helpr who actually has
// money — the case the complaint was about, and the one an empty mock cannot
// show.
//
// Measured on this fixture at 393x852:
//   before any split, one column:  5382px  (6.3 screens)
//   four views — Money 1013 · History 2653 · Insights 1472 · Payouts 840
//   two views (2026-09-11): Earnings and Payouts, each under its own budget
//   Earned (Q1177): see PAGE_BUDGET_SCREENS below
// It fits because nothing is listed twice any more: each transfer sits inside
// the job it paid instead of in a second list.
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

/** Ceiling for the whole page, in viewport-heights, with headroom over the
 *  measured value. A page that grows a section's worth trips this; normal
 *  drift will not. */
const PAGE_BUDGET_SCREENS = 6.0;

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


// A CONNECTED wallet with a real payout history — the state the tab is long
// in. The shared edge-function stub answers every function with
// `{success:true}`, which reads as "not connected" and hides the wallet, the
// payout history and the whole Payouts view.
async function mockConnectedWallet(page: Page): Promise<void> {
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
}

async function openFunded(page: Page, { honorFilters }: { honorFilters: boolean }): Promise<void> {
  await installSupabaseMocks(page, {
    user: { ...FAKE_HELPER },
    rules: [
      // Filters honoured: the PaymentTab poster-spend query is
      // `.eq("customer_id", me)`, and a verbatim body handed it all twelve
      // helper-side jobs, so "Total spent … across 12 jobs" claimed the count
      // a second time. None of these jobs were posted by the helper.
      mockTable("jobs", jobs, honorFilters ? { honorFilters: true } : undefined),
      mockTable("payout_transfers", transfers),
      mockRpc("get_user_credential_tier", 2),
    ],
  });
  // A CONNECTED wallet with a real payout history — the state the tab is long
  // in. The shared edge-function stub answers every function with
  // `{success:true}`, which reads as "not connected" and hides the wallet, the
  // payout history and the bank-account section.
  await mockConnectedWallet(page);
  await page.addInitScript(() => {
    try {
      localStorage.setItem("helpr_onboarding", JSON.stringify({ seen: true, completed: true }));
    } catch { /* no-storage guard */ }
  });
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto("/profile?tab=earnings");
  await page.getByText(/Tax reporting:/i).first().waitFor({ timeout: 20_000 });
  await page.waitForTimeout(2_000);
}

test("the Earned half stays within its length budget", async ({ helperPage: page }) => {
  await openFunded(page, { honorFilters: false });
  expect(await page.getByRole("tab").allInnerTexts()).toEqual(["Earned", "Spent"]);

  // The fixture really did produce a funded wallet and real take-home —
  // otherwise every assertion below would pass against an empty state.
  await expect(page.getByText(/\$245\.00/).first()).toBeVisible({ timeout: 10_000 });
  // $1,645 since Q1273 (2026-10-07): the eight jobs with a paid transfer count
  // the $120 that was sent, not the take-home preview (was $1,632).
  await expect(page.getByText(/\$1,645\b/).first()).toBeVisible({ timeout: 10_000 });

  const px = await page.evaluate(MEASURE_SCROLLER);
  const screens = px / 852;
  expect(
    screens,
    `the Earnings page is ${screens.toFixed(1)} screens (${px}px) — budget is ${PAGE_BUDGET_SCREENS}`,
  ).toBeLessThanOrEqual(PAGE_BUDGET_SCREENS);
});

test("lifetime take-home is stated in exactly one place", async ({ helperPage: page }) => {
  // It used to appear three times on one screen: the Money "Net" tile,
  // HeroSummary in the analytics dashboard, and "Total earned" in the payout
  // settings — two of them computed by different paths, so they could and did
  // disagree. Each figure has one home now: the Earned summary card.
  await openFunded(page, { honorFilters: true });
  // "N jobs" / "N completed" is the tell — the count that rode alongside the
  // money figure in all three places.
  const text = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  const claims = (text.match(new RegExp(`${JOB_COUNT} (jobs|completed)`, "g")) || []).length;
  expect(claims, "lifetime completed-jobs count is stated more than once").toBe(1);
});

// "Repeat itself a lot" (owner, 2026-10-01): every paid job was listed in
// Earning history AND its transfer again in Recent transfers. The one list
// shows each transfer inside the job it paid, once. The transfer line prints
// the last 8 characters of its Stripe transfer id, so each fixture id must
// appear exactly once on the page. Listing every ledger row on its own as well
// as under its job — the old two-list layout, back inside one component — puts
// each id on the page twice.
// @mutate src/components/profile/earningsTab/EarningHistory.tsx |     if (!moneyJobIds.has(t.job_id)) {\n      orphanTransfers.push(t);\n      continue;\n    } |     orphanTransfers.push(t);
test("each transfer is listed exactly once", async ({ helperPage: page }) => {
  await openFunded(page, { honorFilters: true });
  const text = await page.locator("body").innerText();
  for (const t of transfers) {
    const tail = t.stripe_transfer_id.slice(-8);
    const n = text.split(tail).length - 1;
    expect(n, `transfer ${t.stripe_transfer_id} is listed ${n} times`).toBe(1);
  }
});
