/** Types for scripts/any-baseline.mjs, imported by src/test/anyRatchet.test.ts. */
export function isTestFile(rel: string): boolean;
export function countAny(src: string, fileName: string): number;
export function countAnyByFile(root: string): { scanned: number; counts: Record<string, number> };
