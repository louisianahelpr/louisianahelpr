/**
 * Shipping S3 label worker (supabase/functions/_shared/shipLabelWorker.ts; Q2259, money review fixes 2, 7, 8, 13) and
 * the checkout's hold (declutter-checkout, stripe-webhook declutterCheckout.ts): a label already on the shipment is
 * reused, never re-bought; only the stored rate is bought, and only when not dearer; the label is recorded BEFORE the
 * capture; a label that cannot be bought RELEASES the hold; a provider error is a retry, never a release; live mode
 * is never touched; a shipped order's page is a manual-capture hold in test mode only, with its own Shipping line.
 *
 * @mutate supabase/functions/_shared/shipLabelWorker.ts |   if (existing.ok) return captureAfter(existing.label, "reused_captured"); |   if (false) return captureAfter(existing.label, "reused_captured");
 * @mutate supabase/functions/_shared/shipLabelWorker.ts |   if (!check.buy) return releaseHold(check.reason); |   if (!check.buy && false) return releaseHold(check.reason);
 * @mutate supabase/functions/_shared/shipLabelWorker.ts |   if (!read.ok) return retry(`read ${read.status}`); |   if (!read.ok) return releaseHold(`read ${read.status}`);
 * @mutate supabase/functions/_shared/shipLabelWorker.ts |   if (s.label_mode !== "test") return "skipped_live"; |
 * @mutate supabase/functions/_shared/shipLabelWorker.ts |   if (!(await p.rateBuyable(s.id, s.quoted_cents))) return releaseHold("over_collected_shipping"); |
 * @mutate supabase/functions/_shared/shipLabelWorker.ts |     if (!recorded) return "skipped_not_held"; |
 * @mutate supabase/functions/declutter-checkout/index.ts |   if (handover === "ship" && mode !== "test") return json({ error: "shipping_test_only" }, 409); |
 * @mutate supabase/functions/declutter-checkout/index.ts | ...(handover === "ship" ? { capture_method: "manual" as const } : {}) }, | },
 * @mutate supabase/functions/stripe-webhook/handlers/declutterCheckout.ts |     shipHeld = pi.status === "requires_capture"; |     shipHeld = false;
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runShipLabel, type ClaimedShipment, type ShipLabelPorts, type ShipOrder } from "../../supabase/functions/_shared/shipLabelWorker";
import { blankComments } from "./helpers/blankNonCode";

const SHP = "shp_abc";
const claim = (over: Partial<ClaimedShipment> = {}): ClaimedShipment => ({
  id: "s1", declutter_order_id: "o1", label_mode: "test", provider_shipment_id: SHP, provider_rate_id: "rate_ga",
  quoted_cents: 733, attempts: 0, ...over,
});
const held: ShipOrder = { status: "paid", ship_capture: "held", stripe_payment_intent_id: "pi_1" };
const unbought = (rate = "7.33") => ({ id: SHP, mode: "test", rates: [{ id: "rate_ga", rate, currency: "USD" }], postage_label: null });
const bought = (rate = "7.33") => ({
  ...unbought(rate), postage_label: { label_url: "https://easypost-files.s3.amazonaws.com/l.pdf" }, tracking_code: "9400",
  selected_rate: { id: "rate_ga", rate, currency: "USD" },
});

function ports(over: Partial<ShipLabelPorts> = {}) {
  const calls: string[] = [];
  const p: ShipLabelPorts = {
    getShipment: async () => { calls.push("get"); return { ok: true, status: 200, body: unbought() }; },
    buyShipment: async () => { calls.push("buy"); return { ok: true, status: 200, body: bought() }; },
    rateBuyable: async () => { calls.push("buyable"); return true; },
    recordBought: async () => { calls.push("record"); return true; },
    recordFailed: async (_s, r) => { calls.push(`failed:${r}`); },
    recordRetry: async () => { calls.push("retry"); },
    capture: async () => { calls.push("capture"); return "captured"; },
    release: async () => { calls.push("release"); },
    setCapture: async (_o, st) => { calls.push(`set:${st}`); },
    page: async () => { calls.push("page"); },
    ...over,
  };
  return { p, calls };
}

describe("ship label worker", () => {
  it("buys the stored rate, records it, then captures", async () => {
    const { p, calls } = ports();
    expect(await runShipLabel(claim(), held, p)).toBe("bought_captured");
    expect(calls).toEqual(["get", "buyable", "buy", "record", "capture", "set:captured"]);
  });
  it("a label already on the shipment is reused, never bought again", async () => {
    const { p, calls } = ports({ getShipment: async () => ({ ok: true, status: 200, body: bought() }) });
    expect(await runShipLabel(claim(), held, p)).toBe("reused_captured");
    expect(calls).not.toContain("buy");
  });
  it("a dearer rate releases the hold and buys nothing", async () => {
    const { p, calls } = ports({ getShipment: async () => ({ ok: true, status: 200, body: unbought("9.99") }) });
    expect(await runShipLabel(claim(), held, p)).toBe("released");
    expect(calls).toEqual(expect.arrayContaining(["failed:dearer_than_paid", "release", "set:released"]));
    expect(calls).not.toContain("buy");
    expect(calls).not.toContain("capture");
  });
  it("the database's own budget check can refuse the buy", async () => {
    const { p, calls } = ports({ rateBuyable: async () => false });
    expect(await runShipLabel(claim(), held, p)).toBe("released");
    expect(calls).not.toContain("buy");
  });
  it("a provider error is a retry, never a release", async () => {
    const { p, calls } = ports({ getShipment: async () => ({ ok: false, status: 503, body: null }) });
    expect(await runShipLabel(claim(), held, p)).toBe("retry");
    expect(calls).not.toContain("release");
    const b = ports({ buyShipment: async () => ({ ok: false, status: 500, body: null }) });
    expect(await runShipLabel(claim(), held, b.p)).toBe("retry");
    expect(b.calls).not.toContain("capture");
  });
  it("live mode and an order not on hold are never touched", async () => {
    const { p, calls } = ports();
    expect(await runShipLabel(claim({ label_mode: "live" }), held, p)).toBe("skipped_live");
    expect(await runShipLabel(claim(), { ...held, ship_capture: "captured" }, p)).toBe("skipped_not_held");
    expect(calls).toEqual([]);
  });
  it("a lost compare-and-set never captures", async () => {
    const { p, calls } = ports({ recordBought: async () => false });
    expect(await runShipLabel(claim(), held, p)).toBe("skipped_not_held");
    expect(calls).not.toContain("capture");
  });
});

describe("the shipped order's page is a test-mode card hold", () => {
  const checkout = blankComments(readFileSync("supabase/functions/declutter-checkout/index.ts", "utf8"));
  const hook = blankComments(readFileSync("supabase/functions/stripe-webhook/handlers/declutterCheckout.ts", "utf8"));
  it("declutter-checkout: test mode only, manual capture, its own Shipping line, the total counts it", () => {
    expect(checkout).toContain(`if (handover === "ship" && mode !== "test") return json({ error: "shipping_test_only" }, 409);`);
    expect(checkout).toContain(`...(handover === "ship" ? { capture_method: "manual" as const } : {}) },`);
    expect(checkout).toMatch(/name: "Shipping"/);
    expect(checkout).toContain("order.items_cents + order.premium_cents + order.tax_cents + deliveryCents + shippingCents !== order.total_cents");
    expect(checkout).toContain("p_quote_id: quoteId");
  });
  it("the webhook records a hold only from a requires_capture PaymentIntent, and releases one the order does not take", () => {
    expect(hook).toContain(`shipHeld = pi.status === "requires_capture";`);
    expect(hook).toContain("await stripe.paymentIntents.cancel(paymentIntentId)");
    expect((hook.match(/shipHeld/g) ?? []).length).toBeGreaterThan(4);
  });
});
