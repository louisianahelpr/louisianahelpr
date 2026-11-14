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
// F079 (UI audit 11-09): at 200% zoom (720x450) the 4:3 photo filled the whole screen and hid the title, price and
// actions. From sm it is capped too, at the larger of 55% of the screen and the screen less 400px: no cap on a normal
// desktop window (900 tall: 500px, above the photo's own height), about half of a short one (450 tall: 248px).
// Owner 11-14 (Depop/Vinted audit item 9): on a phone the item photo is full-bleed, square-cornered, edge to edge (the
// item page and its skeleton wrap it in APP_PAGE_PHONE_BLEED on a `phoneBleed` AppPage).
export const ITEM_PHOTO_ASPECT = { item: "aspect-square max-h-[52dvh] max-sm:rounded-none sm:max-h-[max(55dvh,calc(100dvh-400px))] sm:aspect-[4/3] bg-photo-empty", banner: "aspect-[16/9] bg-photo-empty" } as const;
