/**
 * Stripe's embedded Checkout form (layout 5 in e2e/stripeCheckoutCard.ts) is driven INSIDE its iframe.
 *
 * First red 2026-11-13 (e2e-journeys 43430382667: the three 05-card-hold journeys, admin-refund, money-outcomes,
 * time-travel's countdown chip; a11y-webkit-prod 43470000763: the job-status fixture "accepted"): Stripe's
 * "checkout_guacamole" Checkout draws the whole payment form in `iframe[title="Secure embedded form frame"]`, so a
 * page-level locator saw "#cardNumber x0, role=radio x0, buttons []" on a fully drawn form. A second variant
 * (card-hold run 2026-11-15, ~/.lh-shots/builder4d-1115/run1.log) put billing inside the Card section with a
 * required State select and a pre-ticked Link opt-in, and refused Save with "Please provide the name on your card".
 *
 * The class: a driver that builds Stripe field locators on the PAGE breaks the moment Stripe moves the form into a
 * frame. So (1) the helper finds the frame, opens Card, fills both variants by `name`, picks the State, unticks Link
 * and presses the frame's submit, driven below against a fake page per variant; (2) no e2e driver builds a Stripe
 * field or submit locator itself: they call fillStripeCardFields / clickStripeSubmit / pressStripePay.
 */
// @mutate e2e/stripeCheckoutCard.ts |   if (frames > 0) return { root: page.frameLocator(STRIPE_EMBEDDED_FORM_FRAME).first(), embedded: true }; |   if (false) return { root: page.frameLocator(STRIPE_EMBEDDED_FORM_FRAME).first(), embedded: true };
// @mutate e2e/stripeCheckoutCard.ts |   if (embedded) { |   if (false) {
// @mutate e2e/stripeCheckoutCard.ts | embedded ? "payment-form-submit-button" : "hosted-payment-submit-button" | "hosted-payment-submit-button"
// @mutate e2e/stripeCheckoutCard.ts | const STRIPE_LINK_OPT_IN = '#enableStripePass, input[name="linkOptIn"]'; | const STRIPE_LINK_OPT_IN = "#enableStripePass";
// @mutate e2e/journeys/fixtures.ts |   await fillStripeCardFields(page, TEST_CARD); |   await page.locator("#cardNumber").fill(TEST_CARD.number);
import { describe, expect, it } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { readdirSync } from "./helpers/trackedFiles";
import { blankComments } from "./helpers/blankNonCode";
import {
  STRIPE_EMBEDDED_FORM_FRAME,
  clickStripeSubmit,
  fillStripeCardFields,
  openCardFields,
  untickStripeLink,
  waitForStripePaymentMethods,
} from "../../e2e/stripeCheckoutCard";

const ROOT = join(__dirname, "..", "..");
const HELPER = "e2e/stripeCheckoutCard.ts";

type Variant = "5a" | "5b";

/** The embedded form frame's DOM, per variant, as measured in the two traces named above. */
function fakeEmbeddedPage(variant: Variant) {
  let open = false;
  const filled: Record<string, string> = {};
  const clicks: string[] = [];
  let state = "";
  let linkChecked = variant === "5b";
  // Inputs present inside the frame once Card is open, keyed by the selector the helper must use.
  const inFrame = (sel: string): boolean => {
    if (/name="(number|expiry|cvc)"/.test(sel)) return open;
    if (/name="(name|addressLine1|locality|postalCode)"/.test(sel)) return variant === "5a" || open;
    if (sel.includes('select[name="administrativeArea"]')) return variant === "5b" && open;
    if (sel.includes('input[name="linkOptIn"]')) return variant === "5b" && open;
    return false;
  };
  const loc = (name: string, present: () => boolean, extra: Record<string, unknown> = {}) => {
    const l: Record<string, unknown> = {
      isVisible: async () => present(),
      count: async () => (present() ? 1 : 0),
      waitFor: async () => {
        if (!present()) throw new Error(`Timeout waiting for ${name}`);
      },
      fill: async (v: string) => {
        if (!present()) throw new Error(`no element for ${name}`);
        filled[name] = v;
      },
      first: () => l,
      or: (other: { isVisible(): Promise<boolean> }) =>
        loc(`${name}|or`, () => present() || (other as unknown as { _present: () => boolean })._present()),
      _present: present,
      evaluateAll: async () => [],
      ...extra,
    };
    return l;
  };
  const frame = {
    locator: (sel: string) =>
      loc(sel, () => inFrame(sel), {
        selectOption: async (v: string | { label: string }) => {
          state = typeof v === "string" ? v : v.label;
        },
        isChecked: async () => linkChecked,
        uncheck: async () => {
          linkChecked = false;
          clicks.push("uncheck-link");
        },
      }),
    getByRole: (role: string, opts?: { name?: RegExp }) =>
      loc(`role=${role}`, () => role === "button" && !!opts?.name?.test("Card"), {
        click: async () => {
          clicks.push("Card");
          open = true;
        },
      }),
    getByTestId: (id: string) =>
      loc(id, () => id === "payment-form-submit-button", {
        click: async () => {
          clicks.push(id);
        },
      }),
  };
  const page = {
    url: () => "https://checkout.stripe.com/g/pay/cs_test_fake",
    // The page itself holds no payment control: only the frame (and nothing a page-level selector can drive).
    locator: (sel: string) => loc(sel, () => sel === STRIPE_EMBEDDED_FORM_FRAME),
    getByTestId: (id: string) => loc(id, () => false),
    getByRole: (role: string) => loc(`role=${role}`, () => false),
    frameLocator: (sel: string) => {
      if (sel !== STRIPE_EMBEDDED_FORM_FRAME) throw new Error(`unexpected frame ${sel}`);
      return { first: () => frame, ...frame };
    },
    keyboard: { press: async () => undefined },
    waitForTimeout: async () => undefined,
  };
  return { page: page as unknown as Page, filled, clicks, state: () => state, linkChecked: () => linkChecked };
}

