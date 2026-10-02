import { describe, it, expect } from "vitest";
import { storageExtFor } from "@/lib/storageExt";

describe("storageExtFor (docs/OPEN.md LIVE DEFECT #5)", () => {
  it("derives the extension from a known MIME type", () => {
    expect(storageExtFor({ type: "image/png" }, "jpg")).toBe("png");
    expect(storageExtFor({ type: "image/jpeg" }, "jpg")).toBe("jpg");
    expect(storageExtFor({ type: "application/pdf" }, "jpg")).toBe("pdf");
    expect(storageExtFor({ type: "video/quicktime" }, "mp4")).toBe("mov");
  });

  it("is case-insensitive on the MIME type", () => {
    expect(storageExtFor({ type: "IMAGE/PNG" }, "jpg")).toBe("png");
  });

  it("falls back to the caller-supplied default for an unknown type", () => {
    expect(storageExtFor({ type: "application/octet-stream" }, "bin")).toBe("bin");
    expect(storageExtFor({ type: "" }, "jpg")).toBe("jpg");
  });

  it("never derives the extension from the file name, even an attacker-chosen one", () => {
    // A file named evil.php whose actual content-type is image/png must still
    // resolve to "png" — the name is never consulted.
    expect(storageExtFor({ type: "image/png", name: "evil.php" } as any, "jpg")).toBe("png");
    // An unrecognised type with a misleading name falls back to the caller's
    // default, never to text read off the name.
    expect(storageExtFor({ type: "application/x-php", name: "evil.png" } as any, "jpg")).toBe("jpg");
  });
});
