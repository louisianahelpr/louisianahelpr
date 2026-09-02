// avatarStorage — one place that knows what "replace my profile photo" means.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY THIS EXISTS: REPLACING AN AVATAR DID NOT REPLACE IT
// ═══════════════════════════════════════════════════════════════════════════
//
// Every avatar write in this app used to build its own key by appending the
// extension of whatever file the user picked:
//
//     `${userId}/avatar.${file.name.split(".").pop()}`
//
// `upsert: true` then makes the write idempotent *for that exact key* — and
// only for that key. Pick a `.png` over a `.jpg` and you do not overwrite the
// `.jpg`; you add a second object beside it. The `avatars` bucket is public,
// so the first one stays anonymously fetchable at 200 forever.
//
// That is not a housekeeping problem. This is the surface where a member
// uploads a photo of their DRIVER'S LICENCE or PASSPORT by mistake — the ID
// picker and the avatar picker have sat one tap apart — notices, and re-uploads
// a selfie. They have every reason to believe they undid it. They have not: the
// document is still served, publicly, at the old key. Two identity documents
// were found live in this bucket exactly this way, and a sweep of prod on
// 2026-09-01 found 3 of 14 live objects orphaned by the extension swap.
//
// ── WHAT "REPLACE" MEANS HERE ─────────────────────────────────────────────
//
// Two mechanisms, deliberately both, because either alone leaves a hole:
//
//   1. THE KEY IS DERIVED FROM THE CONTENT TYPE, NOT THE FILE NAME. The bucket
//      accepts exactly four MIME types, so there are exactly FOUR reachable
//      keys per user — `avatar.jpg|png|webp|gif` — instead of one per distinct
//      filename suffix a user's camera roll happens to produce. `IMG_01.JPEG`,
//      `photo.jpg` and `scan.jpe` all now land on the SAME object and upsert
//      over each other. (The old `sanitizeExt` took any 5 characters after the
//      last dot: `avatar.undefined`, `avatar.bin`, `avatar.heic` were all
//      reachable keys, and each was its own permanent public object.)
//
//   2. EVERY OTHER `avatar.*` OBJECT IN THE FOLDER IS DELETED, AND THE DELETE
//      IS VERIFIED BY RE-READING. This is what closes the remaining
//      cross-format case (jpg → png) and cleans up the legacy keys that
//      mechanism 1 can no longer create.
//
// An extension-free fixed key (`${userId}/avatar`) was measured as a third
// option and rejected: it works on `/object/public/` today, but Supabase's
// `/render/image/public/` transform is a paid add-on that is OFF for this
// tenant (403 FeatureNotEnabled on EVERY avatar, extension or not — see
// `imageUrl.ts`), so there is no way to prove an extension-free key still
// renders on the day that add-on is switched on. Keeping a real extension
// costs nothing and plants no landmine.
//
// ── A NULL `error` FROM `.remove()` DOES NOT MEAN THE OBJECT WENT ─────────
//
// `supabase.storage.from(b).remove(paths)` answers `{ data: [], error: null }`
// when RLS filtered every path out, when the object was already gone, and when
// the caller was not the owner. All three are indistinguishable from success if
// you only check `error` — and this is the one code path in the app where
// swallowing that leaves a passport public.
//
// So the sweep does not trust `error`, and does not trust the returned `data`
// either: it RE-LISTS the folder afterwards and reports, by name, anything that
// is still there. A non-empty `staleRemaining` is a live public exposure, is
// reported to `error_logs` from inside this module (so a caller that ignores
// the field cannot make it silent), and is handed back for the caller to
// surface to the person whose document it is.

import { report } from "@/lib/errorLogger";

/** The public bucket. Public by design — avatars are marketplace-visible. */
export const AVATAR_BUCKET = "avatars";

/**
 * The bucket's `allowed_mime_types` (see
 * `20260505220000_split_avatars_bucket_private_user_documents.sql`), mapped to
 * the one canonical extension each. Keeping this in lockstep with the bucket
 * definition is what makes the reachable key set finite.
 */
