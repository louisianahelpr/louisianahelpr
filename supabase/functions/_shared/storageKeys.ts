/**
 * Storage keys, DERIVED — never assembled from client text.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 * `complete-signup` built FOUR storage keys by interpolating a field off the
 * request body — one per uploaded file:
 *
 *     `${userId}/avatar.${avatarExt}`                              → avatars (PUBLIC)
 *     `${userId}/id-document.${idExt}`                             → id-documents
 *     `${userId}/credentials/license-${Date.now()}.${licenseExt}`  → user-documents
 *     `${userId}/credentials/insurance-${Date.now()}.${insuranceExt}` → user-documents
 *
 * Between parsing the body and using these values there was one check: a
 * base64 SIZE limit. Nothing looked at the extensions at all.
 *
 * Each `*Ext` is whatever the caller put in the JSON. The browser gets it from
 * `file.name.split(".").pop()`, so on the happy path it is `jpg` — but nothing
 * on the wire is a file name, and nothing validated it. This function runs
 * under the SERVICE ROLE key, so storage RLS (`avatars: owner upload`, which
 * pins `(storage.foldername(name))[1]` to `auth.uid()`) is not evaluated at
 * all. There was no backstop of any kind, in either the public bucket or the
 * two PRIVATE ones — and `id-documents` and `user-documents` are configured
 * with `allowed_mime_types: null` and `file_size_limit: null`, so the buckets
 * impose nothing either. Code was the only defence and it was absent.
 *
 * Reproduced against PROD on 2026-09-01, all with HTTP 200:
 *
 *   avatarExt: "php"
 *     → object written to `avatars/<uid>/avatar.php`, public, HTTP 200, and
 *       that URL written into `profiles.avatar_url`.
 *
 *   a second call with avatarExt: "jpg"
 *     → `avatar.jpg` created BESIDE `avatar.php`. Same orphan-on-replace bug
 *       as the client had (see `src/lib/avatarStorage.ts`): `upsert: true` is
 *       idempotent for one exact key and no other, so every distinct suffix a
 *       caller sends is its own permanent public object.
 *
 *   avatarExt: "png/../../<other-user-id>/avatar.png"
 *     → the slash is not a special character to Storage, so the key escapes
 *       the user's folder entirely. Measured twice: once landing an object at
 *       the BUCKET ROOT (`avatars/ESCAPED-BY-CLIENT-EXT/pwned.png`), and once
 *       OVERWRITING a different account's `avatar.png` — verified by SHA of the
 *       served bytes before and after. Reaching this needs only a freshly
 *       created, never-signed-in account inside the 30-minute completion
 *       window, which the attacker makes themselves; no victim credential is
 *       involved. An unauthenticated caller could therefore replace any
 *       member's public profile photo with an image of their choosing.
 *
 * The same three properties hold for the other three keys. The private buckets
 * are not a mitigation: an object planted under another member's folder in
 * `id-documents` is what an admin reviewer opens as that member's government
 * ID, and the traversal reaches it just as easily.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 * The key's extension comes from the CONTENT TYPE. No caller-supplied string
 * is ever interpolated into a key, by any path.
 *
 * For the AVATAR that is strict: the extension is looked up in the `avatars`
 * bucket's own `allowed_mime_types`, so four MIME types in means four reachable
 * keys per user out (`avatar.jpg|png|webp|gif`), and anything else is refused
 * outright — the bucket would have rejected it anyway. This mirrors
 * `src/lib/avatarStorage.ts` exactly, deliberately: the two paths write to the
 * same object for the same user, so they must agree on what that object is
 * called or a signup and a later profile edit orphan each other.
 *
 * For the three DOCUMENTS it is lenient about the *type* but never about the
 * *text*. Those buckets take anything a reviewer might need to read (PDF,
 * HEIC off an iPhone, a scan), and these three request fields are only ever
 * populated by ALREADY-SHIPPED clients — the current app sends none of them —
 * so hard-refusing an unrecognised type would break uploads nobody can push a
 * fix to. Instead `safeDocumentExt` resolves the extension from the content
 * type, falls back to the caller's extension ONLY when it matches a fixed
 * allow-list of known document suffixes, and otherwise uses `bin`. The value
 * that reaches the key is therefore always one this file chose from a closed
 * set, which is what kills the traversal and the unbounded key space at once.
 *
 * ── A null `error` from `.remove()` does not mean the object went ───────────
 * `remove()` answers `{ data: [], error: null }` when the path did not exist,
 * when RLS filtered it out, and when the caller was not the owner. So the
 * sweep below does not read `error` and does not trust the returned rows: it
 * RE-LISTS the folder and reports, by name, whatever is still there. An
 * unreadable folder is reported as still-exposed, never as clean — this is the
 * bucket where a mis-tapped picker has twice left a government ID public.
 */

