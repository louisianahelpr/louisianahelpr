/**
 * A listing photo that steps aside when it fails to load (audit 1028, after D1-14): the tile shows its placeholder
 * (`fallback`, or whatever sits under it) instead of the browser's broken-image box and alt text. The same rule as
 * DeclutterItemCard's own photo. A new `src` gets a fresh try.
 */
import { useState, type ImgHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { safePhotoSrc, safePhotoSrcSet } from "@/lib/declutter/safePhotoSrc";

/** `retrySrc`: tried once (without srcSet) when `src` fails, before the fallback (B67: the item page's resized photo, then
 * the original). */
type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "alt" | "onError"> & {
  src: string;
  alt: string;
  fallback?: ReactNode;
  retrySrc?: string;
  /** A phone's own candidates (item page speed, 11-09: the square crop its square frame shows), chosen by `phone.media`. */
  phone?: { media: string; srcSet: string; sizes: string };
};

export function FallbackImg({ src, alt, fallback = null, className, retrySrc, srcSet, phone, ...img }: Props) {
  const [failed, setFailed] = useState<{ src: string; stage: "retry" | "gone" } | null>(null);
  const stage = failed?.src === src ? failed.stage : null;
  if (stage === "gone" || (stage === "retry" && !retrySrc)) return <>{fallback}</>;
  const retrying = stage === "retry";
  // Only our own photo URLs reach the src (safePhotoSrc, CodeQL #519); anything else is the placeholder.
  const shown = safePhotoSrc(retrying ? retrySrc : src);
  if (!shown) return <>{fallback}</>;
  const phoneSrcSet = phone && !retrying ? safePhotoSrcSet(phone.srcSet) : undefined;
  const el = (
    <img
      {...img}
      className={cn("bg-photo-empty", className)}
      src={shown}
      srcSet={retrying ? undefined : safePhotoSrcSet(srcSet)}
      alt={alt}
      data-fallback-img=""
      onError={() => setFailed({ src, stage: retrying || !retrySrc ? "gone" : "retry" })}
    />
  );
  if (!phoneSrcSet || !phone) return el;
  // `contents`: the <picture> draws no box, so the <img> sizes against the frame exactly as it did alone.
  return (
    <picture className="contents">
      <source media={phone.media} srcSet={phoneSrcSet} sizes={phone.sizes} />
      {el}
    </picture>
  );
}
