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
    // The transform endpoint is a paid Supabase add-on that is NOT enabled on
    // this project — every /render/image/public/ request 403s FeatureNotEnabled
    // in production, so transformedImageUrl now passes the original URL through
    // unless VITE_SUPABASE_IMAGE_TRANSFORM === "1". These tests cover the
    // transform LOGIC, so they opt in explicitly; the default pass-through has
    // its own describe block below.
    vi.stubEnv("VITE_SUPABASE_IMAGE_TRANSFORM", "1");
    // Pin DPR to 1 so dimension assertions are deterministic.
    Object.defineProperty(globalThis, "devicePixelRatio", {
      value: 1,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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

  it("wraps a Supabase URL through both Supabase render + Vercel transform when the add-on is enabled", () => {
    vi.stubEnv("VITE_SUPABASE_IMAGE_TRANSFORM", "1");
    const out = buildImageUrl(PUBLIC, { width: 88, height: 88 });
    expect(out.startsWith("/_vercel/image?")).toBe(true);
    const params = new URLSearchParams(out.split("?")[1]);
    const inner = decodeURIComponent(params.get("url") ?? "");
    // Supabase-side resize is applied to the inner URL.
    expect(inner).toContain("/storage/v1/render/image/public/");
    expect(inner).toContain("width=88");
    expect(params.get("w")).toBe("96"); // snapped from 88 → next allowed width
    expect(params.get("q")).toBe("75");
    vi.unstubAllEnvs();
  });

  it("still uses Vercel's optimizer, with the PLAIN object URL, when the add-on is off", () => {
    // The production default. Vercel can still resize; what it must not do is
    // point at Supabase's /render/image/ endpoint, which 403s FeatureNotEnabled
    // and makes Vercel answer 502 — a broken image on every job photo.
    const out = buildImageUrl(PUBLIC, { width: 88, height: 88 });
    expect(out.startsWith("/_vercel/image?")).toBe(true);
    const inner = decodeURIComponent(new URLSearchParams(out.split("?")[1]).get("url") ?? "");
    expect(inner).toBe(PUBLIC);
    expect(inner).not.toContain("/render/image/");
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


describe("transformedImageUrl — transform add-on disabled (the production default)", () => {
  // Supabase image transforms are a paid add-on this project does not have.
  // Verified against prod 2026-08-31:
  //   /storage/v1/render/image/public/... -> 403 FeatureNotEnabled
  //   /storage/v1/object/public/...       -> 200
  // Vercel's optimizer in front then returned 502, so every transformed image
  // rendered as a broken placeholder. Passing the original URL through is the
  // correct behaviour until the add-on is enabled.
  it("returns the original object URL untouched", () => {
    expect(transformedImageUrl(PUBLIC, { width: 96 })).toBe(PUBLIC);
  });

  it("adds no transform query params", () => {
    const out = transformedImageUrl(PUBLIC, { width: 96, quality: 60 });
    expect(out).not.toContain("/render/image/");
    expect(out).not.toContain("width=");
    expect(out).not.toContain("quality=");
  });
});
