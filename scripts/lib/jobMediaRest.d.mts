export interface JobMediaOwner {
  id: string;
  customer_id?: string | null;
  helper_id?: string | null;
  party_ids?: (string | null | undefined)[];
}
export interface StoragePrefix {
  bucket: string;
  prefix: string;
}
export interface RemovalResult {
  removed: number;
  failures: string[];
}
type Conn = { base: string; headers: Record<string, string>; source?: string };
export function jobMediaPrefixes(job: JobMediaOwner): StoragePrefix[];
export function userStoragePrefixes(userId: string): StoragePrefix[];
export function messageAttachmentPath(url: string | null | undefined): string | null;
export function removePrefixes(args: Conn & { prefixes: StoragePrefix[] }): Promise<RemovalResult>;
export function removeMessageAttachmentsRest(args: Conn & { attachmentUrls: string[] }): Promise<RemovalResult>;
export function removeJobMediaRest(args: Conn & { jobs: JobMediaOwner[] }): Promise<RemovalResult>;
export function removeUserStorageRest(args: Conn & { userIds: string[] }): Promise<RemovalResult>;
export function callerReadsBuckets(headers: Record<string, string> | Headers | undefined | null): boolean;
