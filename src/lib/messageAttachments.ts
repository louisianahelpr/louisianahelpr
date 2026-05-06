import { supabase } from "@/integrations/supabase/client";

const BUCKET = "message-attachments";

export const MESSAGE_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;

export const MESSAGE_ATTACHMENT_MIME_WHITELIST = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/pdf",
] as const;

export type MessageAttachmentMime = (typeof MESSAGE_ATTACHMENT_MIME_WHITELIST)[number];

export function isImageMime(mime: string | null | undefined): boolean {
  return !!mime && mime.startsWith("image/");
}

export function isPdfMime(mime: string | null | undefined): boolean {
  return mime === "application/pdf";
}

// Path convention enforced by storage RLS:
//   <job_id>/<sender_id>/<uuid>-<filename>
export function buildAttachmentPath(jobId: string, senderId: string, file: File): string {
  const uuid = crypto.randomUUID();
  const safeName = file.name.replace(/[^\w.-]/g, "_").slice(0, 80);
  return `${jobId}/${senderId}/${uuid}-${safeName}`;
}

// Strips EXIF (and other metadata) from an image by drawing it onto a
// canvas and re-encoding. Returns a fresh Blob. Skips non-image and HEIC
// files (HEIC isn't decodable in most browsers).
export async function stripImageExif(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/") || file.type === "image/heic") return file;

  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("canvas.toBlob returned null"))),
        file.type,
        0.92,
      );
    });
  } finally {
    bitmap.close?.();
  }
}

// Uploads an attachment to the message-attachments bucket. Returns the
// storage path on success (NOT a URL — caller stores path on
// messages.attachment_url and resolves a signed URL at display time).
export async function uploadMessageAttachment(
  file: File,
  jobId: string,
  senderId: string,
): Promise<{ path: string; mime: string; size: number } | { error: string }> {
  if (file.size > MESSAGE_ATTACHMENT_MAX_BYTES) {
    return { error: `File too large (max ${Math.round(MESSAGE_ATTACHMENT_MAX_BYTES / 1024 / 1024)}MB).` };
  }
  if (!MESSAGE_ATTACHMENT_MIME_WHITELIST.includes(file.type as MessageAttachmentMime)) {
    return { error: "Unsupported file type. Allowed: JPG, PNG, WEBP, HEIC, PDF." };
  }

  const blob = await stripImageExif(file);
  const path = buildAttachmentPath(jobId, senderId, file);

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, {
      contentType: file.type,
      upsert: false,
    });

  if (error) return { error: error.message };
  return { path, mime: file.type, size: blob.size };
}

// Resolves a short-lived signed URL for display. Re-call on each render
// of a long-lived view since URLs expire.
export async function getMessageAttachmentSignedUrl(
  path: string,
  expiresInSeconds = 60 * 5,
): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error || !data) return null;
  return data.signedUrl;
}

export function getMessageAttachmentFilename(path: string, fallback = "Attachment"): string {
  if (!path) return fallback;
  const last = path.split("/").pop() || fallback;
  // Strip the leading <uuid>- prefix from buildAttachmentPath
  const stripped = last.replace(/^[0-9a-f-]{36}-/i, "");
  try {
    return decodeURIComponent(stripped);
  } catch {
    return stripped;
  }
}
