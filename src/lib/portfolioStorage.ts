// portfolioStorage — one place that knows what "remove a work photo" means.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY THIS EXISTS: REMOVING A WORK PHOTO DID NOT REMOVE IT
// ═══════════════════════════════════════════════════════════════════════════
//
// `usePortfolio` wrote helper work photos into the PUBLIC `avatars` bucket and
// had no removal path at all. `removePortfolioAt` did exactly one thing:
//
//     const next = portfolioUrls.filter((_, idx) => idx !== i);
//     await persistPortfolio(next);       // UPDATE profiles SET portfolio_urls
//
// The object was never touched. Reproduced against PROD on 2026-09-01 with a
// real signed-in test account: upload one photo, "remove" it from Edit Profile,
// and afterwards `profiles.portfolio_urls` is `[]` while the storage folder
// still lists the object and an anonymous GET of its public URL returns 200 —
// checked repeatedly over 30s, so this is not CDN lag, it is a live object.
//
// This is the same harm as the avatar orphan (`@/lib/avatarStorage`), and it is
// worse in one specific way: the avatar picker takes one file, this one takes
// six at a time from the camera roll. "Recent work" is where a member uploads
// six photos of a job, spots that one of them shows a customer's front door with
// the house number, or an invoice, or a child in the background — and deletes
// it. The tile disappears from their profile. They have every reason to believe
// it is gone. It is not: it is still served, publicly, at a URL that anyone who
// loaded the profile earlier already has.
//
// ── THE KEY SCHEME, AND WHY IT IS NOT THE AVATAR'S ────────────────────────
//
// An avatar is ONE object per user, so it gets ONE fixed key per content type
// and `upsert: true` makes a re-upload a true replacement. A portfolio holds N
// images, so a fixed key cannot work — and the two schemes that suggest
// themselves are both wrong:
//
//   * KEYED BY SLOT INDEX (`portfolio/1.jpg`). Reordering the array would then
//     mean physically moving bytes between keys, deleting the middle image
//     would renumber every image after it, and two tabs (or a retry) racing on
//     the same index would silently overwrite each other's photo. The array is
//     ordered; the storage layer should not have to be.
//
//   * KEYED BY FILE NAME. That is the original defect in a new place —
//     `IMG_01.JPEG` is user-controlled text — and it makes two different photos
//     that happen to share a camera-roll name collide.
//
// So each image gets a STABLE RANDOM ID, and the extension is derived from the
// content type exactly as the avatar's is:
//
//     <userId>/portfolio/<random-id>.<jpg|png|webp|gif>
//
// The consequences are the point:
//   * REORDER is a pure database operation. The array holds the URLs in display
//     order; nothing in storage moves, so a reorder cannot lose an image.
//   * REPLACE is an upload at a fresh id plus a reconcile — never an in-place
//     overwrite, so a failed upload cannot destroy the photo it was replacing.
//   * DELETE is a reconcile. See below.
//
// ── DELETION IS A RECONCILE, NOT A DELETE ─────────────────────────────────
//
// Deleting "the object for index i" would be correct only if the folder and the
// column were already in agreement — and the whole reason this module exists is
// that they are not. Every account that ever used the old code has objects in
// that folder with nothing pointing at them.
//
// So the operation is stated as an INVARIANT instead: the set of objects under
// `<userId>/portfolio/` must equal the set referenced by `portfolio_urls`.
// `reconcilePortfolioObjects` is handed the surviving list and deletes
// everything else in the folder. That makes it:
//   * correct for a single delete, a multi-delete, and a replace, with one code
//     path rather than three;
//   * self-healing — the first time a user with pre-existing orphans touches
//     their portfolio, the orphans go;
//   * idempotent, so a retry after a partial failure converges.
//
// It also has to FAIL CLOSED, because "delete everything not in this list" is
// destructive if the list is misread. If any surviving reference points into
// this folder but cannot be resolved to an object name, NOTHING is deleted.
//
// ── A NULL `error` FROM `.remove()` DOES NOT MEAN THE OBJECT WENT ─────────
//
// Same rule as `avatarStorage`, same reason: `.remove()` answers
// `{ data: [], error: null }` when RLS filtered every path out, when the object
// was already gone, and when the caller was not the owner. The sweep therefore
// re-lists the folder afterwards and reports by name anything still present. An
// unreadable folder is reported as still-exposed, never as clean.

