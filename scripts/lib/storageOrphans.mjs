/**
 * Storage orphan rules: which row owns an object, and when an object may be
 * deleted because that row is gone. Pure functions, no I/O, so every rule the
 * weekly sweep (scripts/storage-orphan-sweep.mjs) acts on is unit-tested in
 * src/test/storageOrphanSweep.test.ts.
 *
 * Path schemes come from the upload code, recorded in
 * docs/audit/storage-audit-2026-09-14.md. An object whose path matches no
 * scheme is NEVER an orphan: an unknown path means we do not know its owner,
 * and "we don't know" must never turn into a delete.
 *
 * A "world" is one read of the owning tables:
 *   { profileUserIds: Set, authUserIds: Set, jobIds: Set, attachmentRefs: string[] }
 * attachmentRefs are the raw `messages.attachment_url` values (a bare object
 * path or a full URL containing it).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Buckets whose objects identify a PERSON, keyed `<userId>/...`. */
export const USER_BUCKETS = ["avatars", "id-documents", "user-documents", "profile-videos"];

/**
 * Identity documents. The owner said: never delete from these unless the owner
 * is confirmed absent from BOTH profiles and auth.users. The sweep applies that
 * to every user-keyed check (it is the stricter reading), but these two are
 * named so a later loosening elsewhere cannot reach them.
 */
export const IDENTITY_DOCUMENT_BUCKETS = ["id-documents", "user-documents"];

export const DEFAULTS = Object.freeze({
  minAgeDays: 7,
  maxFiles: 50,
  maxBucketPct: 5,
  waitMinutes: 10,
});

function userAbsent(world, id) {
  return !world.profileUserIds.has(id) && !world.authUserIds.has(id);
}
function userPresent(world, id) {
  return world.profileUserIds.has(id) || world.authUserIds.has(id);
}

function attachmentReferenced(world, path) {
  return world.attachmentRefs.some((ref) => {
    if (!ref) return false;
    if (ref === path) return true;
    let decoded = ref;
    try {
      decoded = decodeURIComponent(ref);
    } catch {
      /* keep raw */
    }
    return decoded.split("?")[0].endsWith(`/message-attachments/${path}`) || decoded === path;
  });
}

/**
 * Why this object is an orphan in `world`, or null when it is owned (or its
 * owner cannot be determined).
 */
export function orphanReason(bucket, name, world) {
  const seg = name.split("/");
  const isId = (s) => typeof s === "string" && UUID_RE.test(s);

  if (USER_BUCKETS.includes(bucket)) {
    if (!isId(seg[0]) || seg.length < 2) return null;
    return userAbsent(world, seg[0]) ? "user gone" : null;
  }

  if (bucket === "application-attachments") {
    // <helperId>/<jobId>/<file>
    if (!isId(seg[0]) || !isId(seg[1]) || seg.length < 3) return null;
    if (userAbsent(world, seg[0])) return "helper gone";
    return world.jobIds.has(seg[1]) ? null : "job gone";
  }

  if (bucket === "proof-photos" || bucket === "job-photos") {
    if (!isId(seg[0]) || seg.length < 2) return null;
    // <userId>/disputes/<jobId>/... (proof-photos) and <userId>/reviews/... (job-photos)
    // These are EVIDENCE on records that outlive the uploader: a dispute lives
    // on its job, a review survives with reviewer_id nulled. accountPurge keeps
    // them on purpose, so "user gone" must never delete them. A dispute photo
    // goes only when its job is gone; a review photo is never swept.
    if (seg[1] === "disputes") {
      return isId(seg[2]) && !world.jobIds.has(seg[2]) ? "job gone" : null;
    }
    if (seg[1] === "reviews") return null;
    // <jobId>/... — but a first segment that is a LIVE USER is a user folder of
    // some shape we do not model (e.g. a test upload). Its owner exists: skip.
    if (userPresent(world, seg[0])) return null;
    return world.jobIds.has(seg[0]) ? null : "job gone";
  }

  if (bucket === "message-attachments") {
    // <jobId>/<senderId>/<file>  or  voice-notes/<jobId>/<senderId>/<file>
    const off = seg[0] === "voice-notes" ? 1 : 0;
    const jobId = seg[off];
    if (!isId(jobId) || seg.length < off + 3) return null;
    if (!world.jobIds.has(jobId)) return "job gone";
    return attachmentReferenced(world, name) ? null : "unreferenced";
  }

  // business-documents, social-posts, marketing-media, anything new: no owner
  // convention, so never an orphan.
  return null;
}

