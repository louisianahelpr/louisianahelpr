// Shown able to fail (2026-10-20): drop shipping from the fee base and the worked
// examples and the card-coverage grid go red (3 tests).
// @mutate src/lib/shipping/policy.ts | const base = Math.max(0, itemsCents) + Math.max(0, shippingCents); | const base = Math.max(0, itemsCents);
import { describe, expect, it } from "vitest";
import { STRIPE_FLAT_CENTS, STRIPE_PCT } from "@/lib/stripeFees";
import { checkoutAmounts } from "@/lib/declutter/money";
import {
  buyerFeeCentsShip,
  declutterSizeCanShip,
  easypostKeyMode,
  isLouisianaZip,
  labelPayer,
  parcelAllowed,
  rateWithinQuote,
  shipmentIdempotencyKey,
  shippedCheckoutAmounts,
  shippedOrderFinal,
  type ShipRefundReason,
} from "./policy";

// Stripe's international-card surcharge (stripe.com/pricing, read 2026-10-20): +1.5%.
const INTL_PCT = STRIPE_PCT + 0.015;
const cardCost = (cents: number, pct: number) => Math.round(cents * pct) + STRIPE_FLAT_CENTS;

describe("shipped-order buyer fee (decision 2: 5% of items + shipping + 70c)", () => {
  it("matches the spec's worked examples", () => {
    expect(buyerFeeCentsShip(500, 733)).toBe(132);
    expect(buyerFeeCentsShip(1000, 1637)).toBe(202);
    expect(buyerFeeCentsShip(2500, 1308)).toBe(260);
    expect(shippedCheckoutAmounts([300, 200], 733)).toEqual({ itemsCents: 500, premiumCents: 132, shippingCents: 733, totalCents: 1365 });
  });

  it("rounds half away from zero like Postgres round(numeric)", () => {
    expect(buyerFeeCentsShip(10, 0)).toBe(71); // 0.5 -> 1
    expect(buyerFeeCentsShip(29, 0)).toBe(71); // 1.45 -> 1
    expect(buyerFeeCentsShip(30, 0)).toBe(72); // 1.5 -> 2
    expect(buyerFeeCentsShip(-5, -5)).toBe(70);
  });

  it("with no shipping it equals the F1 fee every pickup order pays", () => {
    for (let items = 0; items <= 100_000; items += 7) {
      expect(buyerFeeCentsShip(items, 0)).toBe(checkoutAmounts([items]).premiumCents);
    }
  });

  it("always covers the card fee, US and international card, every items/shipping pair", () => {
    // Inventory floor: a real grid, not an empty loop.
    let n = 0;
    let minUs = Infinity;
    let minIntl = Infinity;
    for (let items = 0; items <= 100_000; items += 97) {
      for (let ship = 1; ship <= 6_000; ship += 53) {
        const { premiumCents, totalCents } = shippedCheckoutAmounts([items], ship);
        minUs = Math.min(minUs, premiumCents - cardCost(totalCents, STRIPE_PCT));
        minIntl = Math.min(minIntl, premiumCents - cardCost(totalCents, INTL_PCT));
        n++;
      }
    }
    expect(n).toBeGreaterThan(100_000);
    expect(minUs).toBeGreaterThan(0);
    expect(minIntl).toBeGreaterThan(0);
  });

  it("the items-only F1 fee would NOT cover it (the finding the new rule fixes)", () => {
    // $5 item, $20 shipping, US card: F1 on items only nets -10c (spec 5.1 table).
    const f1 = checkoutAmounts([500]).premiumCents;
    expect(f1 - cardCost(500 + f1 + 2000, STRIPE_PCT)).toBe(-10);
    const ship = shippedCheckoutAmounts([500], 2000);
    expect(ship.premiumCents - cardCost(ship.totalCents, STRIPE_PCT)).toBeGreaterThan(0);
  });
});

