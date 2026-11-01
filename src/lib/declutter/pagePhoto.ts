/**
 * THE ITEM PAGE'S PHOTO (B67, DECL-ITEM-SPEED): the gallery shows a width-limited WebP from Supabase's image transform
 * (storage/v1/render/image/public, as photoCardUrl), never the original. Measured 2026-11-01 on a live listing photo
 * (GET only): original 462 KB; width 720 124 KB, width 1080 166 KB. Width only, so the aspect stays the original's and
 * the frame's object-cover crops exactly as before. The full-screen viewer keeps the original, and a transform that
 * fails falls back to it (FallbackImg retrySrc).
 *
 * Built from the public object URL (the same URL getPublicUrl(path, { transform: { width, quality } }) returns), so
 * it needs no client: a URL that is not a public Storage object gets null, and the frame shows it as before.
 */
export const PAGE_PHOTO_WIDTHS = [720, 1080] as const;
const PUBLIC_OBJECT = "/storage/v1/object/public/";

export function pagePhotoUrl(publicUrl: string, width: (typeof PAGE_PHOTO_WIDTHS)[number]): string | null {
  const at = publicUrl.indexOf(PUBLIC_OBJECT);
  if (at < 0 || publicUrl.includes("?")) return null;
  return `${publicUrl.slice(0, at)}/storage/v1/render/image/public/${publicUrl.slice(at + PUBLIC_OBJECT.length)}?width=${width}&quality=75`;
}

/** The frame's src and srcSet for one original photo URL, or null to show the original. */
export function pagePhoto(publicUrl: string): { src: string; srcSet: string } | null {
  const src = pagePhotoUrl(publicUrl, 720);
  if (!src) return null;
  return { src, srcSet: PAGE_PHOTO_WIDTHS.map((w) => `${pagePhotoUrl(publicUrl, w)} ${w}w`).join(", ") };
}
