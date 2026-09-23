import { useEffect, useState } from "react";
import {
  PROOF_PHOTO_SIGN_TTL_SECONDS,
  signProofPhotoUrls,
} from "@/lib/proofPhotoStorage";

/**
 * A 1x1 transparent GIF. What an unresolved tile shows while its signed URL is
 * being minted: an empty box of exactly the right size, which is what an <img>
 * looks like mid-load anyway. Without it the browser paints alt text for a
 * frame or two on every render of a proof gallery — a visible change to
 * screens this fix is not supposed to redesign.
 */
export const PENDING_PHOTO_SRC =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/** Joins on NUL, which cannot appear in a storage path or a URL, so two
 *  different arrays can never produce the same cache key. */
function contentKey(values: readonly string[]): string {
  return values.join(String.fromCharCode(0));
}

/**
 * Turns stored proof-photo values into renderable URLs.
 *
 * The stored value is a storage PATH (see src/lib/proofPhotoStorage.ts for why,
 * and for the legacy full-URL shape this still accepts). Signing happens here,
 * at display time, with a ten-minute ticket — so nothing carrying an `exp` is
 * ever written down, and a gallery opened a year from now works the same as one
 * opened today.
 *
 * Returns an array of the same length and order as `values`; an entry that
 * cannot be signed is null.
 */
export function useProofPhotoUrls(
  values: readonly string[],
  expiresInSeconds: number = PROOF_PHOTO_SIGN_TTL_SECONDS,
): (string | null)[] {
  // The resolved URLs are kept WITH the key they were resolved for. Without
  // that pairing, a gallery switching from job A to job B would index B's
  // positions into A's still-current URLs for one paint — the wrong photo
  // against the right alt text, which is worse than no photo.
  const [state, setState] = useState<{ key: string; urls: (string | null)[] }>({
    key: "",
    urls: [],
  });
  const key = contentKey(values);

  useEffect(() => {
    let cancelled = false;
    if (values.length === 0) {
      setState({ key, urls: [] });
      return;
    }
    void signProofPhotoUrls(values, expiresInSeconds).then((urls) => {
      if (!cancelled) setState({ key, urls });
    });
    return () => {
      cancelled = true;
    };
    // `values` is intentionally absent: its identity changes every render at
    // most call sites, `key` is its content.
  }, [key, expiresInSeconds]);

  if (state.key !== key) return values.map(() => null);
  return values.map((_, i) => state.urls[i] ?? null);
}
