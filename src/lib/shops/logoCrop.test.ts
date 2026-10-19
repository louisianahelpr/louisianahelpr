/**
 * SH12: the shop logo is square-cropped once, centred, before it is cleaned
 * and uploaded (it is the shop's avatar in every square/circle it shows in);
 * cover and gallery photos are uploaded as they come.
 *
 * @mutate src/lib/shops/api.ts |   const cleaned = await cleanListingPhoto(kind === "logo" ? await squareCropLogo(file) : file); |   const cleaned = await cleanListingPhoto(file);
 * @mutate src/lib/shops/logoCrop.ts |   return { sx: Math.floor((w - size) / 2), sy: Math.floor((h - size) / 2), size }; |   return { sx: 0, sy: 0, size };
 * @mutate src/lib/shops/logoCrop.ts |     const out = Math.min(size, LOGO_MAX_SIDE); |     const out = size;
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";

const h = vi.hoisted(() => ({ crop: vi.fn(), clean: vi.fn(), upload: vi.fn(), rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { storage: { from: () => ({ upload: h.upload, remove: vi.fn(), getPublicUrl: () => ({ data: { publicUrl: "" } }) }) }, rpc: h.rpc },
}));
vi.mock("@/lib/declutter/photos", () => ({ cleanListingPhoto: h.clean, LISTING_PHOTO_UPLOAD_TYPES: ["image/jpeg"] }));
vi.mock("./logoCrop", async (orig) => ({ ...(await orig<typeof import("./logoCrop")>()), squareCropLogo: h.crop }));

import { addShopPhoto } from "./api";
import { squareCropRect } from "./logoCrop";

const file = (name: string) => new File([new Uint8Array([1, 2, 3])], name, { type: "image/jpeg" });

beforeEach(() => {
  for (const f of Object.values(h)) f.mockReset();
  h.crop.mockImplementation(async () => file("cropped.jpg"));
  h.clean.mockImplementation(async (f: File) => f);
  h.upload.mockResolvedValue({ data: {}, error: null });
  h.rpc.mockResolvedValue({ data: { replaced_path: null }, error: null });
});

describe("squareCropRect: the centred square", () => {
  it("crops the long side evenly and keeps the short side", () => {
    expect(squareCropRect(1200, 800)).toEqual({ sx: 200, sy: 0, size: 800 });
    expect(squareCropRect(600, 1000)).toEqual({ sx: 0, sy: 200, size: 600 });
    expect(squareCropRect(500, 500)).toEqual({ sx: 0, sy: 0, size: 500 });
    expect(squareCropRect(0, 0).size).toBe(1);
  });
});

describe("addShopPhoto crops only the logo", () => {
  it("a logo is cropped, then cleaned, then uploaded", async () => {
    await addShopPhoto("u1", "logo", file("wide.jpg"));
    expect(h.crop).toHaveBeenCalledTimes(1);
    expect((h.clean.mock.calls[0][0] as File).name).toBe("cropped.jpg");
    expect(h.rpc).toHaveBeenCalledWith("shops_attach_photo", expect.objectContaining({ p_kind: "logo" }));
  });

  it("a cover or gallery photo is not cropped", async () => {
    await addShopPhoto("u1", "cover", file("cover.jpg"));
    await addShopPhoto("u1", "gallery", file("g.jpg"));
    expect(h.crop).not.toHaveBeenCalled();
    expect(h.clean.mock.calls.map((c) => (c[0] as File).name)).toEqual(["cover.jpg", "g.jpg"]);
  });

  it("a stored logo is capped at LOGO_MAX_SIDE (every screen shows it at 160px or less)", () => {
    const src = blankComments(readFileSync(join(__dirname, "logoCrop.ts"), "utf8"));
    expect(src).toMatch(/const LOGO_MAX_SIDE = 640;/);
    expect(src).toMatch(/const out = Math\.min\(size, LOGO_MAX_SIDE\);/);
    expect(src).toMatch(/canvas\.toBlob\(resolve, "image\/jpeg"/);
  });
});
