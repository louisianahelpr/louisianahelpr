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
// ── ORDER: UPLOAD → ROW → DELETE. NEVER DELETE BEFORE THE ROW MOVES. ──────
//
// Mechanism 2 used to run INSIDE the upload, before the caller wrote the row.
// So a jpg → png swap deleted `avatar.jpg` and only THEN asked Postgres to
// point `profiles.avatar_url` at `avatar.png` — and when that update failed
// (a contact-leak bio on /complete-profile, a timeout, a zero-row write), the
// row was left on an object that no longer existed and every screen rendering
// that person fired a 400. Found on prod 2026-09-15 (22 failed presses): the
// E2E helper's row said `avatar.png`, storage held only `avatar.jpg`.
//
// `replaceAvatarObject` therefore takes the ROW as an argument and owns the
// order: upload, then `row.write(publicUrl)` (which must throw unless Postgres
// confirms the write), then the sweep — and the sweep also keeps whatever the
// row points at THE MOMENT BEFORE it deletes, so a second replacement that has
// ALREADY moved the row does not have its object deleted by this one.
//
// Be exact about what that buys, because the guarantee is not total: the keep
// list is read at T1 and applied at T2, so a replacement whose row write lands
// BETWEEN those two statements is still unprotected. The window went from a
// whole function body to the gap between two adjacent awaits. It is not zero,
// and writing it down as zero is how the next reader stops looking.
//
// There is no exported way to upload an avatar without handing over the row.
// `src/test/avatarRowObjectAgreement.test.ts` enforces this repo-wide.
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

/**
 * The avatar object a stored `avatar_url` names inside `<userId>/`, or `null`
 * when it names something else (another user's folder, a data: URI, a
 * non-Supabase URL, a portfolio image). Query strings (`?t=`) are ignored.
 */
export function avatarObjectNameFromUrl(url: string | null | undefined, userId: string): string | null {
  if (!url) return null;
  const marker = `/${AVATAR_BUCKET}/${userId}/`;
  const at = url.indexOf(marker);
  if (at < 0) return null;
  const name = url.slice(at + marker.length).split(/[?#]/)[0];
  return isAvatarObjectName(name) ? name : null;
}

/**
 * The `profiles` row an avatar replacement must move BEFORE anything is
 * deleted. Supplied by the caller because this module deliberately holds no
 * database client.
 */
export interface AvatarProfileRow {
  /**
   * Point `profiles.avatar_url` at `publicUrl`. Resolve ONLY when Postgres
   * confirms the write (rows back from `.select(…)`, e.g. via
   * `unwrapMutation`) and THROW otherwise — a null `error` is not a write, and
   * resolving on one lets the sweep delete the object the row still names.
   */
  write(publicUrl: string): Promise<unknown>;
  /** `profiles.avatar_url` as it is right now. Throw if it cannot be read. */
  read(): Promise<string | null>;
}

export interface AvatarReplaceResult {
  /** Storage key the new photo now occupies. */
  path: string;
  /** Public URL, cache-busted — the value `row.write` was given, and confirmed. */
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
 * Upload a profile photo, point the profile at it, and only then retract
 * whatever it replaced.
 *
 *   1. Upload. Throws on failure — nothing changed, row and bucket untouched.
 *   2. `row.write(publicUrl)`. Its error is re-thrown UNCHANGED (callers
 *      branch on `WriteRejectedError` / contact-leak codes) and NOTHING is
 *      deleted: the row still names the old object, which still exists. The
 *      new object may sit beside it until the next successful replace sweeps
 *      it; that is a spare file, never a broken photo.
 *   3. Sweep every other `avatar.*`, keeping this upload AND whatever the row
 *      names at that instant. Never throws: the new photo is live and the row
 *      points at it, so a failed sweep comes back in `staleRemaining`, already
 *      logged. If the row cannot be re-read, nothing is deleted and the old
 *      objects are reported as still exposed — unknown is never "clean".
 */
export async function replaceAvatarObject(
  client: AvatarStorageClient,
  userId: string,
  file: File | Blob,
  contentType: string,
  row: AvatarProfileRow,
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

  // The row moves first. If this throws, the sweep below never runs.
  await row.write(publicUrl);

  let rowName: string | null;
  try {
    rowName = avatarObjectNameFromUrl(await row.read(), userId);
  } catch (err) {
    const staleRemaining = [`${userId}/<profile row unreadable — nothing removed>`];
    report(err instanceof Error ? err : new Error(String(err)), {
      context: { bucket: AVATAR_BUCKET, kept: path, stale: staleRemaining.join(",") },
    });
    return { path, publicUrl, removed: [], staleRemaining };
  }

  const { removed, staleRemaining } = await sweepSupersededAvatars(
    client,
    userId,
    rowName && rowName !== objectName ? [objectName, rowName] : objectName,
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
 * Delete every `avatar.*` object in the user's folder except the kept name(s),
 * and PROVE it by re-listing.
 *
 * Exported for tests; `replaceAvatarObject` calls it after every confirmed row
 * write, which is what makes the fix self-healing for the accounts that
 * already have an orphan. NEVER call it before `profiles.avatar_url` names the
 * object being kept — the class check fails any call site that does.
 */
export async function sweepSupersededAvatars(
  client: AvatarStorageClient,
  userId: string,
  keep: string | null | readonly string[],
): Promise<{ removed: string[]; staleRemaining: string[] }> {
  const bucket = client.storage.from(AVATAR_BUCKET);
  const keepNames: readonly string[] = keep === null ? [] : typeof keep === "string" ? [keep] : keep;

  const stale = await listSupersededAvatars(client, userId, keepNames);
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

  const after = await listSupersededAvatars(client, userId, keepNames);
  // Unverifiable is reported as still-exposed, for the same reason as above.
  if (after === null) return { removed: [], staleRemaining: stale };

  const survived = new Set(after);
  return {
    removed: stale.filter((p) => !survived.has(p)),
    staleRemaining: after,
  };
}

/**
 * Every `avatar.*` key in the folder other than the kept names, or `null` when
 * the folder could not be listed at all.
 *
 * Sub-folders (`<uid>/portfolio/…`) come back from `.list()` as entries with a
 * null `id`; they are skipped, so a portfolio image is never in range of this.
 */
async function listSupersededAvatars(
  client: AvatarStorageClient,
  userId: string,
  keepNames: readonly string[],
): Promise<string[] | null> {
  const LIMIT = 100;
  const { data, error } = await client.storage
    .from(AVATAR_BUCKET)
    .list(userId, { limit: LIMIT });
  if (error || !data) return null;
  // A FULL page is not a folder listing, it is the first 100 of an unknown
  // number — and reporting the unread remainder as swept is the same defect as
  // reading a null `error` as success. `null` is how this function says "could
  // not read it", and the callers already turn that into still-exposed.
  // (A real folder holds a handful of `avatar.*` keys and one `portfolio`
  // entry, so this is a guard, not a path anything normally takes.)
  if (data.length >= LIMIT) return null;
  return data
    .filter(
      (o) =>
        o.id !== null &&
        o.id !== undefined &&
        isAvatarObjectName(o.name) &&
        !keepNames.includes(o.name),
    )
    .map((o) => `${userId}/${o.name}`);
}
