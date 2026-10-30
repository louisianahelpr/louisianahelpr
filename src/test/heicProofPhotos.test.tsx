/**
 * A HEIC PROOF PHOTO IS NEVER A BROKEN BOX (Tester 6, 10-30: stored unconverted, it draws in WebKit and shows broken
 * in Chromium). Where the browser can read it, it uploads as a JPEG. Where it can't, the Helpr is told and keeps the
 * file; nothing is uploaded that the poster's browser may not draw. A stored one that won't draw is a labelled link.
 * jsdom decodes nothing, so Image and the canvas encoder are stood in for; a real decode is the browser run's job.
 *
 * @mutate src/components/PhotoProof.tsx | const ready = isHeicFile(f) ? await heicToJpeg(f) : f; | const ready = f;
 * @mutate src/components/PhotoProof.tsx |           toast.error(`"${f.name}" is a HEIC photo this browser can't read. Save it as a JPG, or take the photo on your phone in the Helpr app.`);\n | \n
 * @mutate src/components/PhotoProof.tsx |           const clean = await cleanProofPhoto(ready); |           const clean: File \| null = ready;
 * @mutate src/components/PhotoProof.tsx |           else toast.error(LISTING_PHOTO_UNCLEANABLE); |           else selected.push(ready);
 * @mutate src/lib/cleanProofPhoto.ts |     return await cleanListingPhoto(file, PROOF_MAX_SIDE, PROOF_QUALITY); |     return file;
 * @mutate src/lib/heicToJpeg.ts |   if (!blob \|\| blob.type !== "image/jpeg") return null; |   if (!blob) return null;
 * @mutate src/lib/heicToJpeg.ts |   if (type) return HEIC_TYPES.has(type);\n | \n
 * @mutate src/components/ProofPhotoImg.tsx |       onError={() => { if (src) setFailedSrc(src); }}\n |
 * @mutate src/components/ProofPhotoImg.tsx |   if (src && failedSrc === src) { |   if (failedSrc) {
 * @mutate src/components/PhotoProofDialog.tsx | <ProofPhotoImg insideControl src={afterSrcs[i]} | <img src={afterSrcs[i] ?? ""}
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

const uploads = vi.hoisted(() => [] as { path: string; file: File }[]);
const toastError = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: { from: () => ({ upload: async (path: string, file: File) => { uploads.push({ path, file }); return { error: null }; } }) },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { proof_after_urls: [] }, error: null }) }) }),
      update: () => ({ eq: () => ({ select: async () => ({ data: [{ id: "j" }], error: null }) }) }),
    }),
    rpc: async () => ({ error: null }),
  },
}));
vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
const clean = vi.hoisted(() => ({ fn: null as null | ((f: File) => Promise<File | null>) }));
vi.mock("@/lib/cleanProofPhoto", async (orig) => {
  const actual = await orig<typeof import("@/lib/cleanProofPhoto")>();
  return { ...actual, cleanProofPhoto: (f: File) => (clean.fn ? clean.fn(f) : actual.cleanProofPhoto(f)) };
});
const compress = vi.hoisted(() => ({ fn: null as null | ((f: File) => Promise<File>) }));
vi.mock("@/lib/imageCompression", () => ({ compressImage: (f: File) => compress.fn!(f) }));
vi.mock("@/hooks/useProofPhotoUrls", () => ({ useProofPhotoUrls: (v: readonly string[]) => v.map((x) => `https://signed.example/${x}`), PENDING_PHOTO_SRC: "pending" }));

import { PhotoProofCaptureChip } from "@/components/PhotoProof";
import { PhotoProofDialog } from "@/components/PhotoProofDialog";
import { ProofPhotoImg } from "@/components/ProofPhotoImg";
import { heicToJpeg, isHeicFile } from "@/lib/heicToJpeg";
import { cleanProofPhoto } from "@/lib/cleanProofPhoto";

/** A browser that decodes (`decodes: true`, WebKit) or doesn't (Chromium), with an encoder that answers `encoded`. */
function browser({ decodes, encoded = "image/jpeg" }: { decodes: boolean; encoded?: string }) {
  class FakeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = decodes ? 8000 : 0;
    naturalHeight = decodes ? 4000 : 0;
    set src(_: string) { queueMicrotask(() => (decodes ? this.onload?.() : this.onerror?.())); }
  }
  vi.stubGlobal("Image", FakeImage);
  URL.createObjectURL = vi.fn(() => "blob:x");
  URL.revokeObjectURL = vi.fn();
  const drawn: number[][] = [];
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
    return { drawImage: () => drawn.push([this.width, this.height]) } as never;
  });
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb) => cb(new Blob(["jpg"], { type: encoded })));
  return drawn;
}
const heic = (name = "IMG_1.HEIC", type = "image/heic") => new File(["h"], name, { type });

