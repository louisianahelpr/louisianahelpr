/**
 * THE PHOTO SHEET'S OWN WORDS (audit 2026-10-30).
 *  - The After photos sheet said nothing about what to photograph; Before photos did (JOBS3-52).
 *  - A failed upload's toast sat over the picked photo at 375. The message now lives in the sheet, and the sheet stays
 *    open with the photo kept and Upload pressable.
 *
 * @mutate src/components/PhotoProof.tsx | {type === "after" && ( | {false && (
 * @mutate src/components/PhotoProof.tsx |             <FieldError>{uploadError}</FieldError>\n |
 * @mutate src/components/PhotoProof.tsx |     setUploading(true);\n    setUploadError(null); |     setUploading(true);
 * @mutate src/components/PhotoProof.tsx |   useEffect(() => { if (!open) setUploadError(null); }, [open]);\n |
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const uploadResult = vi.hoisted(() => ({ error: { message: "storage down" } as { message: string } | null }));
const updateResult = vi.hoisted(() => ({ data: [{ id: "j" }] as { id: string }[], error: null as { message: string } | null }));
const toastFns = vi.hoisted(() => ({ error: vi.fn(), warning: vi.fn(), success: vi.fn(), info: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: { from: () => ({ upload: async () => ({ error: uploadResult.error }) }) },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { proof_after_urls: [] }, error: null }) }) }),
      update: () => ({ eq: () => ({ select: async () => updateResult }) }),
    }),
    rpc: async () => ({ error: null }),
  },
}));
vi.mock("sonner", () => ({ toast: toastFns }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/hooks/useProofPhotoUrls", () => ({ useProofPhotoUrls: (v: readonly string[]) => v.map((x) => `https://signed.example/${x}`), PENDING_PHOTO_SRC: "pending" }));
vi.mock("@/components/prepareProofPhotos", () => ({ prepareProofPhotos: async (files: File[]) => files }));

import { PhotoProofCaptureChip } from "@/components/PhotoProof";

const openSheet = (type: "before" | "after") => {
  render(<PhotoProofCaptureChip jobId="j" type={type} existingUrls={[]} label={`${type} photo`} />);
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`${type} photo`, "i") }));
  return screen.getByRole("dialog");
};

const pickAPhoto = async (sheet: HTMLElement) => {
  const input = sheet.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["x"], "a.jpg", { type: "image/jpeg" })] } });
  await within(sheet).findByAltText("Photo 1 preview");
};

beforeEach(() => {
  vi.clearAllMocks();
  uploadResult.error = { message: "storage down" };
  updateResult.error = null;
  updateResult.data = [{ id: "j" }];
  URL.createObjectURL = vi.fn(() => "blob:x");
});
afterEach(cleanup);

describe("what to photograph", () => {
  it("the After sheet says, like the Before sheet", () => {
    const sheet = openSheet("after");
    expect(within(sheet).getByText("Show the finished job, before you mark it complete. These are your proof if there's ever a question.")).toBeTruthy();
    expect(sheet.querySelector("[data-before-photo-guide]")).toBeNull();
  });

  it("the Before sheet keeps its own line", () => {
    const sheet = openSheet("before");
    expect(sheet.querySelector("[data-before-photo-guide]")).toBeTruthy();
    expect(sheet.querySelector("[data-after-photo-guide]")).toBeNull();
  });
});

describe("a failed upload", () => {
  it("says so inside the sheet, not in a toast, and keeps the photo and Upload", async () => {
    const sheet = openSheet("after");
    await pickAPhoto(sheet);
    fireEvent.click(within(sheet).getByRole("button", { name: "Upload" }));

    expect((await within(sheet).findByRole("alert")).textContent).toMatch(/That photo didn't upload\. Try again/);
    expect(toastFns.error).not.toHaveBeenCalled();
    expect(within(sheet).getByAltText("Photo 1 preview")).toBeTruthy();
    expect((within(sheet).getByRole("button", { name: "Upload" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("a photo that uploaded but couldn't attach says so inside the sheet too", async () => {
    uploadResult.error = null;
    updateResult.data = [];
    const sheet = openSheet("after");
    await pickAPhoto(sheet);
    fireEvent.click(within(sheet).getByRole("button", { name: "Upload" }));

    expect((await within(sheet).findByRole("alert")).textContent).toMatch(/couldn't be attached/);
    expect(toastFns.error).not.toHaveBeenCalled();
  });

  it("clears on the retry that works, and the sheet closes", async () => {
    const onUploaded = vi.fn();
    render(<PhotoProofCaptureChip jobId="j" type="after" existingUrls={[]} label="after photo" onUploaded={onUploaded} />);
    fireEvent.click(screen.getByRole("button", { name: /after photo/i }));
    const sheet = screen.getByRole("dialog");
    await pickAPhoto(sheet);
    fireEvent.click(within(sheet).getByRole("button", { name: "Upload" }));
    await within(sheet).findByRole("alert");

    uploadResult.error = null;
    fireEvent.click(within(sheet).getByRole("button", { name: "Upload" }));
    await waitFor(() => expect(onUploaded).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("is gone when the sheet is closed and reopened", async () => {
    const sheet = openSheet("after");
    await pickAPhoto(sheet);
    fireEvent.click(within(sheet).getByRole("button", { name: "Upload" }));
    await within(sheet).findByRole("alert");

    fireEvent.click(within(sheet).getByRole("button", { name: "Cancel" }));
    // Cancel closes the sheet in the same tick, so this is a plain check, not a waitFor (waitForEmptyIsVacuous).
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /after photo/i }));
    expect(within(await screen.findByRole("dialog")).queryByRole("alert")).toBeNull();
  });
});
