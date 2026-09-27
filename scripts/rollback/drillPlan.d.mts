export interface DrillDeployment {
  uid?: string;
  id?: string;
  created?: number;
  createdAt?: number;
  readyState?: string;
  state?: string;
  meta?: { githubCommitSha?: string; gitCommitSha?: string };
}
export function deploymentSha(d: DrillDeployment | null | undefined): string | null;
export function pickDrillTargets(
  deployments: DrillDeployment[] | null | undefined,
  liveSha: string,
): { current: DrillDeployment | null; previous: DrillDeployment | null; reason: string };
