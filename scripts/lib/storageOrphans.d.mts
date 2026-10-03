export interface OwnerWorld {
  readAt?: number;
  profileUserIds: Set<string>;
  authUserIds: Set<string>;
  jobIds: Set<string>;
  attachmentRefs: string[];
  /** public.deleted_jobs_log seed rows: job id -> its lifetime in ms (Q1149). */
  deletedSeedJobs?: Map<string, { from: number | null; until: number }>;
}
export interface StoredObject {
  bucket: string;
  name: string;
  size: number;
  createdAt: string;
  cacheControl?: string | null;
}
export type OrphanObject = StoredObject & { reason: string; seedDeleted?: boolean };
export const USER_BUCKETS: string[];
export const IDENTITY_DOCUMENT_BUCKETS: string[];
export const DEFAULTS: Readonly<{ minAgeDays: number; maxFiles: number; maxBucketPct: number; waitMinutes: number }>;
export function orphanReason(bucket: string, name: string, world: OwnerWorld): string | null;
export function owningJobId(bucket: string, name: string): string | null;
export function seedJobDeleted(bucket: string, name: string, world: OwnerWorld, createdAtMs: number): boolean;
export function identityDocumentDeletable(bucket: string, name: string, world: OwnerWorld): boolean;
export function selectOrphans(args: {
  objects: StoredObject[];
  first: OwnerWorld & { readAt: number };
  second: OwnerWorld & { readAt: number };
  now: number;
  minAgeDays?: number;
  waitMinutes?: number;
}): { orphans: OrphanObject[]; skippedYoung: OrphanObject[]; skippedSecondRead: OrphanObject[]; error: string | null };
export function checkCaps(args: {
  orphans: StoredObject[];
  objects: StoredObject[];
  maxFiles?: number;
  maxBucketPct?: number;
}): { tripped: boolean; reasons: string[] };
export function emptyListingError(objects: unknown, buckets: unknown): string | null;
export function formatMB(bytes: number): string;
export function uncacheableAvatars<T extends { bucket: string; cacheControl?: string | null }>(objects: T[]): T[];
