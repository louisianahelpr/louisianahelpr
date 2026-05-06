import { describe, it, expect } from "vitest";
import { compressImage } from "./imageCompression";

// imageCompression mostly exercises canvas + Image which jsdom doesn't
// fully simulate (toBlob is a no-op, image onload doesn't auto-fire).
// Tests focus on the early-exit paths that guard against pointless work
// — non-image MIME, tiny files. Those are the fast paths AND the
// regression guards we actually care about (a bug that removed the size
// check would silently 10× the upload time for 5KB icons).

describe("compressImage early exits", () => {
  it("returns the original file unchanged for non-image MIME types", async () => {
    const file = new File(["pdf-bytes-here"], "doc.pdf", { type: "application/pdf" });
    const result = await compressImage(file);
    expect(result).toBe(file);
  });

  it("returns the original file unchanged when file is below 100KB", async () => {
    // 50KB JPEG — below the 100KB compression threshold
    const smallContent = new Uint8Array(50 * 1024);
    const file = new File([smallContent], "tiny.jpg", { type: "image/jpeg" });
    const result = await compressImage(file);
    expect(result).toBe(file);
  });

  it("returns the original file unchanged for empty file", async () => {
    const file = new File([], "empty.jpg", { type: "image/jpeg" });
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
});
