// Types for scripts/check-loading-state-shape.mjs (plain JS so `node` runs it in CI).
export declare const ROW_BUDGET: number;
export declare function stableUrl(url: string): string;
export declare function clusterKey(r: { persona: string; url: string }, i: number): string;
export declare function breaches(results: unknown[]): { key: string; kind: string; path?: string; delta?: number; detail: string }[];
export declare function byDesignCovers(
  b: { key: string; kind: string; path?: string; delta?: number },
  entries: { key: string; kind: string; path?: string; maxDeltaPx?: number }[],
): boolean;
