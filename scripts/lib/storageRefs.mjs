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
  { table: "job_guarantee_claims", column: "photo_paths", array: true, bucket: "proof-photos", writer: "src/lib/guarantee/index.ts uploadGuaranteePhotos (<uid>/disputes/<jobId>/..., Q2450)" },
  { table: "job_missed_returns", column: "photos", array: true, bucket: "proof-photos", writer: "src/components/jobs/MissedReturnSheet.tsx (<uid>/disputes/<jobId>/missed-..., owner #4)" },
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
  { table: "declutter_item_photos", column: "storage_path", array: false, bucket: "job-photos", writer: "declutter_add_item_photo RPC (path <uid>/declutter/<item>/<file>; Declutter slice 2 uploads it)" },
  { table: "declutter_strikes", column: "appeal_photo_path", array: false, bucket: "job-photos", writer: "none yet: the Declutter strike-appeal RPC (a later slice) writes a job-photos path" },
  // Declutter slice 4 (20261015042253): porch and problem photos, in the PRIVATE declutter-handover bucket (20261017055502), paths under <uid>/declutter/<handover|problem>/<order>/.
  { table: "declutter_handovers", column: "set_out_photo_path", array: false, bucket: "declutter-handover", writer: "declutter_porch_photo RPC, seller's set-out photo (src/lib/declutter/handover.ts uploads it; path)" },
  { table: "declutter_handovers", column: "picked_up_photo_path", array: false, bucket: "declutter-handover", writer: "declutter_porch_photo RPC, buyer's picked-up photo (src/lib/declutter/handover.ts uploads it; path)" },
  { table: "shop_handovers", column: "ready_photo_path", array: false, bucket: "shop-handover", writer: "shops_mark_ready RPC, the shop's ready photo (src/lib/shops/handover.ts uploads it; path <uid>/shops/handover/<order>/<file>)" },
  { table: "shop_handovers", column: "problem_photo_path", array: false, bucket: "helpr-tasks", writer: "shop_helpr_answer_no_show RPC (20261107035259), the Helpr's proof photo copied onto the problem row; helpr_task_photo_ok checks it is the Helpr's own task folder (path <uid>/task/<task>/<file>); admins read it through shops_admin_queue" },
  { table: "declutter_problems", column: "photo_paths", array: true, bucket: "declutter-handover", writer: "declutter_report_problem RPC (up to 6 paths; the screens offer no problem photos yet)" },
  { table: "declutter_problems", column: "other_side_photo_paths", array: true, bucket: "declutter-handover", writer: "declutter_problem_add_side RPC, the other side's photos (20261029225634; up to 3 paths under <uid>/declutter/problem/<order>/, uploaded by src/components/declutter/DeclutterProblemPhotos.tsx)" },
  { table: "declutter_refund_requests", column: "seller_photo_paths", array: true, bucket: "declutter-handover", writer: "declutter_answer_refund RPC, the seller's photos on a part offer or a no (A3-74, 20261102041000; up to 3 paths under <uid>/declutter/problem/<order>/, uploaded by src/components/declutter/DeclutterProblemPhotos.tsx)" },
  { table: "declutter_refund_requests", column: "return_photo_path", array: false, bucket: "declutter-handover", writer: "declutter_return_dropped_off RPC, the buyer's drop-off photo (20261030071818 returns; path under <uid>/declutter/return/<order>/, checked by declutter_return_photo_ok)" },
  { table: "declutter_refund_requests", column: "returned_photo_path", array: false, bucket: "declutter-handover", writer: "declutter_refund_item_returned RPC, the seller's photo of the item back (20261030071818 returns; optional path under <uid>/declutter/return/<order>/)" },
  { table: "declutter_wanted", column: "photo_paths", array: true, bucket: "job-photos", writer: "declutter_add_wanted_photo / declutter_remove_wanted_photo RPCs (20261030064727; up to 3 paths <uid>/wanted/<wanted_id>/<file>)" },
  { table: "declutter_refund_requests", column: "photo_paths", array: true, bucket: "declutter-handover", writer: "declutter_ask_refund RPC, the buyer's refund photos (20261029225634; up to 3 paths under <uid>/declutter/problem/<order>/, uploaded by src/components/declutter/DeclutterProblemPhotos.tsx)" },
  { table: "job_quotes", column: "photo_paths", array: true, bucket: "job-photos", writer: "src/lib/quotes/api.ts uploadQuotePhoto (path <uid>/quotes/<file>; submit_job_quote refuses a path outside the quoter's own folder)" },
  // Declutter slice 5 (20261017055505): Helpr delivery photos and truck photos, in the PRIVATE helpr-tasks bucket.
  { table: "helpr_tasks", column: "pickup_photo_path", array: false, bucket: "helpr-tasks", writer: "helpr_task_picked_up RPC, the Helpr's photo at the pickup (src/lib/helprTasks/api.ts uploads it; path <uid>/task/<task>/<file>)" },
  { table: "helpr_tasks", column: "dropoff_photo_path", array: false, bucket: "helpr-tasks", writer: "helpr_task_delivered RPC, the Helpr's photo at the drop-off (src/lib/helprTasks/api.ts uploads it; path <uid>/task/<task>/<file>)" },
  { table: "helpr_tasks", column: "return_photo_path", array: false, bucket: "helpr-tasks", writer: "helpr_task_returned RPC (BUY-36), the Helpr's photo of the item back at the pickup (helpr_task_photo_ok checks the path; path <uid>/task/<task>/<file>)" },
  { table: "helpr_vehicles", column: "photo_path", array: false, bucket: "helpr-tasks", writer: "helpr_set_vehicle RPC, the Helpr's truck photo (src/lib/helprTasks/api.ts uploads it; path <uid>/vehicle/<file>)" },
  { table: "shop_photos", column: "storage_path", array: false, bucket: "job-photos", writer: "src/lib/shops/api.ts addShopPhoto -> shops_attach_photo RPC (path <uid>/shops/<file>)" },
  { table: "shop_item_photos", column: "storage_path", array: false, bucket: "job-photos", writer: "src/lib/shops/items.ts addShopItemPhoto -> shops_add_item_photo RPC (path <uid>/shop-items/<item id>/<file>)" },
  // Shops digital downloads (20261108182917): the private shop-digital bucket; the row's path is written by SQL.
  { table: "shop_item_files", column: "storage_path", array: false, bucket: "shop-digital", writer: "supabase/functions/shop-digital upload_url -> shops_digital_file_begin RPC (path <uid>/<item id>/<file id>.<ext>)" },
  { table: "maintenance_request_photos", column: "storage_path", array: false, bucket: "user-documents", writer: "rentals_file_request RPC (path <uid>/rentals/requests/<batch>/<file>; src/lib/rentals/api.ts uploads it)" },
  { table: "rental_properties", column: "ownership_proof_path", array: false, bucket: "user-documents", writer: "rentals_submit_ownership_proof RPC (path <uid>/rentals/<property>/<file>; src/lib/rentals/api.ts uploads it)" },
  { table: "rental_listing_photos", column: "storage_path", array: false, bucket: "listing-photos", writer: "rentals_add_listing_photo RPC (PRIVATE bucket since 20261019071203, path <uid>/rental-listings/<listing>/<file>; src/lib/rentals/listings.ts uploads it)" },
  { table: "shop_permits", column: "document_path", array: false, bucket: "user-documents", writer: "shops_submit_permit RPC (path <uid>/shop-permits/<kind>-<ts>.<ext>; src/lib/shops/permits.ts uploads it, 20261110195956)" },
  { table: "landlord_id_reviews", column: "front_path", array: false, bucket: "user-documents", writer: "rentals_submit_landlord_id RPC, the landlord's ID photo (path <uid>/landlord-id/<file>; src/lib/rentals/api.ts uploads it; nulled once the photo is deleted after review)" },
  { table: "landlord_id_reviews", column: "back_path", array: false, bucket: "user-documents", writer: "rentals_submit_landlord_id RPC, the optional back of the ID (path <uid>/landlord-id/<file>; src/lib/rentals/api.ts uploads it; nulled once the photo is deleted after review)" },
  { table: "sponsor_signups", column: "logo_path", array: false, bucket: "sponsor-logos", writer: "sponsor-25days edge function, a brand's logo (PRIVATE bucket, path signups/<signup id>.<ext>; service role only)" },
  { table: "sponsor_settings", column: "founder_photo_path", array: false, bucket: "sponsor-logos", writer: "sponsor-25days edge function ?action=founder_photo, admins only (PRIVATE bucket, path founder/<uuid>.<ext>)" },
];

