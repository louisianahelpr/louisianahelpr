import { supabase } from "@/integrations/supabase/client";
import {
  assertUploadableAvatar,
  replaceAvatarObject,
  type AvatarReplaceResult,
} from "@/lib/avatarStorage";
import { sanitizeExt, withTimeout } from "./constants";

export interface UploadedProfileFiles {
  avatarUrl: string | null;
  idDocumentPath: string | null;
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
 * parallel (much faster than base64-through-edge-function).
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
export const uploadProfileFiles = async (
  userId: string,
  avatarFile: File | null,
  idFile: File | null,
): Promise<UploadedProfileFiles> => {
  let avatarResult: AvatarReplaceResult | null = null;
  let idDocumentPath: string | null = null;

  const uploads: Promise<void>[] = [];

  if (avatarFile) {
    // Throws before any network call — a file the bucket would reject with an
    // opaque `mime type ... is not supported` (or a bare 413) instead fails
    // here with copy the recovery path can show verbatim.
    assertUploadableAvatar(avatarFile);
    uploads.push(
      replaceAvatarObject(supabase, userId, avatarFile, avatarFile.type).then((r) => {
        avatarResult = r;
      }),
    );
  }

  if (idFile) {
    // Deliberately NOT the avatar path: a timestamped key in the PRIVATE
    // `id-documents` bucket, no upsert, no public URL ever minted. Successive
    // uploads are meant to accumulate here — an ID is evidence with a review
    // history, not a photo being replaced — which is exactly why the two
    // buckets must not share a key strategy.
    const ext = sanitizeExt(idFile.name);
    const path = `${userId}/id-document-${Date.now()}.${ext}`;
    uploads.push(
      supabase.storage
        .from("id-documents")
        .upload(path, idFile, { contentType: idFile.type })
        .then(({ error }) => {
          if (error) throw error;
          idDocumentPath = path;
        })
    );
  }

  if (uploads.length) await withTimeout(Promise.all(uploads), "File upload");

  const result = avatarResult as AvatarReplaceResult | null;
  return {
    avatarUrl: result?.publicUrl ?? null,
    idDocumentPath,
    staleAvatarObjects: result?.staleRemaining ?? [],
  };
};
