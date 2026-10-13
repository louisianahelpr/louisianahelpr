/**
 * Stripe Checkout's Card fields are opened in ONE place: e2e/stripeCheckoutCard.ts.
 *
 * Three copies of a one-shot forced radio click lived in the fixtures; when
 * Stripe's page had not wired its handlers yet the click did nothing, the
 * fixture sat 30s on `#cardNumber`, and prod-audit's whole messy-input sweep
 * went down with it (runs 35983716673, 35999386803). The helper repeats the
 * click until the fields open. This check keeps the class closed: no e2e file
 * that drives `#cardNumber` clicks a radio itself, and the helper retries.
 *
 * 2026-10-13: Stripe's hosted Checkout dropped the radio inputs (the circle is
 * an aria-hidden span; each method is a BUTTON, data-testid
 * "card-accordion-item-button"). Every driver waited on
 * `#cardNumber.or(getByRole("radio"))`, sat 60s and failed: all nine
 * e2e-journeys reds of run 38399095812 and e2e-real-backend 38447487997's money
 * loop. So the class is now: NO driver waits on a radio itself (e2e/ and the
 * scripts/probes .mjs copy that cannot import the helper), and the helper opens
 * the card fields on every layout, driven below against a fake page per layout.
 */
// @mutate e2e/stripeCheckoutCard.ts |  for (let i = 0; i < attempts; i++) { | for (let i = 0; i < 1; i++) {
// @mutate e2e/prod-audit/fundedOpenJob.ts |     await openCardFields(page); |     if (!(await card.isVisible().catch(() => false))) await radio.click({ force: true });
// @mutate e2e/stripeCheckoutCard.ts |     if ((await cardButton.count().catch(() => 0)) > 0) { |     if (false) {
// @mutate e2e/journeys/fixtures.ts |   const paymentField = stripePaymentMethodControl(page); |   const paymentField = page.locator("#cardNumber").or(page.getByRole("radio").first());
// @mutate scripts/probes/mint-funded-seed-jobs.prod.mjs |       await card.or(cardButton).or(radio).first() |       await card.or(radio).first()
import { describe, expect, it } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { readdirSync } from "./helpers/trackedFiles";
import { blankComments } from "./helpers/blankNonCode";
import { openCardFields } from "../../e2e/stripeCheckoutCard";

const ROOT = join(__dirname, "..", "..");
const HELPER = "e2e/stripeCheckoutCard.ts";

function e2eFiles(dir = join(ROOT, "e2e")): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "node_modules" ? [] : e2eFiles(p);
    return /\.(ts|mjs)$/.test(n) ? [p] : [];
  });
}

