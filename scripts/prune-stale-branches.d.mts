/** Types for scripts/prune-stale-branches.mjs, imported by src/test/pruneStaleBranches.test.ts. */
export const PROTECTED: Set<string>;
export function countUnlanded(cherryOutput: string): number;
export function decideBranch(b: {
  name: string;
  hasOpenPr: boolean;
  cherryOutput: string;
  mergesAhead: number;
}): { name: string; action: "KEEP" | "DELETE" | "UNLANDED"; reason: string };
export function inspectBranch(
  name: string,
  cwd?: string,
): { sha: string; cherryOutput: string; mergesAhead: number };
export function deleteBranch(name: string, sha: string, cwd?: string): void;
