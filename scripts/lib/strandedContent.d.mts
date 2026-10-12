/** Types for scripts/lib/strandedContent.mjs, imported by the hygiene guards. */
export type Git = (args: string[], o?: { input?: string; env?: Record<string, string> }) => string;
export interface ContentResult {
  ref: string;
  mergeBase: string | null;
  files: { file: string; missing: string[]; removedStill: string[]; shortMissing?: string[] }[];
  missing: number;
  removedStill: number;
  shortMissing: number;
  stranded: boolean;
  error?: string;
}
export const IGNORED_PATHS: RegExp[];
export function isIgnoredPath(f: string): boolean;
export function sigLine(line: string): string | null;
export function buildMainIndex(git: Git, mainRef: string): Set<string>;
export function unlandedContent(git: Git, ref: string, mainRef: string, mainIndex: Set<string>, o?: { strict?: boolean }): ContentResult;
export function isStranded(missing: number, removedStill: number): boolean;
export function contentLanded(r: ContentResult): boolean;
export function contentNote(r: ContentResult): string;
export function gitRunner(cwd: string): Git;
export function makeContentJudge(repo: string, mainRef: string): (ref: string) => ContentResult;
