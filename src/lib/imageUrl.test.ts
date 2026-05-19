import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { transformedImageUrl } from "./imageUrl";

const PUBLIC =
  "https://abc123.supabase.co/storage/v1/object/public/avatars/user/photo.jpg";

describe("transformedImageUrl", () => {
  beforeEach(() => {
    // Pin DPR to 1 so dimension assertions are deterministic.
    Object.defineProperty(globalThis, "devicePixelRatio", {
      value: 1,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "devicePixelRatio", {
      value: 1,
      configurable: true,
    });
  });

  it("rewrites the public object path to the render/image endpoint", () => {
    const out = transformedImageUrl(PUBLIC, { width: 88, height: 88 });
    expect(out).toContain("/storage/v1/render/image/public/avatars/user/photo.jpg");
    expect(out).not.toContain("/storage/v1/object/public/");
  });

  it("appends width, height, resize and quality params", () => {
    const url = new URL(transformedImageUrl(PUBLIC, { width: 88, height: 64 }));
    expect(url.searchParams.get("width")).toBe("88");
    expect(url.searchParams.get("height")).toBe("64");
    expect(url.searchParams.get("resize")).toBe("cover");
    expect(url.searchParams.get("quality")).toBe("75");
  });

  it("respects an explicit resize mode and quality", () => {
    const url = new URL(
      transformedImageUrl(PUBLIC, { width: 100, resize: "contain", quality: 90 }),
    );
    expect(url.searchParams.get("resize")).toBe("contain");
    expect(url.searchParams.get("quality")).toBe("90");
  });

  it("scales dimensions by devicePixelRatio, capped at 2x", () => {
    Object.defineProperty(globalThis, "devicePixelRatio", {
      value: 3,
      configurable: true,
    });
    const url = new URL(transformedImageUrl(PUBLIC, { width: 100 }));
    // 3x DPR is clamped to 2x → 200, not 300.
    expect(url.searchParams.get("width")).toBe("200");
  });

  it("clamps dimensions to the 1-2500 range Supabase accepts", () => {
    const url = new URL(transformedImageUrl(PUBLIC, { width: 9000 }));
    expect(url.searchParams.get("width")).toBe("2500");
  });

  it("clamps quality to the 20-100 range", () => {
    const low = new URL(transformedImageUrl(PUBLIC, { width: 10, quality: 5 }));
    expect(low.searchParams.get("quality")).toBe("20");
    const high = new URL(transformedImageUrl(PUBLIC, { width: 10, quality: 150 }));
    expect(high.searchParams.get("quality")).toBe("100");
  });

  it("passes non-Supabase URLs through unchanged", () => {
    const external = "https://example.com/cdn/image.png";
    expect(transformedImageUrl(external, { width: 88 })).toBe(external);
  });

  it("passes blob/data preview URLs through unchanged", () => {
    const blob = "blob:http://localhost/abc-def";
    expect(transformedImageUrl(blob, { width: 88 })).toBe(blob);
  });

  it("returns an empty string for null or undefined input", () => {
    expect(transformedImageUrl(null, { width: 88 })).toBe("");
    expect(transformedImageUrl(undefined, { width: 88 })).toBe("");
  });

  it("does not double-rewrite an already-transformed URL", () => {
    const once = transformedImageUrl(PUBLIC, { width: 88 });
    const twice = transformedImageUrl(once, { width: 88 });
    expect(twice).toBe(once);
  });
});