/**
 * The `avatars` bucket's `allowed_mime_types`, mapped to the one canonical
 * extension each. Verified against prod bucket config 2026-09-01:
 * `["image/jpeg","image/png","image/webp","image/gif"]`. Keep in lockstep with
 * `20260505220000_split_avatars_bucket_private_user_documents.sql` AND with
 * `AVATAR_MIME_EXT` in `src/lib/avatarStorage.ts`.
 */
export const AVATAR_MIME_EXT: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

/**
 * Legacy fallback ONLY: extension → content type.
 *
 * A shipped iOS build's JS is bundled into the `.ipa` and cannot be updated
 * from here, so refusing every request whose `avatarContentType` is absent
 * would break signup on already-installed versions. This table lets such a
 * request still resolve — but note what it does NOT do: the value is used to
 * pick a MIME type from a fixed set, and the extension that ends up in the key
 * is then re-derived from that MIME type. An unrecognised extension resolves
 * to nothing rather than being passed through, so no caller-supplied text ever
 * reaches the key by either route.
 */
const LEGACY_EXT_MIME: Readonly<Record<string, string>> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jpe: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

/**
 * Content type → extension for the two PRIVATE document buckets.
 *
 * Wider than the avatar map on purpose: these hold whatever a member photographs
 * or scans, and `id-documents` / `user-documents` set no `allowed_mime_types`
 * of their own (verified against prod 2026-09-01), so this table is the only
 * thing describing what is expected.
 */
const DOCUMENT_MIME_EXT: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/tiff": "tiff",
  "application/pdf": "pdf",
};

/**
 * Extensions accepted as a FALLBACK when the content type says nothing useful
 * (an older client sending `application/octet-stream`, or none at all).
 *
 * This is an allow-list, not a sanitiser. A value that is not literally one of
 * these is discarded rather than cleaned up — "strip the bad characters" is how
 * a traversal survives its own fix.
 */
const DOCUMENT_EXT_ALLOWED: ReadonlySet<string> = new Set([
  "jpg", "jpeg", "png", "webp", "gif", "heic", "heif", "tiff", "tif", "pdf",
]);

/**
 * The extension a document key may use. Always one of a closed set; never the
 * caller's string passed through.
 */
export function safeDocumentExt(contentType: unknown, ext: unknown): string {
  if (typeof contentType === "string") {
    const fromType = DOCUMENT_MIME_EXT[contentType.trim().toLowerCase()];
    if (fromType) return fromType;
  }
  if (typeof ext === "string") {
    const e = ext.trim().toLowerCase().replace(/^\./, "");
    if (DOCUMENT_EXT_ALLOWED.has(e)) return e;
  }
  // Unknown but still storable — the reviewer downloads it and their OS works
  // out what it is, which is strictly better than refusing an upload from a
  // client that cannot be updated.
  return "bin";
}

/** Matches `avatar.<ext>` — the current key space plus every legacy one. */
const AVATAR_OBJECT_NAME = /^avatar\.[A-Za-z0-9]{1,16}$/;

