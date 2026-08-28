// Image URL helpers.
//
// Two complementary transforms layer here:
//
// 1. `transformedImageUrl` — rewrites a Supabase Storage public-object URL
//    to its `/render/image/public/` equivalent with `width`/`height`/`quality`
//    query params. This resizes at the *source*, so we never push a multi-MB
//    phone photo through the wire just to render a 44px avatar.
//
// 2. `buildImageUrl` — additionally routes the final URL through Vercel's
//    `/_vercel/image` edge transform on the web build. That adds AVIF/WebP
//    re-encoding, browser-aware format negotiation, and long-lived edge
//    caching in front of Supabase egress. On native (Capacitor iOS/Android)
//    there is no Vercel server in front of the wrapped `dist/`, so we pass
//    the source URL through untouched.
//
// Uploaded job photos and avatars come from
// `supabase.storage.from(...).getPublicUrl()`:
//   https://<ref>.supabase.co/storage/v1/object/public/<bucket>/<path>
// becomes, after `transformedImageUrl`:
//   https://<ref>.supabase.co/storage/v1/render/image/public/<bucket>/<path>?width=88&height=88&resize=cover&quality=75
// and after `buildImageUrl` on web:
//   /_vercel/image?url=<encoded>&w=88&q=75
//
// See:
//   https://supabase.com/docs/guides/storage/serving/image-transformations
//   https://vercel.com/docs/image-optimization

import { Capacitor } from "@capacitor/core";

type ImageResizeMode = "cover" | "contain" | "fill";

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

// Widths Vercel Image Optimization allows. We snap requested widths to the
// nearest allowed value so we hit a cached variant instead of forcing the
// edge to mint a new one for every off-by-one CSS box. This list mirrors the
// default `images.imageSizes` + `images.deviceSizes` Vercel ships with.
// https://vercel.com/docs/image-optimization#image-sizes
const VERCEL_ALLOWED_WIDTHS = [
  16, 32, 48, 64, 96, 128, 256, 384, 640, 750, 828, 1080, 1200, 1920, 2048,
  3840,
];

const VERCEL_TRANSFORM_PATH = "/_vercel/image";

function snapToAllowedWidth(width: number): number {
  // Pick the smallest allowed width >= request; falls back to the largest
  // if the requester asked for something huge.
  for (const candidate of VERCEL_ALLOWED_WIDTHS) {
    if (candidate >= width) return candidate;
  }
  return VERCEL_ALLOWED_WIDTHS[VERCEL_ALLOWED_WIDTHS.length - 1];
}

function isAlreadyVercelTransformed(src: string): boolean {
  // The transform endpoint may be referenced as a relative path
  // (`/_vercel/image?...`) or absolute, depending on where the URL was minted.
  return (
    src.startsWith(VERCEL_TRANSFORM_PATH) ||
    src.includes(`${VERCEL_TRANSFORM_PATH}?`)
  );
}

function isUntransformable(src: string): boolean {
  // Anything the Vercel edge can't (or shouldn't) re-fetch:
  // - inline data: URIs (already in memory),
  // - blob: previews (local-only),
  // - relative paths the user-agent will resolve against the current origin
  //   — Vercel's transformer rewrites those for us when needed, but our
  //   wrapper signals intent more clearly by letting them pass through and
  //   relying on the platform default for static assets,
  // - already-`/_vercel/image` URLs (idempotency).
  if (!src) return true;
  if (src.startsWith("data:")) return true;
  if (src.startsWith("blob:")) return true;
  if (isAlreadyVercelTransformed(src)) return true;
  return false;
}

export interface BuildImageUrlOptions {
  /** Rendered CSS width in px. Used to size both the Supabase source and the Vercel edge variant. */
  width?: number;
  /** Rendered CSS height in px. Forwarded to the Supabase transform; Vercel's endpoint only takes width. */
  height?: number;
  /** How the source is fit into width/height at the Supabase layer. Defaults to "cover". */
  resize?: ImageResizeMode;
  /** Encode quality 20-100. Defaults to 75. */
  quality?: number;
}

/**
 * Build the final `<img src>` to ship to the DOM.
 *
 * - **Native (Capacitor iOS/Android)**: returns the original URL unchanged.
 *   There is no Vercel edge inside the Capacitor wrapper — a `/_vercel/image`
 *   path would 404. We still skip the Supabase transform too, because
 *   resizing on phones with cellular data is dominated by Supabase's
 *   per-request render cold-starts. Native callers that want the Supabase
 *   resize layer can call `transformedImageUrl` directly.
 * - **Web (Vercel-served)**: if the URL is a Supabase Storage public-object
 *   URL, applies `transformedImageUrl` first so Supabase renders a
 *   right-sized JPEG, then wraps that through `/_vercel/image` for AVIF/WebP
 *   re-encoding + edge caching. External URLs are passed straight to the
 *   Vercel transform.
 * - Always passes through data: / blob: / already-`/_vercel/image` URLs.
 */
export function buildImageUrl(
  src: string | null | undefined,
  options: BuildImageUrlOptions = {},
): string {
  if (!src) return "";

  // Native: do not route through Vercel's edge — there is no edge.
  if (Capacitor.isNativePlatform()) return src;

  if (isUntransformable(src)) return src;

  // Resize at the Supabase source first when applicable. For non-Supabase
  // URLs this is a no-op pass-through.
  const sourceUrl = transformedImageUrl(src, {
    width: options.width,
    height: options.height,
    resize: options.resize,
    quality: options.quality,
  });

  // Final defence: if the Supabase-side transform somehow produced something
  // that already references the Vercel endpoint (e.g. someone fed us
  // pre-transformed input), bail out before double-wrapping.
  if (isAlreadyVercelTransformed(sourceUrl)) return sourceUrl;

  const width = options.width
    ? snapToAllowedWidth(Math.max(1, Math.round(options.width * dpr())))
    : VERCEL_ALLOWED_WIDTHS[VERCEL_ALLOWED_WIDTHS.length - 1];
  const quality = Math.max(
    MIN_QUALITY,
    Math.min(Math.round(options.quality ?? 75), MAX_QUALITY),
  );

  // Vercel's image endpoint only requires `url` and `w`. `q` is optional but
  // we always send it so cached variants are deterministic per quality.
  return `${VERCEL_TRANSFORM_PATH}?url=${encodeURIComponent(sourceUrl)}&w=${width}&q=${quality}`;
}
