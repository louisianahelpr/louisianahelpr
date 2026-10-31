import { allocateCents } from "../../../supabase/functions/_shared/crewShares";

/** The smallest of the N frozen crew shares of `budget`, in dollars. Moved out of LogisticsSection.tsx (size limit). */
export function crewSmallestShare(budget: number, n: number): number {
  return allocateCents(Math.round((Number.isFinite(budget) ? budget : 0) * 100), n, Math.max(0, n - 1)) / 100;
}