/**
 * Columns whose NAME looks like a file reference but which never hold a Storage
 * object, each with the reason. Two-way with types.ts in the test.
 */
export const NOT_STORAGE_COLUMNS = {
  "shop_photo_byte_checks.storage_path": "Q1956 (20261112095000): a one-use stamp that the shop-photo-check edge function read this object's bytes; the photo itself is in shop_photos / shop_item_photos (checked above), the row is deleted at attach and a day-old one by the next stamp, so it never serves or keeps a file",
  "shop_item_files.file_name": "the name a buyer's download is saved as (Content-Disposition), not a storage path: the object is at shop_item_files.storage_path",
  "profile_job_photos.photo_path": "a copy of one path in jobs.proof_after_urls or group_job_helpers.proof_after_urls (both checked above): a Helpr's pick for their public page (20261105172514), shown only while it is still one of that job's after photos, so a missing file is already found through the job",
  "declutter_wanted.photo_added_at": "a timestamp: when the newest photo was added (20261030225143), not a file reference",
  "job_continue_days.done_without_new_photo_at": "a timestamp: when a continue day was marked done without a new after photo (20261108160000), not a file reference",
  "job_continue_days.new_after_photo_at": "a timestamp: when the Helpr added the new day's after photo (20261108160000), not a file reference (the photo is in the job's proof list)",
  "declutter_wanted.photos_cleared": "a subset of declutter_wanted.photo_paths, the checked column and the whole list: marks which of its paths a check passed (20261030225143); never read as a file to serve on its own",
  "declutter_wanted.photos_held": "a subset of declutter_wanted.photo_paths, the checked column and the whole list: marks which of its paths a check flagged (20261030225143); never read as a file to serve on its own",
  "shipping_return_labels.label_url": "train 7 (20261103212046): the EasyPost-hosted https URL of a bought test-mode return label (CHECK label_url LIKE 'https://%'), not an object in our storage",
  "shipments.label_path": "Shipping S1 (20261020024605): no rows and no writer until the S3 label worker, which picks the private label bucket and moves this column to STORAGE_REFERENCE_COLUMNS (docs/specs/shipping-draft.md 9.3, Q2259)",
  "declutter_photo_purge_queue.storage_path": "a queued object the declutter-photo-purge function DELETES (server-only queue, 20261101054258): a detached photo path waiting to stop existing, never one the app serves",
  "rental_photo_purge_queue.storage_path": "a queued object the listing-photo-purge cron DELETES (server-only queue, 20261019071203): a path waiting to stop existing, never one the app serves",
  "profiles.share_job_photos": "the member's boolean opt-out from showing their job photos (20261021001940, Terms 'Photos from jobs'); a switch, not a file reference",
  "analytics_events.url": "the page URL an event fired on",
  "error_logs.url": "the page URL an error happened on",
  "marketing_content.external_url": "the published post's URL on Instagram/Facebook",
  "messages.attachment_duration": "voice-note length in seconds",
  "messages.attachment_mime": "the attachment's content type",
  "messages.attachment_size": "the attachment's size in bytes",
  "jobs.require_photo_proof": "a boolean setting",
  "landlord_id_reviews.images_deleted_at": "a timestamp: when the ID photos were deleted after review (the paths are nulled then)",
  "platform_settings.social_webhook_url": "an outbound webhook endpoint",
  "profiles.hourly_rate": "a number ('hourly' contains 'url')",
  "shop_photos.photo_kind": "which slot the photo fills: 'logo', 'cover' or 'gallery' (a CHECK enum)",
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
