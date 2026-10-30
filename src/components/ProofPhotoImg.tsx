import { useState } from "react";
import { PENDING_PHOTO_SRC } from "@/hooks/useProofPhotoUrls";

/**
 * A proof photo, or, when this browser can't draw it, a labelled way to open it (Tester 6, 10-30: a stored HEIC shows
 * as a broken image in Chromium). A photo is never just a broken box, because a poster decides on pay from these.
 *
 * `insideControl`: the caller already wraps this in a link or button, so the fallback is words only (a link inside a
 * link is invalid HTML) and the caller's control is what opens it.
 */
export function ProofPhotoImg({
  src,
  alt,
  className,
  insideControl = false,
}: {
  /** The signed URL; null while it is being minted. */
  src: string | null | undefined;
  alt: string;
  className?: string;
  insideControl?: boolean;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  // Kept with the URL it failed for, so a fresh ticket for the photo gets its own try.
  if (src && failedSrc === src) {
    const box = `${className ?? ""} flex items-center justify-center bg-muted p-1 text-center text-ds-12 font-semibold text-foreground`;
    return insideControl
      ? <span data-proof-photo-fallback="" className={box}>Open photo</span>
      : <a data-proof-photo-fallback="" href={src} target="_blank" rel="noopener noreferrer" className={`${box} underline`} aria-label={alt ? `Open photo: ${alt}` : "Open photo"}>Open photo</a>;
  }
  return (
    <img
      src={src ?? PENDING_PHOTO_SRC}
      alt={alt}
      loading="lazy"
      decoding="async"
      className={className}
      onError={() => { if (src) setFailedSrc(src); }}
    />
  );
}
