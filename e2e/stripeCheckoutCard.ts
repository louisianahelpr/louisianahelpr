/**
 * Open the Card fields on Stripe's hosted Checkout page — the ONE place that
 * does it (fundedOpenJob, prod-lifecycle, journeys fixtures, the canary and
 * payWithTestCard all go through here).
 *
 * Stripe has rendered the payment-method picker THREE ways, and this helper
 * knows all of them:
 *
 *  1. ONE method: no picker at all, the card fields (`#cardNumber`) are open.
 *  2. Radio accordion (to 2026-10): Card is the first `role=radio`, opened by a
 *     forced click (Stripe's own item button sits on top of the text).
 *  3. Button accordion (Stripe Sandbox, seen 2026-10-13, e2e-real-backend
 *     38447487997 and 38384858376, issue #2940): the round "radio" is a
 *     decorative `<span aria-hidden="true" class="RadioButton--decorative">`,
 *     so there is NO role=radio anywhere, and the control is
 *     `<button data-testid="card-accordion-item-button" aria-label="Pay with card">`.
 *     Every driver waited 60s for `#cardNumber or the first radio` and died.
 *
 * The click can land before Stripe's page has wired its handlers: prod-audit
 * 35999386803 and 35983716673 each sat 30s on `#cardNumber` with the Card radio
 * visibly unselected. So the click is repeated until the fields open —
 * selecting a payment method submits nothing, so a second click is not a
 * second payment.
 *
 * When Stripe changes the picker a fourth way, the failure says so and lists
 * the buttons the page DID render (stripeLayoutReport), instead of a bare
 * "element(s) not found" on a locator nobody can read.
 *
 * Guard: src/test/stripeCheckoutCardOpener.test.ts.
 */
import type { Locator, Page } from "@playwright/test";

/** Stripe's card-number input, present once the Card method is open. */
export const STRIPE_CARD_FIELD = "#cardNumber";
/** Layout 3: the Card item's own button in the button accordion. */
export const STRIPE_CARD_METHOD_BUTTON = "card-accordion-item-button";
/** Layout 3: the Card item that holds that button. */
export const STRIPE_CARD_METHOD_ITEM = "card-accordion-item";

/**
 * Whatever Stripe renders first that this helper can drive: the open card
 * fields, the Card method button, or a payment-method radio. Wait on THIS,
 * never on `getByRole("radio")` alone.
 */
export function stripePaymentMethodControl(page: Page): Locator {
  // The item container too: the button is an overlay click area, and a
  // zero-size overlay would read as hidden while the item is plainly drawn.
  return page
    .locator(STRIPE_CARD_FIELD)
    .or(page.getByTestId(STRIPE_CARD_METHOD_BUTTON))
    .or(page.getByTestId(STRIPE_CARD_METHOD_ITEM))
    .or(page.getByRole("radio"))
    .first();
}

/**
 * What Stripe's payment form looks like right now, for a failure message:
 * the buttons (test id / aria-label / text) and whether any radio or card
 * field exists. Read-only; never clicks.
 */
export async function stripeLayoutReport(page: Page): Promise<string> {
  const buttons = await page
    .locator("button")
    .evaluateAll((els) =>
      els
        .map((b) => b.getAttribute("data-testid") || b.getAttribute("aria-label") || (b.textContent ?? "").trim())
        .filter(Boolean)
        .slice(0, 20),
    )
    .catch(() => [] as string[]);
  const radios = await page.getByRole("radio").count().catch(() => -1);
  const fields = await page.locator(STRIPE_CARD_FIELD).count().catch(() => -1);
  return (
    `Stripe Checkout's payment-method picker is not one e2e/stripeCheckoutCard.ts knows ` +
    `(open ${STRIPE_CARD_FIELD}, button[data-testid=${STRIPE_CARD_METHOD_BUTTON}], or role=radio). ` +
    `On ${page.url().slice(0, 60)}: ${STRIPE_CARD_FIELD} x${fields}, role=radio x${radios}, ` +
    `buttons [${buttons.join(" | ")}]. Stripe changed its DOM: teach the helper the new layout.`
  );
}

/**
 * Wait until Stripe renders a payment-method control this helper can drive.
 * Throws stripeLayoutReport on timeout, naming what the page rendered instead.
 */
export async function waitForStripePaymentMethods(page: Page, timeout = 60_000): Promise<void> {
  const waited = await stripePaymentMethodControl(page)
    .waitFor({ state: "visible", timeout })
    .then(() => null, (err: unknown) => String(err).split("\n")[0].slice(0, 120));
  if (waited !== null) throw new Error(`${await stripeLayoutReport(page)} (${waited})`);
}

export async function openCardFields(page: Page, attempts = 3): Promise<Locator> {
  const card = page.locator(STRIPE_CARD_FIELD);
  const cardButton = page.getByTestId(STRIPE_CARD_METHOD_BUTTON);
  const cardItem = page.getByTestId(STRIPE_CARD_METHOD_ITEM);
  const radio = page.getByRole("radio").first();
  for (let i = 0; i < attempts; i++) {
    if (await card.isVisible().catch(() => false)) return card;
    // Layout 3 first: it names the Card method exactly. Layout 2's first
    // radio is Card by position only. If the button (an overlay click area)
    // took the click and nothing opened, the next attempt clicks the item.
    if ((await cardButton.count().catch(() => 0)) > 0) {
      const target = i % 2 === 1 && (await cardItem.count().catch(() => 0)) > 0 ? cardItem : cardButton;
      await target.first().click({ force: true }).catch(() => undefined);
    } else {
      await radio.click({ force: true }).catch(() => undefined);
    }
    await card.waitFor({ state: "visible", timeout: 10_000 }).catch(() => undefined);
  }
  if (await card.isVisible().catch(() => false)) return card;
  throw new Error(`card fields never opened after ${attempts} clicks. ${await stripeLayoutReport(page)}`);
}


const STRIPE_CHECKOUT_HOST = "checkout.stripe.com";

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
  let host = "";
  try {
    host = new URL(checkoutUrl).hostname;
  } catch {
    // Not a URL at all: refused below with the same message.
  }
  // Exact host, not a suffix: "evil-checkout.stripe.com.example" must not pass.
  if (host !== STRIPE_CHECKOUT_HOST || !/\/cs_test_[A-Za-z0-9]+/.test(checkoutUrl)) {
    throw new Error(`refusing to pay a Checkout Session that is not test mode: ${checkoutUrl.slice(0, 80)}`);
  }
  await page.goto(checkoutUrl, { waitUntil: "domcontentloaded" });
  const cardNumber = page.locator(STRIPE_CARD_FIELD);
  await waitForStripePaymentMethods(page);
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
  await page.waitForURL((url) => url.hostname !== STRIPE_CHECKOUT_HOST, { timeout: 120_000 }).catch(async (err) => {
    const complaints = await page
      .locator('[role="alert"], .FieldError, [class*="Error"]')
      .allInnerTexts()
      .catch(() => [] as string[]);
    const unique = [...new Set(complaints.map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean))];
    throw new Error(`Stripe Checkout did not submit (${String(err).slice(0, 80)}): ${unique.join(" | ") || "no inline error text"}`);
  });
}
