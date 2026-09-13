// LEGACY ALIASES (2026-09-12) — drop each once the minimum supported app version
// no longer uses it. Tracked in docs/OPEN.md, "Gift card legacy aliases".
//
// The feature is the Helpr gift card. This is the ONLY place client code still
// spells a retired wire name, and only to ACCEPT it. Exempt from
// src/test/giftCardNaming.test.ts by explicit path.

/**
 * `/post-job?<param>=<id>` query key used before the rename (now `gift_card`).
 * Stripe shortfall sessions created before the rename carry it in their
 * cancel_url, so a poster backing out of one lands here with the old key.
 */
export const LEGACY_POST_JOB_GIFT_CARD_PARAM = "pif_credit";
