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

/**
 * ITEM PAGE SPEED (Builder 2, 11-09: ~6 s to the first photo on Slow 4G): below sm the frame is SQUARE
 * (ITEM_PHOTO_ASPECT.item), but the width-only photo kept the original's shape, so a phone downloaded every pixel
 * object-cover then cropped away (a 720x900 photo for a 335x335 frame). A phone gets the square, centre-cropped as
 * object-cover crops it, at the same quality. Measured 11-09 on three live listings (720 wide, q75, WebP):
 * 167 -> 127 KB, 132 -> 61 KB, 97 -> 46 KB. sm and up keep the width-only photo (their frame is 4:3, and a square
 * would lose a landscape photo's sides there).
 */
export const PHONE_PHOTO_MEDIA = "(max-width: 639px)";
/** The phone frame's width (the column less its 20px gutters), as the gallery's sizes say it below sm. */
export const PHONE_PHOTO_SIZES = "calc(100vw - 40px)";

function pagePhonePhotoUrl(publicUrl: string, width: (typeof PAGE_PHOTO_WIDTHS)[number]): string | null {
  const base = pagePhotoUrl(publicUrl, width);
  return base && base.replace(`?width=${width}&quality=75`, `?width=${width}&height=${width}&resize=cover&quality=75`);
}

/** The frame's src and srcSet for one original photo URL (and a phone's square srcSet), or null to show the original. */
export function pagePhoto(publicUrl: string): { src: string; srcSet: string; phoneSrcSet: string } | null {
  const src = pagePhotoUrl(publicUrl, 720);
  if (!src) return null;
  return {
    src,
    srcSet: PAGE_PHOTO_WIDTHS.map((w) => `${pagePhotoUrl(publicUrl, w)} ${w}w`).join(", "),
    phoneSrcSet: PAGE_PHOTO_WIDTHS.map((w) => `${pagePhonePhotoUrl(publicUrl, w)} ${w}w`).join(", "),
  };
}
