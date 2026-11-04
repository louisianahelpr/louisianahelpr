/**
 * Q1930 (lead re-review 11-04): the delivery quote answers at once and Apple's routed road miles land in the
 * background, so a Helpr delivery's price can move between the quote and Pay. Pay carries the price the screen showed
 * (expected_delivery_cents) for 'delivery' as for 'seller_delivery'; declutter-checkout refuses a different frozen
 * price before any Stripe page (delivery_rate_changed, "The delivery price just changed...") and closes an open page
 * priced differently first. The screen then prices it again (declutterTradeViews.test.tsx, both directions). An older
 * app that sends no price is held to the one the quote showed (src/test/edge/declutter-payments.test.ts, Q1930 cases).
 *
 * @mutate src/lib/declutter/api.ts |         : handover === "delivery" && typeof expectedDeliveryCents === "number" ? { expected_delivery_cents: expectedDeliveryCents } |         : false ? { expected_delivery_cents: expectedDeliveryCents }
 * @mutate supabase/functions/declutter-checkout/index.ts |   const expectedRate = (handover === "seller_delivery" \|\| handover === "delivery") && |   const expectedRate = handover === "seller_delivery" &&
 * @mutate supabase/functions/declutter-checkout/index.ts |     && seenRate !== null && Number(open.delivery_cents ?? 0) !== seenRate; |     && false;
 * @mutate supabase/functions/declutter-checkout/index.ts |   const seenRate = expectedRate ?? shownRate; |   const seenRate = expectedRate;
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const invoke = vi.fn(async (_fn: string, _opts: { body: Record<string, unknown> }) => ({ data: { url: "https://checkout.stripe.com/x" }, error: null }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (fn: string, opts: { body: Record<string, unknown> }) => invoke(fn, opts) } } }));
const lastBody = () => invoke.mock.calls[invoke.mock.calls.length - 1]?.[1].body;
const flat = (s: string) => blankComments(s).replace(/\s+/g, " ");

describe("a Helpr delivery's price is checked at Pay (Q1930)", () => {
  beforeEach(() => invoke.mockClear());

  it("startCheckoutPayment carries the shown Helpr delivery price, and nothing when the screen has none", async () => {
    const { startCheckoutPayment } = await import("@/lib/declutter/api");
    await startCheckoutPayment("s1", "delivery", null, null, 4000);
    expect(lastBody()).toMatchObject({ handover: "delivery", expected_delivery_cents: 4000 });
    await startCheckoutPayment("s1", "delivery", null, null, null);
    expect(lastBody()).not.toHaveProperty("expected_delivery_cents");
    await startCheckoutPayment("s1", "porch", null, null, 4000);
    expect(lastBody()).not.toHaveProperty("expected_delivery_cents");
  });

  it("declutter-checkout reads it for 'delivery', closes an open page priced differently, and refuses before Stripe", () => {
    const edge = flat(readFileSync("supabase/functions/declutter-checkout/index.ts", "utf8"));
    expect(edge).toContain('const expectedRate = (handover === "seller_delivery" || handover === "delivery") && typeof body.expected_delivery_cents === "number"');
    expect(edge).toContain('const deliveryChanged = !!open && handover === "delivery" && open.handover === "delivery" && seenRate !== null && Number(open.delivery_cents ?? 0) !== seenRate;');
    // An older app (no expected price) is held to the price the quote showed (declutter_delivery_quotes_shown).
    expect(edge).toContain("const seenRate = expectedRate ?? shownRate;");
    expect(edge).toMatch(/page\.status === "open" && \([^)]*\|\| deliveryChanged\)\)/);
    const refuse = edge.indexOf('if (expectedRate !== null && Number(order.delivery_cents ?? 0) !== expectedRate) { return json({ error: "delivery_rate_changed"');
    expect(refuse).toBeGreaterThan(0);
    expect(refuse).toBeLessThan(edge.indexOf("checkout.sessions.create("));
  });

  it("the words fit both deliveries (never 'the seller's' price for a Helpr delivery)", async () => {
    const { DECLUTTER_CLIENT_ERROR_COPY } = await import("@/lib/declutter/errors");
    expect(DECLUTTER_CLIENT_ERROR_COPY.delivery_rate_changed).toBe("The delivery price just changed. Check the new price, then tap Pay again.");
  });
});
