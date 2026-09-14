/**
 * The storage a JOB owns, and removing it when the job row is deleted.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * The 2026-09-14 storage audit (docs/audit/storage-audit-2026-09-14.md) found
 * 7 proof photos, 5 chat attachments and 2 application attachments still in
 * storage for jobs that no longer existed. Nothing that deleted a job removed
 * its files, and once the row is gone nothing can reach them. `accountPurge`
 * keeps job media on purpose while the job SURVIVES (it is the other party's
 * evidence) — but `purge_user_data()` also DELETES the departing poster's
 * unfunded, unassigned, unapplied jobs, and those files were left behind.
 *
 * ── Rule ─────────────────────────────────────────────────────────────────────
 * Call this only for jobs whose row is confirmed GONE. A removal failure is
 * logged and returned, never thrown: the deletion the caller is performing
 * (an App Store–required account deletion) must never be blocked by a file.
 * The weekly storage-orphan-sweep is the net for anything this misses.
 *
 * Path schemes, from the upload code:
 *   job-photos               <jobId>/…                        (useJobMediaUpload.ts)
 *   proof-photos             <jobId>/…, <jobId>/revisions/…   (PhotoProof, CompletionChoiceSheet)
 *                            <userId>/disputes/<jobId>/…      (DisputeDialog)
 *   message-attachments      <jobId>/<senderId>/…             (messageAttachments.ts)
 *                            voice-notes/<jobId>/<senderId>/…
 *   application-attachments  <helperId>/<jobId>/…             (useApplyFlow, AppliedJobsTab)
 *
 * Keep in step with scripts/lib/jobMediaRest.mjs (parity-tested in
 * src/test/storageDeletionPaths.test.ts).
 */

export interface JobMediaOwner {
  id: string;
  customer_id?: string | null;
  helper_id?: string | null;
  /** Every user who may have uploaded under a user-first prefix for this job. */
  party_ids?: (string | null | undefined)[];
}

export interface StoragePrefix {
  bucket: string;
  prefix: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function jobMediaPrefixes(job: JobMediaOwner): StoragePrefix[] {
  if (!UUID_RE.test(job.id)) return [];
  const parties = [...new Set([job.customer_id, job.helper_id, ...(job.party_ids ?? [])])].filter(
    (p): p is string => typeof p === "string" && UUID_RE.test(p),
  );
  return [
    { bucket: "job-photos", prefix: job.id },
    { bucket: "proof-photos", prefix: job.id },
    { bucket: "message-attachments", prefix: job.id },
    { bucket: "message-attachments", prefix: `voice-notes/${job.id}` },
    ...parties.map((p) => ({ bucket: "proof-photos", prefix: `${p}/disputes/${job.id}` })),
    ...parties.map((p) => ({ bucket: "application-attachments", prefix: `${p}/${job.id}` })),
  ];
}

/** Structural: only the storage surface this file uses. */
interface StorageCapableClient {
  storage: {
    // deno-lint-ignore no-explicit-any
    from(bucket: string): any;
  };
}

/** Every object path under a prefix, recursing into sub-prefixes (id === null). */
export async function listObjectsUnder(
  client: StorageCapableClient,
  bucket: string,
  prefix: string,
): Promise<string[]> {
  const found: string[] = [];
  const queue = [prefix];
  let visited = 0;
  while (queue.length > 0 && visited < 500) {
    const current = queue.shift()!;
    visited++;
    const { data, error }: { data: { name: string; id?: string | null }[] | null; error: { message: string } | null } =
      await client.storage.from(bucket).list(current, { limit: 1000 });
    if (error) throw new Error(error.message);
    for (const entry of data ?? []) {
      const path = `${current}/${entry.name}`;
      if (entry.id == null) queue.push(path);
      else found.push(path);
    }
    if ((data?.length ?? 0) >= 1000) throw new Error(`listing ${bucket}/${current} hit the 1000-object page limit`);
  }
  if (queue.length > 0) throw new Error(`listing ${bucket}/${prefix} exceeded the traversal bound`);
  return found;
}

export interface JobMediaRemoval {
  removed: number;
  failures: string[];
}

/**
 * Remove every object the given (already deleted) jobs owned. Never throws.
 * Failures are logged with `source` and returned so the caller can record them.
 */
export async function removeJobMedia(
  client: StorageCapableClient,
  jobs: JobMediaOwner[],
  source: string,
): Promise<JobMediaRemoval> {
  let removed = 0;
  const failures: string[] = [];
  for (const job of jobs) {
    for (const { bucket, prefix } of jobMediaPrefixes(job)) {
      try {
        // `<userId>/disputes/…` and `<userId>/reviews/…` share the top level
        // with `<jobId>/…`. Never treat those user-shaped sub-folders as job media.
        const paths = (await listObjectsUnder(client, bucket, prefix)).filter(
          (p) => !(prefix === job.id && /^[^/]+\/(disputes|reviews)\//.test(p)),
        );
        if (paths.length === 0) continue;
        const { data, error }: { data: { name: string }[] | null; error: { message: string } | null } =
          await client.storage.from(bucket).remove(paths);
        if (error) throw new Error(error.message);
        // `remove` answers { data: [], error: null } for paths it did not
        // delete. Count what came back, never what was asked for.
        const n = data?.length ?? 0;
        removed += n;
        if (n < paths.length) failures.push(`${bucket}/${prefix}: removed ${n} of ${paths.length}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // A missing bucket is an environment difference, not a leak.
        if (/bucket not found|does not exist/i.test(msg)) continue;
        failures.push(`${bucket}/${prefix}: ${msg}`);
      }
    }
  }
  if (failures.length > 0) {
    console.error(`[${source}] job media removal incomplete (${removed} removed):`, failures.join("; "));
  }
  return { removed, failures };
}
