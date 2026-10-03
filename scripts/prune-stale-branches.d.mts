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
  contentStranded?: boolean;
}): { name: string; action: "KEEP" | "DELETE" | "UNLANDED"; reason: string };
export const STRANDED_AFTER_HOURS: number;
export function uncoveredCommits(cherryVerbose: string, covered: Set<string>): { sha: string; subject: string }[];
export function isStranded(b: { name: string; hasOpenPr: boolean; ageHours: number; uncovered: unknown[] }): boolean;
export const AUTO_LAND_PREFIX: string;
export const AUTO_LAND_STUCK_HOURS: number;
export function autoLandTitle(name: string): string;
export function stuckAutoLandPrs<T extends { title: string; createdAt: string; headRefName: string }>(prs: T[], nowMs: number): T[];
