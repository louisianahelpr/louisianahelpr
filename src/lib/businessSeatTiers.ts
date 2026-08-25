// Client mirror of the canonical business seat-plan tiers defined on the edge
// in supabase/functions/_shared/businessSeatTiers.ts. Re-exported here so the
// React UI (ForBusiness marketing page, BusinessTeam seat plan) and the
// checkout edge function all derive seat counts / prices / featured flags from
// ONE source and can never silently diverge. Parity is guarded by
// src/lib/businessSeatTiers.parity.test.ts.
//
// The ⚠️ caveat that used to live here — "the Stripe Price objects still charge
// the OLD amounts until a human updates them" — no longer applies. The monthly
// Prices were corrected in Stripe on 2026-07-05 and the ANNUAL Prices ($200 /
// $300 / $400) were created 2026-08-19, so displayed figures and charged
// amounts now agree in both billing intervals.

export {
  BUSINESS_SEAT_TIERS,
  BUSINESS_SEAT_TIER_TO_PRICE,
  type BusinessSeatTier,
  type BusinessSeatTierKey,
} from "../../supabase/functions/_shared/businessSeatTiers";

/**
 * Format a tier's monthly price for the in-app seat-plan rows, e.g. "Free"
 * or "$20/mo". The marketing page shows the bare priceLabel ("$20"); the
 * BusinessTeam workspace appends "/mo". Both derive from the same source.
 */
export const formatSeatPriceMonthly = (priceLabel: string): string =>
  priceLabel === "Free" ? "Free" : `${priceLabel}/mo`;

/**
 * Format a tier's ANNUAL price, e.g. "Free" or "$200/yr". Derived from
 * `annualPriceCents` rather than multiplying the monthly label, because the
 * annual plans are priced at 10x monthly (two months free) — deriving it by
 * multiplying by 12 would overstate every annual price by two months.
 */
export const formatSeatPriceAnnual = (annualPriceCents: number): string =>
  annualPriceCents === 0 ? "Free" : `$${Math.round(annualPriceCents / 100)}/yr`;

/** Months saved by paying annually — 12 minus the annual/monthly ratio. */
export const seatAnnualMonthsFree = (priceCents: number, annualPriceCents: number): number =>
  priceCents === 0 ? 0 : Math.max(0, 12 - Math.round(annualPriceCents / priceCents));
