import { test, expect } from "@playwright/test";

import { installSupabaseMocks, FAKE_CUSTOMER, seedAuthedSession } from "./fixtures";

/**
 * The day picker replaces a frequency dropdown, so it is wider than what it
 * replaced (seven columns) and it renders inside the post-a-job form's own
 * card. Both of those make horizontal fit the thing worth measuring rather
 * than eyeballing — a seven-column grid is exactly the shape that overflows a
 * 320-375px phone if a cell has a min-width.
 */
for (const width of [375, 1440]) {
  test(`post-job recurring picker fits @ ${width}`, async ({ page, context, baseURL }) => {
    await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
    await installSupabaseMocks(page, { user: FAKE_CUSTOMER, seed: true });
    await page.addInitScript(() => {
      try {
        localStorage.setItem("helpr_onboarding", JSON.stringify({ seen: true, completed: true }));
      } catch { /* no-storage guard */ }
    });
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/post-job");

    // Land on the form itself, not the entry choice. The entry step is a
    // deliberate landing (start fresh / repost / template / AI), so the form
    // is one tap in.
    const startFresh = page.getByRole("button", { name: /^Start fresh/ }).first();
    await startFresh.waitFor({ timeout: 20_000 });
    await startFresh.click();
    await page.getByRole("heading", { name: /logistics|where and when/i }).first()
      .waitFor({ timeout: 20_000 })
      .catch(() => undefined);

    const repeats = page.getByRole("button", { name: "Repeats", exact: true });
    await repeats.waitFor({ timeout: 20_000 });
    await repeats.click();

    const dayGroup = page.getByRole("group", { name: "Days of the week" });
    await expect(dayGroup).toBeVisible();
    await expect(dayGroup.getByRole("button")).toHaveCount(7);

    // Every day is a real tap target, including on the narrowest phone.
    for (const label of ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]) {
      const box = (await dayGroup.getByRole("button", { name: label }).boundingBox())!;
      expect(box.height, `${label} tap target @ ${width}`).toBeGreaterThanOrEqual(44);
    }

    // The week stepper is bounded at 1 — the floor is a control affordance,
    // not a submit-time rejection.
    const fewer = page.getByRole("button", { name: "One week fewer" });
    const more = page.getByRole("button", { name: "One week more" });
    await expect(more).toBeEnabled();
    // Step down until the control itself stops us. The bound is enforced by
    // the button going disabled, not by a rejected submit, so clicking past it
    // must be impossible rather than merely futile.
    for (let i = 0; i < 10 && (await fewer.isEnabled()); i++) await fewer.click();
    await expect(page.getByText(/^1 week$/)).toBeVisible();
    await expect(fewer).toBeDisabled();

    // Choosing days with no start date yet must NOT read "0 visits". The
    // series starts on the job's own date, so with no date there is nothing to
    // count, and "0 visits" reads as "your schedule is broken" when the real
    // answer is "we need the date first". The populated count itself is
    // covered by recurringSchedule.test.ts, which can exercise every shape
    // without driving a calendar popover.
    for (const label of ["Mon", "Wed", "Fri"]) {
      await dayGroup.getByRole("button", { name: label }).click();
    }
    await expect(page.getByText("0 visits")).toHaveCount(0);
    await expect(page.getByText(/Choose the date this starts/)).toBeVisible();
    // Let the chip transition settle before measuring — `transition-all` means
    // the last-clicked day is still mid-fade the instant the click resolves,
    // and a half-faded chip is not what a user ever sees.
    await page.waitForTimeout(400);
    // All three chosen days must render identically. A chip that reads
    // "selected" only because it still has focus is not a selection signal.
    const chosen = await dayGroup.locator('button[aria-pressed="true"]').evaluateAll(
      (els) => els.map((el) => getComputedStyle(el).backgroundColor),
    );
    expect(chosen, `three days chosen @ ${width}`).toHaveLength(3);
    expect(new Set(chosen).size, `chosen days render one fill, got ${chosen.join(" | ")}`).toBe(1);
    await page.screenshot({ path: `/tmp/recurring-picked-${width}.png`, fullPage: false });

    const fit = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(fit.scrollWidth, `horizontal overflow @ ${width}`).toBeLessThanOrEqual(fit.clientWidth);

    await page.screenshot({ path: `/tmp/recurring-picker-${width}.png`, fullPage: false });
  });
}
