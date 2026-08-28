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

type MessageAttachmentMime = (typeof MESSAGE_ATTACHMENT_MIME_WHITELIST)[number];

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

/** HEIC/HEIF can't be decoded by canvas in WKWebView (or most browsers),
 *  so its EXIF — including GPS — can't be scrubbed client-side. */
function isHeicMime(mime: string | null | undefined): boolean {
  return mime === "image/heic" || mime === "image/heif";
}

// Strips EXIF (and other metadata) from an image by drawing it onto a
// canvas and re-encoding. Returns a fresh Blob. Skips non-image files;
// HEIC never reaches this (uploadMessageAttachment rejects it first).
async function stripImageExif(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/") || isHeicMime(file.type)) return file;

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
    return { error: "Unsupported file type. Allowed: JPG, PNG, WEBP, PDF." };
  }
  // Un-strippable format would ship the photo's GPS EXIF to the other
  // participant — refuse it rather than leak location data.
  if (isHeicMime(file.type)) {
    return { error: "That photo format can't be privacy-scrubbed — take a screenshot or choose a JPEG/PNG." };
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

/**
 * Batched signed-URL resolver — one network round-trip for an arbitrary
 * number of message-attachment paths. Replaces N per-row
 * `getMessageAttachmentSignedUrl` calls on the inbox list, where every
 * image-last-message conversation used to fire its own request.
 *
 * Returns a `path → signedUrl` map. Missing entries (the storage SDK
 * may return per-path errors inside an otherwise-successful batch) are
 * simply absent from the result; callers should `?? null` on lookup.
 *
 * De-dupes input paths (the same image may legitimately appear on two
 * conversations) and short-circuits on an empty input.
 */
export async function getMessageAttachmentSignedUrls(
  paths: string[],
  expiresInSeconds = 60 * 5,
): Promise<Record<string, string>> {
  const unique = Array.from(new Set(paths.filter(Boolean)));
  if (unique.length === 0) return {};
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(unique, expiresInSeconds);
  if (error || !data) return {};
  const out: Record<string, string> = {};
  for (const row of data) {
    if (row.path && row.signedUrl && !row.error) out[row.path] = row.signedUrl;
  }
  return out;
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

/** Maximum voice note size: 10 MB (60s audio at ~128kbps = ~1 MB — 10× headroom). */
const VOICE_NOTE_MAX_BYTES = 10 * 1024 * 1024;

export function isAudioMime(mime: string | null | undefined): boolean {
  return !!mime && mime.startsWith("audio/");
}

/**
 * Uploads a voice note Blob to the message-attachments bucket.
 * Returns { path, mime, size } on success, { error } on failure.
 * The path uses the same scoping convention as image attachments:
 *   voice-notes/<jobId>/<senderId>/<uuid>.<ext>
 */
export async function uploadVoiceNote(
  blob: Blob,
  mime: string,
  jobId: string,
  senderId: string,
): Promise<{ path: string; mime: string; size: number } | { error: string }> {
  if (blob.size > VOICE_NOTE_MAX_BYTES) {
    return { error: "Voice note too large (max 10 MB)." };
  }

  const ext = mime.includes("webm") ? "webm" : "m4a";
  const uuid = crypto.randomUUID();
  const path = `voice-notes/${jobId}/${senderId}/${uuid}.${ext}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { contentType: mime, upsert: false });

  if (error) return { error: error.message };
  return { path, mime, size: blob.size };
}
