export interface BatchRun {
  display_title?: string | null;
  head_sha: string;
  created_at: string;
  conclusion?: string | null;
}
export interface Decision {
  action: "dispatch" | "skip";
  reason: string;
  base: string | null;
}
/** The run-name marker every batch run carries. */
export const BATCH_MARK: string;
export const DEBOUNCE_MS: number;
export const COMPARE_FILE_CAP: number;
export const UI_PATHS: string[];
export const TARGETS: { file: string; paths: string[] }[];
export function matchesPaths(file: string, patterns: string[]): boolean;
export function batchRuns<T extends BatchRun>(runs: T[]): T[];
export function decide(args: {
  head: string;
  runs: BatchRun[];
  now: number;
  paths?: string[];
  changedFiles?: string[] | null;
}): Decision;
