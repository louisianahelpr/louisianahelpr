/**
 * Storage orphan rules: which row owns an object, and when an object may be
 * deleted because that row is gone. Pure functions, no I/O, so every rule the
 * weekly sweep (scripts/storage-orphan-sweep.mjs) acts on is unit-tested in
 * src/test/storageOrphanSweep.test.ts.
 *
 * Path schemes come from the upload code, recorded in
 * docs/archive/storage-audit-2026-09-14.md. An object whose path matches no
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
export const USER_BUCKETS = ["avatars", "user-documents"];

/**
 * Identity documents. The owner said: never delete from these unless the owner
 * is confirmed absent from BOTH profiles and auth.users. The sweep applies that
 * to every user-keyed check (it is the stricter reading), but these two are
 * named so a later loosening elsewhere cannot reach them. (`id-documents` was
 * dropped in Q196; `user-documents` is the one left.)
 */
export const IDENTITY_DOCUMENT_BUCKETS = ["user-documents"];

export const DEFAULTS = Object.freeze({
  minAgeDays: 7,
  maxFiles: 50,
  maxBucketPct: 5,
  maxBucketFiles: 5,
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

/**
 * The job a job-keyed object belongs to, read by the same path schemes as
 * orphanReason; null for user-keyed buckets, review photos and unknown shapes.
 */
export function owningJobId(bucket, name) {
  const seg = name.split("/");
  const isId = (s) => typeof s === "string" && UUID_RE.test(s);
  if (bucket === "application-attachments") return isId(seg[1]) ? seg[1] : null;
  if (bucket === "proof-photos" || bucket === "job-photos") {
    if (seg[1] === "disputes") return isId(seg[2]) ? seg[2] : null;
    if (seg[1] === "reviews") return null;
    return isId(seg[0]) ? seg[0] : null;
  }
  if (bucket === "message-attachments") {
    const off = seg[0] === "voice-notes" ? 1 : 0;
    return isId(seg[off]) ? seg[off] : null;
  }
  return null;
}

/**
 * docs/OPEN.md Q1149: a "job gone" object whose job the DATABASE logged
 * deleting as a SEED job (public.deleted_jobs_log, written by an AFTER DELETE
 * trigger on jobs; `world.deletedSeedJobs`: job id -> { from, until } in ms,
 * the job's created_at and its deletion). The caps guard against a wrong
 * MATCH; this is not a match, it is the database's own record that a test job
 * was deleted, so such files are swept without counting toward the caps and
 * without the min-age wait (no upload can be in flight for a job row that no
 * longer exists). Only a file CREATED within that job's lifetime qualifies: a
 * job id can be chosen by a client, so a later job reusing an id must not
 * vouch for files an earlier one left (lh-authz-rls review, 2026-10-03).
 * 2026-10-03: 228 such files tripped the caps and paged critical with
 * nothing wrong in the matching.
 */
export function seedJobDeleted(bucket, name, world, createdAtMs) {
  const id = owningJobId(bucket, name);
  const life = id ? world?.deletedSeedJobs?.get(id) : undefined;
  if (!life || !Number.isFinite(createdAtMs)) return false;
  // A window with no start fails closed (review LOW-4): no lower bound is no exemption.
  if (life.from == null || createdAtMs < life.from) return false;
  return createdAtMs <= life.until;
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
    const seed =
      r1 === "job gone" &&
      orphanReason(o.bucket, o.name, second) === "job gone" &&
      seedJobDeleted(o.bucket, o.name, first, created) &&
      seedJobDeleted(o.bucket, o.name, second, created);
    if (!seed && (!Number.isFinite(created) || now - created < floorMs)) {
      skippedYoung.push({ ...o, reason: r1 });
      continue;
    }
    const r2 = orphanReason(o.bucket, o.name, second);
    if (!r2 || !identityDocumentDeletable(o.bucket, o.name, first) || !identityDocumentDeletable(o.bucket, o.name, second)) {
      skippedSecondRead.push({ ...o, reason: r1 });
      continue;
    }
    orphans.push(seed ? { ...o, reason: "seed job deleted", seedDeleted: true } : { ...o, reason: r2 });
  }
  return { orphans, skippedYoung, skippedSecondRead, error: null };
}

/**
 * A sweep that MEASURED NOTHING must never report "clean".
 *
 * The failure shape this closes is a real one in this repo: a sweeper printed
 * `"OK — all stranded rows unwound."` for five days over five genuinely stuck
 * rows, because the thing it measured came back empty and empty read as clean.
 * `storage-orphan-sweep.mjs` had the same hole: `listObjects()` returning `[]`
 * — a revoked service key, a renamed bucket, a listing API change, a 500 that
 * the pagination loop swallowed — produced
 * `storage orphan sweep: 0 files, 0.0 MB removed (0 objects, 0.0 MB total)`
 * and exit 0. Prod has thousands of objects; zero is never an answer, it is a
 * broken read.
 *
 * Returns the error string, or null when the listing is real.
 */
export function emptyListingError(objects, buckets) {
  const n = Array.isArray(objects) ? objects.length : -1;
  if (n > 0) return null;
  return (
    `listed ${n < 0 ? "no array of" : n} objects across ${Array.isArray(buckets) ? buckets.length : 0} bucket(s) — ` +
    `a sweep that measured nothing must never report clean. Check the service-role key and the bucket list.`
  );
}

/**
 * Hard caps. Tripped means the matching is probably wrong: delete NOTHING and
 * alert. Over `maxFiles` orphans in total, or any one bucket whose orphans are
 * BOTH over `maxBucketFiles` files AND over `maxBucketPct` percent of it.
 */
export function checkCaps({
  orphans,
  objects,
  maxFiles = DEFAULTS.maxFiles,
  maxBucketPct = DEFAULTS.maxBucketPct,
  maxBucketFiles = DEFAULTS.maxBucketFiles,
}) {
  const reasons = [];
  // A deleted seed job's files (Q1149, seedJobDeleted) are explained by the
  // database itself; the caps judge only the orphans nothing explains.
  orphans = orphans.filter((o) => !o.seedDeleted);
  if (orphans.length > maxFiles) reasons.push(`${orphans.length} orphans is over the ${maxFiles}-file cap`);
  const totals = new Map();
  for (const o of objects) totals.set(o.bucket, (totals.get(o.bucket) ?? 0) + 1);
  const hits = new Map();
  for (const o of orphans) hits.set(o.bucket, (hits.get(o.bucket) ?? 0) + 1);
  for (const [bucket, n] of hits) {
    const total = totals.get(bucket) ?? 0;
    const pct = total === 0 ? 100 : (n / total) * 100;
    // BOTH conditions (owner, 2026-09-14): a bucket of 4 objects with one leaked
    // file is 25% but is cleanup, not a matching bug.
    if (n > maxBucketFiles && pct > maxBucketPct) reasons.push(`${bucket}: ${n} of ${total} objects (${pct.toFixed(1)}%) is over the ${maxBucketPct}% cap`);
  }
  return { tripped: reasons.length > 0, reasons };
}

/**
 * Avatars must be browser-cacheable. The app re-renders the same avatar URL
 * on every list, card and header, and its `?t=` cache-buster already changes
 * the URL on replace, so an object stored `no-cache` is refetched on every
 * render: one test account's avatar, uploaded `no-cache` by an unknown tool
 * on 2026-09-20, made 527 of the GETs that pushed journeys-webkit over its
 * request budget (nightly-red #1719). Returns every avatar object whose
 * stored cacheControl has no positive max-age, or says no-cache / no-store.
 */
export function uncacheableAvatars(objects) {
  return objects.filter((o) => {
    if (o.bucket !== "avatars") return false;
    const cc = String(o.cacheControl ?? "").toLowerCase();
    if (/no-cache|no-store/.test(cc)) return true;
    const m = /max-age=(\d+)/.exec(cc);
    return !m || Number(m[1]) <= 0;
  });
}

export function formatMB(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
