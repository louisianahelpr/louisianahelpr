/**
 * Post a Job's screens, in order: the ONE source of the "n of 7" each screen shows and of the
 * desktop rail (owner 2026-10-21: "make sure each one is numbered correctly"). The numbers are
 * fixed: a group with one category ("Something else") skips "kind" and goes 2 -> 4, and nothing
 * renumbers. Guarded by src/test/postJobScreenNumbers.test.ts.
 */
export const POST_JOB_SCREENS = [
  // JA-41 (owner pick 2026-11-01): "How do you want to start?" is gone; the first screen is the group grid,
  // with template / saved Helpr / AI as links on it (EntryChoice). Six screens.
  { key: "groups", rail: "What" },
  { key: "kind", rail: "Kind of job" },
  { key: "details", rail: "Details" },
  { key: "price", rail: "Price" },
  { key: "where", rail: "When and where" },
  { key: "review", rail: "Review" },
] as const;

export type PostJobScreen = (typeof POST_JOB_SCREENS)[number]["key"];
export const POST_JOB_SCREEN_COUNT = POST_JOB_SCREENS.length;

/** 1-based position of a screen. */
export function screenNumber(screen: PostJobScreen): number {
  return POST_JOB_SCREENS.findIndex((s) => s.key === screen) + 1;
}

/** The form page (usePostJobForm `formPage`) that shows a screen; start and review are other steps. */
export const FORM_PAGE_OF: Partial<Record<PostJobScreen, number>> = { groups: 1, kind: 1, details: 2, price: 3, where: 4 };

/** The screen a form page shows (page 1 is "kind" while a group's categories are open). */
export function screenOfFormPage(page: number, groupOpen: boolean): PostJobScreen {
  if (page <= 1) return groupOpen ? "kind" : "groups";
  return page === 2 ? "details" : page === 3 ? "price" : "where";
}
