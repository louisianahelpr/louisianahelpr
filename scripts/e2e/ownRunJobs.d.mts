/** Types for ./ownRunJobs.mjs (plain JS so CI's node runs it; Playwright's TS pipeline imports it too). */
export declare const OWN_RUN_JOBS_ENV: string;
export declare function recordOwnRunJob(jobId: string, env?: Record<string, string | undefined>): boolean;
export declare function readOwnRunJobIds(env?: Record<string, string | undefined>): Set<string>;
export declare function mayWalkForward(input: {
  id: string;
  ageMs: number;
  minAgeMs: number;
  phase: string;
  ownIds: Set<string>;
}): boolean;