const CARD = {
  number: "4242 4242 4242 4242",
  expiry: "12 / 34",
  cvc: "123",
  name: "Guard Test",
  line1: "100 Audit Way",
  city: "Baton Rouge",
  zip: "70801",
};

describe("the embedded Checkout form is driven inside its iframe (layout 5)", () => {
  for (const variant of ["5a", "5b"] as const) {
    it(`${variant}: waits, opens Card, fills every field by name, and presses the frame's submit`, async () => {
      const f = fakeEmbeddedPage(variant);
      await waitForStripePaymentMethods(f.page, 50);
      await openCardFields(f.page);
      await fillStripeCardFields(f.page, CARD);
      await untickStripeLink(f.page);
      await clickStripeSubmit(f.page);
      expect(f.filled).toEqual({
        'input[name="number"]': CARD.number,
        'input[name="expiry"]': CARD.expiry,
        'input[name="cvc"]': CARD.cvc,
        'input[name="name"]': CARD.name,
        'input[name="addressLine1"]': CARD.line1,
        'input[name="locality"]': CARD.city,
        'input[name="postalCode"]': CARD.zip,
      });
      expect(f.clicks).toEqual(variant === "5b" ? ["Card", "uncheck-link", "payment-form-submit-button"] : ["Card", "payment-form-submit-button"]);
      // 5b refuses Save ("Enter your address") without a State; 5a has no State select.
      expect(f.state()).toBe(variant === "5b" ? "LA" : "");
      expect(f.linkChecked()).toBe(false);
    });
  }
});

function e2eFiles(dir = join(ROOT, "e2e")): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "node_modules" ? [] : e2eFiles(p);
    return /\.ts$/.test(n) ? [p] : [];
  });
}

describe("no e2e driver builds a Stripe field or submit locator itself", () => {
  const STRIPE_FIELD_SELECTORS = [
    '"#cardNumber"',
    '"#cardExpiry"',
    '"#cardCvc"',
    '"#billingName"',
    '"#billingAddressLine1"',
    '"#billingLocality"',
    '"#billingPostalCode"',
    '"hosted-payment-submit-button"',
    '"payment-form-submit-button"',
  ];
  const files = e2eFiles()
    .map((p) => ({ rel: p.slice(ROOT.length + 1), code: blankComments(readFileSync(p, "utf8")) }))
    .filter((f) => f.rel !== HELPER);
  const payers = files.filter((f) => f.code.includes("fillStripeCardFields(page"));

  it("finds the drivers that pay a Checkout Session (inventory floor)", () => {
    expect(files.length).toBeGreaterThan(50);
    expect(payers.map((f) => f.rel).sort()).toEqual(["e2e/journeys/fixtures.ts", "e2e/prod-audit/fundedOpenJob.ts", "e2e/prod-lifecycle.spec.ts"]);
  });

  it("each takes Stripe's fields from the helper, never from the page", () => {
    const offenders = files.flatMap((f) => STRIPE_FIELD_SELECTORS.filter((s) => f.code.includes(s)).map((s) => `${f.rel}: ${s}`));
    expect(offenders, "use fillStripeCardFields / clickStripeSubmit (e2e/stripeCheckoutCard.ts): Stripe can draw the form in an iframe").toEqual([]);
  });
});
