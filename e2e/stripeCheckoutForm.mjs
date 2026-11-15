/**
 * Stripe Checkout's payment form, driven on every layout Stripe draws: the ONE place that builds a Stripe field,
 * method or submit locator. The layouts (1-5, the embedded-iframe form included) and why each step exists are
 * written up in e2e/stripeCheckoutCard.ts, which re-exports everything here for the Playwright drivers.
 *
 * Plain JS on purpose (Q?embedmjs): the standalone `node` scripts that pay a TEST-mode Checkout Session
 * (scripts/probes/mint-funded-seed-jobs.prod.mjs, scripts/e2e/declutterPayoutProof.mjs, scripts/stripe-tax-probe.mjs)
 * run under plain `node` with no TypeScript type stripping, so they cannot import the .ts. Before this file each kept its own copy of the
 * page-level selectors (#cardNumber, hosted-payment-submit-button, ...), and every copy broke on Stripe's embedded
 * form, where the page itself holds no payment control. Types: ./stripeCheckoutForm.d.mts.
 *
 * Guards: src/test/stripeEmbeddedCheckoutForm.test.ts, src/test/stripeCheckoutCardOpener.test.ts.
 */

/** Stripe's card-number input, present once the Card method is open. */
export const STRIPE_CARD_FIELD = "#cardNumber";
/** Layout 3: the Card item's own button in the button accordion. */
export const STRIPE_CARD_METHOD_BUTTON = "card-accordion-item-button";
/** Layout 3: the Card item that holds that button. */
export const STRIPE_CARD_METHOD_ITEM = "card-accordion-item";
/**
 * Layout 4 (e2e-journeys 41585440777, chromium, cs_test_): Card is already selected but its fields are folded into a
 * read-only summary, "Pay with Visa •••• 4242", whose only control is a "Change" link-button
 * (`div.SavedInfoSummary … button.ReadOnlyFormField-actionButton`). No #cardNumber, no radio, no accordion button:
 * the page's buttons were exactly [Change | hosted-payment-submit-button]. "Change" unfolds the editable form;
 * pressing it submits nothing.
 */
export const STRIPE_SAVED_INFO_CHANGE = ".SavedInfoSummary button.ReadOnlyFormField-actionButton";

/**
 * Layout 5: the iframe Stripe's embedded Checkout draws the whole payment form in (trace of a11y-webkit-prod
 * 43470000763: name __privateStripeFrameNNNN changes per load, the title is the stable handle).
 */
export const STRIPE_EMBEDDED_FORM_FRAME = 'iframe[title="Secure embedded form frame"]';

/**
 * The form's fields, by layout. Layout 5 comes in two variants, and both were measured:
 *  5a (trace of a11y-webkit-prod 43470000763, 2026-11-13): billing in a separate "Billing details" block,
 *     ids `billingAddress-nameInput`, `billingAddress-addressLine1Input`, ...
 *  5b (card-hold run 2026-11-15, ~/.lh-shots/builder4d-1115/run1.log): billing inside the Card section ("Name on
 *     card", "Billing information"), ids `payment-nameInput`, `payment-localityInput`, ..., a REQUIRED State select
 *     (`payment-administrativeAreaInput`) and a pre-ticked Link opt-in (`payment-linkOptInInput`).
 * Ids differ, `name` attributes do not (name, addressLine1, locality, postalCode, administrativeArea), so layout 5
 * is keyed on those. Card number/expiry/cvc are `payment-numberInput` etc., name=number/expiry/cvc, in both.
 */
const FIELDS = {
  page: {
    card: STRIPE_CARD_FIELD,
    expiry: "#cardExpiry",
    cvc: "#cardCvc",
    name: "#billingName",
    line1: "#billingAddressLine1",
    locality: "#billingLocality",
    postal: "#billingPostalCode",
  },
  embedded: {
    card: 'input[name="number"]',
    expiry: 'input[name="expiry"]',
    cvc: 'input[name="cvc"]',
    name: 'input[name="name"]',
    line1: 'input[name="addressLine1"]',
    locality: 'input[name="locality"]',
    postal: 'input[name="postalCode"]',
  },
};

/** Layout 5b's required State select; the test address is in Baton Rouge. */
const EMBEDDED_STATE_SELECT = 'select[name="administrativeArea"]';
/** Layouts 1-4's State select (scripts/stripe-tax-probe.mjs needed it for its Lafayette address). */
const PAGE_STATE_SELECT = "#billingAdministrativeArea";
/** The hosted page's receipt email field. */
const STRIPE_EMAIL_FIELD = "#email";

