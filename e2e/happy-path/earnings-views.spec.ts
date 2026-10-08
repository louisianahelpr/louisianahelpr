import { test, expect, FAKE_HELPER, installSupabaseMocks } from "./fixtures";

// THE MONEY TAB: EARNED | SPENT (Q1177).
//
// History: 2026-08-28 the tab became a four-segment control ("entirely too
// long"); 2026-09-11 two segments, Earnings and Payouts. The owner then called
// that split wrong twice: "messy and repeat itself a lot" (2026-10-01, the
// same money listed up to three times across the two views) and "earning and
// payouts are the same. So do earning and spent instead" (2026-10-04). It is
// now "Money", with Earned (wallet, earned summary, ONE payouts list,
// insights, tax note) and Spent (the Spent card and the jobs it sums).
//
// This spec pins what a screenshot would not:
//   1. The switcher has exactly two tabs, Earned and Spent; Payouts is part
//      of Earned, not a tab.
//   2. Earned holds every one of its sections at once, in reading order.
//   3. `?view=spent` opens on Spent; the old `?view=payouts` link opens the
//      whole Earned half, not half of it.

/** Text present even on an empty account, in the order Earned reads. */
const IN_ORDER: RegExp[] = [
  // `earnedRangeLabel("lifetime")`: the summary opens on lifetime and prints
  // the label under the figure whatever the figure is.
  /total earned/i,
  // No Payouts list and no "Sent to your bank" (owner, 2026-10-08): asserted absent below.
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
}

async function assertEarnedInOrder(page: import("@playwright/test").Page) {
  await page.getByText(/Tax reporting:/i).first().waitFor({ timeout: 20_000 });
  expect(await page.getByRole("tab").allInnerTexts()).toEqual(["Earned", "Spent"]);
  await expect(page.getByRole("tab", { name: "Earned" })).toHaveAttribute("aria-selected", "true");
  const tops: number[] = [];
  for (const marker of IN_ORDER) {
    const el = page.getByText(marker).first();
    await expect(el, `${marker} is missing from the Earned half`).toBeVisible({ timeout: 10_000 });
    const box = await el.boundingBox();
    tops.push(box?.y ?? -1);
  }
  for (let i = 1; i < tops.length; i++) {
    expect(tops[i], `${IN_ORDER[i]} renders above ${IN_ORDER[i - 1]}`).toBeGreaterThan(tops[i - 1]);
  }
  await expect(page.getByRole("heading", { name: /^Payouts$/ })).toHaveCount(0);
  await expect(page.getByText(/Sent to your bank/i)).toHaveCount(0);
}

test("the Money tab: Earned | Spent, every Earned section in order", async ({ helperPage: page }) => {
  await open(page, "/profile?tab=earnings");
  await expect(page.getByRole("heading", { level: 1 }).first()).toHaveText("Money");
  await assertEarnedInOrder(page);

  // Every switcher segment is a full 44px HIG tap target.
  for (const b of await page.getByRole("tab").all()) {
    const h = (await b.boundingBox())?.height ?? 0;
    expect(h, `"${await b.innerText()}" tap target is under the 44px minimum`).toBeGreaterThanOrEqual(44);
  }

  await page.getByRole("tab", { name: "Spent" }).click();
  await expect(page.getByText(/Total spent/i).first()).toBeVisible({ timeout: 10_000 });
  // Only the selected half is mounted.
  await expect(page.getByText(/Tax reporting:/i)).toHaveCount(0);
});

// `?view=spent` opens the Spent half, read once at mount.
// @mutate src/components/profile/EarningsTab.tsx | useState<MoneyView>(() => moneyViewFromSearch(searchParams)) | useState<MoneyView>("earned")
test("?view=spent opens Spent; the old ?view=payouts link opens the whole Earned half", async ({ helperPage: page }) => {
  await open(page, "/profile?tab=earnings&view=spent");
  await expect(page.getByRole("tab", { name: "Spent" })).toHaveAttribute("aria-selected", "true", { timeout: 20_000 });
  await expect(page.getByText(/Total spent/i).first()).toBeVisible({ timeout: 10_000 });

  await page.goto("/profile?tab=earnings&view=payouts");
  await assertEarnedInOrder(page);
});
