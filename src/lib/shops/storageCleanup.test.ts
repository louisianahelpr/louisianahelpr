/**
 * Shops photo cleanup (lh-silent-failure re-review of 603408318e): a refused
 * attach (slice 1's addShopPhoto, slice 2's addShopItemPhoto) and a detach
 * both delete the storage object, and a failed OR short delete is reported to
 * Sentry with its count, never only console.warn'd (the object stays public
 * by URL until the account deletion purges <uid>/).
 *
 * @mutate src/lib/shops/storageCleanup.ts |   if (failure \|\| removed < paths.length) { |   if (failure) {
 * @mutate src/lib/shops/storageCleanup.ts |     captureException(failure ?? new Error(`shops: ${what} not removed`), { what, removed, wanted: paths.length }, "warning"); |     void what;
 * @mutate src/lib/shops/items.ts |     await removeShopObjects(ITEM_PHOTO_BUCKET, [path], "refused item photo upload"); |     void path;
 * @mutate src/lib/shops/api.ts |     await removeShopObjects(SHOP_PHOTO_BUCKET, [path], "refused photo upload"); |     void path;
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  remove: vi.fn(),
  upload: vi.fn(),
  rpc: vi.fn(),
  capture: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: { from: () => ({ remove: h.remove, upload: h.upload, getPublicUrl: () => ({ data: { publicUrl: "" } }) }) },
    rpc: h.rpc,
  },
}));
vi.mock("@/lib/sentry", () => ({ captureException: h.capture }));
vi.mock("@/lib/declutter/photos", () => ({
  cleanListingPhoto: async (f: File) => f,
  LISTING_PHOTO_UPLOAD_TYPES: ["image/jpeg"],
}));

import { removeShopObjects } from "./storageCleanup";
import { addShopItemPhoto } from "./items";
import { addShopPhoto } from "./api";

const jpeg = () => new File([new Uint8Array([1, 2, 3])], "a.jpg", { type: "image/jpeg" });

beforeEach(() => {
  for (const f of Object.values(h)) f.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("removeShopObjects", () => {
  it("reports a short delete (fewer objects removed than asked) with its count", async () => {
    h.remove.mockResolvedValue({ data: [{ name: "a" }], error: null });
    await removeShopObjects("job-photos", ["a", "b"], "item photo objects");
    expect(h.capture).toHaveBeenCalledTimes(1);
    expect(h.capture.mock.calls[0][1]).toEqual({ what: "item photo objects", removed: 1, wanted: 2 });
  });

  it("reports a failed delete, and a throw, without throwing itself", async () => {
    h.remove.mockResolvedValueOnce({ data: null, error: new Error("storage down") });
    await removeShopObjects("job-photos", ["a"], "photo objects");
    h.remove.mockRejectedValueOnce(new Error("network"));
    await expect(removeShopObjects("job-photos", ["a"], "photo objects")).resolves.toBeUndefined();
    expect(h.capture).toHaveBeenCalledTimes(2);
  });

  it("says nothing when every object is removed", async () => {
    h.remove.mockResolvedValue({ data: [{ name: "a" }, { name: "b" }], error: null });
    await removeShopObjects("job-photos", ["a", "b"], "photo objects");
    await removeShopObjects("job-photos", [], "photo objects");
    expect(h.capture).not.toHaveBeenCalled();
    expect(h.remove).toHaveBeenCalledTimes(1);
  });
});

describe("a refused attach deletes the upload and reports a miss", () => {
  for (const [name, attach] of [
    ["an item photo (shops_add_item_photo)", () => addShopItemPhoto("u1", "it1", jpeg())],
    ["a shop photo (shops_attach_photo)", () => addShopPhoto("u1", "gallery", jpeg())],
  ] as const) {
    it(name, async () => {
      h.upload.mockResolvedValue({ data: {}, error: null });
      h.rpc.mockResolvedValue({ data: null, error: { message: "item_not_editable", code: "22023" } });
      h.remove.mockResolvedValue({ data: [], error: null });
      await expect(attach()).rejects.toMatchObject({ message: "item_not_editable" });
      expect(h.remove).toHaveBeenCalledTimes(1);
      expect(h.capture).toHaveBeenCalledTimes(1);
      expect(h.capture.mock.calls[0][1]).toMatchObject({ removed: 0, wanted: 1 });
    });
  }
});
