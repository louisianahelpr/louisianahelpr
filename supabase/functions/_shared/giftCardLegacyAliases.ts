// LEGACY ALIASES (2026-09-12) — drop each once the minimum supported app version
// no longer uses it. Tracked in docs/OPEN.md, "Gift card legacy aliases".
//
// The feature is the Helpr gift card. These are the ONLY places edge-function
// code still spells its retired wire names, and only to ACCEPT them from
// callers and Stripe objects created before the rename. Nothing new is ever
// written with them. Exempt from src/test/giftCardNaming.test.ts by explicit
// path.

/** create-payment request body key sent by App Store v1.0.x (now `giftCardId`). */
export const LEGACY_GIFT_CARD_BODY_KEY = "pifCreditId";

/**
 * Stripe Checkout Session metadata key on shortfall sessions created before the
 * rename (now `gift_card_id`). Sessions live up to 24h, and Stripe can retry
 * their webhooks for days.
 */
export const LEGACY_GIFT_CARD_METADATA_KEY = "pif_credit_id";

/** Stripe Checkout Session `metadata.kind` on gift purchases created before the rename (now `gift_card_purchase`). */
export const LEGACY_GIFT_CARD_PURCHASE_KIND = "pif_donation";

/** The gift card id from session metadata, new key first, then the legacy key. */
export function giftCardIdFromMetadata(meta: Record<string, unknown> | null | undefined): string | undefined {
  const v = meta?.gift_card_id ?? meta?.[LEGACY_GIFT_CARD_METADATA_KEY];
  return typeof v === "string" && v ? v : undefined;
}

/** True for a gift card purchase session, under either kind spelling. */
export function isGiftCardPurchaseKind(kind: unknown): boolean {
  return kind === "gift_card_purchase" || kind === LEGACY_GIFT_CARD_PURCHASE_KIND;
}
