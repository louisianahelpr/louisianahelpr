export const FUNCTIONS_DIR: string;
export const SHARED_DIR: string;
export const STAMP_FILE: string;
export const PLACEHOLDER: string;
export const BUILD_HEADER: string;
export const BUILD_PROBE_HEADER: string;
export function listFunctions(root: string): string[];
export function stampedFiles(root: string, fn: string): string[];
export function configBlock(configToml: string, fn: string): string;
export function expectedStamp(root: string, fn: string): string;
export function withStamp(source: string, stamp: string): string;
export function writeStamp(root: string, fn: string, stamp?: string): string;
export function compareStamps(
  expected: Record<string, string>,
  observed: Record<string, string | null>,
): { ok: string[]; mismatched: { fn: string; expected: string; observed: string | null }[] };
