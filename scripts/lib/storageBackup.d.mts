export const EXCLUDED_BUCKETS: Record<string, string>;
export const OBJECTS_SQL: string;
export function safeRelPath(bucket: string, name: string): string;
export function sha256(buf: Uint8Array): string;
export interface ManifestFile { bucket: string; name: string; size: number; sha256: string }
export interface Manifest { files: ManifestFile[]; byBucket: Record<string, number>; skipped: Record<string, number>; excluded: Record<string, string> }
export function backupObjects(io: {
  objects: { bucket_id: string; name: string; size: number | string }[];
  download: (bucket: string, name: string) => Promise<Uint8Array>;
  write: (rel: string, bytes: Uint8Array) => Promise<void> | void;
}): Promise<{ manifest: Manifest; errors: string[] }>;
export function verifyRestore(io: {
  manifest: { files: ManifestFile[] };
  restoredRows: { bucket_id: string; name: string }[];
  read: (rel: string) => Uint8Array | null;
}): { problems: string[]; checked: number; pointed: number };
