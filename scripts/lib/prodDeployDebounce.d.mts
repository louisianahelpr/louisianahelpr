export interface DeploymentRow {
  id: string;
  created: number;
  state: string;
  sha: string | null;
}
export interface VercelDeployment {
  uid?: string;
  id?: string;
  created?: number;
  createdAt?: number;
  state?: string;
  readyState?: string;
  meta?: { githubCommitSha?: string };
}
export const DEBOUNCE_MS: number;
export const LIVE_OR_COMING: Set<string>;
export const MIGRATION_STUCK_MS: number;
export interface PendingMigration {
  version: string;
  committedAt: number;
}
export interface EdgeDeployState {
  state: "ok" | "pending" | "failed";
  runId: number | null;
  sha: string | null;
  status: string | null;
}
export interface WorkflowRun {
  id: number;
  head_sha: string;
  status: string;
  conclusion: string | null;
  created_at: string;
}
export function edgeDeployState(runs: WorkflowRun[], isOnHead: (sha: string) => boolean): EdgeDeployState;
export function pendingMigrationVersions(repoFiles: string[], applied: Iterable<string>): string[];
export function summarize(deployments: VercelDeployment[]): { newest: DeploymentRow | null; base: DeploymentRow | null };
export function decide(input: {
  head: string;
  now: number;
  newest: DeploymentRow | null;
  base: DeploymentRow | null;
  deployPathsChanged: boolean | null;
  pendingMigrations: PendingMigration[] | null;
  edgeDeploy: EdgeDeployState | null;
  debounceMs?: number;
}): { action: "deploy" | "skip"; reason: string; fail?: boolean };
