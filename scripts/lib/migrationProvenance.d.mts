export const DEPLOY_WORKFLOW_PATH: string;
export function parseAppliedVersions(pushOutput: string): string[];
export function receiptInsertSql(
  versions: string[],
  run: { runId: number | string | undefined; runAttempt: number | string | undefined; headSha: string | undefined },
): string | null;
export interface ProvenanceFindings {
  unrecorded: string[];
  staleAck: string[];
  forged: { version: string; why: string }[];
  judged: number;
}
export function provenanceFindings(args: {
  prodVersions: string[];
  ledger: { version: string; run_id: number | string }[];
  cutoff: string;
  acknowledged: { version: string }[];
  runs: Map<string, { path: string; head_branch: string } | null>;
}): ProvenanceFindings;
