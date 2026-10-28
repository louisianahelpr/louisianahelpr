/**
 * Declutter listing photos: cleaned before upload, never sent with their
 * location (docs/specs/declutter-auctions.md B4: the photos are PUBLIC in the
 * job-photos bucket while the pickup address is private, so a photo's GPS tag
 * would hand every buyer the seller's home).
 *
 * compressImage (src/lib/imageCompression.ts) strips EXIF by re-encoding
 * through a canvas, BUT it hands the ORIGINAL file back in three cases: a
 * HEIC file, a canvas with no 2D context, and a toBlob that yields nothing.
 * Each of those keeps the GPS tag. So this path does not trust it: the result
 * must be a NEW image/jpeg file; every APP1-APP15 segment (EXIF, XMP, IPTC)
 * the encoder wrote is stripped from it (stripJpegAppSegments), and the
 * result is scanned once more for an EXIF (APP1) or XMP block before it may be
 * uploaded. A photo that fails is refused with plain words, never uploaded as
 * it is.
 */
import { compressImage } from "@/lib/imageCompression";
import { ListingPhotoError } from "./errors";

/**
 * What a listing photo is once cleaned: always a re-encoded JPEG. A subset of
 * the job-photos bucket's allowed types and of what declutter_add_item_photo
 * attaches (jpeg/png/webp); src/test/uploadMimeParity.test.ts checks both.
 */
export const LISTING_PHOTO_UPLOAD_TYPES: readonly string[] = ["image/jpeg"];

export const LISTING_PHOTO_UNCLEANABLE =
  "We couldn't prepare this photo. Try a different photo, or take a new one with the camera.";

/** True when JPEG bytes carry an EXIF or XMP metadata block (APP1). */
export function jpegHasMetadata(bytes: Uint8Array): boolean {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return false; // not a marker: the header is over or malformed
    const marker = bytes[i + 1];
    if (marker === 0xda || marker === 0xd9) return false; // start of scan / end: no more headers
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (len < 2) return false;
    if (marker === 0xe1) return true; // APP1 = Exif or XMP
    i += 2 + len;
  }
  return false;
}

async function fileBytes(file: Blob): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === "function") return new Uint8Array(await file.arrayBuffer());
  return new Uint8Array(
    await new Promise<ArrayBuffer>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as ArrayBuffer);
      r.onerror = () => reject(r.error);
      r.readAsArrayBuffer(file);
    }),
  );
}

/**
 * The photo as it may be uploaded: re-encoded to JPEG, with no metadata
 * block. Throws ListingPhotoError (plain words) otherwise. Room photos for
 * moving-out mode pass a smaller size (they go to the photo tool only).
 */
export async function cleanListingPhoto(file: File, maxDimension = 1920, quality = 0.82): Promise<File> {
  if (!file.type.startsWith("image/")) throw new ListingPhotoError("Only photos can be added to a listing.");
  let cleaned: File;
  try {
    cleaned = await compressImage(file, maxDimension, quality);
  } catch {
    throw new ListingPhotoError(LISTING_PHOTO_UNCLEANABLE);
  }
  // compressImage returns the original on HEIC / no canvas / empty blob.
  if (cleaned === file || cleaned.type !== "image/jpeg") throw new ListingPhotoError(LISTING_PHOTO_UNCLEANABLE);
  // Apple's JPEG encoder (iOS Safari / WKWebView, WebKit) writes its OWN APP1 and APP13 segments into a canvas
  // re-encode (measured 2026-10-28: markers e0, e1:76, ed:56, ...), so refusing any APP1 refused every photo on
  // an iPhone. The re-encode holds pixels only (the source file's EXIF/GPS never reaches the canvas), and every
  // APPn but APP0 (JFIF) and every comment is stripped here anyway; a header that cannot be walked is refused.
  const stripped = stripJpegAppSegments(await fileBytes(cleaned));
  if (!stripped || jpegHasMetadata(stripped)) throw new ListingPhotoError(LISTING_PHOTO_UNCLEANABLE);
  return new File([stripped as unknown as BlobPart], cleaned.name, { type: "image/jpeg", lastModified: cleaned.lastModified });
}

/**
 * The JPEG with every APP1-APP15 segment (EXIF, XMP, Photoshop/IPTC, ...) and every comment removed from its
 * header; APP0 (JFIF), the tables, the frame and the image data are kept byte for byte. null when the header
 * cannot be walked from the start-of-image to the start-of-scan (then the caller refuses the photo).
 */
export function stripJpegAppSegments(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const keep: Uint8Array[] = [bytes.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    if (marker === 0xda) {
      keep.push(bytes.subarray(i));
      const out = new Uint8Array(keep.reduce((n, k) => n + k.length, 0));
      let at = 0;
      for (const k of keep) {
        out.set(k, at);
        at += k.length;
      }
      return out;
    }
    // End of image, a restart or a standalone marker before any scan: not a header we understand.
    if (marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8) || marker === 0xff) return null;
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (len < 2 || i + 2 + len > bytes.length) return null;
    const metadata = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
    if (!metadata) keep.push(bytes.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  return null;
}

/** A cleaned photo as bare base64 (no data: prefix), for the photo tool's request body. */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result ?? "");
      resolve(s.slice(s.indexOf(",") + 1));
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** Storage path the server accepts: <seller uid>/declutter/<item id>/<file>. */
export function listingPhotoPath(sellerId: string, itemId: string, nonce: string): string {
  const safe = nonce.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 60) || "photo";
  return `${sellerId}/declutter/${itemId}/${safe}.jpg`;
}
