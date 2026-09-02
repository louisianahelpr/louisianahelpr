import * as React from "react";

import { buildImageUrl, type BuildImageUrlOptions } from "@/lib/imageUrl";

/**
 * `OptimizedImage` — a drop-in `<img>` replacement that, on the web build,
 * routes the source URL through Vercel's `/_vercel/image` edge transform for
 * AVIF/WebP re-encoding, browser-aware format negotiation, right-sizing, and
 * long-lived edge caching in front of Supabase egress. On native
 * (Capacitor iOS/Android) there is no Vercel server in front of the wrapped
 * `dist/`, so the source URL is passed through unchanged — calls keep
 * working inside the WKWebView.
 *
 * Defaults that matter:
 *   - `loading="lazy"` and `decoding="async"` — the usual "scroll into view"
 *     win for image-heavy feeds. Set `priority` to flip to eager + high
 *     fetchpriority for above-the-fold imagery (hero, dashboard avatars).
 *   - `quality` defaults to 75 — visually fine for thumbnails and matches
 *     the existing Supabase-side `transformedImageUrl` default.
 *
 * Props mirror the native `<img>` element (`src`, `alt`, `width`, `height`,
 * `className`, `loading`, `decoding`, `onLoad`, `onError`, `sizes`) so this
 * can be slotted in anywhere an existing `<img>` lives without restructuring
 * the surrounding markup.
 */
interface OptimizedImageProps
  extends Omit<
    React.ImgHTMLAttributes<HTMLImageElement>,
    "src" | "loading" | "decoding" | "width" | "height"
  > {
  /** Source URL — Supabase Storage URL, external CDN, blob:/data: preview, or empty. */
  src: string | null | undefined;
  /** Alt text. Required for accessibility; pass `""` for decorative images. */
  alt: string;
  /** Rendered CSS width in px. Used to size the Vercel/Supabase variant. */
  width?: number;
  /** Rendered CSS height in px. Forwarded to the Supabase render layer. */
  height?: number;
  /** Encode quality 20-100. Defaults to 75. */
  quality?: number;
  /** Responsive `sizes` attribute — forwarded to `<img>` as-is. */
  sizes?: string;
  /** Lazy by default. Pass `loading="eager"` for explicit override (rare — prefer `priority`). */
  loading?: "lazy" | "eager";
  /** Async decode by default. Pass `decoding="sync"` only when you really want sync. */
  decoding?: "async" | "sync" | "auto";
  /**
   * Above-the-fold images (hero, dashboard avatar, the first card in a feed).
   * Flips `loading="eager"` and `fetchpriority="high"` so the browser pulls
   * the image as early as possible. Overrides `loading` if both are set.
   */
  priority?: boolean;
  /**
   * Fade the image in once it decodes, over a tinted parchment placeholder —
   * the soft "develops in" feel top photo apps use so a lazy image doesn't
   * pop in hard against the layout. Opt-in (default off) so existing avatars
   * and icons that already paint instantly aren't given an unwanted flicker;
   * reach for it on photo-heavy surfaces (job photos, lightbox thumbs).
   *
   * A cached image still fires `load`, so this stays a single quick fade
   * rather than a stall.
   */
  fadeIn?: boolean;
}

const OptimizedImage = React.forwardRef<HTMLImageElement, OptimizedImageProps>(
  function OptimizedImage(
    {
      src,
      alt,
      width,
      height,
      quality = 75,
      sizes,
      loading,
      decoding,
      priority = false,
      fadeIn = false,
      onLoad,
      onError,
      style,
      ...rest
    },
    ref,
  ) {
    const [loaded, setLoaded] = React.useState(false);
    const transformOptions: BuildImageUrlOptions = React.useMemo(
      () => ({ width, height, quality }),
      [width, height, quality],
    );

    const finalSrc = React.useMemo(
      () => buildImageUrl(src, transformOptions),
      [src, transformOptions],
    );

    const resolvedLoading = priority ? "eager" : loading ?? "lazy";
    const resolvedDecoding = decoding ?? "async";
    // `fetchpriority` is a valid HTML attribute but React types only added it
    // recently; spread through a typed object so older @types/react versions
    // don't reject it at the call site.
    const priorityAttrs: Record<string, string> = priority
      ? { fetchpriority: "high" }
      : {};

    // Fade-in: start transparent over a parchment tint, transition to opaque
    // once the image reports loaded. Composed into the caller's own `style`
    // so a passed `style` prop still wins for anything it sets.
    const fadeStyle: React.CSSProperties = fadeIn
      ? {
          backgroundColor: loaded ? undefined : "hsl(var(--parchment) / 0.5)",
          opacity: loaded ? 1 : 0,
          transition: "opacity 320ms ease-out",
        }
      : {};

    const handleLoad: React.ReactEventHandler<HTMLImageElement> = (e) => {
      if (fadeIn) setLoaded(true);
      onLoad?.(e);
    };

    const handleError: React.ReactEventHandler<HTMLImageElement> = (e) => {
      // Reveal a broken/failed image rather than leaving it stuck at opacity 0.
      if (fadeIn) setLoaded(true);
      onError?.(e);
    };

    return (
      <img
        ref={ref}
        src={finalSrc}
        alt={alt}
        width={width}
        height={height}
        loading={resolvedLoading}
        decoding={resolvedDecoding}
        sizes={sizes}
        onLoad={handleLoad}
        onError={handleError}
        style={fadeIn ? { ...fadeStyle, ...style } : style}
        {...priorityAttrs}
        {...rest}
      />
    );
  },
);

export { OptimizedImage };
export default OptimizedImage;
