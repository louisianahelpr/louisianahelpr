/**
 * OWNER 11-12 (iPhone screenshots of Jobs and Declutter Browse): one header rhythm for both Browses, and tighter.
 * The search bar, the tab row and the category chip row sat 12px / 4px / 12-28px apart ("too airy"); now 6px / 4px /
 * 8px. The tab row and every chip keep their 44px / 40px boxes (the tap floor is the box, not the gap).
 * Every place that draws these rows (the real header and its loading skeletons) reads them here, so they cannot drift.
 * Guard: src/test/browseHeadersOneLayout.test.ts.
 */
/**
 * THE COMPACT TOP (owner 11-14, after Depop's and Vinted's iPhone screens): a page with a search draws ONE phone row,
 * the 44px search with the bell and the photo inline on its right, 8px under the safe area, and 2px under it (with the
 * header's 4px gap, 6px to the tab row). AppTopBar and every loading frame that draws the row read it here.
 * Guard: src/test/compactTopRow.test.tsx.
 */
export const COMPACT_TOP_ROW = "app-top-bar flex items-center gap-1 pt-2 pb-0.5";
/** A phone bar with no search (You, a closed section): the visible title with the bell (and photo), 56px. */
export const TITLE_TOP_ROW = "app-top-bar flex items-center justify-between gap-2 h-14";
/** Under the phone category chip row's own 4px: nothing more, so 8px to the first content with the column's 4px. */
export const CHIPS_ROW_PAD = "pb-0";
/** Where a Browse's nothing-to-show state sits in its column (Jobs and Declutter alike). */
export const BROWSE_EMPTY_SLOT = "px-0 lg:px-4 pt-1 lg:pt-3 flex-1 min-h-0 flex";
