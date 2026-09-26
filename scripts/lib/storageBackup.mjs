/**
 * Q147: back up the uploaded FILES, not just the storage.objects rows that
 * point at them (owner decision 2026-09-23: every bucket except identity
 * documents).
 *
 * Before this, db-backup.yml restored every storage.objects ROW and none of the
 * bytes: measured 2026-09-26, 230 objects / ~9.3 MB across 7 buckets
 * (avatars 4, job-photos 92, message-attachments 27, proof-photos 102,
 * user-documents 5 incl. licence/insurance credentials). A restore would have
 * brought back dispute proof photos and credentials as dangling pointers.
 *
 * INCLUSION IS BY DEFAULT: every bucket that exists is backed up unless it is
 * listed in EXCLUDED_BUCKETS with a reason, so a new bucket is covered the day
 * it is created. The id-documents bucket was dropped by migration
 * 20260923165718 (Q196); its entry stays so that bucket can never come back and
 * be copied into a GitHub artifact.
 *
 * Pure logic with IO injected, so src/test/storageBackup.test.ts drives it with
 * fakes. The CLI is scripts/storage-backup.mjs.
 */
import { createHash } from "node:crypto";

/** @type {Record<string, string>} bucket -> why it is never copied */
export const EXCLUDED_BUCKETS = {
  "id-documents": "government ID images: owner decision 2026-09-23 (Q147), privacy. Bucket dropped by 20260923165718 (Q196); kept here so it can never be backed up if recreated",
};

export const OBJECTS_SQL =
  "select bucket_id, name, coalesce((metadata->>'size')::bigint, -1) as size from storage.objects order by bucket_id, name";

/** A storage path is used as a file path: refuse anything that could escape the output dir. */
export function safeRelPath(bucket, name) {
  const rel = `${bucket}/${name}`;
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(bucket)) throw new Error(`unsafe bucket id: ${bucket}`);
  if (name.startsWith("/") || name.split("/").some((seg) => seg === ".." || seg === "." || seg === "")) {
    throw new Error(`unsafe object name: ${rel}`);
  }
  return rel;
}

export const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/**
 * Download every non-excluded object. Any failed download or size mismatch is
 * a FAILED backup (never a partial one reported as whole).
 * @param {{ objects: {bucket_id:string, name:string, size:number|string}[],
 *   download: (bucket:string, name:string) => Promise<Uint8Array>,
 *   write: (rel:string, bytes:Uint8Array) => Promise<void> | void }} io
 */
export async function backupObjects({ objects, download, write }) {
  const files = [];
  const skipped = {};
  const errors = [];
  for (const o of objects) {
    if (o.bucket_id in EXCLUDED_BUCKETS) {
      skipped[o.bucket_id] = (skipped[o.bucket_id] ?? 0) + 1;
      continue;
    }
    // A folder placeholder has no bytes to keep.
    if (o.name.endsWith("/.emptyFolderPlaceholder")) continue;
    try {
      const rel = safeRelPath(o.bucket_id, o.name);
      const bytes = await download(o.bucket_id, o.name);
      const want = Number(o.size);
      if (want >= 0 && bytes.byteLength !== want) throw new Error(`size ${bytes.byteLength}, storage.objects says ${want}`);
      await write(rel, bytes);
      files.push({ bucket: o.bucket_id, name: o.name, size: bytes.byteLength, sha256: sha256(bytes) });
    } catch (e) {
      errors.push(`${o.bucket_id}/${o.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const byBucket = {};
  for (const f of files) byBucket[f.bucket] = (byBucket[f.bucket] ?? 0) + 1;
  return { manifest: { files, byBucket, skipped, excluded: EXCLUDED_BUCKETS }, errors };
}

/**
 * The restore drill's proof: every storage.objects row the restore brought back
 * (outside the excluded buckets) has its file in the backup, byte-identical to
 * the manifest.
 * @param {{ manifest: {files:{bucket:string,name:string,size:number,sha256:string}[]},
 *   restoredRows: {bucket_id:string, name:string}[],
 *   read: (rel:string) => Uint8Array | null }} io
 */
export function verifyRestore({ manifest, restoredRows, read }) {
  const problems = [];
  const byKey = new Map(manifest.files.map((f) => [`${f.bucket}/${f.name}`, f]));
  let checked = 0;
  for (const f of manifest.files) {
    const bytes = read(safeRelPath(f.bucket, f.name));
    if (!bytes) problems.push(`${f.bucket}/${f.name}: in the manifest, missing from the archive`);
    else if (bytes.byteLength !== f.size || sha256(bytes) !== f.sha256) problems.push(`${f.bucket}/${f.name}: bytes differ from the manifest`);
    else checked++;
  }
  let pointed = 0;
  for (const r of restoredRows) {
    if (r.bucket_id in EXCLUDED_BUCKETS || r.name.endsWith("/.emptyFolderPlaceholder")) continue;
    pointed++;
    if (!byKey.has(`${r.bucket_id}/${r.name}`)) problems.push(`${r.bucket_id}/${r.name}: restored row points at a file the backup does not have`);
  }
  return { problems, checked, pointed };
}
