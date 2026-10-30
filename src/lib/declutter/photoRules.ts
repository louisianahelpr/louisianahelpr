/**
 * How many photos a Declutter listing needs, and may have. The server's own
 * numbers are in declutter_publish_item (photos_required); src/test/declutterPhotoMinimum.test.ts
 * holds the two equal.
 *
 * Owner decision 2026-10-20 (Cowork design audit pop-up): ONE photo is enough
 * to list (it was 3); up to 12.
 */
export const DECLUTTER_MIN_PHOTOS = 1;
export const DECLUTTER_MAX_PHOTOS = 12;

/** "1 photo" / "3 photos". */
export function photosWord(n: number): string {
  return `${n} photo${n === 1 ? "" : "s"}`;
}

/** How many photos the AI reads for one listing. */
export const AI_DRAFT_PHOTOS = 4;
