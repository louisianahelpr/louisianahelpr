// /business/billing renders THREE FABRICATED invoices — INV-2026-061 with a
// $1,524 "outstanding" balance plus two paid ones. Nothing about them is real.
// Until 2026-08-17 the only place that said so was inside the downloaded .txt,
// so the page itself asserted a debt the business owner does not owe. That is
// the same App Store Guideline 2.1 placeholder-content shape that got the
// Contracts / Reports / API pages pulled on 2026-08-10, except on a PAYMENTS
// screen — the worst place to be ambiguous.
//
// The owner's call was to LABEL the fixture, not remove it. This spec pins
// that labelling so it cannot be quietly refactored away while the fake
// numbers stay: if someone deletes the banner or the row pills, this fails.
// (When these are wired to real Stripe invoices, delete this spec WITH the
// fixture — not before.)
//
// Run:
//   PLAYWRIGHT_WEB_SERVER=1 npx playwright test --project=happy-path \
//     business-billing-sample-labels
// Kill anything on :4173 first — playwright.config.ts sets
// reuseExistingServer: !CI, so a stale preview silently serves an old dist/.

import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { businessRules } from "./auditRoutes";
import { test, expect, FAKE_CUSTOMER, installSupabaseMocks, seedAuthedSession } from "./fixtures";

const SHOT_DIR = "/tmp/ui-review";

test.describe("/business/billing — sample invoices are labelled on the page", () => {
  test("banner, per-row pills and section headings all say sample", async ({
    page,
    context,
    baseURL,
  }) => {
    mkdirSync(SHOT_DIR, { recursive: true });
    // FAKE_CUSTOMER owns the seeded business; Billing hides everything behind
    // `business.is_owner`, so the non-owner branch would render a one-line
    // notice and none of the invoice UI.
    await seedAuthedSession(context, FAKE_CUSTOMER, baseURL!);
    await installSupabaseMocks(page, {
      user: FAKE_CUSTOMER,
      rules: businessRules("verified"),
    });

    await page.goto("/business/billing");
    // The fabricated invoice number is the thing a reviewer would read as
    // real — wait on it, so a green run can never mean "nothing rendered".
    await expect(page.getByText("INV-2026-061")).toBeVisible();

    // 1. The banner: unmissable, above both lists, and it says the money is
    //    not owed in as many words.
    const banner = page.getByRole("note", { name: "Sample data notice" });
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("Sample data — these are not real invoices");
    await expect(banner).toContainText("You do not owe any of it");

    // 2. Every invoice row carries its own marker, so the label survives
    //    scrolling past the banner. 3 invoices + 1 per section heading = 5.
    await expect(page.getByTestId("sample-tag")).toHaveCount(5);

    // 3. The headings and counts must not assert a real balance. The count
    //    chip used to read "1 open" next to a $1,524 figure.
    await expect(page.getByRole("heading", { name: /Outstanding invoices \(sample\)/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Payment history \(sample\)/ })).toBeVisible();
    // exact: the row wrapper "INV-2026-061 Sample" also contains "1 Sample".
    await expect(page.getByText("1 sample", { exact: true })).toBeVisible();
    await expect(page.getByText("2 sample", { exact: true })).toBeVisible();
    await expect(page.getByText(/\d+ open$/)).toHaveCount(0);
    await expect(page.getByText(/\d+ paid$/)).toHaveCount(0);

    // 4. The download CTA names the file honestly too.
    await expect(
      page.getByRole("button", { name: "Download sample invoice INV-2026-061" }),
    ).toBeVisible();

    // 5. The page still fits 375 with no horizontal overflow (CLAUDE.md).
    const overflow = await page.evaluate(() => {
      const d = document.documentElement;
      return { scrollWidth: d.scrollWidth, clientWidth: d.clientWidth };
    });
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);

    // The labelling is only labelling if it is legible. White on `bg-warning`
    // was 3.24:1 — this is the check that caught it and keeps it caught.
    const axe = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
    const contrast = axe.violations.flatMap((v) =>
      v.nodes.map((n) => `${v.id}: ${n.target.join(" ")} — ${n.failureSummary?.split("\n")[1]?.trim() ?? ""}`),
    );
    expect(contrast).toEqual([]);

    await page.screenshot({
      path: `${SHOT_DIR}/business-billing-sample-labels-375.png`,
      fullPage: true,
    });
  });

  // CLAUDE.md requires measured fit proof at BOTH breakpoints for any page
  // touched — 375 above, 1440 here.
  //
  // NOTE on which rail this is: /business/* is NOT in AUTH_PREFIXES
  // (src/lib/desktopNavRoutes.ts), so <html> gets no `desktop-rail` class and
  // the global `#root` inset never applies. The ~248px column on the left at
  // 1440 is BusinessLayout's OWN in-page nav (Team / Billing / Exports /
  // Onboarding), measured at html.className === "web-desktop no-bottom-nav".
  // Either way the requirement is the same and is what this asserts.
  test("fits 1440 — no overflow, and the banner is flush with the content column", async ({
    page,
    context,
    baseURL,
  }) => {
    mkdirSync(SHOT_DIR, { recursive: true });
    await seedAuthedSession(context, FAKE_CUSTOMER, baseURL!);
    await installSupabaseMocks(page, {
      user: FAKE_CUSTOMER,
      rules: businessRules("verified"),
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/business/billing");
    await expect(page.getByText("INV-2026-061")).toBeVisible();
    // The labelling must survive the breakpoint, not just exist at 375.
    await expect(page.getByRole("note", { name: "Sample data notice" })).toBeVisible();
    await expect(page.getByTestId("sample-tag")).toHaveCount(5);

    // Measured, not eyeballed. The key statement about THIS change is (c):
    // the banner I added lines up exactly with the content column the page
    // already had, so it introduces no gutter and no new inset.
    const fit = await page.evaluate(() => {
      const d = document.documentElement;
      const vw = d.clientWidth;
      const tooWide: string[] = [];
      for (const el of Array.from(document.querySelectorAll("body *"))) {
        if (el.getBoundingClientRect().width > vw + 1) {
          tooWide.push(`${el.tagName}.${String(el.className).slice(0, 60)}`);
        }
      }
      const note = document.querySelector('[role="note"]')!;
      const banner = note.getBoundingClientRect();
      // The billing-mode Card that already existed, immediately above the
      // banner — the reference for "the page's content column".
      const sibling = note.previousElementSibling!.getBoundingClientRect();
      return {
        scrollWidth: d.scrollWidth,
        clientWidth: vw,
        tooWide: tooWide.slice(0, 5),
        bannerLeft: banner.left,
        bannerRight: banner.right,
        siblingLeft: sibling.left,
        siblingRight: sibling.right,
      };
    });

    // (a) zero horizontal overflow at 1440
    expect(fit.scrollWidth).toBeLessThanOrEqual(fit.clientWidth);
    // (b) nothing wider than the viewport
    expect(fit.tooWide).toEqual([]);
    // (c) the new banner is flush with the pre-existing content column — the
    //     assertion that this change added no dead gutter of its own.
    expect(fit.bannerLeft).toBeCloseTo(fit.siblingLeft, 0);
    expect(fit.bannerRight).toBeCloseTo(fit.siblingRight, 0);

    await page.screenshot({
      path: `${SHOT_DIR}/business-billing-sample-labels-1440.png`,
      fullPage: true,
    });
  });
});
