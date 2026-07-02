// Seat-tier pricing table + rank map for the BusinessTeam workspace,
// extracted verbatim from BusinessTeam.tsx (behavior-preserving split).
// Do not alter any price, seat count, or cents value.

import type { SeatTier } from "@/hooks/useMyBusiness";

export const TIERS: Array<{ id: SeatTier; name: string; seats: number; price: string; priceCents: number }> = [
  { id: "starter", name: "Starter", seats: 1, price: "Free", priceCents: 0 },
  { id: "crew", name: "Crew", seats: 2, price: "$10/mo", priceCents: 1000 },
  { id: "team", name: "Team", seats: 3, price: "$20/mo", priceCents: 2000 },
  { id: "enterprise", name: "Enterprise", seats: 4, price: "$40/mo", priceCents: 4000 },
];

export const TIER_RANK: Record<SeatTier, number> = { starter: 0, crew: 1, team: 2, enterprise: 3 };
