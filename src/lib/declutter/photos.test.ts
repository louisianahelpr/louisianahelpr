/**
 * Declutter photos never reach the PUBLIC bucket with their GPS tag
 * (docs/specs/declutter-auctions.md B4). compressImage hands the ORIGINAL
 * file back for HEIC, a missing canvas context or an empty toBlob; this path
 * refuses those, and refuses any JPEG that still carries an APP1 (EXIF/XMP)
 * block.
 *
 * @mutate src/lib/declutter/photos.ts |   if (cleaned === file \|\| cleaned.type !== "image/jpeg") throw new ListingPhotoError(LISTING_PHOTO_UNCLEANABLE); |   if (cleaned.size < 0) throw new ListingPhotoError(LISTING_PHOTO_UNCLEANABLE);
 * @mutate src/lib/declutter/photos.ts |     return await compressImage(file, BUNCH_THUMB_SIZE, 0.6); |     return file;
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

import { bunchThumbnail, cleanListingPhoto, jpegHasMetadata, LISTING_PHOTO_UNCLEANABLE, listingPhotoPath, stripJpegAppSegments } from "./photos";

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

  it("a re-encoded JPEG with no metadata is accepted, byte for byte", async () => {
    const out = fileOf(jpeg(false));
    compress.mockResolvedValue(out);
    const got = await cleanListingPhoto(fileOf(jpeg(true)));
    expect(got.type).toBe("image/jpeg");
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(jpeg(false));
  });

  // 2026-10-28: Apple's encoder (iOS Safari / WKWebView; measured in Playwright WebKit) writes its own APP1 and
  // APP13 into every canvas JPEG: markers e0:16, e1:76, ed:56, c0, c4, db, dd, da. Refusing any APP1 refused
  // every photo on an iPhone. Now every APPn but APP0 and every comment is stripped; the image data is kept.
  // @mutate src/lib/declutter/photos.ts |     if (!metadata) keep.push(bytes.subarray(i, i + 2 + len)); |     keep.push(bytes.subarray(i, i + 2 + len));
  // @mutate src/lib/declutter/photos.ts |     const metadata = (marker >= 0xe1 && marker <= 0xef) \|\| marker === 0xfe; |     const metadata = marker === 0xe1;
  // @mutate src/lib/declutter/photos.ts |   if (!stripped \|\| jpegHasMetadata(stripped)) throw new ListingPhotoError(LISTING_PHOTO_UNCLEANABLE); |   if (!stripped) return cleaned;
  it("a WebKit canvas JPEG (its own APP1 + APP13) is stripped to APP0 + the image, not refused", async () => {
    const seg = (marker: number, body: number[]) => [0xff, marker, 0x00, body.length + 2, ...body];
    const app0 = seg(0xe0, [0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
    const app1 = seg(0xe1, [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x4d, 0x4d, 0x00, 0x2a]);
    const app13 = seg(0xed, [0x50, 0x68, 0x6f, 0x74, 0x6f, 0x73, 0x68, 0x6f, 0x70]);
    const xmp = seg(0xe2, [0x49, 0x43, 0x43]);
    const com = seg(0xfe, [0x68, 0x69]);
    const dqt = seg(0xdb, [0x00, 1, 2, 3]);
    const sof = seg(0xc0, [8, 0, 1, 0, 1, 1, 1, 0x11, 0]);
    const scan = [0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0x33, 0xff, 0xd9];
    const webkit = new Uint8Array([0xff, 0xd8, ...app0, ...app1, ...app13, ...xmp, ...com, ...dqt, ...sof, ...scan]);
    compress.mockResolvedValue(fileOf(webkit));
    const got = new Uint8Array(await (await cleanListingPhoto(fileOf(jpeg(true)))).arrayBuffer());
    expect(got).toEqual(new Uint8Array([0xff, 0xd8, ...app0, ...dqt, ...sof, ...scan]));
    expect(jpegHasMetadata(got)).toBe(false);
    // Stripping again changes nothing: no metadata segment is left.
    expect(stripJpegAppSegments(got)).toEqual(got);
  });

  it("a header that cannot be walked to its scan is refused, never uploaded", async () => {
    // Truncated segment length, no start-of-scan, a non-marker byte: each refused.
    const truncated = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x40, 0x45, 0x78]);
    const noScan = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xd9]);
    const garbage = new Uint8Array([0xff, 0xd8, 0x12, 0x34, 0x00, 0x04, 0xff, 0xda, 0x00, 0x02]);
    for (const bad of [truncated, noScan, garbage]) {
      expect(stripJpegAppSegments(bad)).toBeNull();
      compress.mockResolvedValue(fileOf(bad));
      await expect(cleanListingPhoto(fileOf(jpeg(true)))).rejects.toThrow(LISTING_PHOTO_UNCLEANABLE);
    }
  });

  it("refuses when compressImage handed back the ORIGINAL (HEIC, no canvas, empty blob): GPS kept", async () => {
    // HEIC keeps its GPS in a HEIF box the JPEG scan cannot see: only the
    // "same file came back" check catches it.
    const original = fileOf(jpeg(false), "image/heic", "p.heic");
    compress.mockResolvedValue(original);
    await expect(cleanListingPhoto(original)).rejects.toThrow(LISTING_PHOTO_UNCLEANABLE);
  });

  it("a 'cleaned' JPEG that still carries EXIF goes up WITHOUT it (stripped, never as it is)", async () => {
    compress.mockResolvedValue(fileOf(jpeg(true)));
    const got = new Uint8Array(await (await cleanListingPhoto(fileOf(jpeg(true)))).arrayBuffer());
    expect(jpegHasMetadata(got)).toBe(false);
    expect(got).toEqual(jpeg(false));
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

describe("Sell a bunch's previews", () => {
  const original = new File(["big"], "big.jpg", { type: "image/jpeg" });

  beforeEach(() => compress.mockReset());

  it("are the small copy", async () => {
    const small = new File(["s"], "big.jpg", { type: "image/jpeg" });
    compress.mockResolvedValue(small);
    expect(await bunchThumbnail(original)).toBe(small);
  });

  it("fall back to the photo itself, and say so in the console", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    compress.fail("Image load timed out");
    expect(await bunchThumbnail(original)).toBe(original);
    expect(warn).toHaveBeenCalledWith("[declutter] no small preview for a photo", expect.any(Error));
    warn.mockRestore();
  });
});
