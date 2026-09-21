export interface OwnerWorld {
  readAt?: number;
  profileUserIds: Set<string>;
  authUserIds: Set<string>;
  jobIds: Set<string>;
  attachmentRefs: string[];
}
export interface StoredObject {
  bucket: string;
  name: string;
  size: number;
  createdAt: string;
}
export type OrphanObject = StoredObject & { reason: string };
export const USER_BUCKETS: string[];
export const IDENTITY_DOCUMENT_BUCKETS: string[];
export const DEFAULTS: Readonly<{ minAgeDays: number; maxFiles: number; maxBucketPct: number; waitMinutes: number }>;
export function orphanReason(bucket: string, name: string, world: OwnerWorld): string | null;
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
