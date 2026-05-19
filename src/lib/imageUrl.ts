// Supabase Storage image transformations.
//
// Uploaded job photos and avatars are multi-MB phone photos served raw via
// `supabase.storage.from(...).getPublicUrl()`. Rendering one of those into a
// 44px avatar or a small card thumbnail wastes bandwidth and decode time —
// painful while scrolling an image-heavy feed inside an iOS WKWebView.
//
// Supabase Storage exposes an on-the-fly image transform endpoint. A public
// object URL looks like:
//   https://<ref>.supabase.co/storage/v1/object/public/<bucket>/<path>
// The transformed equivalent swaps `/object/public/` for `/render/image/public/`
// and accepts `width`, `height`, `resize`, and `quality` query params:
//   https://<ref>.supabase.co/storage/v1/render/image/public/<bucket>/<path>?width=88&height=88&resize=cover&quality=75
// (WebP is applied automatically when the client supports it.)
//
// See: https://supabase.com/docs/guides/storage/serving/image-transformations

export type ImageResizeMode = "cover" | "contain" | "fill";

export interface ImageTransformOptions {
  /** Target CSS width of the rendered box, in px. */
  width?: number;
  /** Target CSS height of the rendered box, in px. */
  height?: number;
  /** How the source is fit into width/height. Defaults to "cover". */
  resize?: ImageResizeMode;
  /** JPEG/WebP quality, 20-100. Defaults to 75 — visually fine for thumbnails. */
  quality?: number;
}

// Supabase clamps width/height to 1-2500 and quality to 20-100. We mirror
// those bounds so a bad caller value can never produce a URL the render
// service rejects (which would break the image entirely).
const MAX_DIMENSION = 2500;
const MIN_QUALITY = 20;
const MAX_QUALITY = 100;

// Cap the devicePixelRatio multiplier: a 3x phone screen rendering a 1000px
// box would otherwise request a 3000px image, defeating the optimization.
const MAX_DPR = 2;

const PUBLIC_OBJECT_SEGMENT = "/storage/v1/object/public/";
const RENDER_IMAGE_SEGMENT = "/storage/v1/render/image/public/";

function dpr(): number {
  const ratio =
    typeof globalThis !== "undefined" &&
    typeof globalThis.devicePixelRatio === "number" &&
    globalThis.devicePixelRatio > 0
      ? globalThis.devicePixelRatio
      : 1;
  return Math.min(ratio, MAX_DPR);
}

function clampDimension(value: number): number {
  // Scale by DPR so the image stays crisp on retina screens, then clamp.
  const scaled = Math.round(value * dpr());
  return Math.max(1, Math.min(scaled, MAX_DIMENSION));
}

/**
 * Rewrites a Supabase Storage public object URL to its transformed (resized)
 * equivalent. Non-Supabase URLs — and anything that isn't a parseable public
 * object URL — are returned unchanged, so this is always safe to wrap around
 * an arbitrary `src`.
 */
export function transformedImageUrl(
  publicUrl: string | null | undefined,
  options: ImageTransformOptions = {},
): string {
  if (!publicUrl) return publicUrl ?? "";

  // Only Supabase Storage public object URLs can be transformed. Anything
  // else (already-transformed URLs, blob:/data: previews, third-party CDNs)
  // passes through untouched.
  if (!publicUrl.includes(PUBLIC_OBJECT_SEGMENT)) return publicUrl;

  let url: URL;
  try {
    url = new URL(publicUrl);
  } catch {
    // Not an absolute URL — leave it alone rather than risk a broken src.
    return publicUrl;
  }

  url.pathname = url.pathname.replace(PUBLIC_OBJECT_SEGMENT, RENDER_IMAGE_SEGMENT);

  const { width, height, resize = "cover", quality = 75 } = options;
  if (typeof width === "number") {
    url.searchParams.set("width", String(clampDimension(width)));
  }
  if (typeof height === "number") {
    url.searchParams.set("height", String(clampDimension(height)));
  }
  url.searchParams.set("resize", resize);
  url.searchParams.set(
    "quality",
    String(Math.max(MIN_QUALITY, Math.min(Math.round(quality), MAX_QUALITY))),
  );

  return url.toString();
}