/**
 * NOTE ON WHAT IS *NOT* SWEPT.
 *
 * `id-document.<ext>` has the same orphan-on-extension-swap shape, and it is
 * deliberately left alone. The sweep exists because an orphan in `avatars` is
 * ANONYMOUSLY FETCHABLE — that is the harm, and it does not exist in
 * `id-documents`, which is private and reachable only through a signed URL an
 * admin mints. Against no exposure to close, deleting a superseded ID scan
 * destroys review history (the client path in
 * `src/pages/completeProfile/uploadProfileFiles.ts` timestamps its ID keys
 * precisely so they accumulate — "an ID is evidence with a review history, not
 * a photo being replaced"). The two paths disagree about that, which is worth
 * settling, but settling it by deleting evidence from inside a key-hardening
 * change is the wrong way round. The key itself is fixed; the retention
 * question is left open on purpose.
 */

/**
 * The MIME type this upload will be stored as, or `null` if the bucket would
 * reject it. Prefers the declared content type; falls back to the extension
 * only to keep already-shipped clients working (see `LEGACY_EXT_MIME`).
 */
export function resolveAvatarContentType(
  contentType: unknown,
  ext: unknown,
): string | null {
  if (typeof contentType === "string") {
    const ct = contentType.trim().toLowerCase();
    if (AVATAR_MIME_EXT[ct]) return ct;
  }
  if (typeof ext === "string") {
    const e = ext.trim().toLowerCase().replace(/^\./, "");
    const fromExt = LEGACY_EXT_MIME[e];
    if (fromExt) return fromExt;
  }
  return null;
}

/**
 * The ONE key an avatar of this content type may occupy.
 *
 * `contentType` must already have come back from `resolveAvatarContentType`;
 * an unknown value throws rather than producing a key, because a caller that
 * treats "I could not classify this" as "use some default" is how a
 * client-controlled suffix got into a storage key in the first place.
 */
export function avatarObjectKey(userId: string, contentType: string): string {
  const ext = AVATAR_MIME_EXT[contentType.toLowerCase()];
  if (!ext) throw new Error(`Unsupported avatar content type: ${contentType}`);
  return `${userId}/avatar.${ext}`;
}

/** The minimum of the Storage API this module needs. */
export interface AvatarSweepClient {
  storage: {
    from(bucket: string): {
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
    };
  };
}

/**
 * Every `avatar.*` key in `<userId>/` other than `keepName`, or `null` when the
 * folder could not be listed at all.
 *
 * Sub-prefixes (`<uid>/portfolio/…`) come back with a null `id` and are
 * skipped, so a portfolio image is never in range of this sweep.
 */
async function listSupersededAvatars(
  client: AvatarSweepClient,
  userId: string,
  keepName: string | null,
): Promise<string[] | null> {
  const { data, error } = await client.storage
    .from("avatars")
    .list(userId, { limit: 100 });
  if (error || !data) return null;
  return data
    .filter(
      (o) =>
        o.id !== null &&
        o.id !== undefined &&
        AVATAR_OBJECT_NAME.test(o.name) &&
        o.name !== keepName,
    )
    .map((o) => `${userId}/${o.name}`);
}

/**
 * Delete every `avatar.*` object in the user's folder except `keepName`, and
 * PROVE it by re-listing.
 *
 * Called on every avatar write, which is what makes the fix self-healing for
 * accounts that already carry an orphan from the old key scheme.
 */
export async function sweepSupersededAvatars(
  client: AvatarSweepClient,
  userId: string,
  keepName: string | null,
): Promise<{ removed: string[]; staleRemaining: string[] }> {
  const stale = await listSupersededAvatars(client, userId, keepName);
  if (stale === null) {
    // Not readable is NOT the same as clean, and reporting it as clean is the
    // same defect as reading a null `error` as success.
    return { removed: [], staleRemaining: [`${userId}/<unreadable folder>`] };
  }
  if (stale.length === 0) return { removed: [], staleRemaining: [] };

  // `error` is deliberately not branched on — see the header. Awaited (not
  // fired and forgotten) so the re-list below observes its effect.
  await client.storage.from("avatars").remove(stale);

  const after = await listSupersededAvatars(client, userId, keepName);
  if (after === null) return { removed: [], staleRemaining: stale };

  const survived = new Set(after);
  return {
    removed: stale.filter((p) => !survived.has(p)),
    staleRemaining: after,
  };
}
