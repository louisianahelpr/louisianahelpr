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
type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "alt" | "onError"> & { src: string; alt: string; fallback?: ReactNode; retrySrc?: string };

export function FallbackImg({ src, alt, fallback = null, className, retrySrc, srcSet, ...img }: Props) {
  const [failed, setFailed] = useState<{ src: string; stage: "retry" | "gone" } | null>(null);
  const stage = failed?.src === src ? failed.stage : null;
  if (stage === "gone" || (stage === "retry" && !retrySrc)) return <>{fallback}</>;
  const retrying = stage === "retry";
  // Only our own photo URLs reach the src (safePhotoSrc, CodeQL #519); anything else is the placeholder.
  const shown = safePhotoSrc(retrying ? retrySrc : src);
  if (!shown) return <>{fallback}</>;
  return (
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
}
