import { compressImage } from "@/lib/imageCompression";

/**
 * Q2471 (1): the photo a poster hands the AI Job Builder, as the base64 (no data: prefix) the ai-job-builder
 * function takes in `photo`. Shrunk to a JPEG of at most 1024px a side (EXIF, so GPS, stripped by the canvas
 * re-encode) so it stays well under the function's 1.5 MB cap. HEIC the browser can't decode is refused here
 * (tryHeic), so the server never gets a format it would reject anyway.
 */
export const AI_PHOTO_MAX_DIMENSION = 1024;

/** The plain words shown when the phone hands us a photo the browser can't turn into a JPEG (HEIF, no type). */
export const UNSUPPORTED_PHOTO_MESSAGE = "This photo type isn't supported. Try a screenshot or JPEG.";

export class UnsupportedPhotoError extends Error {
  constructor() {
    super(UNSUPPORTED_PHOTO_MESSAGE);
  }
}

const SENDABLE = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function jobPhotoForAi(file: File): Promise<string> {
  let small: File;
  try {
    small = await compressImage(file, AI_PHOTO_MAX_DIMENSION, 0.8, undefined, { tryHeic: true });
  } catch {
    // The browser could not decode it (an iPhone HEIF it can't read, a broken file): plain words, not the decoder's.
    throw new UnsupportedPhotoError();
  }
  // compressImage returns a non-image or blank-type file untouched: never send what the server would refuse.
  if (!SENDABLE.has(small.type)) throw new UnsupportedPhotoError();
  const buf = new Uint8Array(await small.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}
