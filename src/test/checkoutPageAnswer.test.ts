/**
 * Phase W (owner 2026-11-27: "checkout should never leave the app/site"): the client reads the payment page an edge
 * function answered with, and never asks for an embedded page inside the native app (old builds and the app keep
 * Stripe's hosted page in the in-app browser sheet).
 *
 * @mutate src/lib/payments/checkoutPage.ts |   return switchOn && !isNativePlatform; |   return switchOn;
 * @mutate src/lib/payments/checkoutPage.ts | return secret.slice(3, 7) === key.slice(3, 7) ? | return true ?
 */
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("@/lib/nativeInit");
});

async function load(native: boolean) {
  vi.doMock("@/lib/nativeInit", () => ({ isNativePlatform: native }));
  return import("@/lib/payments/checkoutPage");
}

describe("checkoutPageFrom / asksForEmbeddedCheckout", () => {
  it("reads an embedded answer, a hosted answer, and refuses a form whose key is in the other Stripe mode", async () => {
    const { checkoutPageFrom } = await load(false);
    expect(checkoutPageFrom({ client_secret: "cs_test_a_secret_b", publishable_key: "pk_test_x" }))
      .toEqual({ kind: "embedded", clientSecret: "cs_test_a_secret_b", publishableKey: "pk_test_x" });
    expect(checkoutPageFrom({ url: "https://checkout.stripe.com/c/pay/cs_live_1" }))
      .toEqual({ kind: "hosted", url: "https://checkout.stripe.com/c/pay/cs_live_1" });
    expect(checkoutPageFrom({ client_secret: "cs_live_a_secret_b", publishable_key: "pk_test_x" })).toBeNull();
    expect(checkoutPageFrom({ paid: true })).toBeNull();
  });

  it("the website asks only while the switch is on; the native app never asks", async () => {
    const web = await load(false);
    expect(web.asksForEmbeddedCheckout(true)).toBe(true);
    expect(web.asksForEmbeddedCheckout(false)).toBe(false);
    vi.resetModules();
    const app = await load(true);
    expect(app.asksForEmbeddedCheckout(true)).toBe(false);
  });
});