/** "Save my information with Link": #enableStripePass on layouts 1-4, name=linkOptIn inside layout 5b. */
const STRIPE_LINK_OPT_IN = '#enableStripePass, input[name="linkOptIn"]';

/**
 * The root every Stripe locator is taken from. The embedded form frame wins whenever the page holds one: on that
 * layout the page's own DOM has no payment control at all.
 */
export async function stripeForm(page) {
  const frames = await page.locator(STRIPE_EMBEDDED_FORM_FRAME).count().catch(() => 0);
  if (frames > 0) return { root: page.frameLocator(STRIPE_EMBEDDED_FORM_FRAME).first(), embedded: true };
  return { root: page, embedded: false };
}

/** Layout 5's controls: the open card field, the Card accordion button, or Pay/Save. */
function embeddedControl(root) {
  return root
    .locator(FIELDS.embedded.card)
    .or(root.getByRole("button", { name: /^Card/ }))
    .or(root.getByTestId("payment-form-submit-button"));
}

/**
 * Whatever Stripe renders first that this helper can drive: the open card
 * fields, the Card method button, or a payment-method radio. Wait on THIS,
 * never on `getByRole("radio")` alone.
 */
export function stripePaymentMethodControl(page) {
  // The item container too: the button is an overlay click area, and a
  // zero-size overlay would read as hidden while the item is plainly drawn.
  // Layout 5: the embedded form frame itself (its controls live in another
  // frame, which a page locator cannot .or() with); openCardFields waits on them.
  return page
    .locator(STRIPE_CARD_FIELD)
    .or(page.getByTestId(STRIPE_CARD_METHOD_BUTTON))
    .or(page.getByTestId(STRIPE_CARD_METHOD_ITEM))
    .or(page.getByRole("radio"))
    .or(page.locator(STRIPE_EMBEDDED_FORM_FRAME))
    .first();
}

/**
 * What Stripe's payment form looks like right now, for a failure message:
 * the buttons (test id / aria-label / text) and whether any radio or card
 * field exists. Read-only; never clicks.
 */
export async function stripeLayoutReport(page) {
  const buttons = await page
    .locator("button")
    .evaluateAll((els) =>
      els
        .map((b) => b.getAttribute("data-testid") || b.getAttribute("aria-label") || (b.textContent ?? "").trim())
        .filter(Boolean)
        .slice(0, 20),
    )
    .catch(() => []);
  const radios = await page.getByRole("radio").count().catch(() => -1);
  const fields = await page.locator(STRIPE_CARD_FIELD).count().catch(() => -1);
  let embedded = "";
  if ((await page.locator(STRIPE_EMBEDDED_FORM_FRAME).count().catch(() => 0)) > 0) {
    const inner = await page
      .frameLocator(STRIPE_EMBEDDED_FORM_FRAME)
      .first()
      .locator("button, [role=button], input")
      .evaluateAll((els) =>
        els
          .map((e) => {
            const id = e.getAttribute("data-testid") || e.id || e.getAttribute("name") || e.getAttribute("aria-label") || (e.textContent ?? "").trim().slice(0, 24);
            return `${e.tagName.toLowerCase()}:${id}`;
          })
          .filter((t) => !t.endsWith(":"))
          .slice(0, 30),
      )
      .catch((err) => [`unreadable: ${String(err).split("\n")[0].slice(0, 80)}`]);
    embedded = ` Embedded form frame (${STRIPE_EMBEDDED_FORM_FRAME}) holds [${inner.join(" | ")}].`;
  }
  return (
    `Stripe Checkout's payment-method picker is not one e2e/stripeCheckoutCard.ts knows ` +
    `(open ${STRIPE_CARD_FIELD}, button[data-testid=${STRIPE_CARD_METHOD_BUTTON}], role=radio, or ${STRIPE_SAVED_INFO_CHANGE}). ` +
    `On ${page.url().slice(0, 60)}: ${STRIPE_CARD_FIELD} x${fields}, role=radio x${radios}, ` +
    `buttons [${buttons.join(" | ")}].${embedded} Stripe changed its DOM: teach the helper the new layout.`
  );
}

/**
 * Wait until Stripe renders a payment-method control this helper can drive.
 * Throws stripeLayoutReport on timeout, naming what the page rendered instead.
 */
export async function waitForStripePaymentMethods(page, timeout = 60_000) {
  const waited = await stripePaymentMethodControl(page)
    .waitFor({ state: "visible", timeout })
    .then(() => null, (err) => String(err).split("\n")[0].slice(0, 120));
  if (waited !== null) throw new Error(`${await stripeLayoutReport(page)} (${waited})`);
  const { root, embedded } = await stripeForm(page);
  if (!embedded) return;
  const inner = await embeddedControl(root)
    .first()
    .waitFor({ state: "visible", timeout })
    .then(() => null, (err) => String(err).split("\n")[0].slice(0, 120));
  if (inner !== null) throw new Error(`${await stripeLayoutReport(page)} (embedded form: ${inner})`);
}

