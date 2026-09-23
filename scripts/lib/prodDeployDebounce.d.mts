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
export function summarize(deployments: VercelDeployment[]): { newest: DeploymentRow | null; base: DeploymentRow | null };
export function decide(input: {
  head: string;
  now: number;
  newest: DeploymentRow | null;
  base: DeploymentRow | null;
  deployPathsChanged: boolean | null;
  debounceMs?: number;
}): { action: "deploy" | "skip"; reason: string };
