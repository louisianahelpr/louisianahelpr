export const CANARY_WORKFLOW: string;
export function sharedAccountWorkflows(dir?: string): string[];
/** A run older than this is a GitHub ghost, never a lock holder. */
export const STALE_RUN_MS: number;
/** The workflow whose push runs can hold the accounts, and the job that does (Q1271). */
export const VACUITY_WORKFLOW: string;
export const VACUITY_E2E_JOB: string;
/** Does this in-progress run hold the shared accounts? `jobs` is read for a vacuity.yml push run. */
export function holdsAccounts(
  run: { event: string; display_title?: string | null; run_started_at?: string | null; created_at?: string | null; path?: string | null },
  now?: number,
  jobs?: Array<{ name: string; status: string }>,
): boolean;
