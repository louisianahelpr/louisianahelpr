/**
 * Open the Card fields on Stripe's hosted Checkout page — the ONE place that
 * does it (fundedOpenJob, prod-lifecycle, journeys fixtures, the canary and
 * payWithTestCard all go through here).
 *
 * Stripe has rendered the payment-method picker FOUR ways, and this helper
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
 *  4. Saved-card summary (e2e-journeys 41585440777): Card selected, fields folded
 *     behind "Pay with Visa •••• 4242" and a "Change" button (STRIPE_SAVED_INFO_CHANGE).
 *  5. EMBEDDED FORM (Stripe's "checkout_guacamole" Checkout, first red 2026-11-13:
 *     e2e-journeys 43430382667, a11y-webkit-prod 43470000763). The whole payment
 *     form is drawn INSIDE an iframe, `iframe[title="Secure embedded form frame"]`
 *     (js.stripe.com elements-inner-habanero, componentName=paymentForm). The
 *     page itself then has no button, radio or card field at all, so every
 *     driver read "#cardNumber x0, role=radio x0, buttons []" on a fully drawn
 *     form. Inside the frame the markup is the Payment Element's: Card is a
 *     `div[role=button]` named "Card", the billing ids are `billingAddress-*`,
 *     and Pay/Save is data-testid `payment-form-submit-button`. Every locator
 *     here is therefore taken from `stripeForm(page)`: the page on layouts 1-4,
 *     a frameLocator on layout 5. Drivers never build a Stripe field locator
 *     themselves (fillStripeCardFields, clickStripeSubmit).
 *
 * When Stripe changes the picker a sixth way, the failure says so and lists
 * the buttons the page DID render (stripeLayoutReport), instead of a bare
 * "element(s) not found" on a locator nobody can read.
 *
 * Guard: src/test/stripeCheckoutCardOpener.test.ts.
 */
import type { Page } from "@playwright/test";
import { answerStripeReturn } from "./stripeReturn";
import {
  fillStripeCardFields,
  openCardFields,
  pressStripePay,
  untickStripeLink,
  waitForStripePaymentMethods,
} from "./stripeCheckoutForm.mjs";

// Q?embedmjs: the locator logic lives in ./stripeCheckoutForm.mjs (plain JS, so the standalone `node` scripts drive
// the same code); this module re-exports it for the Playwright drivers and adds the stripeReturn-backed payWithTestCard.
export {
  STRIPE_CARD_FIELD,
  STRIPE_CARD_METHOD_BUTTON,
  STRIPE_CARD_METHOD_ITEM,
  STRIPE_EMBEDDED_FORM_FRAME,
  STRIPE_SAVED_INFO_CHANGE,
  clickStripeSubmit,
  fillStripeCardFields,
  openCardFields,
  pressStripePay,
  stripeForm,
  stripeLayoutReport,
  stripePaymentMethodControl,
  untickStripeLink,
  waitForStripeFormDrawn,
  waitForStripePaymentMethods,
} from "./stripeCheckoutForm.mjs";
export type { StripeFormRoot, StripeTestCard } from "./stripeCheckoutForm.mjs";

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
  // Q1255: Stripe's return goes to create-payment's APP_URL, the DEPLOYED
  // site; it is answered locally and never loaded from Vercel.
  const stripeReturn = await answerStripeReturn(page);
  try {
    await submitTestCard(page, checkoutUrl);
  } finally {
    await stripeReturn.stop();
  }
}

async function submitTestCard(page: Page, checkoutUrl: string): Promise<void> {
  await page.goto(checkoutUrl, { waitUntil: "domcontentloaded" });
  await waitForStripePaymentMethods(page);
  await openCardFields(page);
  await fillStripeCardFields(page, {
    number: "4242 4242 4242 4242",
    expiry: "12 / 34",
    cvc: "123",
    name: "Gift Card Journey Test",
    line1: "100 Audit Way",
    city: "Baton Rouge",
    zip: "70801",
  });
  await untickStripeLink(page);
  await pressStripePay(page);
  await page.waitForURL((url) => url.hostname !== STRIPE_CHECKOUT_HOST, { timeout: 120_000 }).catch(async (err) => {
    const complaints = await page
      .locator('[role="alert"], .FieldError, [class*="Error"]')
      .allInnerTexts()
      .catch(() => [] as string[]);
    const unique = [...new Set(complaints.map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean))];
    throw new Error(`Stripe Checkout did not submit (${String(err).slice(0, 80)}): ${unique.join(" | ") || "no inline error text"}`);
  });
}
