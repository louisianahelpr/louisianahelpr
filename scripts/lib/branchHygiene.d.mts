import type { ContentResult } from "./strandedContent.mjs";
export interface BranchFacts {
  name: string; merged: boolean; unlanded: number | null; unlandedSubjects: string[];
  contentLanded?: boolean; contentNote?: string; checkedOut: boolean; ageMs: number | null;
}
export type LandedHow = "merged" | "patch" | "content";
export interface BranchDecision { action: "delete" | "skip"; how?: LandedHow; reason?: string }
export interface BranchPlan {
  delete: { branch: string; sha: string; how: LandedHow }[];
  skip: { branch: string; sha: string; reason: string; unlanded?: number | null; unlandedSubjects?: string[] }[];
}
export function classifyBranch(f: BranchFacts, minAgeMs: number): BranchDecision;
export function planBranchCleanup(
  repo: string,
  o: {
    checkedOut: Set<string>; base?: string; minAgeMs?: number; nowMs?: number; outOfTime?: () => boolean;
    contentOf?: (ref: string) => ContentResult;
  },
): BranchPlan;
export function applyBranchPlan(repo: string, plan: BranchPlan): { deleted: string[]; refused: { branch: string; reason: string }[] };
