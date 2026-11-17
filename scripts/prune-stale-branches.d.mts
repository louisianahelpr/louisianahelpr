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
export const NEVER_STRANDED_PREFIXES: string[];
export const READY_QUEUE_PREFIX: string;
export const READY_QUEUE_GRACE_HOURS: number;
export function waitingForTrain(name: string, ageHours: number): boolean;
export function parsePatchIds(out: string): Map<string, string>;
export function cherryFromIndex(commits: { sha: string; subject: string }[], branchIds: Map<string, string>, mainIds: Set<string>, verbose?: boolean): string;
export function patchIdsOf(range: string, cwd?: string): Map<string, string>;
export function cherryIndexedGit(gitFn: (args: string[]) => string, idsOf?: (range: string) => Map<string, string>): (args: string[]) => string;
export function parsePorcelainDeletes(out: string): { deleted: string[]; rejected: { name: string; why: string }[] };
export function deleteBranches(
  rows: { name: string }[],
  tipOf: Map<string, string>,
  gitFn: (args: string[]) => string,
  chunk?: number,
): { deleted: string[]; failed: { name: string; why: string }[] };