beforeEach(() => {
  uploads.length = 0;
  toastError.mockClear();
  // The upload's own tests stand a marked file in for the cleaned one, so they can see it was the one uploaded.
  clean.fn = async (f) => new File([f], f.name, { type: f.type, lastModified: 1 });
  compress.fn = null;
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("heicToJpeg", () => {
  it("knows a HEIC by type, and by name when the picker gives no type (floor: 6 cases)", () => {
    const cases: [string, string, boolean][] = [
      ["a.heic", "image/heic", true], ["a.heif", "image/heif", true], ["a.HEIC", "", true],
      ["a.jpg", "", false], ["a.jpg", "image/jpeg", false], ["a.heic", "image/jpeg", false],
    ];
    expect(cases.length).toBeGreaterThan(5);
    for (const [name, type, want] of cases) expect({ name, type, is: isHeicFile({ name, type }) }).toEqual({ name, type, is: want });
  });

  it("a browser that reads it: a JPEG named .jpg, the long side capped, in proportion", async () => {
    const drawn = browser({ decodes: true });
    const out = await heicToJpeg(heic());
    expect([out?.type, out?.name]).toEqual(["image/jpeg", "IMG_1.jpg"]);
    expect(drawn).toEqual([[4096, 2048]]);
  });

  it("a browser that can't, or an encoder that answers in another format: null, never a wrong file", async () => {
    browser({ decodes: false });
    expect(await heicToJpeg(heic())).toBeNull();
    vi.restoreAllMocks();
    browser({ decodes: true, encoded: "image/png" });
    expect(await heicToJpeg(heic())).toBeNull();
  });
});

describe("the proof upload", () => {
  const pick = (f: File) => {
    render(<PhotoProofCaptureChip jobId="j" type="after" existingUrls={[]} label="After photo" />);
    fireEvent.click(screen.getByRole("button", { name: /After/ }));
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [f] } });
  };

  it("a HEIC this browser reads uploads as a JPEG", async () => {
    browser({ decodes: true });
    pick(heic());
    const go = screen.getByRole("button", { name: "Upload" });
    await waitFor(() => expect((go as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(go);
    await waitFor(() => expect(uploads).toHaveLength(1));
    expect(uploads[0].file.type).toBe("image/jpeg");
    expect(uploads[0].path).toMatch(/^j\/after-.*\.jpg$/);
  });

  it("a HEIC it can't read: a clear message, nothing queued, nothing uploaded", async () => {
    browser({ decodes: false });
    pick(heic());
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(String(toastError.mock.calls[0][0])).toMatch(/IMG_1\.HEIC.*can't read.*JPG/);
    expect((screen.getByRole("button", { name: "Upload" }) as HTMLButtonElement).disabled).toBe(true);
    expect(uploads).toHaveLength(0);
  });

  it("a JPEG uploads as what the cleaner returned, never the file picked", async () => {
    browser({ decodes: false });
    const jpg = new File(["j"], "a.jpg", { type: "image/jpeg" });
    pick(jpg);
    const go = screen.getByRole("button", { name: "Upload" }) as HTMLButtonElement;
    await waitFor(() => expect(go.disabled).toBe(false));
    fireEvent.click(go);
    await waitFor(() => expect(uploads).toHaveLength(1));
    expect(uploads[0].file).not.toBe(jpg);
    expect(uploads[0].file.lastModified).toBe(1);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("a photo that can't be cleaned is refused out loud and never uploaded", async () => {
    browser({ decodes: false });
    clean.fn = async () => null;
    pick(new File(["j"], "a.jpg", { type: "image/jpeg" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(String(toastError.mock.calls[0][0])).toMatch(/couldn.t prepare this photo\./);
    expect((screen.getByRole("button", { name: "Upload" }) as HTMLButtonElement).disabled).toBe(true);
    expect(uploads).toHaveLength(0);
  });
});

describe("cleanProofPhoto takes the EXIF out, GPS included", () => {
  /** A JPEG: start, an APP1 block holding "Exif" and a GPS tag when asked, then start-of-scan. */
  const jpeg = (gps: boolean) => {
    const app1 = gps ? [0xff, 0xe1, 0x00, 0x0c, ...new TextEncoder().encode("Exif\0\0GPS\0")] : [];
    return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, ...app1, 0xff, 0xda, 0x00, 0x02, 0x11, 0xff, 0xd9]);
  };
  const text = async (f: File) => new TextDecoder("latin1").decode(await f.arrayBuffer());

  it("what comes out has no EXIF or GPS, though the re-encode carried some", async () => {
    clean.fn = null;
    compress.fn = async () => new File([jpeg(true)], "a.jpg", { type: "image/jpeg" });
    const got = await cleanProofPhoto(new File([jpeg(true)], "a.jpg", { type: "image/jpeg" }));
    expect(got?.type).toBe("image/jpeg");
    const out = await text(got!);
    expect(out).not.toContain("Exif");
    expect(out).not.toContain("GPS");
  });

  it("the original handed back (no canvas, empty encoder) is refused, GPS and all", async () => {
    clean.fn = null;
    compress.fn = async (f) => f;
    expect(await cleanProofPhoto(new File([jpeg(true)], "a.jpg", { type: "image/jpeg" }))).toBeNull();
  });

  it("an encoder failure is a refusal, not a throw", async () => {
    clean.fn = null;
    compress.fn = async () => { throw new Error("Failed to load image for compression"); };
    expect(await cleanProofPhoto(new File([jpeg(true)], "a.jpg", { type: "image/jpeg" }))).toBeNull();
  });
});

describe("a stored photo that won't draw", () => {
  it("becomes a labelled link to the photo", () => {
    render(<ProofPhotoImg src="https://signed.example/a.heic" alt="After 1" className="w-14" />);
    fireEvent.error(screen.getByAltText("After 1"));
    const link = screen.getByRole("link", { name: "Open photo: After 1" });
    expect(link.getAttribute("href")).toBe("https://signed.example/a.heic");
    expect(link.textContent).toBe("Open photo");
    expect(screen.queryByAltText("After 1")).toBeNull();
  });

  it("inside the gallery's own link it's the words alone, with no link inside a link", () => {
    render(<PhotoProofDialog open onOpenChange={() => {}} beforeUrls={[]} afterUrls={["j/a.heic"]} />);
    fireEvent.error(screen.getByAltText("After 1"));
    const words = screen.getByText("Open photo");
    expect(words.tagName).toBe("SPAN");
    expect(words.closest("a")?.getAttribute("href")).toBe("https://signed.example/j/a.heic");
  });

  it("a fresh ticket gets its own try; a photo still loading is not a failure", () => {
    const { rerender } = render(<ProofPhotoImg src="https://s/1" alt="p" />);
    fireEvent.error(screen.getByAltText("p"));
    rerender(<ProofPhotoImg src="https://s/2" alt="p" />);
    expect((screen.getByAltText("p") as HTMLImageElement).src).toBe("https://s/2");
    rerender(<ProofPhotoImg src={null} alt="p" />);
    fireEvent.error(screen.getByAltText("p"));
    expect(screen.queryByText("Open photo")).toBeNull();
  });
});
