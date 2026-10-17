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
  expired: { version: string; run_id: string }[];
  judged: number;
}
export interface LedgerRow {
  version: string;
  run_id: number | string;
  head_sha?: string;
  recorded_at?: string;
}
export interface ShaEvidence {
  onMain: boolean;
  fileAtSha: boolean;
}
export function provenanceFindings(args: {
  prodVersions: string[];
  ledger: LedgerRow[];
  cutoff: string;
  acknowledged: { version: string }[];
  runs: Map<string, { path: string; head_branch: string } | null>;
  expiredRun?: { minAgeDays: number };
  shaEvidence?: Map<string, ShaEvidence>;
  now?: Date;
}): ProvenanceFindings;
export function expiredRunVerdict(
  receipt: LedgerRow,
  evidence: ShaEvidence | undefined,
  opts: { now: Date; minAgeDays: number | undefined },
): string | null;
