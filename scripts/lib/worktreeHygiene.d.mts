export interface WorktreeEntry { path: string; locked: boolean; lockReason: string; prunable: boolean; branch: string | null; bare: boolean }
export interface WorktreeFacts {
  bare: boolean; locked: boolean; agentOwned: boolean; prunable: boolean; exists: boolean;
  dirty: number; statusError: string | null; ahead: number | null; allUpstream: boolean;
  cwdInside: boolean; lockPid: number | null; lockPidAlive: boolean; ageMs: number | null;
}
export interface WorktreeDecision { action: "remove" | "report" | "skip"; unlock?: boolean; reason?: string }
export interface WorktreePlan {
  entries: WorktreeEntry[];
  remove: { path: string; branch: string | null; unlock: boolean }[];
  report: { path: string; branch: string | null; reason: string }[];
  skip: { path: string; branch: string | null; reason: string }[];
}
export const AGENT_WORKTREE_DIR: string;
export function parseWorktrees(porcelain: string): WorktreeEntry[];
export function lockPid(reason: string): number | null;
export function classifyWorktree(f: WorktreeFacts, minAgeMs: number): WorktreeDecision;
export function pidAlive(pid: number): boolean;
export function planWorktreeCleanup(
  repo: string,
  o: { cwds: string[] | null; nowMs?: number; minAgeMs?: number; base?: string; pidAlive?: (pid: number) => boolean; outOfTime?: () => boolean },
): WorktreePlan;
export function applyWorktreePlan(repo: string, plan: WorktreePlan): { removed: string[]; refused: { path: string; reason: string }[] };
