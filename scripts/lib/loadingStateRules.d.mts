// Types for scripts/lib/loadingStateRules.mjs (plain JS so `node` runs it in CI with no npm install).
export declare const ROW_BUDGET: number;
export declare const JOB_ID_PATH: RegExp;
export declare function stableUrl(url: string): string;
export declare function clusterKey(r: { persona: string; url: string }, i: number): string;
export declare function breaches(results: unknown[]): { key: string; kind: string; path?: string; delta?: number; detail: string }[];
export declare function byDesignCovers(
  b: { key: string; kind: string; path?: string; delta?: number },
  entries: { key: string; kind: string; path?: string; maxDeltaPx?: number; growsBelow?: boolean }[],
): boolean;
export declare function staleEntries(
  results: unknown[],
  allowEntries: { key: string; kind: string; path?: string }[],
  found: { key: string; kind: string }[],
): { stale: string[]; unobserved: string[] };
