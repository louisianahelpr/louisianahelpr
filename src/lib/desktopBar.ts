/**
 * THE DESKTOP WEBSITE'S TOP BAR GEOMETRY, in one place (owner, 2026-10-28, desktop /jobs at ~1390 wide: "jobs is
 * still not even with the h", then "browse posted working needs to be even with create").
 *
 * The left rail is fixed: its logo sits 20px from the top (a 44px box, so its middle is at 42px), and its "+ Create"
 * (48px) follows 16px under the logo, so Create's middle is at 20 + 44 + 16 + 24 = 104px. The bar and the page head
 * line up with those two:
 *   - the bar is BAR_PAD_TOP + BAR_ROW tall and its row (page title, bell, photo) is centred at 14 + 28 = 42px,
 *     level with the logo's middle;
 *   - a page's first content (a section's tabs row, 44px + its 1px rule) starts CONTENT_GAP below the bar, then the
 *     section header's own 4px: 70 + 8 + 4 + 22.5 = 104.5px, level with Create's middle.
 * Every layer that reserves the bar's height reads these: DesktopTopNav (its padding), AppShell (the frame's `top`),
 * index.css (`--desktop-bar-h` for #root on document-scroll pages and the admin rail), PageTitleBar (the one gap under
 * the bar) and PageScaffold (that gap plus the section header's 4px: Jobs' tabs land where the other sections' do). Guard: src/test/desktopHeadLevelWithRail.test.ts.
 */
export const DESKTOP_BAR_PAD_TOP = 14;
export const DESKTOP_BAR_ROW = 56;
export const DESKTOP_BAR_H = DESKTOP_BAR_PAD_TOP + DESKTOP_BAR_ROW;
/** The one gap between the bar and a page's first content (PageTitleBar's `h-2`). */
export const DESKTOP_CONTENT_GAP = 8;
/** PageScaffold's gap under the bar (`lg:pt-3`): the 8px plus the 4px a SectionScreen header puts over its tabs. */
export const DESKTOP_SCAFFOLD_GAP = DESKTOP_CONTENT_GAP + 4;
