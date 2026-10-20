/**
 * The hero's seasonal pill, picked from the month so it is never stale (lead,
 * LANDING-APPROVED.md). A suggestion of what people book in that season, never
 * a claim about Helpr. Storm season follows the Atlantic hurricane season,
 * June 1 to November 30. `month` is 0-11 (Date#getMonth).
 * Guard: src/test/landingRedesign.test.tsx.
 */
export function seasonalPill(month: number): string {
  if (month >= 5 && month <= 10) return "Storm season: get your gutters and shutters ready";
  if (month === 11) return "Holiday season: get help with lights, cleaning and guests";
  if (month <= 1) return "New year: clear out the closet, the attic or the garage";
  return "Spring: lawns, flower beds and pressure washing";
}
