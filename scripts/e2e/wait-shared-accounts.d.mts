/**
 * Types for scripts/e2e/wait-shared-accounts.mjs, so
 * src/test/sharedAccountLockQueues.test.ts can import its parser and decision.
 * Same pattern as scripts/open-done-when.d.mts.
 */
export const LOCK: "prod-lifecycle-shared-accounts";
/** A run created this long before `me` is a GitHub ghost; decide() skips it. */
export const STALE_RUN_MS: number;
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
/** Can this /actions/runs entry reach a locked job? (scheduled/dispatched, not a main batch) */
export function drivesAccounts(run: { event: string; path?: string; display_title?: string | null }): boolean;
export const PUSH_DRIVERS: Set<string>;
/** May the run `me` join the lock now? */
export function decide(me: { id: number; created_at: string }, runs: InFlightRun[], inventory: Inventory): { go: boolean; why: string };
/** ms to wait out a GitHub API rate limit, or null when the response is not one. */
export function rateLimitWaitMs(
  res: { status: number; headers?: Record<string, string>; body?: string },
  now?: number,
): number | null;
/** The locked jobs of one workflow file's text. */
export function lockedJobsInText(text: string): LockedJob[];
/** Git's blob id for a text (matches a git tree entry's sha). */
export function gitBlobSha(text: string): string;
/** Both inventories merged per path; the own ref wins a shared job key. */
export function mergeInventories(own: Inventory, other: Inventory): Inventory;
/** Is this /actions/runs entry a queue member under this inventory? */
export function queueMember(run: { event: string; path?: string; display_title?: string | null }, inventory: Inventory): boolean;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ApiRead = (path: string, token: string) => Promise<any>;
/** The default branch's locked jobs; throws on any failure or an empty answer. */
export function defaultBranchInventory(repo: string, token: string, dir?: string, read?: ApiRead): Promise<Inventory>;
/** One poll: load the default branch's inventory (fail closed), then decide. */
export function nextDecision(
  me: { id: number; created_at: string },
  own: Inventory,
  merged: Inventory | null,
  deps: { loadDefault: () => Promise<Inventory>; snapshotRuns: (inv: Inventory) => Promise<InFlightRun[]> },
): Promise<{ go: boolean; why: string; merged: Inventory | null }>;
