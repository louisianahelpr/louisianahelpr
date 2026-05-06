import { describe, it, expect, vi, beforeEach } from "vitest";

const createSignedUrlMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: {
      from: () => ({
        createSignedUrl: (...args: unknown[]) => createSignedUrlMock(...args),
      }),
    },
  },
}));

import {
  extractAttachmentPath,
  getAttachmentSignedUrl,
  getAttachmentFilename,
} from "./applicationAttachments";

describe("extractAttachmentPath", () => {
  it("returns empty string for empty input", () => {
    expect(extractAttachmentPath("")).toBe("");
  });

  it("returns input unchanged when already a path", () => {
    expect(extractAttachmentPath("user-id/job-id/file.pdf")).toBe("user-id/job-id/file.pdf");
  });

  it("strips the bucket prefix from a legacy public URL", () => {
    const url = "https://abc.supabase.co/storage/v1/object/public/application-attachments/uid/job/file.pdf";
    expect(extractAttachmentPath(url)).toBe("uid/job/file.pdf");
  });

  it("handles signed URL format", () => {
    const url = "https://abc.supabase.co/storage/v1/object/sign/application-attachments/uid/file.pdf?token=xxx";
    expect(extractAttachmentPath(url)).toBe("uid/file.pdf?token=xxx");
  });
});

describe("getAttachmentFilename", () => {
  it("returns the last path segment", () => {
    expect(getAttachmentFilename("uid/job/resume.pdf")).toBe("resume.pdf");
  });

  it("decodes URL-encoded filenames", () => {
    expect(getAttachmentFilename("uid/job/My%20Resume.pdf")).toBe("My Resume.pdf");
  });

  it("uses fallback for empty input", () => {
    expect(getAttachmentFilename("", "Document")).toBe("Document");
  });

  it("uses default fallback when none provided", () => {
    expect(getAttachmentFilename("")).toBe("File");
  });

  it("strips bucket prefix before extracting filename", () => {
    const url = "https://abc.supabase.co/storage/v1/object/public/application-attachments/uid/job/resume.pdf";
    expect(getAttachmentFilename(url)).toBe("resume.pdf");
  });

  it("returns fallback when decodeURIComponent throws on malformed input", () => {
    // % followed by non-hex is malformed URI
    expect(getAttachmentFilename("uid/file%ZZ.pdf", "Document")).toBe("Document");
  });
});

describe("getAttachmentSignedUrl", () => {
  beforeEach(() => {
    createSignedUrlMock.mockReset();
  });

  it("returns null for empty input", async () => {
    expect(await getAttachmentSignedUrl("")).toBeNull();
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });

  it("calls createSignedUrl with the cleaned path and default 10-min TTL", async () => {
    createSignedUrlMock.mockResolvedValue({ data: { signedUrl: "https://signed.url" }, error: null });
    const result = await getAttachmentSignedUrl("uid/job/file.pdf");
    expect(result).toBe("https://signed.url");
    expect(createSignedUrlMock).toHaveBeenCalledWith("uid/job/file.pdf", 600);
  });

  it("forwards the ttl override", async () => {
    createSignedUrlMock.mockResolvedValue({ data: { signedUrl: "https://signed.url" }, error: null });
    await getAttachmentSignedUrl("uid/job/file.pdf", 30);
    expect(createSignedUrlMock).toHaveBeenCalledWith("uid/job/file.pdf", 30);
  });

  it("strips the bucket prefix from a legacy URL before signing", async () => {
    createSignedUrlMock.mockResolvedValue({ data: { signedUrl: "https://signed.url" }, error: null });
    const url = "https://abc.supabase.co/storage/v1/object/public/application-attachments/uid/job/file.pdf";
    await getAttachmentSignedUrl(url);
    expect(createSignedUrlMock).toHaveBeenCalledWith("uid/job/file.pdf", 600);
  });

  it("returns null when supabase returns an error", async () => {
    createSignedUrlMock.mockResolvedValue({ data: null, error: new Error("not found") });
    expect(await getAttachmentSignedUrl("uid/job/file.pdf")).toBeNull();
  });

  it("returns null when supabase returns no data", async () => {
    createSignedUrlMock.mockResolvedValue({ data: null, error: null });
    expect(await getAttachmentSignedUrl("uid/job/file.pdf")).toBeNull();
  });
});
