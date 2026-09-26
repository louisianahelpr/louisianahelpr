/**
 * DR-004: which database columns point at Storage objects, and how to read a
 * stored value as `bucket/path`.
 *
 * After a database restore, rows come back pointing at files that live outside
 * Postgres. Storage objects are in no database backup (Supabase docs; see
 * docs/runbooks/restore-from-backup.md §4), and account deletion removes them
 * for good (supabase/functions/_shared/accountPurge.ts). So a restored row can
 * name a file that no longer exists, and nothing would say so until a user
 * opens a blank avatar or an admin opens a missing credential scan.
 * scripts/check-storage-refs.mjs reads every column below and lists each value
 * whose object is missing. This file is the pure half: the column inventory and
 * the value parser. src/test/storageRefs.test.ts derives the candidate columns
 * from src/integrations/supabase/types.ts and fails when one is in neither list
 * below, so a new photo/document column cannot be left out of the check.
 *
 * `bucket` is where a BARE path in that column lives (the upload site is named
 * beside each). A full Storage URL names its own bucket and wins. `bucket: null`
 * means the column has no Storage writer in the app, so only full Storage URLs
 * in it are checked and a bare value is reported as unresolved.
 */

/** @typedef {{ table: string, column: string, array: boolean, bucket: string | null, writer: string }} RefColumn */

/** @type {RefColumn[]} */
export const STORAGE_REFERENCE_COLUMNS = [
  { table: "applications", column: "attachment_urls", array: true, bucket: "application-attachments", writer: "src/pages/jobs/AppliedJobsTab.tsx (path)" },
  { table: "disputes", column: "evidence_urls", array: true, bucket: "proof-photos", writer: "src/components/DisputeTimelineDialog.tsx (path)" },
  { table: "group_job_helpers", column: "proof_before_urls", array: true, bucket: "proof-photos", writer: "group-job proof upload (path)" },
  { table: "group_job_helpers", column: "proof_after_urls", array: true, bucket: "proof-photos", writer: "group-job proof upload (path)" },
  { table: "helper_credentials", column: "document_url", array: false, bucket: "user-documents", writer: "src/components/profile/CredentialsTab.tsx (path)" },
  { table: "job_revisions", column: "photos", array: true, bucket: "proof-photos", writer: "src/pages/posts/CompletionChoiceSheet.tsx (<jobId>/revisions/...)" },
  { table: "jobs", column: "photos", array: true, bucket: "job-photos", writer: "src/pages/post-job/useJobMediaUpload.ts (public URL)" },
  { table: "jobs", column: "scope_video_url", array: false, bucket: "job-photos", writer: "src/pages/post-job/useJobMediaUpload.ts (public URL)" },
  { table: "jobs", column: "proof_before_urls", array: true, bucket: "proof-photos", writer: "src/components/PhotoProof.tsx (path)" },
  { table: "jobs", column: "proof_after_urls", array: true, bucket: "proof-photos", writer: "src/components/PhotoProof.tsx (path)" },
  { table: "jobs", column: "dispute_evidence_urls", array: true, bucket: "proof-photos", writer: "src/components/DisputeTimelineDialog.tsx (legacy path)" },
  { table: "marketing_content", column: "media_urls", array: true, bucket: "marketing-media", writer: "src/components/admin/marketing/marketingMedia.ts (public URL)" },
  { table: "messages", column: "attachment_url", array: false, bucket: "message-attachments", writer: "src/lib/messageAttachments.ts (path)" },
  { table: "pet_profiles", column: "photo_url", array: false, bucket: null, writer: "none: petProfilesHelpers.ts says it is deliberately not written" },
  { table: "profiles", column: "avatar_url", array: false, bucket: "avatars", writer: "src/lib/avatarStorage.ts, complete-signup (public URL)" },
  { table: "profiles", column: "portfolio_urls", array: true, bucket: "avatars", writer: "src/lib/portfolioStorage.ts (public URL or path)" },
  { table: "profiles", column: "license_url", array: false, bucket: "user-documents", writer: "src/components/profile/CredentialsTab.tsx, complete-signup (path)" },
  { table: "profiles", column: "insurance_url", array: false, bucket: "user-documents", writer: "src/components/profile/CredentialsTab.tsx, complete-signup (path)" },
  { table: "reviews", column: "photo_urls", array: true, bucket: "job-photos", writer: "src/components/reviewPanel/ReviewForm.tsx (public URL)" },
];

/**
 * Columns whose NAME looks like a file reference but which never hold a Storage
 * object, each with the reason. Two-way with types.ts in the test.
 */