export const AVATAR_MIME_EXT: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** The bucket's `file_size_limit`. Restated so the client can reject first. */
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

/** Matches `avatar.<anything>` — the whole legacy key space, plus the current. */
const AVATAR_OBJECT_NAME = /^avatar\.[A-Za-z0-9]{1,16}$/;

/** True for a storage entry that is one of this user's avatar objects. */
export function isAvatarObjectName(name: string): boolean {
  return AVATAR_OBJECT_NAME.test(name);
}

/**
 * The ONE key an avatar of this content type may occupy.
 *
 * Derived from the MIME type the browser reports, never from the file name —
 * a name is user-controlled text that happens to end in a dot and some
 * letters, and treating it as a key component is what created the orphans.
 */
export function avatarObjectKey(userId: string, contentType: string): string {
  const ext = AVATAR_MIME_EXT[contentType.toLowerCase()];
  if (!ext) throw new UnsupportedAvatarError(contentType);
  return `${userId}/avatar.${ext}`;
}

/** A file the `avatars` bucket would reject anyway, caught before the round trip. */
export class UnsupportedAvatarError extends Error {
  constructor(contentType: string) {
    super(
      `That file type isn't supported for a profile photo${
        contentType ? ` (${contentType})` : ""
      } — use JPG, PNG, WebP or GIF.`,
    );
    this.name = "UnsupportedAvatarError";
  }
}

/** A file over the bucket's own cap. */
export class AvatarTooLargeError extends Error {
  constructor(size: number) {
    super(
      `That image is ${(size / 1024 / 1024).toFixed(1)} MB — profile photos are capped at 5 MB.`,
    );
    this.name = "AvatarTooLargeError";
  }
}

/**
 * Reject a file the bucket cannot store, with copy a person can act on.
 *
 * Callers used to do this ad hoc or not at all: `uploadProfileFiles` did NO
 * validation on either of the two files it took, so an unsupported type
 * surfaced as a raw Storage `mime type ... is not supported` string in a toast,
 * and an oversized one as a 413 the recovery path read as a network failure.
 */
export function assertUploadableAvatar(file: { type: string; size: number }): void {
  if (!AVATAR_MIME_EXT[(file.type || "").toLowerCase()]) {
    throw new UnsupportedAvatarError(file.type);
  }
  if (file.size > AVATAR_MAX_BYTES) throw new AvatarTooLargeError(file.size);
}

export interface AvatarReplaceResult {
  /** Storage key the new photo now occupies. */
  path: string;
  /** Public URL, cache-busted — the value to write to `profiles.avatar_url`. */
  publicUrl: string;
  /** Superseded objects this call confirmed are gone. */
  removed: string[];
  /**
   * Superseded objects that are STILL PUBLICLY FETCHABLE after the sweep, or
   * that could not be checked. Non-empty means the user's previous photo — the
   * one they may be trying to retract — is still being served. Already
   * reported to `error_logs` by the time you read it; surface it to the user
   * too, do not treat it as background noise.
   */
  staleRemaining: string[];
}

/**
 * The minimum of the supabase-js Storage API this needs. Declared structurally
 * so this module is testable against a real authenticated client, a service
 * client, or a double — and so it does not drag the app's client singleton in.
 */
