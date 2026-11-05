import type { Page } from "@playwright/test";
import { test, expect, assertHealthy, getSession, newUserContext, sessionsAvailable } from "./fixtures";
import { filteredOut, rotationFor, scenarioTitle } from "./scenarios";

/**
 * Journey — THE MONEY TAB: EARNED | SPENT (Q1177), on the real backend.
 *
 * Moved here from the mocked e2e/happy-path/earnings-views.spec.ts (Q1035:
 * every mocked spec is migrated to prod or retired, one at a time). The checks
 * are the same; the account is the shared test Helpr signed in for real, so
 * the tab reads its own rows from prod instead of a mock seed. Read-only: it
 * only opens /profile?tab=earnings and switches between its two halves.
 *
 * History: 2026-08-28 the tab became a four-segment control ("entirely too
 * long"); 2026-09-11 two segments, Earnings and Payouts. The owner then called
 * that split wrong twice: "messy and repeat itself a lot" (2026-10-01) and
 * "earning and payouts are the same. So do earning and spent instead"
 * (2026-10-04). It is now "Money", with Earned and Spent.
 *
 * Pinned, beyond what a screenshot shows:
 *   1. The switcher has exactly two tabs, Earned and Spent; Payouts is not a tab.
 *   2. Earned holds its sections at once, in reading order.
 *   3. `?view=spent` opens on Spent; the old `?view=payouts` link opens Earned.
 */
// @mutate src/components/profile/EarningsTab.tsx | useState<MoneyView>(() => moneyViewFromSearch(searchParams)) | useState<MoneyView>("earned")

/** Text present whatever the account's figures are, in the order Earned reads. */
const IN_ORDER: RegExp[] = [
  // `earnedRangeLabel("lifetime")`: the summary opens on lifetime and prints the label under the figure.
  /total earned/i,
  // No Payouts list and no "Sent to your bank" (owner, 2026-10-08): asserted absent below.
  /More insights/i,
  /Tax reporting:/i,
];

async function assertEarnedInOrder(page: Page) {
  await page.getByText(/Tax reporting:/i).first().waitFor({ timeout: 30_000 });
  expect(await page.getByRole("tab").allInnerTexts()).toEqual(["Earned", "Spent"]);
  await expect(page.getByRole("tab", { name: "Earned" })).toHaveAttribute("aria-selected", "true");
  const tops: number[] = [];
  for (const marker of IN_ORDER) {
    const el = page.getByText(marker).first();
    await expect(el, `${marker} is missing from the Earned half`).toBeVisible({ timeout: 15_000 });
    tops.push((await el.boundingBox())?.y ?? -1);
  }
  for (let i = 1; i < tops.length; i++) {
    expect(tops[i], `${IN_ORDER[i]} renders above ${IN_ORDER[i - 1]}`).toBeGreaterThan(tops[i - 1]);
  }
  await expect(page.getByRole("heading", { name: /^Payouts$/ })).toHaveCount(0);
  await expect(page.getByText(/Sent to your bank/i)).toHaveCount(0);
}

const rotation = rotationFor(8);
const title = scenarioTitle({ journey: "money-tab", persona: "helper-only", state: "approved", rotation, outcome: "smooth" });

test(title, async ({ browser, request, journey }) => {
  test.skip(filteredOut(title), "SCENARIO pins another scenario");
  const avail = sessionsAvailable();
  test.skip(!avail.ok, avail.why);

  const session = await getSession(request, "helper");
  const ctx = await newUserContext(browser, session);
  try {
    const page = journey.track("helper", await ctx.newPage());
    await page.setViewportSize({ width: 375, height: 812 });

    await test.step("Money opens on Earned, every section in order, two 44px tabs", async () => {
      await page.goto("/profile?tab=earnings");
      await assertHealthy(page, "/profile?tab=earnings");
      await expect(page.getByRole("heading", { level: 1 }).first()).toHaveText("Money", { timeout: 30_000 });
      await assertEarnedInOrder(page);
      for (const b of await page.getByRole("tab").all()) {
        const h = (await b.boundingBox())?.height ?? 0;
        expect(h, `"${await b.innerText()}" tap target is under the 44px minimum`).toBeGreaterThanOrEqual(44);
      }
      await page.getByRole("tab", { name: "Spent" }).click();
      await expect(page.getByText(/Total spent/i).first()).toBeVisible({ timeout: 15_000 });
      // Only the selected half is mounted.
      await expect(page.getByText(/Tax reporting:/i)).toHaveCount(0);
      await journey.milestone(page, "money-spent");
    });

    await test.step("?view=spent opens Spent; the old ?view=payouts link opens Earned", async () => {
      await page.goto("/profile?tab=earnings&view=spent");
      await expect(page.getByRole("tab", { name: "Spent" })).toHaveAttribute("aria-selected", "true", { timeout: 30_000 });
      await expect(page.getByText(/Total spent/i).first()).toBeVisible({ timeout: 15_000 });
      await page.goto("/profile?tab=earnings&view=payouts");
      await assertEarnedInOrder(page);
      await assertHealthy(page, "/profile?tab=earnings&view=payouts");
    });
  } finally {
    await ctx.close();
  }
});
