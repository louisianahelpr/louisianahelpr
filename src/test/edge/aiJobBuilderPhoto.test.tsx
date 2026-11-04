/**
 * Q2471 (1) "Post a job from a photo" (owner 2026-10-29): the AI Job Builder takes ONE photo of the job and Claude
 * writes the whole post from it, with or without words. The server reads the photo's type from its bytes and caps
 * its size (photo.ts), attaches it to the poster's last turn, and lets a photo stand in for an empty description.
 *
 * @mutate supabase/functions/ai-job-builder/photo.ts | if (!mediaType \|\| mediaType === "image/gif") return | if (false) return
 * @mutate supabase/functions/ai-job-builder/photo.ts | if (Math.floor((raw.length * 3) / 4) > MAX_PHOTO_BYTES) return { error: "Photo too large", status: 413 }; |
 * @mutate supabase/functions/ai-job-builder/index.ts | turns: photoRead.image ? turns.map((t, i) => (i === turns.length - 1 ? { ...t, images: [photoRead.image!] } : t)) : turns, | turns,
 * @mutate supabase/functions/ai-job-builder/index.ts |         last.content = "Write the job posting for the work this photo shows."; |
 * @mutate src/components/postjob/AiJobBuilder.tsx |           ...(photoB64 ? { photo: photoB64 } : {}), |
 * @mutate src/components/postjob/AiJobBuilder.tsx |     if (!prompt.trim() && !photo) { |     if (!prompt.trim()) {
 * @mutate supabase/functions/ai-job-builder/index.ts |     if (rawBody.length > MAX_BODY_BYTES) { |     if (false) {
 * @mutate src/components/postjob/jobPhotoForAi.ts |     throw new UnsupportedPhotoError();\n  }\n  // compressImage | throw new Error("decode failed");\n  }\n  // compressImage
 * @mutate src/components/postjob/jobPhotoForAi.ts |   if (!SENDABLE.has(small.type)) throw new UnsupportedPhotoError(); |
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { readJobPhoto, MAX_PHOTO_BYTES } from "../../../supabase/functions/ai-job-builder/photo";
import { blankComments } from "@/test/helpers/blankNonCode";

const invokeMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invokeMock(...a) } } }));
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: toastError, info: vi.fn() }) }));
const photoMock = vi.hoisted(() => ({ impl: async (): Promise<string> => "SMALLJPEG" }));
vi.mock("@/components/postjob/jobPhotoForAi", async (orig) => ({
  ...(await orig<typeof import("@/components/postjob/jobPhotoForAi")>()),
  jobPhotoForAi: vi.fn(() => photoMock.impl()),
}));
const compressMock = vi.hoisted(() => ({ impl: async (f: File): Promise<File> => f }));
vi.mock("@/lib/imageCompression", () => ({ compressImage: (f: File) => compressMock.impl(f) }));

import { AiJobBuilder } from "@/components/postjob/AiJobBuilder";

const b64 = (bytes: number[]) => btoa(String.fromCharCode(...bytes));
const JPEG = b64([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG = b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const GIF = b64([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const TEXT = b64(Array.from(new TextEncoder().encode("<script>alert(1)</script>")));

describe("Q2471 (1) the server's photo check", () => {
  it("no photo is fine; a JPEG or PNG passes with the type read from its bytes", () => {
    expect(readJobPhoto(undefined)).toEqual({ image: null });
    expect(readJobPhoto(null)).toEqual({ image: null });
    expect(readJobPhoto(JPEG)).toEqual({ image: { mediaType: "image/jpeg", base64: JPEG } });
    expect(readJobPhoto(PNG)).toEqual({ image: { mediaType: "image/png", base64: PNG } });
  });

  it("refuses a non-image, a GIF, a non-string and a non-base64 string (400)", () => {
    for (const bad of [TEXT, GIF, 42, {}, "", "not base64!!"]) {
      const r = readJobPhoto(bad);
      expect("error" in r && r.status).toBe(400);
    }
  });

  it("refuses an oversized photo before decoding it (413)", () => {
    const huge = "A".repeat(Math.ceil((MAX_PHOTO_BYTES * 4) / 3) + 8);
    const r = readJobPhoto(huge);
    expect("error" in r && r.status).toBe(413);
  });

  it("the handler checks the photo, attaches it to the last turn, and lets a photo stand in for words", () => {
    const src = blankComments(readFileSync("supabase/functions/ai-job-builder/index.ts", "utf8"));
    expect(src).toMatch(/const photoRead = readJobPhoto\(photo\);\s+if \("error" in photoRead\)/);
    expect(src).toContain("turns: photoRead.image ? turns.map((t, i) => (i === turns.length - 1 ? { ...t, images: [photoRead.image!] } : t)) : turns,");
    expect(src).toContain('last.content = "Write the job posting for the work this photo shows.";');
    // Review 11-04: an oversized body is refused before JSON.parse (declared length unread, then a read cap).
    expect(src).toMatch(/if \(Number\(req\.headers\.get\("content-length"\) \?\? "0"\) > MAX_BODY_BYTES\)/);
    expect(src).toMatch(/const rawBody = await req\.text\(\);\s+if \(rawBody\.length > MAX_BODY_BYTES\)/);
    expect(src.indexOf("rawBody.length > MAX_BODY_BYTES")).toBeLessThan(src.indexOf("JSON.parse(rawBody)"));
  });
});

describe("Q2471 (1) the builder sends the photo", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    toastError.mockReset();
    photoMock.impl = async () => "SMALLJPEG";
  });

  it("a photo the phone can't turn into a JPEG gets plain words and is never sent", async () => {
    const { UnsupportedPhotoError, UNSUPPORTED_PHOTO_MESSAGE } = await import("@/components/postjob/jobPhotoForAi");
    photoMock.impl = async () => { throw new UnsupportedPhotoError(); };
    render(<AiJobBuilder onGenerated={vi.fn()} />);
    fireEvent.click(screen.getByText(/Try the AI job builder/));
    const input = document.getElementById("ai-job-photo") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File([new Uint8Array([1])], "IMG_1.HEIC", { type: "" })] } });
    fireEvent.click(screen.getByRole("button", { name: /Fill in my job/ }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(UNSUPPORTED_PHOTO_MESSAGE));
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("jobPhotoForAi turns a photo the browser can't decode into the plain-words error", async () => {
    const real = await vi.importActual<typeof import("@/components/postjob/jobPhotoForAi")>("@/components/postjob/jobPhotoForAi");
    compressMock.impl = async () => { throw new Error("Image load failed"); };
    try {
      await expect(real.jobPhotoForAi(new File([new Uint8Array([1])], "IMG.HEIC", { type: "image/heic" }))).rejects.toBeInstanceOf(real.UnsupportedPhotoError);
    } finally {
      compressMock.impl = async (f: File) => f;
    }
  });

  it("jobPhotoForAi refuses a blank-type file compressImage hands back untouched", async () => {
    const real = await vi.importActual<typeof import("@/components/postjob/jobPhotoForAi")>("@/components/postjob/jobPhotoForAi");
    await expect(real.jobPhotoForAi(new File([new Uint8Array([1])], "x", { type: "" }))).rejects.toBeInstanceOf(real.UnsupportedPhotoError);
  });

  it("a photo with no words is enough: the shrunk photo goes in the request", async () => {
    invokeMock.mockResolvedValue({ data: { title: "Fence repair", description: "x", category: "fencing" }, error: null });
    const onGenerated = vi.fn();
    render(<AiJobBuilder onGenerated={onGenerated} />);
    fireEvent.click(screen.getByText(/Try the AI job builder/));
    const input = document.getElementById("ai-job-photo") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File([new Uint8Array([1, 2, 3])], "fence.jpg", { type: "image/jpeg" })] } });
    fireEvent.click(screen.getByRole("button", { name: /Fill in my job/ }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    expect(invokeMock.mock.calls[0][0]).toBe("ai-job-builder");
    expect(invokeMock.mock.calls[0][1].body.photo).toBe("SMALLJPEG");
    await waitFor(() => expect(onGenerated).toHaveBeenCalled());
  });

  it("words with no photo send no photo field", async () => {
    invokeMock.mockResolvedValue({ data: { title: "Mow", description: "x", category: "yard_work" }, error: null });
    render(<AiJobBuilder onGenerated={vi.fn()} />);
    fireEvent.click(screen.getByText(/Try the AI job builder/));
    fireEvent.change(screen.getByLabelText("Describe your job"), { target: { value: "Mow my lawn" } });
    fireEvent.click(screen.getByRole("button", { name: /Fill in my job/ }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    expect("photo" in invokeMock.mock.calls[0][1].body).toBe(false);
  });
});
