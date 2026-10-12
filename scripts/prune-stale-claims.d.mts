/** Types for scripts/prune-stale-claims.mjs (src/test/pruneStaleClaims.test.ts). */
export const CLAIM_PREFIX: string;
export const STALE_CLAIM_HOURS: number;
export function mentions(text: string | null | undefined, token: string): boolean;
export function decideClaims(
  claims: { name: string; sha: string; tipDate: string; lastActivity: string | null; aheadBy: number }[],
  openPrs: { number: number; title: string; body: string | null; head: string }[],
  nowMs: number,
): { name: string; sha: string; decision: "DELETE" | "KEEP"; reason: string }[];
