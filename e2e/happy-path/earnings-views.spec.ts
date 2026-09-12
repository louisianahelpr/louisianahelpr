import { test, expect, FAKE_HELPER, installSupabaseMocks } from "./fixtures";

// THE EARNINGS TAB SHOWS ONE THING AT A TIME.
//
// Owner, 2026-08-28: "Earnings and payout tab is also entirely too long."
// The tab had merged three former screens into one — correctly, they are one
// subject — but rendered all of it at once: on a connected, active helpr about
// 25-30 cards and four charts in a single column, grouped only by four hairline
// rules doing the work of navigation.
//
// The latent groups are now a segmented control. It carried FOUR segments
// until 2026-09-11, when the owner asked for the page to be better organised
// and chose two: Earnings (what I made — the former Money, History and
// Insights, which were three slices of one question over the same jobs) and
// Payouts (where the money is and how it reaches me — the wallet, both deposit
// ledgers, and the payout ACCOUNT, which until then was a lazy PaymentTab
// mounted in the middle of the reader's own earnings figures).
//
// This spec pins the two properties that matter and that a screenshot would
// not catch:
//
//   1. Both views exist and are reachable.
//   2. Only the SELECTED view is in the DOM — the others are not merely hidden.
//      That is the whole saving: a helpr checking their balance does not pay to
//      mount the analytics dashboard, both chart sets, or the full job ledger.

/** Text unique to each view, present even on an empty account. */
const MARKERS: Record<string, RegExp> = {
  // Was /in progress/i. That text came from the Money view's 3-up tile row
  // ("Active · N · in progress"), which rendered unconditionally — including
  // the "0 · in progress" tile this suite's empty helper account produced.
  // ad315368 replaced that row with <EarningsSummaryCard />, whose equivalent
  // band is `{!loading && inProgressCount > 0 && …}` — correct product
  // behaviour (an empty account should not be told it has zero jobs running),
  // and it means the old marker is absent on exactly the account this spec
  // uses. The marker requirement above ("present even on an empty account")
  // stopped being true of the string, not of the view.
  //
  // `earnedRangeLabel("lifetime")` is the replacement: EarningsTab opens on the
  // lifetime range, the card prints the label under the figure whatever the
  // figure is, and the phrase exists in exactly one place in src/.
  Earnings: /total earned/i,
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
  await expect(tabs).toHaveCount(2);
  expect(await tabs.allInnerTexts()).toEqual(["Earnings", "Payouts"]);

  // Opens on Earnings — "how am I doing" is what a helpr comes here with.
  await expect(page.getByRole("tab", { name: "Earnings" })).toHaveAttribute("aria-selected", "true");

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

  // The three former segments are ONE view now — the per-job ledger and the
  // breakdown charts must be on the Earnings half, not behind a tab of their
  // own. Asserting the absorbed content directly, because "two tabs exist" is
  // equally true of a split that dropped a section on the floor.
  await page.getByRole("tab", { name: "Earnings" }).click();
  await expect(page.getByText(/Earning history/i).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/more insights with/i).first()).toBeVisible();
});

// `/profile?tab=earnings` is the link every notification and email uses, and
// `/earnings` redirects onto it. `?view=payouts` is the new, additive way for a
// payout-specific one to land on the payout half — without it, a "your payout
// arrived" push would open on the earnings summary.
test("?view=payouts opens the payouts half, and the plain deep link still opens earnings", async ({ helperPage: page }) => {
  await installSupabaseMocks(page, { user: FAKE_HELPER, rules: [] });
  await page.addInitScript(() => {
    try {
      localStorage.setItem("helpr_onboarding", JSON.stringify({ seen: true, completed: true }));
    } catch { /* no-storage guard */ }
  });
  await page.setViewportSize({ width: 375, height: 812 });

  await page.goto("/profile?tab=earnings&view=payouts");
  await page.getByRole("tab").first().waitFor({ timeout: 20_000 });
  await expect(page.getByRole("tab", { name: "Payouts" })).toHaveAttribute("aria-selected", "true");

  await page.goto("/profile?tab=earnings");
  await page.getByRole("tab").first().waitFor({ timeout: 20_000 });
  await expect(page.getByRole("tab", { name: "Earnings" })).toHaveAttribute("aria-selected", "true");
});
