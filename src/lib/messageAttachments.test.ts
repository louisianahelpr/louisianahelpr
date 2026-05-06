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
