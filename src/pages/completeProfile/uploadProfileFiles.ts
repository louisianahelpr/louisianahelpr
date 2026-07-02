import { supabase } from "@/integrations/supabase/client";
import { sanitizeExt, withTimeout } from "./constants";

export interface UploadedProfileFiles {
  avatarUrl: string | null;
  idDocumentPath: string | null;
}

/**
 * Upload the avatar + optional government-ID file directly to Storage in
 * parallel (much faster than base64-through-edge-function). The avatar path
 * is RLS-sensitive — it is keyed by `${userId}/avatar.<ext>` with upsert:true
 * so the object-owner policy resolves. Any Storage error is re-thrown so the
 * caller's try/catch (which drives the recovery + toast path) sees it; never
 * swallow it here.
 */
export const uploadProfileFiles = async (
  userId: string,
  avatarFile: File | null,
  idFile: File | null,
): Promise<UploadedProfileFiles> => {
  let avatarUrl: string | null = null;
  let idDocumentPath: string | null = null;

  const uploads: Promise<void>[] = [];

  if (avatarFile) {
    const ext = sanitizeExt(avatarFile.name);
    const path = `${userId}/avatar.${ext}`;
    uploads.push(
      supabase.storage
        .from("avatars")
        .upload(path, avatarFile, { upsert: true, contentType: avatarFile.type })
        .then(({ error }) => {
          if (error) throw error;
          const { data } = supabase.storage.from("avatars").getPublicUrl(path);
          avatarUrl = `${data.publicUrl}?t=${Date.now()}`;
        })
    );
  }

  if (idFile) {
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

  return { avatarUrl, idDocumentPath };
};