/**
 * The standalone scripts' wait (Q2238): poll until ANY one control is visible, never `a.or(b).first().waitFor()`.
 * `.first()` is the first match in DOM order, and with the Card item already open that is the
 * card-accordion-item-button OVERLAY, a zero-size click area that never reads visible (Declutter payout proof run
 * 39342447913 sat 60 s on it with the card fields drawn). Layout 5 counts once a control INSIDE the embedded form
 * frame is visible. Throws stripeLayoutReport on timeout.
 */
export async function waitForStripeFormDrawn(page, timeout = 60_000, every = 500) {
  const pageControls = [
    page.locator(STRIPE_CARD_FIELD),
    page.getByTestId(STRIPE_CARD_METHOD_ITEM),
    page.getByTestId(STRIPE_CARD_METHOD_BUTTON),
    page.getByRole("radio"),
    page.locator(STRIPE_SAVED_INFO_CHANGE),
    page.getByTestId("hosted-payment-submit-button"),
  ];
  const until = Date.now() + timeout;
  for (;;) {
    const { root, embedded } = await stripeForm(page);
    const controls = embedded
      ? [root.locator(FIELDS.embedded.card), root.getByRole("button", { name: /^Card/ }), root.getByTestId("payment-form-submit-button")]
      : pageControls;
    for (const l of controls) if (await l.first().isVisible().catch(() => false)) return;
    if (Date.now() > until) throw new Error(`${await stripeLayoutReport(page)} (nothing drawn in ${timeout} ms)`);
    await new Promise((r) => setTimeout(r, every));
  }
}

