/** Types for scripts/open-assign-numbers.mjs, imported by src/test/openAssignNumbers.test.ts. */
export const PLACEHOLDER: RegExp;
export function assignPlaceholders(
  files: { path: string; text: string }[],
  firstFree: number,
): { files: { path: string; text: string; changed: boolean }[]; assigned: Map<string, string> };
