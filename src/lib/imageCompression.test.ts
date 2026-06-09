import { describe, it, expect } from "vitest";
import { compressImage } from "./imageCompression";

// imageCompression mostly exercises canvas + Image which jsdom doesn't
// fully simulate (toBlob is a no-op, image onload doesn't auto-fire).
// Tests focus on the early-exit paths that guard against pointless work
// — non-image MIME, HEIC. We deliberately do NOT test a small-file early
// exit: there is no size threshold any more, every image goes through the
// canvas re-encode path because that's how EXIF (GPS, device model,
// timestamps) gets stripped — letting small files skip it would leak EXIF
// on uncompressed originals.

describe("compressImage early exits", () => {
  it("returns the original file unchanged for non-image MIME types", async () => {
    const file = new File(["pdf-bytes-here"], "doc.pdf", { type: "application/pdf" });
    const result = await compressImage(file);
    expect(result).toBe(file);
  });

  it("returns original for non-image even if it's large", async () => {
    // 500KB PDF — large but wrong MIME, must not be touched
    const content = new Uint8Array(500 * 1024);
    const file = new File([content], "big.pdf", { type: "application/pdf" });
    const result = await compressImage(file);
    expect(result).toBe(file);
  });

  it("returns the original file unchanged for HEIC (canvas cannot decode in most browsers)", async () => {
    const file = new File([new Uint8Array(10)], "photo.heic", { type: "image/heic" });
    const result = await compressImage(file);
    expect(result).toBe(file);
  });
});
