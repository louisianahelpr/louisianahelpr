import { describe, it, expect } from "vitest";
import {
  isImageMime,
  isPdfMime,
  buildAttachmentPath,
  getMessageAttachmentFilename,
  MESSAGE_ATTACHMENT_MAX_BYTES,
  MESSAGE_ATTACHMENT_MIME_WHITELIST,
} from "./messageAttachments";

describe("isImageMime", () => {
  it("recognizes common image types", () => {
    expect(isImageMime("image/jpeg")).toBe(true);
    expect(isImageMime("image/png")).toBe(true);
    expect(isImageMime("image/webp")).toBe(true);
    expect(isImageMime("image/heic")).toBe(true);
    expect(isImageMime("image/svg+xml")).toBe(true);
  });

  it("rejects non-image types", () => {
    expect(isImageMime("application/pdf")).toBe(false);
    expect(isImageMime("text/plain")).toBe(false);
    expect(isImageMime("video/mp4")).toBe(false);
  });

  it("handles null/undefined safely", () => {
    expect(isImageMime(null)).toBe(false);
    expect(isImageMime(undefined)).toBe(false);
    expect(isImageMime("")).toBe(false);
  });
});

describe("isPdfMime", () => {
  it("recognizes PDF MIME exactly", () => {
    expect(isPdfMime("application/pdf")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isPdfMime("application/x-pdf")).toBe(false);
    expect(isPdfMime("image/jpeg")).toBe(false);
    expect(isPdfMime(null)).toBe(false);
    expect(isPdfMime("")).toBe(false);
  });
});

describe("buildAttachmentPath", () => {
  it("produces <jobId>/<senderId>/<uuid>-<safeName> shape", () => {
    const file = new File(["x"], "photo.jpg", { type: "image/jpeg" });
    const path = buildAttachmentPath("job-1", "sender-1", file);
    expect(path).toMatch(/^job-1\/sender-1\/[0-9a-f-]+-photo\.jpg$/);
  });

  it("sanitizes special characters in the filename", () => {
    const file = new File(["x"], "weird name!@#$%^&.png", { type: "image/png" });
    const path = buildAttachmentPath("job-1", "sender-1", file);
    // No special chars left in the saved path (other than . - / which
    // are preserved by the sanitization regex).
    expect(path).not.toMatch(/[!@#$%^&]/);
    expect(path).toMatch(/\.png$/);
  });

  it("a filename can never add a path segment (the key is the RLS anchor)", () => {
    // THE LOAD-BEARING ASSERTION. `file.name` is attacker-controlled — it is
    // whatever the picker hands over, or whatever a caller types. The storage
    // key it lands in is what prod's INSERT policy reads:
    //   foldername(name)[1] ~ '<uuid>' AND foldername(name)[2] = auth.uid()
    // (verified read-only against prod pg_policies, 2026-09-21). Those indices
    // are only meaningful while the filename contributes ZERO slashes, so the
    // `/` in the sanitizer's character class is not cosmetic. The old
    // "no !@#$%^& survives" test said nothing about `/`.
    const file = new File(["x"], "../../../etc/passwd.jpg", { type: "image/jpeg" });
    const path = buildAttachmentPath("job-1", "sender-1", file);

    const segments = path.split("/");
    expect(segments).toHaveLength(3);
    expect(segments[0]).toBe("job-1");
    expect(segments[1]).toBe("sender-1");
    expect(segments[2]).not.toContain("/");
    // And backslash too — Windows-picked names carry it and it is not \w.
    const win = buildAttachmentPath(
      "job-1",
      "sender-1",
      new File(["x"], "..\\..\\secret.png", { type: "image/png" }),
    );
    expect(win.split("/")).toHaveLength(3);
    expect(win).not.toContain("\\");
  });

  it("truncates very long filenames to 80 chars (after the uuid-)", () => {
    const longName = "a".repeat(200) + ".jpg";
    const file = new File(["x"], longName, { type: "image/jpeg" });
    const path = buildAttachmentPath("job-1", "sender-1", file);
    const filenameNoUuid = getMessageAttachmentFilename(path);
    expect(filenameNoUuid.length).toBeLessThanOrEqual(80);
  });
});

describe("getMessageAttachmentFilename", () => {
  it("strips the leading uuid- prefix", () => {
    expect(
      getMessageAttachmentFilename("job-1/sender-1/12345678-1234-1234-1234-123456789abc-photo.jpg"),
    ).toBe("photo.jpg");
  });

  it("returns the fallback for null/empty input", () => {
    expect(getMessageAttachmentFilename("")).toBe("Attachment");
    expect(getMessageAttachmentFilename("", "Custom")).toBe("Custom");
  });

  it("decodes URL-encoded filenames", () => {
    const encoded = "job/sender/12345678-1234-1234-1234-123456789abc-photo%20with%20space.jpg";
    expect(getMessageAttachmentFilename(encoded)).toBe("photo with space.jpg");
  });
});

describe("constants", () => {
  it("MAX_BYTES is 5MB", () => {
    expect(MESSAGE_ATTACHMENT_MAX_BYTES).toBe(5 * 1024 * 1024);
  });

  it("MIME whitelist covers expected types only", () => {
    expect(MESSAGE_ATTACHMENT_MIME_WHITELIST).toEqual([
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/heic",
      "application/pdf",
    ]);
  });
});

// Lets `/` (and `\`) through the filename sanitizer. The storage key stops
// having a fixed segment count, and prod's INSERT policy reads
// foldername(name)[1]/[2] by index. Killed by the path-segment test above.
// @mutate src/lib/messageAttachments.ts | file.name.replace(/[^\w.-]/g, "_") | file.name.replace(/[^\w.\-/\\]/g, "_")
