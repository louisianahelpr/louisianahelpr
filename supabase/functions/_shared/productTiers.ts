/**
 * THE Stripe product → membership tier map.
 *
 * This lived in two places — stripe-webhook/constants.ts and a verbatim
 * copy-paste inside check-pro-subscription — with nothing asserting they
 * agreed. They happened to match, but a new Stripe product added to one and
 * not the other silently mis-grants (or fails to grant) a paid tier: the
 * webhook would upgrade someone the reconciliation poll then downgrades on
 * their next dashboard load, or vice versa.
 *
 * One definition, imported by both. Adding a product here reaches every
 * consumer at once.
 */
export const PRODUCT_TO_TIER: Record<string, string> = {
  // Monthly recurring
  "prod_U8rS2fR6KvQoRk": "basic",
  "prod_U8rTRJZSUyzaha": "pro",
  "prod_U8rTUX4EhN5wG3": "elite",
  // Annual recurring
  "prod_U8rTux09RGNWWd": "basic",
  "prod_U8rTiOIcITvnIT": "pro",
  "prod_U8rT5zWKWe29By": "elite",
  // One-time month pass
  "prod_U8rTPMHf6IQnGE": "basic",
  "prod_U8rThLQr2jThoM": "pro",
  "prod_U8rT0f4UtNPrrs": "elite",

  // TEST-MODE products. The app currently runs on a TEST Stripe key, so the
  // Prices the checkout charges belong to TEST products — and those product
  // ids were absent from this map, which means a completed test-mode
  // subscription checkout granted NO tier: the webhook's
  // `PRODUCT_TO_TIER[productId] || null` fell through and the handler bailed.
  // Elite has been in that state since its Prices were repointed to a test
  // product on 2026-08-27. Mapping is by product id and ids never collide
  // across modes, so listing both modes here is safe and it is what keeps
  // test-mode QA of a paid tier honest.
  "prod_UqSRFTWivuEMrl": "elite", // test: monthly + annual + one-time
  // Basic and Pro had the SAME hole Elite was fixed for and were missed: their
  // test-mode products existed in Stripe but not here, so a completed test-mode
  // Basic or Pro checkout resolved `PRODUCT_TO_TIER[productId] || null` to null
  // and the handler's `if (tier)` block was skipped — paid, no entitlement, no
  // alert. Read off the live test-mode Price list on 2026-09-01
  // (acct_1RQbAfKp2H4b7tEC, livemode:false): lookup keys helpr_pro_*_test
  // ($10 / $100 / $10) and helpr_basic_*_test ($5 / $50 / $5).
  "prod_UqSRPJAe0f92Xf": "pro",   // test: monthly + annual + one-time
  "prod_UqSyR1FW6IT0a7": "basic", // test: monthly + annual + one-time
};
