/** Types for scripts/prune-stale-branches.mjs, imported by src/test/pruneStaleBranches.test.ts. */
export const PROTECTED: Set<string>;
export const PROTECTED_PREFIXES: string[];
export const MIN_AGE_HOURS: number;
export function isProtected(name: string): boolean;
export function countUnlanded(cherryOutput: string): number;
export function decideBranch(b: {
  name: string;
  hasOpenPr: boolean;
  cherryOutput: string;
  ageHours: number;
}): { name: string; action: "KEEP" | "DELETE" | "UNLANDED"; reason: string };
