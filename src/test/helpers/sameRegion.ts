/**
 * Two [start, end) source regions are the same region. Used by
 * src/test/decidedDisputeEscrowOnlyMovedBySplit.test.ts, where a later dispute
 * gate covers a money site only in the gate's OWN region (lh-money-escrow
 * review of a2dd38334); its own file so the guard can register a mutation of it.
 */
export function sameRegion(a: readonly [number, number], b: readonly [number, number]): boolean {
  return a[0] === b[0] && a[1] === b[1];
}
