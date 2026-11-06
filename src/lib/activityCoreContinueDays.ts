/**
 * HOME'S CONTINUE DAYS COME WITH THE ACTIVITY CORES (Builder 2, 2026-11-06; lead plan 11-05, OK 11-06, "Nothing slow
 * for users"). useContinueDays (Home, the to-do list) read job_continue_days on its own on every signed-in load with a
 * job under way. get_my_activity_cores, which the same load already asks for, now carries the ACTIVE (proposed or
 * set) days of the member's jobs as 'active_continue_days' (migration 20261106054856), so the rows are kept here as
 * each core answers, with the job ids that core covers.
 *
 * useContinueDays takes them ONLY as the first answer of its key (React Query initialData, dated by when the core
 * answered): every later read of that key (ContinueDayOnCard's invalidation, staleness) is the old direct read, so a
 * cores answer from before a change never overwrites a newer one. A job id no recorded core covers (or no key: an
 * older database, a failed cores read) gives no first answer, and the old read goes out as before.
 *
 * No Supabase import: the activity reads and Home's hook both import this. Guard: src/test/continueDaysFromCores.test.tsx.
 * PGlite proof of the key: src/test/pglite/activityCoresActiveContinueDays.pglite.mjs.
 */
import type { ContinueDay } from "./continueDayWords";

type Part = "posted" | "applied";
type Kept = { userId: string; at: number; covered: Set<string>; byJob: Map<string, ContinueDay> };
const kept = new Map<Part, Kept>();

/**
 * A core answered: keep its active days. `coveredJobIds`: every job id the server scoped the key to for this part
 * (the posted jobs; the jobs of my applications). `rows` not an array = the key is absent: forget the part.
 */
export function keepActiveContinueDays(userId: string, part: Part, coveredJobIds: readonly (string | null | undefined)[], rows: unknown): void {
  // A different member's answer never mixes with this one.
  for (const [p, k] of kept) if (k.userId !== userId) kept.delete(p);
  if (!Array.isArray(rows)) {
    kept.delete(part);
    return;
  }
  const byJob = new Map<string, ContinueDay>();
  for (const r of rows as ContinueDay[]) if (r && typeof r.job_id === "string" && !byJob.has(r.job_id)) byJob.set(r.job_id, r);
  kept.set(part, { userId, at: Date.now(), covered: new Set(coveredJobIds.filter((j): j is string => typeof j === "string")), byJob });
}

/**
 * The first answer for useContinueDays(jobIds): the days by job id and when they were read, or undefined when any id
 * is not covered by a kept core (the old read then goes out).
 */
export function continueDaysFromCores(jobIds: readonly string[]): { days: Record<string, ContinueDay>; at: number } | undefined {
  if (!jobIds.length || kept.size === 0) return undefined;
  const days: Record<string, ContinueDay> = {};
  let at = Infinity;
  for (const id of jobIds) {
    const k = [...kept.values()].find((c) => c.covered.has(id));
    if (!k) return undefined;
    at = Math.min(at, k.at);
    const d = k.byJob.get(id);
    if (d) days[id] = d;
  }
  return { days, at };
}

/** Sign-out (authSignOut.ts, Q724) and tests: forget every kept core, so the next account on this device never gets the last one's days as a first answer. */
export function resetActiveContinueDays(): void {
  kept.clear();
}
