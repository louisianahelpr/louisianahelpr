/**
 * THE DESKTOP SEARCH FIELD, OPEN (owner 2026-10-28, choosing the "Today" row of the search mock-up: "i like today but
 * that's not what it actually looks like on the website"). One look for every search that opens in place in a
 * desktop tabs row (Jobs Browse's BrowseSearchBar, InlineListSearch on Posted / Working / Declutter):
 *   a white rounded pill, 260px wide and 42px tall, a 1.5px light border (the --border line), NO shadow, the
 *   magnifier inside on the left, "<label>…" as its placeholder, the X inside on the right, 15px words.
 * 42px sits inside the row's 44px controls, so the row does not grow when it opens. Phone keeps its own field.
 * The fill is `bg-[hsl(var(--card))]`, never `bg-card`: index.css's T2 card rule (`:where(.bg-card)`) makes every
 * `.bg-card` border transparent and gives it a drop shadow, both `!important`, which is how the old open field lost
 * its border. Guard: src/test/desktopSearchPill.test.tsx.
 */
export const DESKTOP_SEARCH_PILL_WIDTH = "w-[260px]";
export const DESKTOP_SEARCH_PILL_SURFACE = "h-[42px] rounded-full border-[1.5px] border-border bg-[hsl(var(--card))] shadow-none";