export const NOT_STORAGE_COLUMNS = {
  "analytics_events.url": "the page URL an event fired on",
  "error_logs.url": "the page URL an error happened on",
  "marketing_content.external_url": "the published post's URL on Instagram/Facebook",
  "messages.attachment_duration": "voice-note length in seconds",
  "messages.attachment_mime": "the attachment's content type",
  "messages.attachment_size": "the attachment's size in bytes",
  "jobs.require_photo_proof": "a boolean setting",
  "platform_settings.social_webhook_url": "an outbound webhook endpoint",
  "profiles.hourly_rate": "a number ('hourly' contains 'url')",
  "str_calendar_connections.ical_url": "an external iCal feed URL",
};

/** The regex the test uses to find candidate columns in types.ts. */
export const CANDIDATE_COLUMN = /(url|path|photo|image|attachment|document|video|avatar|file|media|proof)/;

const STORAGE_URL = /\/storage\/v1\/(?:object|render\/image)\/(?:public|sign|authenticated)\/([^/?#]+)\/([^?#]+)/;

function decode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s; // a stray % stays literal; the listing lookup then reports it missing
  }
}

/**
 * Read one stored value.
 *   { kind: "object", bucket, path, host }   a Storage object (host null for a bare path)
 *   { kind: "external", value }              a URL that is not Supabase Storage
 *   { kind: "inline", value }                a data: URL (no object behind it)
 *   { kind: "unresolved", value }            cannot tell which object this is
 */
export function resolveStorageRef(value, defaultBucket) {
  if (typeof value !== "string" || value.trim() === "") return { kind: "unresolved", value };
  const v = value.trim();
  if (/^data:/i.test(v)) return { kind: "inline", value: v };
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) {
    let url;
    try {
      url = new URL(v);
    } catch {
      return { kind: "unresolved", value: v };
    }
    const m = url.pathname.match(STORAGE_URL);
    if (!m) return { kind: "external", value: v };
    return { kind: "object", bucket: decode(m[1]), path: decode(m[2]), host: url.host };
  }
  // A bare path: `<bucket-relative path>`. Leading slashes are not part of a key.
  const path = v.replace(/^\/+/, "");
  if (!defaultBucket || !path || path.includes("..")) return { kind: "unresolved", value: v };
  return { kind: "object", bucket: defaultBucket, path, host: null };
}

/** Split `a/b/c.png` into the folder to list (`a/b`) and the name to find (`c.png`). */
export function splitObjectPath(path) {
  const i = path.lastIndexOf("/");
  return i < 0 ? { dir: "", name: path } : { dir: path.slice(0, i), name: path.slice(i + 1) };
}

/**
 * Flatten rows into references. `rows` are `{ id, [column]: value }` as read
 * from PostgREST for one RefColumn.
 */
export function referencesFromRows(col, rows) {
  const out = [];
  for (const row of rows) {
    const raw = row[col.column];
    if (raw === null || raw === undefined) continue;
    const values = col.array ? (Array.isArray(raw) ? raw : [raw]) : [raw];
    for (const value of values) {
      out.push({ table: col.table, column: col.column, id: row.id, value, ref: resolveStorageRef(value, col.bucket) });
    }
  }
  return out;
}

/**
 * Grade references against what the listing found.
 * `listed`: Map of `${bucket}/${dir}` -> Set of object names in that folder
 *   (every folder `foldersToList` asked for must be present; an absent key is a
 *   failed listing and is reported, never read as "missing").
 * `projectHost`: the host of the project being checked. A Storage URL on any
 *   other host points at a different project: after a restore into a NEW
 *   project that is every public avatar/photo URL, and they break when the old
 *   project is gone.
 */
export function gradeReferences(refs, listed, projectHost) {
  const result = { checked: 0, present: 0, missing: [], foreign: [], unresolved: [], external: 0, inline: 0, unlisted: [] };
  for (const r of refs) {
    const { ref } = r;
    if (ref.kind === "external") {
      result.external++;
      continue;
    }
    if (ref.kind === "inline") {
      result.inline++;
      continue;
    }
    if (ref.kind === "unresolved") {
      result.unresolved.push(r);
      continue;
    }
    if (ref.host && projectHost && ref.host !== projectHost) {
      result.foreign.push(r);
      continue;
    }
    const { dir, name } = splitObjectPath(ref.path);
    const names = listed.get(`${ref.bucket}/${dir}`);
    if (!names) {
      result.unlisted.push(r);
      continue;
    }
    result.checked++;
    if (names.has(name)) result.present++;
    else result.missing.push(r);
  }
  return result;
}

/** The distinct `{ bucket, dir }` folders the references need listed. */
export function foldersToList(refs, projectHost) {
  const seen = new Map();
  for (const { ref } of refs) {
    if (ref.kind !== "object") continue;
    if (ref.host && projectHost && ref.host !== projectHost) continue;
    const { dir } = splitObjectPath(ref.path);
    seen.set(`${ref.bucket}/${dir}`, { bucket: ref.bucket, dir });
  }
  return [...seen.values()];
}
