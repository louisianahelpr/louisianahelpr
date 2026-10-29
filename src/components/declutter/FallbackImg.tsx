/**
 * A listing photo that steps aside when it fails to load (audit 1028, after D1-14): the tile shows its placeholder
 * (`fallback`, or whatever sits under it) instead of the browser's broken-image box and alt text. The same rule as
 * DeclutterItemCard's own photo. A new `src` gets a fresh try.
 */
import { useState, type ImgHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "alt" | "onError"> & { src: string; alt: string; fallback?: ReactNode };

export function FallbackImg({ src, alt, fallback = null, className, ...img }: Props) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (failedSrc === src) return <>{fallback}</>;
  return <img {...img} className={cn("bg-photo-empty", className)} src={src} alt={alt} data-fallback-img="" onError={() => setFailedSrc(src)} />;
}
