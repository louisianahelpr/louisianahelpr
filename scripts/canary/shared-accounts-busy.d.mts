export const CANARY_WORKFLOW: string;
export function sharedAccountWorkflows(dir?: string): string[];
/** A run older than this is a GitHub ghost, never a lock holder. */
export const STALE_RUN_MS: number;
/** Does this in-progress run hold the shared accounts? */
export function holdsAccounts(
  run: { event: string; display_title?: string | null; run_started_at?: string | null; created_at?: string | null },
  now?: number,
): boolean;
