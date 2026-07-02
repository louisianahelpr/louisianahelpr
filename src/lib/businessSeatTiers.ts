// Client mirror of the canonical business seat-plan tiers defined on the edge
// in supabase/functions/_shared/businessSeatTiers.ts. Re-exported here so the
// React UI (ForBusiness marketing page, BusinessTeam seat plan) and the
// checkout edge function all derive seat counts / prices / featured flags from
// ONE source and can never silently diverge. Parity is guarded by
// src/lib/businessSeatTiers.parity.test.ts.
//
// See the edge module for the ⚠️ caveat: the Stripe Price objects still charge
// the OLD amounts until a human updates them in the Stripe dashboard — this
// config fixes only the DISPLAYED figures + the tier→price mapping.

export {
  BUSINESS_SEAT_TIERS,
  BUSINESS_SEAT_TIER_TO_PRICE,
  type BusinessSeatTier,
  type BusinessSeatTierKey,
} from "../../supabase/functions/_shared/businessSeatTiers";

import { BUSINESS_SEAT_TIERS, type BusinessSeatTierKey } from "../../supabase/functions/_shared/businessSeatTiers";

/**
 * Format a tier's monthly price for the in-app seat-plan rows, e.g. "Free"
 * or "$20/mo". The marketing page shows the bare priceLabel ("$20"); the
 * BusinessTeam workspace appends "/mo". Both derive from the same source.
 */
export const formatSeatPriceMonthly = (priceLabel: string): string =>
  priceLabel === "Free" ? "Free" : `${priceLabel}/mo`;

/** Look up a tier by its key. */
export const getBusinessSeatTier = (key: BusinessSeatTierKey) =>
  BUSINESS_SEAT_TIERS.find((t) => t.key === key);
