// Q2471 (1) "Post a job from a photo": the ONE photo a poster may hand the AI Job Builder, checked before it is
// sent to Claude. The client shrinks it to a JPEG of at most 1024px a side first (src/components/postjob/
// jobPhotoForAi.ts), so a real photo is ~100-300 KB; anything over MAX_PHOTO_BYTES is refused (413), not
// trimmed. The media type is read from the bytes themselves (imageMediaType), never from the caller's label, so a
// non-image cannot be relayed to the model as one.
import { imageMediaType } from "../declutter-ai-draft/checkSweep.ts";
import type { ClaudeImage } from "../_shared/claudeMessages.ts";

export const MAX_PHOTO_BYTES = 1_500_000;

export type PhotoRead = { image: ClaudeImage | null } | { error: string; status: 400 | 413 };

/** `raw` is the request body's `photo` field: absent/null (no photo), or a base64 string (no data: prefix). */
export function readJobPhoto(raw: unknown): PhotoRead {
  if (raw === undefined || raw === null) return { image: null };
  if (typeof raw !== "string" || raw.length === 0) return { error: "`photo` must be a base64 string", status: 400 };
  // base64 is 4 chars per 3 bytes: refuse an oversized one before decoding it.
  if (Math.floor((raw.length * 3) / 4) > MAX_PHOTO_BYTES) return { error: "Photo too large", status: 413 };
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) return { error: "`photo` must be a base64 string", status: 400 };
  let bytes: Uint8Array;
  try {
    const bin = atob(raw);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch {
    // A malformed base64 string is the caller's error (400), not ours; nothing to log.
    return { error: "`photo` must be a base64 string", status: 400 };
  }
  const mediaType = imageMediaType(bytes);
  if (!mediaType || mediaType === "image/gif") return { error: "`photo` must be a JPEG, PNG or WebP image", status: 400 };
  return { image: { mediaType, base64: raw } };
}
