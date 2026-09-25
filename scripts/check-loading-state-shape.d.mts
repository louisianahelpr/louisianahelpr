// Types for scripts/check-loading-state-shape.mjs (plain JS so `node` runs it in CI).
export declare const ROW_BUDGET: number;
export declare function stableUrl(url: string): string;
export declare function clusterKey(r: { persona: string; url: string }, i: number): string;
export declare function breaches(results: unknown[]): { key: string; kind: string; detail: string }[];