export interface AvatarStorageClient {
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

/**
 * Upload a profile photo so that it REPLACES whatever was there.
 *
 * Throws on a failed upload (nothing changed, the caller's existing recovery
 * path is right). Does NOT throw on a failed sweep: the new photo IS live at
 * that point, and refusing to return its URL would leave the profile pointing
 * at the OLD object — the exact thing being retracted. The failure comes back
 * in `staleRemaining` instead, already logged.
 */
export async function replaceAvatarObject(
  client: AvatarStorageClient,
  userId: string,
  file: File | Blob,
  contentType: string,
): Promise<AvatarReplaceResult> {
  const bucket = client.storage.from(AVATAR_BUCKET);
  const path = avatarObjectKey(userId, contentType);
  const objectName = path.slice(userId.length + 1);

  const { error: uploadError } = await bucket.upload(path, file, {
    upsert: true,
    contentType,
  });
  if (uploadError) throw uploadError;

  const { data: publicData } = bucket.getPublicUrl(path);
  // `?t=` busts the CDN + the <img> cache for the SAME key, which is now the
  // common case rather than the rare one: same-format replacements land on the
  // identical object, so without this the browser keeps painting the old photo.
  const publicUrl = `${publicData.publicUrl}?t=${Date.now()}`;

  const { removed, staleRemaining } = await sweepSupersededAvatars(
    client,
    userId,
    objectName,
  );

  if (staleRemaining.length > 0) {
    // Reported from HERE, not from the caller, so this cannot be lost by a
    // call site that only reads `publicUrl`. No file names, no URLs beyond the
    // object keys themselves; the keys are the user's own id + "avatar.<ext>".
    report(
      new Error(
        `avatars: replaced photo but ${staleRemaining.length} superseded object(s) are still public`,
      ),
      { context: { bucket: AVATAR_BUCKET, kept: path, stale: staleRemaining.join(",") } },
    );
  }

  return { path, publicUrl, removed, staleRemaining };
}

/**
 * Delete every `avatar.*` object in the user's folder except `keepName`, and
 * PROVE it by re-listing.
 *
 * Exported for the backfill/sweep path and for tests; `replaceAvatarObject`
 * calls it on every upload, which is what makes the fix self-healing for the
 * accounts that already have an orphan.
 */
export async function sweepSupersededAvatars(
  client: AvatarStorageClient,
  userId: string,
  keepName: string | null,
): Promise<{ removed: string[]; staleRemaining: string[] }> {
  const bucket = client.storage.from(AVATAR_BUCKET);

  const stale = await listSupersededAvatars(client, userId, keepName);
  if (stale === null) {
    // The folder could not be read, so it is NOT known that the old object is
    // gone — and "not known" is reported as still-exposed, never as clean.
    // The alternative is a sweep that certifies itself on no evidence, which
    // is the same defect as a null `error` being read as success.
    return { removed: [], staleRemaining: [`${userId}/<unreadable folder>`] };
  }
  if (stale.length === 0) return { removed: [], staleRemaining: [] };

  // The `error` is deliberately NOT branched on — see the header. A remove
  // that RLS filtered to nothing answers `{ data: [], error: null }`, so an
  // error check here would pass on exactly the failure that matters and the
  // re-list below is the only thing that can tell the two apart. It is awaited
  // rather than fired-and-forgotten so the re-list observes its effect.
  await bucket.remove(stale);

  const after = await listSupersededAvatars(client, userId, keepName);
  // Unverifiable is reported as still-exposed, for the same reason as above.
  if (after === null) return { removed: [], staleRemaining: stale };

  const survived = new Set(after);
  return {
    removed: stale.filter((p) => !survived.has(p)),
    staleRemaining: after,
  };
}

/**
 * Every `avatar.*` key in the folder other than `keepName`, or `null` when the
 * folder could not be listed at all.
 *
 * Sub-folders (`<uid>/portfolio/…`) come back from `.list()` as entries with a
 * null `id`; they are skipped, so a portfolio image is never in range of this.
 */
async function listSupersededAvatars(
  client: AvatarStorageClient,
  userId: string,
  keepName: string | null,
): Promise<string[] | null> {
  const { data, error } = await client.storage
    .from(AVATAR_BUCKET)
    .list(userId, { limit: 100 });
  if (error || !data) return null;
  return data
    .filter(
      (o) =>
        o.id !== null &&
        o.id !== undefined &&
        isAvatarObjectName(o.name) &&
        o.name !== keepName,
    )
    .map((o) => `${userId}/${o.name}`);
}
