import { useState, useEffect, useRef } from "react";

interface LazyImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  alt: string;
  fallback?: string;
  /** Optional width hint so the browser reserves layout (prevents CLS). */
  width?: number;
  /** Optional height hint so the browser reserves layout (prevents CLS). */
  height?: number;
  /** If true, renders as `<img loading="eager">` for above-the-fold hero images. */
  eager?: boolean;
}

/**
 * Auto-derives a WebP/AVIF source from a JPG/PNG src by swapping the
 * extension. The original src is always rendered as the `<img>` fallback,
 * so missing modern variants gracefully degrade to the original asset.
 */
function modernSources(src: string): { avif?: string; webp?: string } {
  const m = src.match(/\.(jpe?g|png)(\?.*)?$/i);
  if (!m) return {};
  const base = src.slice(0, src.length - m[0].length);
  const query = m[2] || "";
  return {
    avif: `${base}.avif${query}`,
    webp: `${base}.webp${query}`,
  };
}

const LazyImage = ({
  src,
  alt,
  fallback = "/placeholder.svg",
  className,
  eager = false,
  width,
  height,
  ...props
}: LazyImageProps) => {
  const [loaded, setLoaded] = useState(false);
  const [, setError] = useState(false);
  const [activeSrc, setActiveSrc] = useState<string>(eager ? src : fallback);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (eager) {
      setActiveSrc(src);
      return;
    }
    if (!imgRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setActiveSrc(src);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(imgRef.current);
    return () => observer.disconnect();
  }, [src, eager]);

  const { avif, webp } = activeSrc === src ? modernSources(src) : {};

  const img = (
    <img
      ref={imgRef}
      alt={alt}
      src={activeSrc}
      width={width}
      height={height}
      className={`transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-60"} ${className || ""}`}
      onLoad={() => setLoaded(true)}
      onError={() => {
        setError(true);
        setActiveSrc(fallback);
      }}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      {...props}
    />
  );

  // Only wrap in <picture> once we've actually swapped to the real src.
  if (activeSrc === src && (avif || webp)) {
    return (
      <picture>
        {avif && <source srcSet={avif} type="image/avif" />}
        {webp && <source srcSet={webp} type="image/webp" />}
        {img}
      </picture>
    );
  }

  return img;
};

export default LazyImage;
