/**
 * OWNER 11-12 (iPhone screenshots of Jobs and Declutter Browse): one header rhythm for both Browses, and tighter.
 * The search bar, the tab row and the category chip row sat 12px / 4px / 12-28px apart ("too airy"); now 6px / 4px /
 * 8px. The tab row and every chip keep their 44px / 40px boxes (the tap floor is the box, not the gap).
 * Every place that draws these rows (the real header and its loading skeletons) reads them here, so they cannot drift.
 * Guard: src/test/browseHeadersOneLayout.test.ts.
 */
/** Under the section search bar (AppTopBar and its skeletons): with the header's 4px gap, 6px to the tab row. */
export const SEARCH_BAR_PAD = "pb-0.5";
/** Under the phone category chip row's own 4px: nothing more, so 8px to the first content with the column's 4px. */
export const CHIPS_ROW_PAD = "pb-0";
/** Where a Browse's nothing-to-show state sits in its column (Jobs and Declutter alike). */
export const BROWSE_EMPTY_SLOT = "px-0 lg:px-4 pt-1 lg:pt-3 flex-1 min-h-0 flex";