export async function openCardFields(page, attempts = 3) {
  const form = await stripeForm(page);
  if (form.embedded) return openEmbeddedCardFields(page, form.root, attempts);
  const card = page.locator(STRIPE_CARD_FIELD);
  const cardButton = page.getByTestId(STRIPE_CARD_METHOD_BUTTON);
  const cardItem = page.getByTestId(STRIPE_CARD_METHOD_ITEM);
  const radio = page.getByRole("radio").first();
  const savedChange = page.locator(STRIPE_SAVED_INFO_CHANGE);
  for (let i = 0; i < attempts; i++) {
    if (await card.isVisible().catch(() => false)) return card;
    // Layout 4: unfold the saved-card summary first; the next pass finds whatever it unfolded (the fields, or an
    // accordion this loop already drives).
    if ((await savedChange.count().catch(() => 0)) > 0) {
      await savedChange.first().click().catch(() => undefined);
      await card.waitFor({ state: "visible", timeout: 10_000 }).catch(() => undefined);
      continue;
    }
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

/**
 * Layout 5: press the "Card" accordion button inside the embedded form frame until the card number field shows.
 * Choosing a method submits nothing, so a repeated press is not a second payment.
 */
async function openEmbeddedCardFields(page, root, attempts) {
  const card = root.locator(FIELDS.embedded.card).first();
  const cardMethod = root.getByRole("button", { name: /^Card/ }).first();
  await embeddedControl(root).first().waitFor({ state: "visible", timeout: 30_000 }).catch(() => undefined);
  for (let press = 0; press < attempts; press++) {
    if (await card.isVisible().catch(() => false)) return card;
    await cardMethod.click().catch(() => undefined);
    await card.waitFor({ state: "visible", timeout: 10_000 }).catch(() => undefined);
  }
  if (await card.isVisible().catch(() => false)) return card;
  throw new Error(`card fields never opened in the embedded form after ${attempts} presses of Card. ${await stripeLayoutReport(page)}`);
}

/**
 * Type the card and EVERY billing field Stripe renders (which ones appear depends on the account's address setting;
 * a blank required one makes Pay a silent no-op), on whichever layout the page is. Call openCardFields first.
 * Line 1 opens Google's address autocomplete, which covers the fields below it, so each fill ends with Escape.
 */
export async function fillStripeCardFields(page, card) {
  const { root, embedded } = await stripeForm(page);
  const f = embedded ? FIELDS.embedded : FIELDS.page;
  await root.locator(f.card).first().fill(card.number);
  await root.locator(f.expiry).first().fill(card.expiry);
  await root.locator(f.cvc).first().fill(card.cvc);
  for (const [sel, value] of [
    [f.name, card.name],
    [f.line1, card.line1],
    [f.locality, card.city],
    [f.postal, card.zip],
  ]) {
    const field = root.locator(sel).first();
    if ((await field.count()) && (await field.isVisible().catch(() => false))) {
      // An optional billing field that will not take a value is reported by
      // Stripe inline on submit; the caller's webhook poll is the verdict.
      await field.fill(value).catch(() => undefined);
      await page.keyboard.press("Escape").catch(() => undefined);
    }
  }
  // 5b refuses the press with "Enter your address" until a State is chosen; the hosted page's State select
  // (#billingAdministrativeArea, scripts/stripe-tax-probe.mjs's Lafayette address) is the same rule on layouts 1-4.
  const state = root.locator(embedded ? EMBEDDED_STATE_SELECT : PAGE_STATE_SELECT).first();
  if ((await state.count()) && (await state.isVisible().catch(() => false))) {
    await state.selectOption("LA").catch(() => state.selectOption({ label: "Louisiana" })).catch(() => undefined);
  }
  // The receipt email sits on the hosted page (#email), outside the payment form; only a visible, editable one is
  // typed (a signed-in customer's is read-only). Where the embedded layout puts it has not been measured.
  if (card.email) {
    const email = page.locator(STRIPE_EMAIL_FIELD).first();
    if ((await email.count()) && (await email.isVisible().catch(() => false)) && (await email.isEditable().catch(() => false))) {
      await email.fill(card.email).catch(() => undefined);
      await page.keyboard.press("Escape").catch(() => undefined);
    }
  }
}

/**
 * Press Stripe's Pay (or, for a card hold, Save) button on whichever layout the page is. Selecting nothing else:
 * the caller decides when a press counts (pressStripePay waits for the /confirm request).
 */
export async function clickStripeSubmit(page) {
  const { root, embedded } = await stripeForm(page);
  await root.getByTestId(embedded ? "payment-form-submit-button" : "hosted-payment-submit-button").click();
}

const STRIPE_CHECKOUT_HOST = "checkout.stripe.com";

/** The hosted page's submit: a POST to /v1/payment_pages/<cs>/confirm. */
const STRIPE_CONFIRM_REQUEST = /api\.stripe\.com\/v1\/payment_pages\/[^/?]+\/confirm/;

/**
 * Untick "Save my information with Link" right before a Pay press. Stripe draws
 * it, ticked, with a REQUIRED phone number, some time AFTER the address is
 * filled; left ticked, Pay validates the phone, sends nothing and shows no
 * alert. Unticking once before Pay lost that race: no test job funded after
 * 2026-10-28 01:33Z (e2e-journeys 41047645233, measured with a network probe
 * 2026-10-30: no /v1/payment_methods POST, box ticked, phone field red). So
 * every press waits for the box to have had time to appear and asks again.
 */
export async function untickStripeLink(page) {
  await page.waitForTimeout(2_000);
  const { root } = await stripeForm(page);
  const link = root.locator(STRIPE_LINK_OPT_IN).first();
  if ((await link.count()) && (await link.isChecked().catch(() => false))) {
    await link.uncheck({ force: true }).catch(() => undefined);
  }
}

/**
 * Press Pay until Stripe actually submits. Line 1 opens Google's address
 * autocomplete; when Escape does not close it, the FIRST click on Pay only
 * dismisses that dropdown. Scheduled e2e-real-backend run 39039797666
 * (2026-10-17) sat 120s on a fully filled page with Pay focused and the
 * Address combobox still `expanded`, and its trace holds no /confirm request
 * at all (journeys/fixtures.ts and prod-audit/fundedOpenJob.ts had this
 * guard; the money loop and gift card journey did not). So the proof a press took is the /confirm request itself; with none
 * within 8s the button is pressed again (at most 3 presses). A press that did
 * submit is never repeated, so this cannot pay twice.
 */
export async function pressStripePay(page, presses = 3) {
  for (let i = 1; i <= presses; i++) {
    await untickStripeLink(page);
    const confirm = page.waitForRequest(STRIPE_CONFIRM_REQUEST, { timeout: 8_000 }).then(
      () => true,
      () => false,
    );
    // Blur first, as journeys/fixtures.ts and prod-audit/fundedOpenJob.ts
    // already do: a click on the "Pay <merchant>" heading closes the dropdown.
    await page.getByRole("heading", { name: /^Pay / }).first().click().catch(() => undefined);
    await clickStripeSubmit(page);
    if (await confirm) return;
    if (new URL(page.url()).hostname !== STRIPE_CHECKOUT_HOST) return; // left Stripe: the press went through
    console.log(`::warning title=Stripe Pay did not submit::press ${i}/${presses} sent no /confirm request; pressing again`);
  }
}
