import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

/**
 * WHAT THE THREE TESTS ABOVE COULD NOT SEE.
 *
 * They pin the two exits that MUST return the original. Nothing pinned the
 * complement — that everything else must NOT. The header above says a size
 * threshold was deliberately removed because the canvas re-encode is the only
 * thing that strips EXIF (GPS coordinates of the poster's house, device model,
 * timestamps), and yet re-adding `if (file.size < N) return file;` would have
 * left all three green. The guard described the invariant in a comment and
 * asserted the opposite half of it.
 *
 * jsdom never fires `img.onload`, so the honest observation available here is
 * whether the promise SETTLES WITH THE ORIGINAL FILE. An early exit settles it
 * at once; the canvas path either stays pending until the module's own 10s load
 * timeout rejects, or throws on jsdom's unimplemented canvas/object-URL. Either
 * of those is "it entered the re-encode path"; only the first is the leak.
 */
describe("compressImage has no size early-exit — every image re-encodes, or EXIF ships", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ["a 1-byte JPEG", 1],
    ["an 8KB PNG", 8 * 1024],
    ["a 400KB JPEG", 400 * 1024],
  ])("does not hand back %s untouched", async (_label, bytes) => {
    vi.useFakeTimers();
    const file = new File([new Uint8Array(bytes)], "photo.jpg", { type: "image/jpeg" });

    const outcome = compressImage(file).then(
      (result) => (result === file ? "RETURNED THE ORIGINAL — EXIF intact" : "re-encoded"),
      () => "entered the canvas path",
    );
    // Past the module's 10s img.onload timeout, so the promise cannot still be
    // pending when we read it.
    await vi.advanceTimersByTimeAsync(11_000);

    expect(await outcome).not.toBe("RETURNED THE ORIGINAL — EXIF intact");
  });
});

// Audit posting 1030 #4: a listing photo tries the canvas, because WebKit can decode HEIC, and refuses only if that fails.
// @mutate src/lib/imageCompression.ts | (file.type === "image/heic" && !tryHeic) | file.type === "image/heic"
// @mutate src/lib/declutter/photos.ts | cleaned = await compressImage(file, maxDimension, quality, undefined, { tryHeic: true }); | cleaned = await compressImage(file, maxDimension, quality);
describe("tryHeic: a caller that refuses what it can't clean", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("goes to the canvas instead of handing the HEIC back", async () => {
    vi.useFakeTimers();
    const file = new File([new Uint8Array(10)], "photo.heic", { type: "image/heic" });
    const outcome = compressImage(file, 1920, 0.8, undefined, { tryHeic: true }).then(
      (result) => (result === file ? "RETURNED THE ORIGINAL" : "re-encoded"),
      () => "entered the canvas path",
    );
    await vi.advanceTimersByTimeAsync(11_000);
    expect(await outcome).toBe("entered the canvas path");
  });

  it("a listing photo uses it", () => {
    const src = readFileSync(resolve(__dirname, "declutter/photos.ts"), "utf8");
    expect(src.length).toBeGreaterThan(500);
    expect(src).toContain("{ tryHeic: true }");
  });
});

// The EXIF leak, reproduced exactly: a size threshold in front of the canvas
// re-encode. Small photos — which is most phone screenshots and every cropped
// thumbnail — would upload with the poster's home GPS coordinates attached.
// @mutate src/lib/imageCompression.ts | onProgress?.(0); | if (file.size < 1024 * 1024) return file;
// The HEIC exit is the other direction: without it an iPhone photo goes into a
// canvas that cannot decode it, and the upload silently produces a blank image.
// @mutate src/lib/imageCompression.ts | if (!file.type.startsWith("image/") \|\| (file.type === "image/heic" && !tryHeic)) { | if (!file.type.startsWith("image/")) {
