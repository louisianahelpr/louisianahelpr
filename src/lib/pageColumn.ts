/**
 * THE ONE PAGE COLUMN (owner, 2026-10-21: "it should all be wide").
 *
 * On a ~2000px desktop window, You › Money and Notifications sat in a 640px
 * centred column and the Jobs list in a 960px one under a full-width Jobs
 * header, while Home, Explore and Declutter filled the frame. Every signed-in
 * page column now uses this one class: the full width of the app frame (inside
 * the frame's own padding), the same on every page. Phone is unchanged: the
 * frame is the phone's width there.
 *
 * Forms and long text may cap their LINE length inside the column (a reading
 * measure on the text block), never the page column itself.
 *
 * The width lives once, as `--page-column-max` on :root in src/index.css.
 * Guard: src/test/onePageColumn.test.ts.
 */
export const PAGE_COLUMN = "page-column";

/**
 * THE PUBLIC LINK COLUMN: a page opened from a shared link (/book/<id>, /u/<handle>) reads as one centred
 * card column, the same at every width, never a full-width page at 1440 (lead 2026-11-01, B88). Both pages
 * and their loading lines use this one string, so they cannot drift apart.
 * Guard: src/test/publicProfilePage.test.tsx.
 */
export const PUBLIC_LINK_COLUMN = "mx-auto w-full max-w-md";
