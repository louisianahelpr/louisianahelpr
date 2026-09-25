/**
 * Removing a run's proof photos WITHOUT leaving the job row pointing at them.
 *
 * prod-lifecycle.spec.ts uploads real before/after photos through the app and
 * removes the objects in its teardown. The job row survives the run (a funded
 * job cannot be deleted), and it still names both objects in
 * `proof_before_urls` / `proof_after_urls`. Every screen that shows the job then
 * signs a path storage no longer has: `400 POST /object/sign/proof-photos/…`,
 * which is what press-every-control run 36069319716 failed on four times
 * ("Baton Rouge — tap to expand this job" on /posts). Measured on prod
 * 2026-09-25: 6 job rows named a missing proof object, all is_seed, 5 of them
 * "[E2E DO NOT ACCEPT] automated lifecycle" jobs left in_progress.
 *
 * So the teardown DETACHES first: it rewrites each job's arrays without this
 * run's paths (the assigned helper may write both columns;
 * enforce_helper_jobs_column_whitelist) and deletes an object only once the row
 * that named it has been confirmed rewritten. A row that could not be rewritten
 * keeps its object.
 */

export type ProofRow = {
  id: string;
  proof_before_urls: string[] | null;
  proof_after_urls: string[] | null;
};

/** Group object paths (`<jobId>/<file>`) by the job whose folder holds them. */
export function pathsByJob(paths: readonly string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const p of paths) {
    const jobId = p.split("/")[0];
    if (!jobId) continue;
    out.set(jobId, [...(out.get(jobId) ?? []), p]);
  }
  return out;
}

/** The PATCH body that leaves the row naming none of `paths`. */
export function withoutPaths(row: ProofRow, paths: readonly string[]) {
  const drop = new Set(paths);
  return {
    proof_before_urls: (row.proof_before_urls ?? []).filter((v) => !drop.has(v)),
    proof_after_urls: (row.proof_after_urls ?? []).filter((v) => !drop.has(v)),
  };
}

/** Does the row still name any of `paths`? An object it names must not be deleted. */
export function rowStillNames(row: ProofRow, paths: readonly string[]): boolean {
  const named = new Set([...(row.proof_before_urls ?? []), ...(row.proof_after_urls ?? [])]);
  return paths.some((p) => named.has(p));
}
