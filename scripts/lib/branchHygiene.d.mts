export interface BranchFacts {
  name: string; merged: boolean; unlanded: number | null; unlandedSubjects: string[];
  checkedOut: boolean; ageMs: number | null;
}
export interface BranchDecision { action: "delete" | "skip"; how?: "merged" | "patch"; reason?: string }
export interface BranchPlan {
  delete: { branch: string; sha: string; how: "merged" | "patch" }[];
  skip: { branch: string; sha: string; reason: string; unlanded?: number | null; unlandedSubjects?: string[] }[];
}
export function classifyBranch(f: BranchFacts, minAgeMs: number): BranchDecision;
export function planBranchCleanup(
  repo: string,
  o: { checkedOut: Set<string>; base?: string; minAgeMs?: number; nowMs?: number; outOfTime?: () => boolean },
): BranchPlan;
export function applyBranchPlan(repo: string, plan: BranchPlan): { deleted: string[]; refused: { branch: string; reason: string }[] };
