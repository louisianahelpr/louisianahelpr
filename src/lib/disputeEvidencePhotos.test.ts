/**
 * Audit 11-20 night #17: dispute photos are shrunk before the size check.
 *
 * @mutate src/lib/disputeEvidencePhotos.ts | const file = await compress(picked).catch( | const file = await Promise.resolve(picked).catch(
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { shrinkDisputePhotos, DISPUTE_PHOTO_MAX_BYTES } from "./disputeEvidencePhotos";

const sized = (name: string, bytes: number) => {
  const f = new File(["x"], name, { type: "image/jpeg" });
  Object.defineProperty(f, "size", { value: bytes });
  return f;
};

describe("dispute evidence photos", () => {
  it("keeps a photo over 5 MB once it shrinks under the limit", async () => {
    const big = sized("camera.jpg", 9 * 1024 * 1024);
    const small = sized("camera.jpg", 600_000);
    const { ready, tooBig } = await shrinkDisputePhotos([big], async () => small);
    expect(ready).toEqual([small]);
    expect(tooBig).toEqual([]);
  });
  it("refuses only what is still over the limit after shrinking", async () => {
    const big = sized("huge.jpg", DISPUTE_PHOTO_MAX_BYTES + 1);
    const { ready, tooBig } = await shrinkDisputePhotos([big], async (f) => f);
    expect(ready).toEqual([]);
    expect(tooBig).toEqual([big]);
  });
  it("keeps the picked photo when shrinking fails", async () => {
    const ok = sized("ok.jpg", 1000);
    const { ready } = await shrinkDisputePhotos([ok], async () => { throw new Error("no canvas"); });
    expect(ready).toEqual([ok]);
  });
  it("the dispute dialog uses it and no longer refuses on the raw size", () => {
    const src = readFileSync(resolve(__dirname, "../components/DisputeDialog.tsx"), "utf8");
    expect(src).toContain("await shrinkDisputePhotos(allowed)");
    expect(src).not.toContain("exceeds 5 MB limit");
  });
});
