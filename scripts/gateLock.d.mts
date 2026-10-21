/** Types for scripts/gateLock.mjs (src/test/gateLockGlobalSetup.ts, src/test/gateLockExitsNonzeroWhenKilled.test.ts). */
export function lockDisabled(): boolean;
export function acquireGateLock(): Promise<void>;
export function releaseGateLock(): void;
export function gateExit(result: { status: number | null; signal: string | null; error?: Error }): { code: number; message: string | null };
