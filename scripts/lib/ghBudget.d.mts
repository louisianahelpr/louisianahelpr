/** Types for scripts/lib/ghBudget.mjs, imported by src/test/ghCallsNotPerItem.test.ts. */
export const BUDGET_FLOOR: number;
export type GhBudget = { remaining: number; limit: number | null; used: number | null; reset: number | null };
export function parseRateHeaders(text: string): GhBudget | null;
export function readBudget(repo?: string): GhBudget;
