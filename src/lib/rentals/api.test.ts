/**
 * Rentals S1 uploads and signed links (src/lib/rentals/api.ts):
 *  - a photo the user-documents bucket would refuse is refused in words BEFORE
 *    anything is uploaded (uploadMimeParity, Q54), so a refused photo leaves no
 *    orphan objects behind;
 *  - every upload key is new, so it is cached a year (Q655);
 *  - only a storage path is ever signed (signedUrlOnlyForStoragePaths).
 *
 * @mutate src/lib/rentals/api.ts |   if (refused) throw new RentalsCopyError( |   if (false) throw new RentalsCopyError(
 * @mutate src/lib/rentals/api.ts |     cacheControl: IMMUTABLE_OBJECT_CACHE_CONTROL, |     cacheControl: "3600",
 * @mutate src/lib/rentals/api.ts |   if (!isStorageObjectPath(path)) throw new Error("not_a_storage_path"); |
 * @mutate src/lib/rentals/api.ts |   if (!isAllowedUploadType(file, allowed)) throw | if (false) throw
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const upload = vi.fn(async () => ({ error: null }));
const createSignedUrl = vi.fn(async () => ({ data: { signedUrl: "https://signed/x" }, error: null }));
const rpc = vi.fn(async () => ({ data: "req-1", error: null }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: { from: () => ({ upload, createSignedUrl }) },
    rpc: (...args: unknown[]) => rpc(...(args as [])),
  },
}));

import { fileRequest, signedFileUrl, submitOwnershipProof } from "./api";
import { RentalsCopyError, rentalsErrorMessage } from "./copy";

const UID = "11111111-1111-4111-8111-111111111111";
const file = (name: string, type: string) => new File(["x"], name, { type });
const request = (photos: File[]) => ({
  tenancyId: "t1",
  category: "plumbing",
  description: "Kitchen sink drips all night long.",
  urgency: "soon" as const,
  accessWindows: "",
  petsOnSite: false,
  okToEnterAlone: false,
  accessNotes: "",
  photos,
});

describe("Rentals uploads and signed links", () => {
  beforeEach(() => {
    upload.mockClear();
    createSignedUrl.mockClear();
    rpc.mockClear();
  });

  it("refuses a GIF among the request photos in words, before uploading any of them", async () => {
    const err = await fileRequest(UID, request([file("ok.jpg", "image/jpeg"), file("party.gif", "image/gif")])).catch((e) => e);
    expect(err).toBeInstanceOf(RentalsCopyError);
    expect(rentalsErrorMessage(err)).toBe('"party.gif" isn\'t a supported file type. Use a JPEG, PNG, WebP or HEIC photo.');
    expect(upload).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a Word document as ownership proof before uploading it", async () => {
    const err = await submitOwnershipProof(UID, "p1", file("deed.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")).catch((e) => e);
    expect(rentalsErrorMessage(err)).toBe('"deed.docx" isn\'t a supported file type. Use a JPEG, PNG or PDF.');
    expect(upload).not.toHaveBeenCalled();
  });

  it("uploads accepted photos into the tenant's own folder, cached a year, then files the request", async () => {
    await fileRequest(UID, request([file("sink.jpg", "image/jpeg")]));
    expect(upload).toHaveBeenCalledTimes(1);
    const [path, , opts] = upload.mock.calls[0] as unknown as [string, File, Record<string, unknown>];
    expect(path).toMatch(new RegExp(`^${UID}/rentals/requests/[0-9a-f-]{36}/0-sink\\.jpg$`));
    expect(opts).toEqual({ upsert: false, contentType: "image/jpeg", cacheControl: "31536000" });
    expect(rpc).toHaveBeenCalledWith("rentals_file_request", expect.objectContaining({ p_photo_paths: [path] }));
  });

  it("signs only a storage path, never a URL", async () => {
    await expect(signedFileUrl("javascript:alert(1)")).rejects.toThrow("not_a_storage_path");
    await expect(signedFileUrl("https://elsewhere.example/x.pdf")).rejects.toThrow("not_a_storage_path");
    expect(createSignedUrl).not.toHaveBeenCalled();
    await expect(signedFileUrl(`${UID}/rentals/p1/deed.pdf`)).resolves.toBe("https://signed/x");
    expect(createSignedUrl).toHaveBeenCalledWith(`${UID}/rentals/p1/deed.pdf`, 600);
  });
});
