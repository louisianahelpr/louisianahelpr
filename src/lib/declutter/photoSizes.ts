/**
 * SQUARE PHOTO SIZES (B77, 2026-11-01, "Nothing slow for users"). Supabase's image transform
 * (storage/v1/render/image/public, WebP when the browser accepts it) at the size each place draws, built from the
 * photo's public object URL like pagePhoto.ts, so it needs no client: a URL that is not a public Storage object gets
 * null, and the place shows the original as before.
 *
 * - A list row's small square (Selling's listings 64 CSS px, Buying's cart 48): THUMB_PHOTO_PX covers 2.5x. Both
 *   showed the full original (356-560 KB each, B50's measure of live photos).
 * - A Browse card: a phone's two-column card is ~162 CSS px, 323 device px at 2x, so it takes the 340 square
 *   (cardPhotoSrcSet + CARD_PHOTO_SIZES) and only a wider tile the 480 (photoCardUrl, CARD_PHOTO_PX). /declutter's
 *   largest paint at 375 on Slow 4G is the first card's photo (11.9 s, 3.1 s of it the download, B72/B74's lab).
 * Same square crop and quality as photoCardUrl (src/lib/declutter/api.ts). Guard: src/lib/declutter/photoSizes.test.ts.
 */
const PUBLIC_OBJECT = "/storage/v1/object/public/";

export const THUMB_PHOTO_PX = 160;
/**
 * B81 (2026-11-01): 340, not B77's 320. The card at 375 draws calc(50vw - 26px) = 161.5 CSS px, 323 device px at 2x,
 * so a 320w candidate fell short and the browser took the 480 (34 KB WebP on Browse's first live photo, measured with
 * curl the same day; the 340 is 17.7 KB, the 320 15.7 KB). 340 covers a 2x phone up to 392 wide.
 */
export const CARD_PHOTO_SMALL_PX = 340;
/** The card's drawn width: half the phone screen less its gutters (20 px each side, 12 px gap); about 250 px from sm up. */
export const CARD_PHOTO_SIZES = "(min-width: 640px) 250px, calc(50vw - 26px)";

export function squarePhotoUrl(publicUrl: string, px: number): string | null {
  const at = publicUrl.indexOf(PUBLIC_OBJECT);
  if (at < 0 || publicUrl.includes("?")) return null;
  return `${publicUrl.slice(0, at)}/storage/v1/render/image/public/${publicUrl.slice(at + PUBLIC_OBJECT.length)}?width=${px}&height=${px}&resize=cover&quality=70`;
}

/** The card's srcSet: the small square, then the 480 card photo it already asks for (`cardUrl`, photoCardUrl). */
export function cardPhotoSrcSet(publicUrl: string, cardUrl: string, cardPx: number): string | undefined {
  const small = squarePhotoUrl(publicUrl, CARD_PHOTO_SMALL_PX);
  return small ? `${small} ${CARD_PHOTO_SMALL_PX}w, ${cardUrl} ${cardPx}w` : undefined;
}
