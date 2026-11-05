/**
 * The item photo's frame, shared by DeclutterGallery (the photo) and
 * DeclutterItemSkeleton (its bone) so the placeholder is the photo's exact box
 * (Q1837: an 80%-wide bone stood in for the full-width square, 268px -> 335px at 375).
 */
export const ITEM_PHOTO_FRAME_BASE = "relative w-full overflow-hidden rounded-2xl";
// Items are photo-first (square on a phone); a job page's photo is a banner (boards 15, 168).
// The item photo is square on a phone but never taller than about half the screen, so the price and title start
// above the dock on a short or wide phone window (lead walkthrough 2026-10-28, shot 33: at 500x700 the + covered the
// title). object-cover crops the overflow; the full photo is a tap away in the viewer.
export const ITEM_PHOTO_ASPECT = { item: "aspect-square max-h-[52dvh] sm:max-h-none sm:aspect-[4/3] bg-photo-empty", banner: "aspect-[16/9] bg-photo-empty" } as const;
