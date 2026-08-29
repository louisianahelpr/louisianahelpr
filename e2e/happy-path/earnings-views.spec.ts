import { test, expect, FAKE_HELPER, installSupabaseMocks } from "./fixtures";

// THE EARNINGS TAB SHOWS ONE THING AT A TIME.
//
// Owner, 2026-08-28: "Earnings and payout tab is also entirely too long."
// The tab had merged three former screens into one — correctly, they are one
// subject — but rendered all of it at once: on a connected, active helpr about
// 25-30 cards and four charts in a single column, grouped only by four hairline
// rules doing the work of navigation.
//
// The four latent groups are now a segmented control. This spec pins the two
// properties that matter and that a screenshot would not catch:
//
//   1. All four views exist and are reachable.
//   2. Only the SELECTED view is in the DOM — the others are not merely hidden.
//      That is the whole saving: a helpr checking their balance does not pay to
//      mount the analytics dashboard, both chart sets, or the full job ledger.

/** Text unique to each view, present even on an empty account. */
const MARKERS: Record<string, RegExp> = {
  Money: /in progress/i,
  History: /Earning history/i,
  Insights: /take-home/i,
  Payouts: /Tax reporting:/i,
};

test("earnings tab renders one view at a time", async ({ helperPage: page }) => {
  await installSupabaseMocks(page, { user: FAKE_HELPER, rules: [] });
  // The onboarding tour renders a modal that swallows taps.
  await page.addInitScript(() => {
    try {
      localStorage.setItem("helpr_onboarding", JSON.stringify({ seen: true, completed: true }));
    } catch { /* no-storage guard */ }
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/profile?tab=earnings");

  const tabs = page.getByRole("tab");
  await tabs.first().waitFor({ timeout: 20_000 });
  await expect(tabs).toHaveCount(4);
  expect(await tabs.allInnerTexts()).toEqual(["Money", "History", "Insights", "Payouts"]);

  // Opens on Money — the wallet is what a helpr comes here for.
  await expect(page.getByRole("tab", { name: "Money" })).toHaveAttribute("aria-selected", "true");

  // Every tab is a full 44px HIG tap target. A segmented control is often
  // drawn at ~36px, and this one briefly was — by overriding the bare
  // `button { min-height: 44px }` in index.css to get there. That override
  // came out: the 2026-08-28 a11y sweep raised Legal's search buttons,
  // ChatComposer's cancel-reply and SavedSearches' notify/delete from 24-32px
  // to min-44px, and a brand-new control shipping under that bar the same week
  // would just be the next thing on the list.
  const boxes = await page.evaluate(() =>
    [...document.querySelectorAll('[role="tab"]')].map((b) => {
      const r = b.getBoundingClientRect();
      return { text: (b.textContent || "").trim(), height: r.height };
    }),
  );
  for (const b of boxes) {
    expect(b.height, `"${b.text}" tap target is under the 44px minimum`).toBeGreaterThanOrEqual(44);
  }

  for (const name of Object.keys(MARKERS)) {
    await page.getByRole("tab", { name }).click();
    // The heavier views mount lazily (analytics dashboard, payout settings).
    await expect(page.getByRole("tab", { name })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText(MARKERS[name]).first()).toBeVisible({ timeout: 10_000 });

    // …and every OTHER view's marker is gone from the document entirely.
    for (const other of Object.keys(MARKERS)) {
      if (other === name) continue;
      await expect(
        page.getByText(MARKERS[other]),
        `${other} content is still mounted while ${name} is selected`,
      ).toHaveCount(0);
    }
  }
});