import { report } from "@/lib/errorLogger";
import { AVATAR_MIME_EXT } from "@/lib/avatarStorage";

/**
 * Portfolio images share the `avatars` bucket with profile photos — same
 * bucket, same `allowed_mime_types`, same 5 MB cap, same owner-scoped RLS
 * (`(storage.foldername(name))[1] = auth.uid()`), which is what lets the owner
 * delete their own objects from the client.
 */
export const PORTFOLIO_BUCKET = "avatars";

/** Sub-prefix inside the user's folder. Keeps avatars and portfolio disjoint. */
export const PORTFOLIO_PREFIX = "portfolio";

/** The bucket's `file_size_limit`. Restated so the client can reject first. */
export const PORTFOLIO_MAX_BYTES = 5 * 1024 * 1024;

/**
 * The bucket's `allowed_mime_types` → canonical extension. Imported rather than
 * re-declared: it is the SAME bucket, so a second copy could drift and start
 * minting keys the bucket rejects.
 */
export const PORTFOLIO_MIME_EXT = AVATAR_MIME_EXT;

/** `<id>.<ext>` — the whole reachable name space under the portfolio prefix. */
const PORTFOLIO_OBJECT_NAME = /^[A-Za-z0-9._-]{1,80}$/;

/** A file the bucket would reject anyway, caught before the round trip. */
export class UnsupportedPortfolioImageError extends Error {
  constructor(contentType: string) {
    super(
      `That file type isn't supported for a work photo${
        contentType ? ` (${contentType})` : ""
      } — use JPG, PNG, WebP or GIF.`,
    );
    this.name = "UnsupportedPortfolioImageError";
  }
}

/** A file over the bucket's own cap. */
export class PortfolioImageTooLargeError extends Error {
  constructor(size: number) {
    super(
      `That image is ${(size / 1024 / 1024).toFixed(1)} MB — work photos are capped at 5 MB.`,
    );
    this.name = "PortfolioImageTooLargeError";
  }
}

/** Reject a file the bucket cannot store, with copy a person can act on. */
export function assertUploadablePortfolioImage(file: { type: string; size: number }): void {
  if (!PORTFOLIO_MIME_EXT[(file.type || "").toLowerCase()]) {
    throw new UnsupportedPortfolioImageError(file.type);
  }
  if (file.size > PORTFOLIO_MAX_BYTES) throw new PortfolioImageTooLargeError(file.size);
}

/** The folder every one of this user's work photos lives in. */
export function portfolioFolder(userId: string): string {
  return `${userId}/${PORTFOLIO_PREFIX}`;
}

/**
 * A fresh key for one image.
 *
 * The id is random and never reused, so it is stable for the life of the image
 * and independent of its position in the array — that is what makes reordering
 * free and makes a concurrent upload impossible to collide with. The extension
 * comes from the CONTENT TYPE, never the file name.
 */
export function newPortfolioObjectKey(userId: string, contentType: string): string {
  const ext = PORTFOLIO_MIME_EXT[contentType.toLowerCase()];
  if (!ext) throw new UnsupportedPortfolioImageError(contentType);
  return `${portfolioFolder(userId)}/${randomObjectId()}.${ext}`;
}

