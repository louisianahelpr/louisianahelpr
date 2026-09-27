/**
 * Types for scripts/e2e/wait-shared-accounts.mjs, so
 * src/test/sharedAccountLockQueues.test.ts can import its parser and decision.
 * Same pattern as scripts/open-done-when.d.mts.
 */
export const LOCK: "prod-lifecycle-shared-accounts";
export interface LockedJob {
  key: string;
  name: string;
}
export type Inventory = Record<string, LockedJob[]>;
export interface InFlightRun {
  id: number;
  created_at: string;
  name: string;
  path: string;
  html_url: string;
  jobs: { name: string; status: string; conclusion?: string | null }[];
}
/** Every job holding the lock, per workflow path. */
export function lockedJobs(dir?: string): Inventory;
/** Does an API job name (matrix suffix included) belong to a locked job? */
export function matchesLocked(apiName: string, locked: LockedJob[]): boolean;
/** May the run `me` join the lock now? */
export function decide(me: { id: number; created_at: string }, runs: InFlightRun[], inventory: Inventory): { go: boolean; why: string };
