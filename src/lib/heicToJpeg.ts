/**
 * HEIC and HEIF to JPEG, on the device, before a proof photo uploads (Tester 6, 10-30: a stored HEIC draws in WebKit
 * and shows broken in Chromium, so the poster deciding on pay could see nothing).
 *
 * Only a browser that can decode the file can convert it: WebKit can, Chromium cannot. Null means this browser
 * couldn't, and the caller says so; the file is never silently swapped or dropped.
 */
const HEIC_TYPES = new Set(["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"]);
/** A longest side that keeps a proof photo readable when zoomed, and a JPEG well inside the bucket's 10 MB. */
const MAX_SIDE = 4096;
const QUALITY = 0.9;
const STEP_TIMEOUT_MS = 15_000;

/** By type, or by name when the picker reports none (some browsers give a HEIC an empty type). */
export function isHeicFile(file: { type: string; name: string }): boolean {
  const type = (file.type || "").toLowerCase();
  if (type) return HEIC_TYPES.has(type);
  return /\.hei[cf]$/i.test(file.name);
}

function decode(file: File): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    const done = (v: HTMLImageElement | null) => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(v);
    };
    const timer = setTimeout(() => done(null), STEP_TIMEOUT_MS);
    img.onload = () => done(img);
    img.onerror = () => done(null);
    img.src = url;
  });
}

export async function heicToJpeg(file: File): Promise<File | null> {
  const img = await decode(file);
  if (!img || !img.naturalWidth || !img.naturalHeight) return null;
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  try {
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  } catch {
    // Out of memory on a huge photo, typically. Null is the caller's "this browser couldn't", and it says so.
    return null;
  }
  const blob = await new Promise<Blob | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), STEP_TIMEOUT_MS);
    canvas.toBlob((b) => { clearTimeout(timer); resolve(b); }, "image/jpeg", QUALITY);
  });
  // An encoder that fell back to another format would leave the same problem under a new name.
  if (!blob || blob.type !== "image/jpeg") return null;
  return new File([blob], `${file.name.replace(/\.[^.]*$/, "") || "photo"}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
}
