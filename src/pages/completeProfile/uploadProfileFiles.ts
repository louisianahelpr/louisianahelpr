import { supabase } from "@/integrations/supabase/client";
import { assertUploadableAvatar, replaceAvatarObject } from "@/lib/avatarStorage";
import { readProfileAvatarUrl } from "@/lib/readProfileAvatarUrl";
import { sanitizeExt, withTimeout } from "./constants";

/** What `saveRow` is given: the uploaded files the profile row should name. */
export interface UploadedProfileFiles {
  /** Public URL of the avatar that was JUST uploaded, or null when none was picked. */
  avatarUrl: string | null;
  idDocumentPath: string | null;
}

export interface SavedProfileFiles<T> {
  /** Whatever `saveRow` returned — the row Postgres confirmed. */
  saved: T;
  /**
   * Superseded avatar objects that are STILL PUBLICLY FETCHABLE.
   *
   * Empty on every healthy upload. Non-empty means the photo the member just
   * replaced is still being served from the public bucket — which, on this
   * exact screen, may be a photograph of their driver's licence. The caller
   * must surface it; it is already in `error_logs` either way.
   */
  staleAvatarObjects: string[];
}

/**
 * Upload the avatar + optional government-ID file directly to Storage in
 * parallel (much faster than base64-through-edge-function), then save the
 * profile row through `saveRow`, then retire the superseded avatar.
 *
 * ── THE ROW IS SAVED IN THE MIDDLE, NOT AFTER ─────────────────────────────
 *
 * This used to return the new avatar URL having ALREADY deleted the previous
 * `avatar.*` object, and the caller wrote the row afterwards. When that write
 * failed — a contact-leak bio rejected by the database (23514), a timeout, a
 * zero-row update — the row was left on an object that no longer existed.
 * `saveRow` now runs as `replaceAvatarObject`'s row-writer: after the upload,
 * before any delete. It must THROW unless Postgres confirmed the write
 * (`unwrapMutationRow`), and its error reaches the caller unchanged.
 *
 * ── THE TWO FILES ARE NOT THE SAME KIND OF THING ──────────────────────────
 *
 * This function takes both, and they have OPPOSITE privacy properties:
 *
 *   avatarFile → bucket `avatars`      → PUBLIC. Anonymously fetchable at a
 *                                        guessable URL, by design: it is the
 *                                        marketplace-visible profile photo.
 *   idFile     → bucket `id-documents` → PRIVATE. No public URL exists; only
 *                                        the row's path is stored, and reads
 *                                        go through a signed URL.
 *
 * Swapping them is one tap on a picker, and it has happened: a driver's licence
 * and a US passport data page were both found live in the public `avatars`
 * bucket. Two things follow, and both are load-bearing rather than tidiness:
 *
 *   1. The UI that feeds this function must say WHICH FILE GOES WHERE at the
 *      moment each is chosen — "shown publicly on your profile" vs "private,
 *      only Helpr staff can open it". You cannot detect "photo of a document"
 *      from the client (the licence was 2502×1407 and the passport 1093×1491 —
 *      no aspect-ratio or dimension test separates either from a real photo),
 *      so making the CONSEQUENCE legible is the whole of the defence.
 *   2. Re-uploading a photo must REMOVE the old one, or a member who notices
 *      their mistake and re-uploads a selfie has not retracted anything. See
 *      `@/lib/avatarStorage` — the key used to embed the file's own extension,
 *      so a `.png` over a `.jpg` left the `.jpg` public forever.
 *
 * Validation used to be ZERO here on both files. It is now enforced for the
 * avatar (type + size, against the bucket's own limits) rather than trusted
 * from whichever caller happened to check first.
 *
 * Any Storage error is re-thrown so the caller's try/catch (which drives the
 * recovery + toast path) sees it; never swallow it here.
 */
export const uploadProfileFiles = async <T>(
  userId: string,
  avatarFile: File | null,
  idFile: File | null,
  saveRow: (files: UploadedProfileFiles) => Promise<T>,
): Promise<SavedProfileFiles<T>> => {
  // Throws before any network call — a file the bucket would reject with an
  // opaque `mime type ... is not supported` (or a bare 413) instead fails
  // here with copy the recovery path can show verbatim.
  if (avatarFile) assertUploadableAvatar(avatarFile);

  // Deliberately NOT the avatar path: a timestamped key in the PRIVATE
  // `id-documents` bucket, no upsert, no public URL ever minted. Successive
  // uploads are meant to accumulate here — an ID is evidence with a review
  // history, not a photo being replaced — which is exactly why the two
  // buckets must not share a key strategy. Started now so it runs alongside
  // the avatar upload.
  const idUpload: Promise<string | null> = idFile
    ? (async () => {
        const path = `${userId}/id-document-${Date.now()}.${sanitizeExt(idFile.name)}`;
        const { error } = await supabase.storage
          .from("id-documents")
          .upload(path, idFile, { contentType: idFile.type });
        if (error) throw error;
        return path;
      })()
    : Promise.resolve(null);
  // Observed below; this only stops an early avatar failure from turning an
  // ID failure into an unhandled rejection.
  idUpload.catch(() => undefined);

  if (!avatarFile) {
    const idDocumentPath = await withTimeout(idUpload, "File upload");
    return { saved: await saveRow({ avatarUrl: null, idDocumentPath }), staleAvatarObjects: [] };
  }

  let saved: { value: T } | null = null;
  // The timeout bounds what the member waits for; it does not cancel the
  // work. If it fires, the replacement still runs upload → row → sweep in that
  // order, so a late finish can never leave the row on a deleted object.
  // 120s: it now spans the upload AND the save, which had 60s each before.
  const replaced = await withTimeout(
    replaceAvatarObject(supabase, userId, avatarFile, avatarFile.type, {
      write: async (publicUrl: string) => {
        const idDocumentPath = await idUpload;
        saved = { value: await saveRow({ avatarUrl: publicUrl, idDocumentPath }) };
      },
      read: () => readProfileAvatarUrl(userId),
    }),
    "File upload",
    120_000,
  );
  const done = saved as { value: T } | null;
  if (!done) throw new Error("File upload finished without saving the profile.");
  return { saved: done.value, staleAvatarObjects: replaced.staleRemaining };
};
