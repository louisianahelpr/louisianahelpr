/**
 * Open the Card fields on Stripe's hosted Checkout page — the ONE place that
 * does it (fundedOpenJob, prod-lifecycle, journeys fixtures all call this).
 *
 * Card is one option in a collapsed accordion, opened by a forced click on the
 * first radio (Stripe's own item button sits on top of the text). That click
 * can land before Stripe's page has wired its handlers: prod-audit 35999386803
 * and 35983716673 each sat 30s on `#cardNumber` with the Card radio visibly
 * unselected, which took the whole messy-input sweep down with the fixture.
 * So the click is repeated until the fields open — selecting a payment method
 * submits nothing, so a second click is not a second payment.
 *
 * With a single payment method there is no accordion and no radio; the fields
 * are already open and nothing is clicked.
 *
 * Guard: src/test/stripeCheckoutCardOpener.test.ts.
 */
import type { Locator, Page } from "@playwright/test";

export async function openCardFields(page: Page, attempts = 3): Promise<Locator> {
  const card = page.locator("#cardNumber");
  const radio = page.getByRole("radio").first();
  for (let i = 0; i < attempts; i++) {
    if (await card.isVisible().catch(() => false)) return card;
    await radio.click({ force: true }).catch(() => undefined);
    await card.waitFor({ state: "visible", timeout: 10_000 }).catch(() => undefined);
  }
  await card.waitFor({ state: "visible", timeout: 10_000 });
  return card;
}
