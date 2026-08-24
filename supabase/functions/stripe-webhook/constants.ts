// Re-exported from _shared so the webhook and the reconciliation poll read
// ONE map. See _shared/productTiers.ts.
export { PRODUCT_TO_TIER } from "../_shared/productTiers.ts";

// One-time pass product IDs (to set 30-day expiry)
export const ONE_TIME_PRODUCTS = new Set([
  "prod_U8rTPMHf6IQnGE",
  "prod_U8rThLQr2jThoM",
  "prod_U8rT0f4UtNPrrs",
]);
