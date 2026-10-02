/** Types for scripts/prune-stale-branches.mjs, imported by src/test/pruneStaleBranches.test.ts. */
export const PROTECTED: Set<string>;
export function countUnlanded(cherryOutput: string): number;
export function decideBranch(b: {
  name: string;
  hasOpenPr: boolean;
  cherryOutput: string;
}): { name: string; action: "KEEP" | "DELETE" | "UNLANDED"; reason: string };
