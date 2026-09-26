/** Types for scripts/component-size-baseline.mjs, imported by src/test/componentSizeRatchet.test.ts. */
export const THRESHOLD: number;
export const BASELINE_PATH: string;
export function isTestFile(rel: string): boolean;
export function countLines(src: string): number;
export function componentSizes(root: string): { scanned: number; sizes: Record<string, number> };
export function oversized(sizes: Record<string, number>, threshold?: number): Record<string, number>;
export function compare(sizes: Record<string, number>, baseline: Record<string, number>, threshold?: number): string[];
