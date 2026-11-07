// Types for scripts/audit/prune-loading-baseline.mjs (plain JS so `node` runs it in CI).
export declare function pruneBaseline(
  measurements: { results?: unknown[] },
  baseline: { allow?: { key: string; kind: string; path?: string }[]; [k: string]: unknown },
): { baseline: { allow: { key: string; kind: string; path?: string }[]; [k: string]: unknown }; removed: string[] };