function randomObjectId(): string {
  const c = globalThis.crypto;
  // `randomUUID` needs a secure context; the fallback keeps this working in
  // jsdom and in a plain-http dev server without silently weakening a key that
  // only has to be unique, not unguessable (the bucket is public regardless).
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Strip the cache-busting query / fragment the app appends to public URLs. */
function withoutQuery(ref: string): string {
  return ref.split(/[?#]/, 1)[0];
}

/**
 * Matches the two public shapes Supabase serves an `avatars` object at — the
 * plain object route and the image-transform route — plus the signed route, so
 * a reference minted by any of them still resolves to the same object.
 */
const AVATARS_OBJECT_URL = /\/(?:object|render\/image)\/(?:public|sign)\/avatars\/(.+)$/;

/**
 * The object NAME inside `<userId>/portfolio/` that `ref` points at, or `null`
 * if `ref` is not one of this user's portfolio objects.
 *
 * `portfolio_urls` is not homogeneous: `complete-signup` stores bare
 * `user-documents` PATHS in the same column, and older rows can hold anything
 * that was ever written there. Only a reference that resolves cleanly into this
 * user's portfolio folder in the `avatars` bucket is treated as ours.
 */
export function portfolioObjectName(userId: string, ref: string): string | null {
  if (typeof ref !== "string" || !ref) return null;
  const clean = withoutQuery(ref.trim());

  let key: string | null = null;
  const m = AVATARS_OBJECT_URL.exec(clean);
  if (m) {
    try {
      key = decodeURIComponent(m[1]);
    } catch {
      return null;
    }
  } else if (!/^[a-z][a-z0-9+.-]*:/i.test(clean) && clean.startsWith(`${userId}/`)) {
    // A bare storage path, which is how the edge function stores its uploads.
    key = clean;
  }
  if (key === null) return null;

  const prefix = `${portfolioFolder(userId)}/`;
  if (!key.startsWith(prefix)) return null;
  const name = key.slice(prefix.length);
  // A nested key is NOT one of ours — the sweep lists one level, so treating a
  // deeper path as resolved would let it be silently missed.
  if (!name || name.includes("/") || !PORTFOLIO_OBJECT_NAME.test(name)) return null;
  return name;
}

/**
 * True when `ref` clearly points into this user's portfolio folder but could
 * NOT be resolved to a single object name (a nested key, a name shape this
 * module does not mint, an undecodable escape).
 *
 * This is the fail-closed trigger: the sweep deletes "everything not in the
 * keep set", so a surviving reference it cannot place is a reason to delete
 * nothing at all rather than risk removing a photo the user still has.
 */
export function isUnresolvedPortfolioRef(userId: string, ref: string): boolean {
  if (portfolioObjectName(userId, ref) !== null) return false;
  const clean = withoutQuery(String(ref ?? "").trim());
  const prefix = `${portfolioFolder(userId)}/`;
  return clean.includes(`/avatars/${prefix}`) || clean.startsWith(prefix);
}

/**
 * The minimum of the supabase-js Storage API this needs. Declared structurally
 * so this module is testable against a real authenticated client, a service
 * client, or a double.
 */
export interface PortfolioStorageClient {
  storage: {
    from(bucket: string): {
      upload(
        path: string,
        body: File | Blob | ArrayBuffer | ArrayBufferView | string,
        opts?: { upsert?: boolean; contentType?: string },
      ): PromiseLike<{ error: { message: string } | null }>;
      list(
        prefix: string,
        opts?: { limit?: number },
      ): PromiseLike<{
        data: Array<{ name: string; id?: string | null }> | null;
        error: { message: string } | null;
      }>;
      remove(paths: string[]): PromiseLike<{
        data: unknown[] | null;
        error: { message: string } | null;
      }>;
      getPublicUrl(path: string): { data: { publicUrl: string } };
    };
  };
}

export interface PortfolioUploadResult {
  /** Storage key the image occupies. */
  path: string;
  /** Public URL — the value to append to `profiles.portfolio_urls`. */
  publicUrl: string;
}

/**
 * Store one work photo at a fresh key.
 *
 * `upsert: false` is deliberate and safe here precisely BECAUSE the id is
 * fresh: there is nothing at that key to overwrite, so a collision is a real
 * error rather than something to paper over.
 *
 * Throws on failure — the caller's per-file error path is right, and returning
 * a URL for an object that was not stored is how a broken tile reaches a
 * profile.
 */
export async function uploadPortfolioImage(
  client: PortfolioStorageClient,
  userId: string,
  file: File | Blob,
  contentType: string,
): Promise<PortfolioUploadResult> {
  const bucket = client.storage.from(PORTFOLIO_BUCKET);
  const path = newPortfolioObjectKey(userId, contentType);

  const { error } = await bucket.upload(path, file, { upsert: false, contentType });
  if (error) throw error;

  return { path, publicUrl: bucket.getPublicUrl(path).data.publicUrl };
}

export interface PortfolioReconcileResult {
  /** Objects this call confirmed are gone. */
  removed: string[];
  /**
   * Objects that are STILL PUBLICLY FETCHABLE after the sweep, or that could
   * not be checked. Non-empty means a work photo the user removed is still
   * being served. Already reported to `error_logs` by the time you read it;
   * surface it to the user too, do not treat it as background noise.
   */
  staleRemaining: string[];
}

/**
 * Make storage match the column: delete every object under
 * `<userId>/portfolio/` that no surviving entry of `keepRefs` points at, and
 * PROVE it by re-listing.
 *
 * `keepRefs` is the WHOLE post-change `portfolio_urls` array, not the removed
 * entry — see the header on why this is stated as an invariant. Call it after
 * every write to the column (add, remove, replace, reorder); on a reorder it
 * finds nothing to do and costs one list.
 *
 * Never throws. The column has already been written by the time this runs, so
 * throwing would only turn a storage problem into a lost profile edit.
 */
export async function reconcilePortfolioObjects(
  client: PortfolioStorageClient,
  userId: string,
  keepRefs: readonly string[],
): Promise<PortfolioReconcileResult> {
  const result = await sweepPortfolioFolder(client, userId, keepRefs);

  if (result.staleRemaining.length > 0) {
    // Reported from HERE, not from the caller, so this cannot be lost by a call
    // site that ignores the return value. The keys are the user's own id plus
    // an opaque object id — no file names, no image content.
    report(
      new Error(
        `avatars: ${result.staleRemaining.length} removed work photo(s) are still public`,
      ),
      {
        context: {
          bucket: PORTFOLIO_BUCKET,
          folder: portfolioFolder(userId),
          stale: result.staleRemaining.join(","),
        },
      },
    );
  }

  return result;
}

async function sweepPortfolioFolder(
  client: PortfolioStorageClient,
  userId: string,
  keepRefs: readonly string[],
): Promise<PortfolioReconcileResult> {
  const folder = portfolioFolder(userId);

  // FAIL CLOSED. A surviving reference that points into this folder but cannot
  // be placed means the keep set is incomplete, and "delete everything not in
  // the keep set" would then delete a photo the user still has on their
  // profile. Losing an image the user kept is worse than delaying the removal
  // of one they dropped, so nothing is deleted and the caller is told.
  const unresolved = keepRefs.filter((r) => isUnresolvedPortfolioRef(userId, r));
  if (unresolved.length > 0) {
    return {
      removed: [],
      staleRemaining: [`${folder}/<unresolved reference; sweep skipped>`],
    };
  }

  const keep = new Set(
    keepRefs.map((r) => portfolioObjectName(userId, r)).filter((n): n is string => n !== null),
  );

  const listed = await listPortfolioObjects(client, folder);
  if (listed === null) {
    // Not readable is NOT the same as clean.
    return { removed: [], staleRemaining: [`${folder}/<unreadable folder>`] };
  }

  const doomed = listed.names.filter((n) => !keep.has(n)).map((n) => `${folder}/${n}`);
  // A truncated page means objects exist that were never considered, so the
  // sweep cannot claim the folder is clean even if everything it saw went.
  const truncationNote = listed.truncated ? [`${folder}/<listing truncated>`] : [];

  if (doomed.length === 0) return { removed: [], staleRemaining: truncationNote };

  // `error` is deliberately NOT branched on — see the header. A remove that RLS
  // filtered to nothing answers `{ data: [], error: null }`, so only the
  // re-list below can tell success from silent refusal. Awaited so the re-list
  // observes its effect.
  await client.storage.from(PORTFOLIO_BUCKET).remove(doomed);

  const after = await listPortfolioObjects(client, folder);
  if (after === null) return { removed: [], staleRemaining: [...doomed, ...truncationNote] };

  const survivors = new Set(after.names.map((n) => `${folder}/${n}`));
  return {
    removed: doomed.filter((p) => !survivors.has(p)),
    staleRemaining: [...doomed.filter((p) => survivors.has(p)), ...truncationNote],
  };
}

/**
 * Object names directly under `folder`, or `null` when it could not be listed.
 *
 * Sub-prefixes come back from `.list()` with a null `id` and are skipped: they
 * are not objects, and `remove()` on a prefix deletes nothing while still
 * answering `{ error: null }`.
 */
async function listPortfolioObjects(
  client: PortfolioStorageClient,
  folder: string,
): Promise<{ names: string[]; truncated: boolean } | null> {
  const LIMIT = 1000;
  const { data, error } = await client.storage
    .from(PORTFOLIO_BUCKET)
    .list(folder, { limit: LIMIT });
  if (error || !data) return null;
  return {
    names: data.filter((o) => o.id !== null && o.id !== undefined).map((o) => o.name),
    truncated: data.length >= LIMIT,
  };
}
