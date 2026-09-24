/**
 * NB-007: the three native photo call sites showed "Couldn't open your photos.
 * Please try again." for a back-out, a denied permission and a real failure
 * alike. Cancel is silent, denial points at Settings (and is not reported as an
 * error), a real failure keeps the retry copy. Inventory: every src/ file that
 * calls pickImagesNative/takePhotoNative must route its catch through
 * pickerFailure.
 *
 * @mutate src/lib/nativeCamera.ts | if (CANCELLED.test(m)) return null; // NB-007 cancel is silent | // NB-007 cancel is silent
 * @mutate src/lib/nativeCamera.ts | copy: `${kind === "camera" ? "Camera" : "Photo"} access is off. Turn it on in Settings, then try again.`, // NB-007 denied | copy: "Couldn't open your photos. Please try again.",
 * @mutate src/components/PhotoProof.tsx | const failure = pickerFailure(err, "photos"); | const failure = { copy: "Couldn't open your photos. Please try again.", isError: true };
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pickerFailure } from "@/lib/nativeCamera";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) && !/\.test\./.test(n) ? [p] : [];
  });
}

describe("native picker outcomes are told apart (NB-007)", () => {
  it("a back-out says nothing", () => {
    expect(pickerFailure(new Error("User cancelled photos app"), "photos")).toBeNull();
  });
  it("a denied permission points at Settings and is not an error", () => {
    const f = pickerFailure(new Error("User denied access to photos"), "photos");
    expect(f?.isError).toBe(false);
    expect(f?.copy).toMatch(/Settings/);
    expect(pickerFailure(new Error("User denied access to camera"), "camera")?.copy).toMatch(/^Camera access is off/);
  });
  it("a real failure keeps the retry copy and is reported", () => {
    expect(pickerFailure(new Error("Error processing image"), "photos")).toEqual({
      copy: "Couldn't open your photos. Please try again.",
      isError: true,
    });
  });
  const callers = walk("src").filter(
    (f) => f !== join("src", "lib", "nativeCamera.ts") && /\b(pickImagesNative|takePhotoNative)\(/.test(readFileSync(f, "utf8")),
  );
  it("the caller inventory is real", () => {
    expect(callers.length).toBeGreaterThanOrEqual(3);
  });
  it("every picker call site maps its failure through pickerFailure", () => {
    for (const f of callers) {
      const s = readFileSync(f, "utf8");
      const calls = (s.match(/\b(?:pickImagesNative|takePhotoNative)\(/g) ?? []).length;
      const mapped = (s.match(/pickerFailure\(err, "(?:photos|camera)"\)/g) ?? []).length;
      expect(mapped, f).toBe(calls);
    }
  });
});
