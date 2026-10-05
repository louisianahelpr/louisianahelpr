import { test, expect, FAKE_HELPER, installSupabaseMocks } from "./fixtures";

// THE EARNINGS TAB IS ONE PAGE (Q1177).
//
// History: 2026-08-28 the tab became a four-segment control ("entirely too
// long"); 2026-09-11 two segments, Earnings and Payouts. 2026-10-01 the owner
// called the two-view split "messy and repeat itself a lot": the same money was
// listed up to three times (Earning history, Payout history, Recent transfers)
// across two views. It is now ONE page with no switcher: wallet, earned
// summary, ONE payouts list, insights, bank account, tax note.
//
// This spec pins what a screenshot would not:
//   1. There is no view switcher — zero role="tab" controls on the page.
//   2. Every section is in the DOM at once, in reading order.
//   3. The old `?view=payouts` deep link (any bookmark that still carries it)
//      renders the same whole page, not half of it.

/** Text present even on an empty account, in the order the page reads. */
const IN_ORDER: RegExp[] = [
  // `earnedRangeLabel("lifetime")`: the summary opens on lifetime and prints
  // the label under the figure whatever the figure is.
  /total earned/i,
  /^Payouts$/,
  /More Insights/i,
  /Tax reporting:/i,
];

async function open(page: import("@playwright/test").Page, url: string) {
  await installSupabaseMocks(page, { user: FAKE_HELPER, rules: [] });
  // The onboarding tour renders a modal that swallows taps.
  await page.addInitScript(() => {
    try {
      localStorage.setItem("helpr_onboarding", JSON.stringify({ seen: true, completed: true }));
    } catch { /* no-storage guard */ }
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(url);
  await page.getByText(/Tax reporting:/i).first().waitFor({ timeout: 20_000 });
}

async function assertWholePageInOrder(page: import("@playwright/test").Page) {
  await expect(page.getByRole("tab")).toHaveCount(0);
  const tops: number[] = [];
  for (const marker of IN_ORDER) {
    const el = page.getByText(marker).first();
    await expect(el, `${marker} is missing from the one-page Earnings tab`).toBeVisible({ timeout: 10_000 });
    const box = await el.boundingBox();
    tops.push(box?.y ?? -1);
  }
  for (let i = 1; i < tops.length; i++) {
    expect(tops[i], `${IN_ORDER[i]} renders above ${IN_ORDER[i - 1]}`).toBeGreaterThan(tops[i - 1]);
  }
}

test("earnings tab is one page: no switcher, every section in order", async ({ helperPage: page }) => {
  await open(page, "/profile?tab=earnings");
  await assertWholePageInOrder(page);
});

// A bookmark from the two-view era may still carry `&view=payouts`. It must
// open the same whole page — reintroducing a `view`-keyed split (the
// 2026-09-11 design) is exactly what this catches.
// @mutate src/components/profile/EarningsTab.tsx |         {pageReady && (\n          <> |         {pageReady && new URLSearchParams(window.location.search).get("view") !== "payouts" && (\n          <>
test("the old ?view=payouts link still opens the whole page", async ({ helperPage: page }) => {
  await open(page, "/profile?tab=earnings");
  await page.goto("/profile?tab=earnings&view=payouts");
  await page.getByText(/total earned/i).first().waitFor({ timeout: 20_000 });
  await assertWholePageInOrder(page);
});
