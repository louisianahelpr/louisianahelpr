/**
 * THE ROW UNDER THE JOBS TABS IS ONE ROW (owner, 2026-10-27, /jobs at 1440: "spacing for all of these should
 * be the same, like 0 jobs and the line under should be the same size as the posted screen").
 *
 * Browse's "N jobs" row (count, search, filters, map) and Posted / Working's status chip row (chips, search)
 * are the same box on every tab, so switching tabs moves nothing:
 *   - JOBS_TOOLBAR_ROW: the row itself, 46px (the status chips' 44px plus their scroller's 2px), no side
 *     inset of its own, so its left edge is the tabs' left edge;
 *   - JOBS_TOOLBAR_LINE_CLASS / _STYLE: on the desktop website, the box under the row with the hairline,
 *     4px below the row, across the whole panel (Browse: over the list AND the map, as Posted's spans).
 * Measured at 1440 and 375 with getBoundingClientRect (~/.lh-shots/jobs-search-inline-1027/).
 * Guard: src/test/jobsToolbarRowIsOneRow.test.tsx.
 */
export const JOBS_TOOLBAR_ROW = "flex min-h-[46px] min-w-0 items-center gap-2";

export const JOBS_TOOLBAR_LINE_CLASS = "shrink-0 -ml-px -mt-px pb-1";

export const JOBS_TOOLBAR_LINE_STYLE = { borderBottom: "1px solid hsl(var(--olivewood) / 0.12)" } as const;
