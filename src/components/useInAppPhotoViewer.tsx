import { useCallback, useMemo, useState, type ReactNode } from "react";
import { PhotoLightbox } from "@/components/dashboard/PhotoLightbox";

/**
 * Open a photo INSIDE the app (owner 11-13, Yusef's "Mow and Weed Eat" review: tapping the Helpr's photo opened the raw
 * signed storage URL in an iOS Safari sheet with an address bar — "it took me out of the app"). Every photo tile calls
 * `open(i)` instead of being an `<a href={signedUrl} target="_blank">` or a `window.open`: a signed URL is never a
 * link a user can carry out of the app (src/test/photosOpenInApp.test.ts).
 *
 * `srcs` may hold nulls (still being signed, or unsignable); those tiles do nothing and are left out of the viewer, so
 * the counter and swipe order count only photos that can draw. `alts` is the same order as `srcs`.
 */
export function useInAppPhotoViewer(
  srcs: readonly (string | null | undefined)[],
  alts?: readonly (string | null | undefined)[],
): { open: (index: number) => void; viewer: ReactNode } {
  const [index, setIndex] = useState<number | null>(null);
  const key = srcs.join("\n");
  const altKey = (alts ?? []).join("\n");
  const ready = useMemo(() => {
    const out: { src: string; alt: string; from: number }[] = [];
    srcs.forEach((s, i) => { if (s) out.push({ src: s, alt: alts?.[i] ?? "", from: i }); });
    return out;
  }, [key, altKey]); // keyed on the joined values, not the arrays' identity (callers pass fresh arrays each render)
  const open = useCallback((i: number) => {
    const k = ready.findIndex((r) => r.from === i);
    if (k >= 0) setIndex(k);
  }, [ready]);
  const viewer = (
    <PhotoLightbox
      photos={ready.map((r) => r.src)}
      alts={ready.map((r) => r.alt)}
      lightboxIndex={index !== null && index < ready.length ? index : null}
      setLightboxIndex={setIndex}
    />
  );
  return { open, viewer };
}
