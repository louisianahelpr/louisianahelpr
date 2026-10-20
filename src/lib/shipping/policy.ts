/**
 * Shipping policy (docs/specs/shipping-draft.md; owner decisions 2026-10-20; Q2239).
 * Pure rules only: no network, no EasyPost. The server is the source of truth for
 * every amount charged; these mirror it for previews and are what the S2+ edge
 * functions import for the decisions that are not money columns.
 *
 * The fee mirrors public.declutter_buyer_fee_cents_ship (migration
 * 20261020024605_shipping_s1_data_model.sql): 5% of (items + shipping) + 70 cents
 * (decision 2), so the card fee on a shipped order is always covered.
 */

const BUYER_FEE_FIXED_CENTS = 70;

/** The buyer's fee on a SHIPPED order. Postgres round() on numeric rounds half away from zero; Math.round agrees for non-negatives. */
export function buyerFeeCentsShip(itemsCents: number, shippingCents: number): number {
  const base = Math.max(0, itemsCents) + Math.max(0, shippingCents);
  // 5% in integer arithmetic (base * 5 / 100, rounded half up): no 0.05 float drift.
  return Math.floor((base * 5 + 50) / 100) + BUYER_FEE_FIXED_CENTS;
}

/** The amounts a shipped Declutter order freezes: total = items + fee + shipping (no tax on a casual sale, row 54). */
export function shippedCheckoutAmounts(
  itemPricesCents: number[],
  shippingCents: number,
): { itemsCents: number; premiumCents: number; shippingCents: number; totalCents: number } {
  const itemsCents = itemPricesCents.reduce((a, b) => a + b, 0);
  const premiumCents = buyerFeeCentsShip(itemsCents, shippingCents);
  return { itemsCents, premiumCents, shippingCents, totalCents: itemsCents + premiumCents + shippingCents };
}

/**
 * Louisiana addresses only (decision 3). USPS 3-digit areas 700-701, 703-708, 710-714
 * (702 and 709 are not Louisiana). Same rule as the shipments.ship_to CHECK.
 */
export function isLouisianaZip(zip: string | null | undefined): boolean {
  return typeof zip === "string" && /^(70[013-8]|71[0-4])[0-9]{2}(-[0-9]{4})?$/.test(zip.trim());
}

/** Declutter: only size "small" may ship (decision 8). */
export function declutterSizeCanShip(size: string | null | undefined): boolean {
  return size === "small";
}

/** The largest parcel a seller may declare: 20 lb, 22 in long (so USPS length surcharges never apply). */
const MAX_PARCEL = { weightOz: 320, lengthIn: 22 } as const;

export function parcelAllowed(p: { weightOz: number; lengthIn?: number | null }): boolean {
  return Number.isFinite(p.weightOz) && p.weightOz > 0 && p.weightOz <= MAX_PARCEL.weightOz
    && (p.lengthIn == null || (Number.isFinite(p.lengthIn) && p.lengthIn > 0 && p.lengthIn <= MAX_PARCEL.lengthIn));
}

/**
 * Compare the live rate with what the buyer paid BEFORE buying (money review fix 7):
 * a label dearer than the held shipping is never bought (the hold is released instead).
 */
export function rateWithinQuote(rateCents: number, quotedCents: number): boolean {
  return Number.isInteger(rateCents) && Number.isInteger(quotedCents) && rateCents > 0 && rateCents <= quotedCents;
}

/** One label per order, ever: the shipments.idempotency_key (UNIQUE) for an order. */
export function shipmentIdempotencyKey(kind: "declutter" | "shop", orderId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(orderId)) {
    throw new Error("invalid_order_id");
  }
  return `${kind}:${orderId}`;
}

/** Which EasyPost key an order may use: its Stripe mode, never the other (money review fix 8). */
export function easypostKeyMode(stripeMode: "test" | "live"): "test" | "live" {
  return stripeMode;
}

export type ShipRefundReason =
  | "label_not_bought"
  | "seller_backed_out"
  | "ship_never_shipped"
  | "buyer_cancelled"
  | "admin_buyer_fault"
  | "ship_lost"
  | "ship_damaged"
  | "not_as_described"
  | "admin_no_fault";

/**
 * Who pays the label on a refund (spec 5.3; decisions 5 and 6): never the platform.
 * - "none": no label was bought (the hold is released).
 * - "void_then_seller": void it; a rejected void is the seller's debt.
 * - "void_then_buyer": void it; the buyer's shipping is refunded only when the void refund succeeds.
 * - "seller": the label was spent; it is the seller's debt.
 */
export type LabelPayer = "none" | "void_then_seller" | "void_then_buyer" | "seller";

export function labelPayer(reason: ShipRefundReason): LabelPayer {
  switch (reason) {
    case "label_not_bought":
      return "none";
    case "seller_backed_out":
    case "ship_never_shipped":
      return "void_then_seller";
    case "buyer_cancelled":
    case "admin_buyer_fault":
      return "void_then_buyer";
    case "ship_lost":
    case "ship_damaged":
    case "not_as_described":
    case "admin_no_fault":
      return "seller";
  }
}

/** The buyer window after the delivered scan (decision 4): 48 hours; "I got it" ends it early. */
const BUYER_WINDOW_HOURS = 48;

/** Whether a delivered shipped order is final (the seller may be paid). Never before the delivered scan. */
export function shippedOrderFinal(
  s: { deliveredAt: Date | null; buyerConfirmedAt: Date | null; problemOpen: boolean },
  now: Date,
): boolean {
  if (!s.deliveredAt || s.problemOpen) return false;
  if (s.buyerConfirmedAt && s.buyerConfirmedAt.getTime() >= s.deliveredAt.getTime()) return true;
  return now.getTime() - s.deliveredAt.getTime() >= BUYER_WINDOW_HOURS * 3600 * 1000;
}
