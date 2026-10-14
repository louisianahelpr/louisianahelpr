/**
 * Declutter photos never reach the PUBLIC bucket with their GPS tag
 * (docs/specs/declutter-auctions.md B4). compressImage hands the ORIGINAL
 * file back for HEIC, a missing canvas context or an empty toBlob; this path
 * refuses those, and refuses any JPEG that still carries an APP1 (EXIF/XMP)
 * block.
 *
 * @mutate src/lib/declutter/photos.ts |   if (cleaned === file \|\| cleaned.type !== "image/jpeg") throw new ListingPhotoError(LISTING_PHOTO_UNCLEANABLE); |   if (cleaned.size < 0) throw new ListingPhotoError(LISTING_PHOTO_UNCLEANABLE);
 * @mutate src/lib/declutter/photos.ts |     if (marker === 0xe1) return true; // APP1 = Exif or XMP |     if (marker === 0xe1) return false;
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let compressImpl: (f: File) => Promise<File> = async (f) => f;
const compress = {
  mockReset: () => { compressImpl = async (f) => f; },
  mockResolvedValue: (v: File) => { compressImpl = async () => v; },
  fail: (msg: string) => { compressImpl = async () => { throw new Error(msg); }; },
};
vi.mock("@/lib/imageCompression", () => ({ compressImage: (f: File) => compressImpl(f) }));

import { cleanListingPhoto, jpegHasMetadata, LISTING_PHOTO_UNCLEANABLE, listingPhotoPath } from "./photos";

/** SOI, optional APP1 "Exif" segment, APP0, SOS. */
function jpeg(withExif: boolean): Uint8Array {
  const soi = [0xff, 0xd8];
  const app0 = [0xff, 0xe0, 0x00, 0x07, 0x4a, 0x46, 0x49, 0x46, 0x00];
  const exif = [0xff, 0xe1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
  const sos = [0xff, 0xda, 0x00, 0x02];
  return new Uint8Array([...soi, ...app0, ...(withExif ? exif : []), ...sos, 0x11, 0x22, 0xff, 0xd9]);
}
const fileOf = (bytes: Uint8Array, type = "image/jpeg", name = "p.jpg") => new File([bytes as unknown as BlobPart], name, { type });

describe("Declutter listing photos are cleaned before upload", () => {
  beforeEach(() => compress.mockReset());

  it("jpegHasMetadata finds an EXIF block and passes a clean JPEG", () => {
    expect(jpegHasMetadata(jpeg(true))).toBe(true);
    expect(jpegHasMetadata(jpeg(false))).toBe(false);
    expect(jpegHasMetadata(new Uint8Array([1, 2, 3]))).toBe(false);
  });

  it("a re-encoded JPEG with no metadata is accepted", async () => {
    const out = fileOf(jpeg(false));
    compress.mockResolvedValue(out);
    await expect(cleanListingPhoto(fileOf(jpeg(true)))).resolves.toBe(out);
  });

  it("refuses when compressImage handed back the ORIGINAL (HEIC, no canvas, empty blob): GPS kept", async () => {
    // HEIC keeps its GPS in a HEIF box the JPEG scan cannot see: only the
    // "same file came back" check catches it.
    const original = fileOf(jpeg(false), "image/heic", "p.heic");
    compress.mockResolvedValue(original);
    await expect(cleanListingPhoto(original)).rejects.toThrow(LISTING_PHOTO_UNCLEANABLE);
  });

  it("refuses a 'cleaned' JPEG that still carries EXIF", async () => {
    compress.mockResolvedValue(fileOf(jpeg(true)));
    await expect(cleanListingPhoto(fileOf(jpeg(true)))).rejects.toThrow(LISTING_PHOTO_UNCLEANABLE);
  });

  it("refuses a non-image and a failed re-encode", async () => {
    await expect(cleanListingPhoto(fileOf(jpeg(false), "video/quicktime", "v.mov"))).rejects.toThrow(/Only photos/);
    compress.fail("Image load timed out");
    await expect(cleanListingPhoto(fileOf(jpeg(false)))).rejects.toThrow(LISTING_PHOTO_UNCLEANABLE);
  });

  it("builds the one path shape the server accepts", () => {
    const uid = "11111111-1111-1111-1111-111111111111";
    const item = "22222222-2222-2222-2222-222222222222";
    expect(listingPhotoPath(uid, item, "a b/../c")).toMatch(/^[0-9a-f-]{36}\/declutter\/[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,100}$/);
  });
});
