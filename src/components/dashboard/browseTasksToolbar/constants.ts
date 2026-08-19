// Compact label for the active budget-range chip. Either bound can be
// unset ("" = no floor / no cap), so render whichever side is present:
//   min only → "$50+", max only → "≤ $250", both → "$50 – $250".
export function budgetChipLabel(minBudget: string, maxBudget: string): string {
  if (minBudget && maxBudget) return `$${minBudget} – $${maxBudget}`;
  if (minBudget) return `$${minBudget}+`;
  if (maxBudget) return `≤ $${maxBudget}`;
  return "Budget";
}

// Per-chip horizontal swipe-to-remove threshold. A clean leftward drift
// past this value commits the clear; anything less springs back to 0.
export const CHIP_SWIPE_THRESHOLD = -64;
