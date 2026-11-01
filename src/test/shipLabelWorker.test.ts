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
 * @mutate supabase/functions/_shared/shipLabelWorker.ts |     const closed = await p.closeReleased(s.declutter_order_id); |     const closed = "skipped";
 * @mutate supabase/functions/_shared/shipLabelWorker.ts |     const captured = await p.capture(pi, s.declutter_order_id, amount); |     const captured = await p.capture(pi, s.declutter_order_id, 99999);
 * @mutate supabase/functions/stripe-webhook/handlers/declutterCheckout.ts |     const closed = await closeReleasedHoldRefund(supabase, paymentIntentId); |     const closed = "left";
 * @mutate supabase/functions/stripe-webhook/handlers/declutterCheckout.ts |       await closeReleasedHoldRefund(supabase, paymentIntentId);\n      logStep("Declutter ship hold already released" |       logStep("Declutter ship hold already released"
 * @mutate supabase/functions/stripe-webhook/handlers/declutterCheckout.ts |       seed: event.livemode !== true, |
 * @mutate supabase/functions/_shared/shipLabelRun.ts |           seed: s.label_mode === "test", |
 * @mutate supabase/functions/_shared/shipLabelRun.ts | testStripe.paymentIntents.capture(pi, { amount_to_capture: amountCents }, | testStripe.paymentIntents.capture(pi, {},
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
    captureAmount: async () => { calls.push("amount"); return 2485; },
    capture: async (_pi, _o, cents) => { calls.push(`capture:${cents}`); return "captured"; },
    release: async () => { calls.push("release"); },
    setCapture: async (_o, st) => { calls.push(`set:${st}`); },
    closeReleased: async () => { calls.push("close"); return "closed"; },
    page: async () => { calls.push("page"); },
    ...over,
  };
  return { p, calls };
}

describe("ship label worker", () => {
  it("buys the stored rate, records it, then captures", async () => {
    const { p, calls } = ports();
    expect(await runShipLabel(claim(), held, p)).toBe("bought_captured");
    expect(calls).toEqual(["get", "buyable", "buy", "record", "amount", "capture:2485", "set:captured"]);
  });
  it("a label already on the shipment is reused, never bought again", async () => {
    const { p, calls } = ports({ getShipment: async () => ({ ok: true, status: 200, body: bought() }) });
    expect(await runShipLabel(claim(), held, p)).toBe("reused_captured");
    expect(calls).not.toContain("buy");
  });
  it("a dearer rate releases the hold and buys nothing", async () => {
    const { p, calls } = ports({ getShipment: async () => ({ ok: true, status: 200, body: unbought("9.99") }) });
    expect(await runShipLabel(claim(), held, p)).toBe("released");
    // B114: the released order is closed (never left 'paid'), after the hold is gone.
    expect(calls).toEqual(expect.arrayContaining(["failed:dearer_than_paid", "release", "set:released", "close"]));
    expect(calls.indexOf("close")).toBeGreaterThan(calls.indexOf("release"));
    expect(calls).not.toContain("buy");
    expect(calls.some((c) => c.startsWith("capture"))).toBe(false);
  });
  it("captures exactly the amount the database names (a setup fee paid elsewhere stays uncaptured)", async () => {
    const { p, calls } = ports({ captureAmount: async () => { calls.push("amount"); return 2275; } });
    expect(await runShipLabel(claim(), held, p)).toBe("bought_captured");
    expect(calls).toContain("capture:2275");
  });
  it("the run sends amount_to_capture and closes a released order through the database", () => {
    const run = blankComments(readFileSync("supabase/functions/_shared/shipLabelRun.ts", "utf8"));
    expect(run).toContain(`testStripe.paymentIntents.capture(pi, { amount_to_capture: amountCents },`);
    expect(run).toContain(`admin.rpc("declutter_ship_hold_released", { p_order_id: orderId })`);
    expect(run).toContain(`admin.rpc("declutter_ship_setup_fee_at_capture", { p_order_id: orderId })`);
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
    expect(b.calls.some((c) => c.startsWith("capture"))).toBe(false);
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
    expect(calls.some((c) => c.startsWith("capture"))).toBe(false);
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
  it("a released hold's refund row is closed by the webhook, on first delivery and on a redelivery (20261101221604)", () => {
    expect(hook).toContain(`supabase.rpc("declutter_ship_hold_refund_released", { p_payment_intent_id: paymentIntentId })`);
    // Both branches: after the cancel, and the redelivery that finds the hold already cancelled.
    expect((hook.match(/await closeReleasedHoldRefund\(supabase, paymentIntentId\)/g) ?? []).length).toBe(2);
  });
  it("test-mode shipping alerts are digest-only (test data never pages the owner)", () => {
    expect(hook).toContain("seed: event.livemode !== true,");
    const run = blankComments(readFileSync("supabase/functions/_shared/shipLabelRun.ts", "utf8"));
    expect(run).toContain(`seed: s.label_mode === "test",`);
  });
});
