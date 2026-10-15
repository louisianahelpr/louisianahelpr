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
 * must be a NEW image/jpeg file, and its bytes are scanned for an EXIF (APP1)
 * or XMP block before it may be uploaded. A photo that fails is refused with
 * plain words, never uploaded as it is.
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
 * block. Throws ListingPhotoError (plain words) otherwise.
 */
export async function cleanListingPhoto(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) throw new ListingPhotoError("Only photos can be added to a listing.");
  let cleaned: File;
  try {
    cleaned = await compressImage(file, 1920, 0.82);
  } catch {
    throw new ListingPhotoError(LISTING_PHOTO_UNCLEANABLE);
  }
  // compressImage returns the original on HEIC / no canvas / empty blob.
  if (cleaned === file || cleaned.type !== "image/jpeg") throw new ListingPhotoError(LISTING_PHOTO_UNCLEANABLE);
  if (jpegHasMetadata(await fileBytes(cleaned))) throw new ListingPhotoError(LISTING_PHOTO_UNCLEANABLE);
  return cleaned;
}

/** Storage path the server accepts: <seller uid>/declutter/<item id>/<file>. */
export function listingPhotoPath(sellerId: string, itemId: string, nonce: string): string {
  const safe = nonce.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 60) || "photo";
  return `${sellerId}/declutter/${itemId}/${safe}.jpg`;
}
