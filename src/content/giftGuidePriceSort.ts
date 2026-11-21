/**
 * The price sort of the owner-list guides (Her, Him, Kids and their relationship views like /gift-guides/mom; owner
 * 2026-11-21: "the guides should be able to be sorted by price"). Each pick carries `priceRank`, its place in the
 * cheapest-first order written by the import (scripts/giftGuidePriceRank1121.mjs). It is a position, never a price, so
 * sorting shows no Amazon price (Associates rule). "low" is the list as imported; "high" reverses the ranked picks. A
 * pick with no rank (unknown price) stays after every ranked pick in BOTH orders, in its own order.
 * Guard: src/test/giftGuidePriceSort1121.test.tsx.
 */
export type PriceOrder = "low" | "high";

const ranked = (r: number | null | undefined): r is number => typeof r === "number" && Number.isFinite(r);

/** The picks in the chosen price order, unknown prices last. Never mutates its input. */
export function sortByPrice<T extends { priceRank?: number | null }>(picks: readonly T[], order: PriceOrder): T[] {
  const known = picks.filter((p) => ranked(p.priceRank));
  const unknown = picks.filter((p) => !ranked(p.priceRank));
  const dir = order === "high" ? -1 : 1;
  known.sort((a, b) => dir * ((a.priceRank as number) - (b.priceRank as number)));
  return [...known, ...unknown];
}
