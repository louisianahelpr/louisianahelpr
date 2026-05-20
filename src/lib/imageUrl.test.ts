import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const isNativePlatformMock = vi.fn();

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => isNativePlatformMock(),
  },
}));

import { buildImageUrl, transformedImageUrl } from "./imageUrl";

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

describe("buildImageUrl", () => {
  beforeEach(() => {
    // Pin DPR to 1 so width snapping is deterministic.
    Object.defineProperty(globalThis, "devicePixelRatio", {
      value: 1,
      configurable: true,
    });
    isNativePlatformMock.mockReset();
    isNativePlatformMock.mockReturnValue(false);
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "devicePixelRatio", {
      value: 1,
      configurable: true,
    });
  });

  it("returns the original URL unchanged on native platforms", () => {
    isNativePlatformMock.mockReturnValue(true);
    expect(buildImageUrl(PUBLIC, { width: 88 })).toBe(PUBLIC);
    expect(buildImageUrl("https://example.com/x.png", { width: 88 })).toBe(
      "https://example.com/x.png",
    );
  });

  it("wraps a Supabase URL through both Supabase render + Vercel transform on web", () => {
    const out = buildImageUrl(PUBLIC, { width: 88, height: 88 });
    expect(out.startsWith("/_vercel/image?")).toBe(true);
    const params = new URLSearchParams(out.split("?")[1]);
    const inner = decodeURIComponent(params.get("url") ?? "");
    // Supabase-side resize is applied to the inner URL.
    expect(inner).toContain("/storage/v1/render/image/public/");
    expect(inner).toContain("width=88");
    expect(params.get("w")).toBe("96"); // snapped from 88 → next allowed width
    expect(params.get("q")).toBe("75");
  });

  it("wraps an external https URL through Vercel transform on web", () => {
    const external = "https://cdn.example.com/photo.jpg";
    const out = buildImageUrl(external, { width: 384, quality: 80 });
    expect(out.startsWith("/_vercel/image?")).toBe(true);
    const params = new URLSearchParams(out.split("?")[1]);
    expect(decodeURIComponent(params.get("url") ?? "")).toBe(external);
    expect(params.get("w")).toBe("384");
    expect(params.get("q")).toBe("80");
  });

  it("snaps requested widths to the nearest allowed Vercel image size", () => {
    const out = buildImageUrl("https://cdn.example.com/x.jpg", { width: 100 });
    const params = new URLSearchParams(out.split("?")[1]);
    // 100 snaps up to 128 (next allowed).
    expect(params.get("w")).toBe("128");
  });

  it("passes data: URIs through unchanged on web", () => {
    const data = "data:image/png;base64,iVBORw0KGgo=";
    expect(buildImageUrl(data, { width: 88 })).toBe(data);
  });

  it("passes blob: previews through unchanged on web", () => {
    const blob = "blob:http://localhost/abc-def";
    expect(buildImageUrl(blob, { width: 88 })).toBe(blob);
  });

  it("is idempotent: already-/_vercel/image URLs pass through unchanged", () => {
    const once = buildImageUrl("https://cdn.example.com/x.jpg", { width: 96 });
    const twice = buildImageUrl(once, { width: 96 });
    expect(twice).toBe(once);
  });

  it("returns empty string for null or undefined input", () => {
    expect(buildImageUrl(null, { width: 88 })).toBe("");
    expect(buildImageUrl(undefined, { width: 88 })).toBe("");
  });
});