describe("Stripe Checkout card fields open through the shared helper", () => {
  const drivers = e2eFiles()
    .map((p) => ({ rel: p.slice(ROOT.length + 1), src: readFileSync(p, "utf8") }))
    .filter((f) => f.rel !== HELPER && f.src.includes('"#cardNumber"') && /4242|TEST_CARD/.test(f.src));

  it("finds the files that pay a Checkout Session (the inventory is not empty)", () => {
    expect(drivers.length).toBeGreaterThan(2);
    expect(drivers.map((d) => d.rel).sort()).toEqual(
      ["e2e/journeys/fixtures.ts", "e2e/prod-audit/fundedOpenJob.ts", "e2e/prod-lifecycle.spec.ts"],
    );
  });

  it("no driver clicks a payment-method radio itself; each calls openCardFields", () => {
    const offenders = drivers.filter((d) => /\.click\(\{\s*force:\s*true\s*\}\)/.test(d.src) && /getByRole\("radio"\)/.test(d.src) && !d.src.includes("openCardFields(page)"));
    const hand = drivers.filter((d) => /(radio|methodRadio)\.click\(/.test(d.src));
    expect(offenders.map((d) => d.rel)).toEqual([]);
    expect(hand.map((d) => d.rel)).toEqual([]);
    for (const d of drivers) expect(d.src, `${d.rel} must open the card fields via openCardFields`).toContain("openCardFields(page)");
  });

  it("the helper repeats the click more than once before giving up", () => {
    const src = readFileSync(join(ROOT, HELPER), "utf8");
    const m = /for \(let i = 0; i < (\w+); i\+\+\)/.exec(src);
    expect(m, "openCardFields has no retry loop").not.toBeNull();
    const bound = m![1] === "attempts" ? Number(/attempts = (\d+)/.exec(src)?.[1]) : Number(m![1]);
    expect(bound).toBeGreaterThan(1);
    expect(src).toMatch(/radio\.click\(\{ force: true \}\)/);
  });
});

// Source text searched for, not a URL check: built from parts so CodeQL's
// URL-substring rule (js/incomplete-url-substring-sanitization) does not read
// a test's grep as a host check (PR #2986 CodeQL).
const STRIPE_CHECKOUT_HOST_TEXT = ["checkout", "stripe", "com"].join(".");

describe("no driver waits on a payment-method radio alone (Stripe's button accordion has none)", () => {
  const files = [...e2eFiles(), ...e2eFiles(join(ROOT, "scripts"))]
    .map((p) => ({ rel: p.slice(ROOT.length + 1), code: blankComments(readFileSync(p, "utf8")) }))
    .filter((f) => f.rel !== HELPER && (f.code.includes('"#cardNumber"') || f.code.includes("stripeCheckoutCard") || f.code.includes(STRIPE_CHECKOUT_HOST_TEXT)));

  it("finds every file that drives Stripe's card field (the inventory is not empty)", () => {
    expect(files.length).toBeGreaterThan(4);
    expect(files.map((f) => f.rel)).toEqual(expect.arrayContaining([
      "e2e/canary/core-loop.spec.ts",
      "e2e/prod-gift-card.spec.ts",
      "e2e/journeys/fixtures.ts",
      "e2e/prod-audit/fundedOpenJob.ts",
      "e2e/prod-lifecycle.spec.ts",
      "scripts/probes/mint-funded-seed-jobs.prod.mjs",
    ]));
  });

  it("each one that names a radio also names the Card method button, and the .ts ones never name a radio", () => {
    const radioOnly = files.filter((f) => /getByRole\(["']radio["']\)/.test(f.code) && !f.code.includes("card-accordion-item-button"));
    expect(radioOnly.map((f) => f.rel)).toEqual([]);
    const tsWithRadio = files.filter((f) => f.rel.endsWith(".ts") && /getByRole\(["']radio["']\)/.test(f.code));
    expect(tsWithRadio.map((f) => f.rel), "wait via stripePaymentMethodControl / waitForStripePaymentMethods instead").toEqual([]);
  });
});

type Layout = "single" | "radio" | "button" | "unknown";

/** A fake Checkout page per layout; "button" mirrors the DOM of run 38447487997's trace. */
function fakeStripePage(layout: Layout) {
  let open = layout === "single";
  const clicks: string[] = [];
  const buttonIds =
    layout === "button"
      ? ["card-accordion-item-button", "us_bank_account-accordion-item-button", "cashapp-accordion-item-button", "hosted-payment-submit-button"]
      : layout === "unknown"
        ? ["card-method-tile", "hosted-payment-submit-button"]
        : ["hosted-payment-submit-button"];
  const loc = (name: string, present: () => boolean, onClick?: () => void) => {
    const l = {
      isVisible: async () => present(),
      count: async () => (present() ? 1 : 0),
      waitFor: async () => {
        if (!present()) throw new Error(`Timeout waiting for ${name}`);
      },
      click: async () => {
        if (!present()) throw new Error(`no element for ${name}`);
        clicks.push(name);
        onClick?.();
      },
      first: () => l,
      evaluateAll: async <T,>(fn: (els: Array<{ getAttribute(k: string): string | null; textContent: string }>) => T) =>
        fn(buttonIds.map((id) => ({ getAttribute: (k: string) => (k === "data-testid" ? id : null), textContent: "" }))),
    };
    return l;
  };
  const page = {
    url: () => "https://checkout.stripe.com/c/pay/cs_test_fake",
    locator: (sel: string) => (sel === "#cardNumber" ? loc("#cardNumber", () => open) : loc(sel, () => true)),
    getByTestId: (id: string) => loc(id, () => layout === "button" && id === "card-accordion-item-button", () => { open = true; }),
    getByRole: (role: string) => loc(`role=${role}`, () => layout === "radio" && role === "radio", () => { open = true; }),
  };
  return { page: page as unknown as Page, clicks, isOpen: () => open };
}

describe("openCardFields opens the card fields on every layout Stripe renders", () => {
  it("single method: nothing clicked", async () => {
    const f = fakeStripePage("single");
    await openCardFields(f.page);
    expect(f.clicks).toEqual([]);
  });
  it("radio accordion: clicks the first radio", async () => {
    const f = fakeStripePage("radio");
    await openCardFields(f.page);
    expect(f.clicks).toEqual(["role=radio"]);
  });
  it("button accordion (no role=radio): clicks the Card method button", async () => {
    const f = fakeStripePage("button");
    await openCardFields(f.page);
    expect(f.isOpen()).toBe(true);
    expect(f.clicks).toEqual(["card-accordion-item-button"]);
  });
  it("unknown layout fails naming the page's buttons", async () => {
    const f = fakeStripePage("unknown");
    await expect(openCardFields(f.page, 2)).rejects.toThrow(/card-method-tile/);
  });
});