describe("where and what can ship", () => {
  it("Louisiana ZIPs only (decision 3)", () => {
    for (const z of ["70112", "70001", "70301", "70801", "71101", "71497", "70112-1234", " 70501 "]) expect(isLouisianaZip(z)).toBe(true);
    for (const z of ["70200", "70900", "71500", "75201", "39201", "7011", "701123", "", null, undefined, "abcde"]) expect(isLouisianaZip(z)).toBe(false);
  });
  it("Declutter small only (decision 8)", () => {
    expect(declutterSizeCanShip("small")).toBe(true);
    for (const s of ["large", "xl", "", null, undefined]) expect(declutterSizeCanShip(s)).toBe(false);
  });
  it("parcels up to 20 lb and 22 in", () => {
    expect(parcelAllowed({ weightOz: 16, lengthIn: 12 })).toBe(true);
    expect(parcelAllowed({ weightOz: 320 })).toBe(true);
    expect(parcelAllowed({ weightOz: 321 })).toBe(false);
    expect(parcelAllowed({ weightOz: 0 })).toBe(false);
    expect(parcelAllowed({ weightOz: 16, lengthIn: 23 })).toBe(false);
    expect(parcelAllowed({ weightOz: Number.NaN })).toBe(false);
  });
});

describe("label purchase rules (money review fixes 7 and 8)", () => {
  it("never buys a label dearer than the held shipping", () => {
    expect(rateWithinQuote(733, 733)).toBe(true);
    expect(rateWithinQuote(734, 733)).toBe(false);
    expect(rateWithinQuote(0, 733)).toBe(false);
    expect(rateWithinQuote(7.5, 733)).toBe(false);
  });
  it("one idempotency key per order, matching the shipments CHECK", () => {
    const id = "0f8b2c1e-1234-4abc-9def-0123456789ab";
    expect(shipmentIdempotencyKey("declutter", id)).toBe(`declutter:${id}`);
    expect(shipmentIdempotencyKey("shop", id)).toBe(`shop:${id}`);
    expect(() => shipmentIdempotencyKey("declutter", "x")).toThrow("invalid_order_id");
  });
  it("a test-mode order only ever uses the EasyPost test key", () => {
    expect(easypostKeyMode("test")).toBe("test");
    expect(easypostKeyMode("live")).toBe("live");
  });
});

describe("who pays the label on a refund (decisions 5, 6): never the platform", () => {
  const all: ShipRefundReason[] = ["label_not_bought", "seller_backed_out", "ship_never_shipped", "buyer_cancelled",
    "admin_buyer_fault", "ship_lost", "ship_damaged", "not_as_described", "admin_no_fault"];
  it("every reason names a payer that is not the platform", () => {
    for (const r of all) expect(["none", "void_then_seller", "void_then_buyer", "seller"]).toContain(labelPayer(r));
  });
  it("matches the spec 5.3 table", () => {
    expect(labelPayer("label_not_bought")).toBe("none");
    expect(labelPayer("seller_backed_out")).toBe("void_then_seller");
    expect(labelPayer("ship_never_shipped")).toBe("void_then_seller");
    expect(labelPayer("buyer_cancelled")).toBe("void_then_buyer");
    expect(labelPayer("admin_buyer_fault")).toBe("void_then_buyer");
    expect(labelPayer("ship_lost")).toBe("seller");
    expect(labelPayer("ship_damaged")).toBe("seller");
    expect(labelPayer("admin_no_fault")).toBe("seller");
  });
});

describe("when a shipped order is final (decision 4: 48 h after delivered)", () => {
  const delivered = new Date("2026-10-20T12:00:00Z");
  const at = (h: number) => new Date(delivered.getTime() + h * 3600_000);
  it("never before the delivered scan", () => {
    expect(shippedOrderFinal({ deliveredAt: null, buyerConfirmedAt: at(1), problemOpen: false }, at(500))).toBe(false);
  });
  it("48 h after delivery, or earlier on I got it, never with a problem open", () => {
    expect(shippedOrderFinal({ deliveredAt: delivered, buyerConfirmedAt: null, problemOpen: false }, at(47.9))).toBe(false);
    expect(shippedOrderFinal({ deliveredAt: delivered, buyerConfirmedAt: null, problemOpen: false }, at(48))).toBe(true);
    expect(shippedOrderFinal({ deliveredAt: delivered, buyerConfirmedAt: at(1), problemOpen: false }, at(2))).toBe(true);
    expect(shippedOrderFinal({ deliveredAt: delivered, buyerConfirmedAt: at(-1), problemOpen: false }, at(2))).toBe(false);
    expect(shippedOrderFinal({ deliveredAt: delivered, buyerConfirmedAt: null, problemOpen: true }, at(100))).toBe(false);
  });
});
