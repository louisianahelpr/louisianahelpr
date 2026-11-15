import { useCallback, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
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

/** Shown when a private photo could not be signed (the same words openSignedDocument uses for a document). */
const PHOTO_SIGN_FAILED = "Couldn't load that photo. Try again.";

/**
 * One photo opened in the app's own viewer from a click, for a file that is only known (or only signed) at click time:
 * an admin's evidence photo, a support screenshot, an ID photo (owner 2026-11-15: "when I click a picture it takes me
 * out of the website into Supabase"). `show(src)` opens a URL already in hand; `showSigned(sign)` signs first and opens
 * the result, or calls `onFail` with PHOTO_SIGN_FAILED. A PDF never comes here: callers route only
 * `isBrowserImagePath(path)` files to it (src/test/photosOpenInApp.test.tsx).
 */
export function useSinglePhotoViewer(): {
  show: (src: string, alt?: string) => void;
  showSigned: (sign: () => Promise<string | null>, alt: string, onFail: (msg: string) => void) => Promise<void>;
  viewer: ReactNode;
} {
  const [photo, setPhoto] = useState<{ src: string; alt: string } | null>(null);
  const show = useCallback((src: string, alt = "") => setPhoto({ src, alt }), []);
  const showSigned = useCallback(async (sign: () => Promise<string | null>, alt: string, onFail: (msg: string) => void) => {
    let url: string | null;
    try {
      url = await sign();
    } catch {
      // Treated exactly like a null URL: the caller's onFail tells the user, nothing is swallowed silently.
      url = null;
    }
    if (url) setPhoto({ src: url, alt });
    else onFail(PHOTO_SIGN_FAILED);
  }, []);
  const setIndex: Dispatch<SetStateAction<number | null>> = (v) => {
    const next = typeof v === "function" ? v(photo ? 0 : null) : v;
    if (next === null) setPhoto(null);
  };
  const viewer = (
    <PhotoLightbox
      photos={photo ? [photo.src] : []}
      alts={photo ? [photo.alt] : []}
      lightboxIndex={photo ? 0 : null}
      setLightboxIndex={setIndex}
    />
  );
  return { show, showSigned, viewer };
}
