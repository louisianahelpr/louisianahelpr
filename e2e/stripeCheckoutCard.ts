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

/**
 * Pay a TEST-mode hosted Checkout Session with 4242 4242 4242 4242 and wait to
 * leave Stripe. The same field-by-field fill e2e/prod-lifecycle.spec.ts does
 * inline (its comments record why each step exists: the collapsed accordion,
 * every billing field Stripe renders, the Link opt-in that silently blocks Pay),
 * shared here so a new money journey does not grow a fourth copy.
 *
 * Refuses anything that is not a `cs_test_` session: the card only exists in
 * test mode, and a live session must never reach the submit button.
 * The caller proves the charge from the database (the webhook), not from where
 * the browser lands.
 */
export async function payWithTestCard(page: Page, checkoutUrl: string): Promise<void> {
  if (!/\/cs_test_[A-Za-z0-9]+/.test(checkoutUrl)) {
    throw new Error(`refusing to pay a Checkout Session that is not test mode: ${checkoutUrl.slice(0, 80)}`);
  }
  await page.goto(checkoutUrl, { waitUntil: "domcontentloaded" });
  const cardNumber = page.locator("#cardNumber");
  await cardNumber.or(page.getByRole("radio").first()).first().waitFor({ state: "visible", timeout: 60_000 });
  await openCardFields(page);
  await cardNumber.fill("4242 4242 4242 4242");
  await page.locator("#cardExpiry").fill("12 / 34");
  await page.locator("#cardCvc").fill("123");
  for (const [id, value] of [
    ["#billingName", "Gift Card Journey Test"],
    ["#billingAddressLine1", "100 Audit Way"],
    ["#billingLocality", "Baton Rouge"],
    ["#billingPostalCode", "70801"],
  ] as const) {
    const field = page.locator(id);
    if ((await field.count()) && (await field.isVisible().catch(() => false))) {
      // An optional billing field that will not take a value is reported by
      // Stripe inline on submit; the webhook poll after this is the verdict.
      await field.fill(value).catch(() => undefined);
      await page.keyboard.press("Escape").catch(() => undefined);
    }
  }
  const linkOptIn = page.locator("#enableStripePass");
  if ((await linkOptIn.count()) && (await linkOptIn.isChecked().catch(() => false))) {
    await linkOptIn.uncheck({ force: true }).catch(() => undefined);
  }
  await page.getByTestId("hosted-payment-submit-button").click();
  await page.waitForURL((url) => !url.host.endsWith("checkout.stripe.com"), { timeout: 120_000 }).catch(async (err) => {
    const complaints = await page
      .locator('[role="alert"], .FieldError, [class*="Error"]')
      .allInnerTexts()
      .catch(() => [] as string[]);
    const unique = [...new Set(complaints.map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean))];
    throw new Error(`Stripe Checkout did not submit (${String(err).slice(0, 80)}): ${unique.join(" | ") || "no inline error text"}`);
  });
}
