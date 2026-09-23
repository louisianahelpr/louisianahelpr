/**
 * Types for scripts/perf/critical-path.mjs, so src/test/criticalPathBudget.test.ts
 * can drive the real analyser on a fixture bundle instead of a second copy of
 * it. Same pattern as scripts/back-control-inventory.d.mts.
 */
export interface RouteResult {
  path: string;
  chunk: string;
  routeRound: number;
  rounds: number;
  chunks: number;
  jsKB: number;
}
export interface Analysis {
  entry: string;
  entryKB: number;
  entryStaticChunks: number;
  htmlPreloads: string[];
  bootRounds: number;
  bootChunks: number;
  bootKB: number;
  bootFiles: string[];
  routes: RouteResult[];
}
export interface Budget {
  entry: { staticChunks: number; kb: number };
  routes: Record<string, { routeRound: number; rounds: number; jsKB: number }>;
}
export const ROUTES: Array<{ path: string; chunk: string }>;
export function analyse(dist?: string): Analysis;
export function checkAgainstBudget(res: Analysis, budget: Budget): string[];
