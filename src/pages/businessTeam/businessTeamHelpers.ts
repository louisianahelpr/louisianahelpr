// Seat-tier pricing table + rank map for the BusinessTeam workspace.
//
// The name, seat count, price, and cents value are DERIVED from the single
// source of truth (src/lib/businessSeatTiers.ts → the edge _shared config) so
// the in-app seat plan can never disagree with the marketing page or the
// checkout function. The numeric `seats` here is the seat LIMIT used for
// upgrade/downgrade fit math; it parses the canonical display string
// ("4+" → 4). `price` appends "/mo" via formatSeatPriceMonthly.

import type { SeatTier } from "@/hooks/useMyBusiness";
import {
  BUSINESS_SEAT_TIERS,
  formatSeatPriceMonthly,
  formatSeatPriceAnnual,
  seatAnnualMonthsFree,
} from "@/lib/businessSeatTiers";

export const TIERS: Array<{
  id: SeatTier;
  name: string;
  seats: number;
  price: string;
  priceCents: number;
  /** Annual display price, e.g. "$200/yr". "Free" for starter. */
  annualPrice: string;
  annualPriceCents: number;
  /** Months saved by paying annually (2 on every paid tier). 0 on starter. */
  monthsFree: number;
}> =
  BUSINESS_SEAT_TIERS.map((tier) => ({
    id: tier.key as SeatTier,
    name: tier.name,
    seats: parseInt(tier.seats, 10), // "4+" → 4 (seat limit for fit math)
    price: formatSeatPriceMonthly(tier.priceLabel),
    priceCents: tier.priceCents,
    annualPrice: formatSeatPriceAnnual(tier.annualPriceCents),
    annualPriceCents: tier.annualPriceCents,
    monthsFree: seatAnnualMonthsFree(tier.priceCents, tier.annualPriceCents),
  }));

export const TIER_RANK: Record<SeatTier, number> = { starter: 0, crew: 1, team: 2, enterprise: 3 };
