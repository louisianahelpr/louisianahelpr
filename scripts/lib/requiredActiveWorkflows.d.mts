/** Types for scripts/lib/requiredActiveWorkflows.mjs (src/test/requiredActiveWorkflows.test.ts). */
export const REQUIRED_ACTIVE: string[];
export const EXEMPT_FROM_ACTIVE: Record<string, string>;
export function inactiveRequired(apiWorkflows: { path: string; state: string }[], required?: string[]): { file: string; state: string }[];
