/**
 * The buckets account deletion erases, and the check that each one EXISTS.
 *
 * Q219: a service-role `storage.from(b).list(prefix)` against a bucket that
 * does not exist answers `{ data: [], error: null }` (HTTP 200). A misspelled
 * or dropped name in the list below therefore made account deletion report
 * `storage ok` while erasing nothing there, and the re-list verification could
 * not see it either (it lists the same nothing). The old "not found|does not
 * exist → skip" branches never fired for the same reason. The only way to tell
 * "missing" from "empty" is to ask Storage which buckets exist, so the purge
 * does that first and fails the step on any name it does not know.
 *
 * Kept in its own dependency-free module so vitest can run it
 * (src/test/purgeBucketsAreDeclared.test.ts); accountPurge.ts itself imports
 * Deno-only modules.
 */

/**
 * Buckets holding media that identifies the PERSON. These are erased.
 *
 * Deliberately NOT in this list: `job-photos`, `proof-photos`,
 * and `message-attachments`. Those are keyed by job, not by user, and they are
 * evidence attached to a record that
 * survives — a completed job, a settled dispute. Deleting them would destroy
 * the counterparty's evidence to satisfy this user's request, which is the
 * same mistake as cascading their reviews away.
 *
 * That reasoning holds only while the job row exists. The jobs
 * `purge_user_data()` itself deletes have their media removed afterwards by
 * `removeMediaOfDeletedJobs` (accountPurge.ts), never blocking.
 *
 * Every name here must be a bucket the migrations still declare
 * (src/test/purgeBucketsAreDeclared.test.ts), and at run time must exist
 * (`missingBuckets` below). `id-documents` (Q196) and `profile-videos`
 * (20260921212141) were removed with their buckets.
 */
export const IDENTITY_BUCKETS = [
  "avatars",
  "user-documents",
  "application-attachments",
] as const;

/** The one Storage call this module needs. */
export interface BucketListingClient {
  storage: {
    // deno-lint-ignore no-explicit-any
    listBuckets(): any;
  };
}

/**
 * The names in `wanted` that Storage does not have. Throws when Storage cannot
 * be asked at all: "could not check" must never read as "none missing".
 */
export async function missingBuckets(
  admin: BucketListingClient,
  wanted: readonly string[],
): Promise<string[]> {
  const { data, error }: {
    data: { id?: string; name?: string }[] | null;
    error: { message: string } | null;
  } = await admin.storage.listBuckets();
  if (error) throw new Error(`listBuckets failed: ${error.message}`);
  if (!Array.isArray(data)) throw new Error("listBuckets returned no bucket list");
  const have = new Set<string>();
  for (const b of data) {
    if (b.id) have.add(b.id);
    if (b.name) have.add(b.name);
  }
  return wanted.filter((b) => !have.has(b));
}
