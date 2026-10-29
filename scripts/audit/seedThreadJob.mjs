/**
 * Which poster-e2e <-> helper-e2e job prod-seed hangs its 34-message "SEED
 * thread" (and that thread's reactions and pins) on.
 *
 * F28 (app audit 2026-10-28, part 4 half 2): it took the NEWEST pair job in a
 * working state, whoever made it. During the audit that was the live audit
 * job (a journey's own is_seed job), so a re-seed moved 34 seed messages into
 * the chat the audit was driving. A seed writes only to rows it owns: the
 * thread goes on one of the durable state fixtures this repo builds
 * (scripts/e2e/seedStateFixtures.mjs, `ownJobIds`), never on a job some other
 * run created. None present: no job, and the caller skips the thread.
 *
 * @param {Array<{ id: string, status: string }>} pairJobs every pair job, any order
 * @param {Iterable<string>} ownJobIds the ids of the seed's own fixture jobs, in preference order
 * @returns {{ id: string, status: string } | null}
 */
export function pickSeedThreadJob(pairJobs, ownJobIds) {
  const byId = new Map(pairJobs.map((j) => [j.id, j]));
  const own = [...ownJobIds].map((id) => byId.get(id)).filter(Boolean);
  return own.find((j) => SEED_THREAD_STATUSES.includes(j.status)) ?? own[0] ?? null;
}

/** A thread between a poster and their hired Helpr: the job has someone working it. */
export const SEED_THREAD_STATUSES = ["completed", "in_progress", "accepted", "disputed"];
