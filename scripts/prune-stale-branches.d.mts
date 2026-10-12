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
export function isStranded(b: { name: string; hasOpenPr: boolean; ageHours: number; uncovered: unknown[]; accepted?: boolean; contentOnMain?: boolean; contentInOpenPr?: boolean }): boolean;
type StrandedRow = { name: string; ageHours: number; uncovered: { sha: string; subject: string }[] };
export function findStranded(
  gitFn: (args: string[]) => string,
  branches: { name: string; sha: string; ageHours: number }[],
  openHeads: Set<string>,
  acceptedTips: Map<string, string>,
  contentStrandedOf: (name: string) => boolean,
  contentInOpenPrOf?: (name: string) => boolean,
): { stranded: StrandedRow[]; contentOnMain: StrandedRow[]; inOpenPr: StrandedRow[] };
export function readAcceptedTips(file?: string): Map<string, string>;
export const AUTO_LAND_PREFIX: string;
export const AUTO_LAND_STUCK_HOURS: number;
export function autoLandTitle(name: string): string;
export function stuckAutoLandPrs<T extends { title: string; createdAt: string; headRefName: string }>(prs: T[], nowMs: number): T[];
export const NEVER_AUTO_LAND_PREFIXES: string[];
export const MAX_AUTO_LAND_PER_RUN: number;
export const MAX_OPEN_AUTO_LAND: number;
export function autoLandBudget(openPrs: { title: string }[]): number;