/** Stricter gate for identity documents: absent from BOTH tables, or keep. */
export function identityDocumentDeletable(bucket, name, world) {
  if (!IDENTITY_DOCUMENT_BUCKETS.includes(bucket)) return true;
  const owner = name.split("/")[0];
  return !world.profileUserIds.has(owner) && !world.authUserIds.has(owner);
}

/**
 * The orphans that may be deleted.
 *
 * `objects`: [{ bucket, name, size, createdAt }]
 * `first`, `second`: two worlds read at least `waitMinutes` apart
 *   (`first.readAt`, `second.readAt` in ms).
 *
 * An object qualifies only when BOTH reads call it an orphan, it is at least
 * `minAgeDays` old (an upload whose row is not written yet is never touched),
 * and, for identity documents, the owner is absent from both tables in both
 * reads. Returns { orphans, skippedYoung, skippedSecondRead, error }.
 */
export function selectOrphans({ objects, first, second, now, minAgeDays = DEFAULTS.minAgeDays, waitMinutes = DEFAULTS.waitMinutes }) {
  if (!first || !second) return { orphans: [], skippedYoung: [], skippedSecondRead: [], error: "two reads are required" };
  const gapMs = second.readAt - first.readAt;
  if (!(gapMs >= waitMinutes * 60_000)) {
    return {
      orphans: [],
      skippedYoung: [],
      skippedSecondRead: [],
      error: `reads were ${Math.round(gapMs / 1000)}s apart; at least ${waitMinutes} min is required`,
    };
  }
  const floorMs = minAgeDays * 24 * 60 * 60_000;
  const orphans = [];
  const skippedYoung = [];
  const skippedSecondRead = [];
  for (const o of objects) {
    const r1 = orphanReason(o.bucket, o.name, first);
    if (!r1) continue;
    const created = Date.parse(o.createdAt);
    if (!Number.isFinite(created) || now - created < floorMs) {
      skippedYoung.push({ ...o, reason: r1 });
      continue;
    }
    const r2 = orphanReason(o.bucket, o.name, second);
    if (!r2 || !identityDocumentDeletable(o.bucket, o.name, first) || !identityDocumentDeletable(o.bucket, o.name, second)) {
      skippedSecondRead.push({ ...o, reason: r1 });
      continue;
    }
    orphans.push({ ...o, reason: r2 });
  }
  return { orphans, skippedYoung, skippedSecondRead, error: null };
}

/**
 * Hard caps. Tripped means the matching is probably wrong: delete NOTHING and
 * alert. Over `maxFiles` orphans in total, or over `maxBucketPct` percent of
 * any one bucket's objects.
 */
export function checkCaps({ orphans, objects, maxFiles = DEFAULTS.maxFiles, maxBucketPct = DEFAULTS.maxBucketPct }) {
  const reasons = [];
  if (orphans.length > maxFiles) reasons.push(`${orphans.length} orphans is over the ${maxFiles}-file cap`);
  const totals = new Map();
  for (const o of objects) totals.set(o.bucket, (totals.get(o.bucket) ?? 0) + 1);
  const hits = new Map();
  for (const o of orphans) hits.set(o.bucket, (hits.get(o.bucket) ?? 0) + 1);
  for (const [bucket, n] of hits) {
    const total = totals.get(bucket) ?? 0;
    const pct = total === 0 ? 100 : (n / total) * 100;
    if (pct > maxBucketPct) reasons.push(`${bucket}: ${n} of ${total} objects (${pct.toFixed(1)}%) is over the ${maxBucketPct}% cap`);
  }
  return { tripped: reasons.length > 0, reasons };
}

export function formatMB(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
