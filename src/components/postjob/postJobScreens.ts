/**
 * Post a Job's screens, in order, and the STEP each belongs to: the ONE source of the "n of 3" each screen shows and
 * of the desktop rail (owner 2026-10-21: "make sure each one is numbered correctly").
 *
 * Owner 2026-11-20 (ease batch, item 1): a short 3-step flow, What you need -> When -> Budget -> Post. The group grid,
 * a group's kinds and the title/description are all step 1 ("What you need"); When and where is step 2; Budget is
 * step 3; Review is the Post screen after the three steps (its bar is full and it has no number of its own).
 * Real-member data for the 30 days before: 5 opened Post a job and 1 posted. Guard: src/test/postJobScreenNumbers.test.tsx.
 */
export const POST_JOB_SCREENS = [
  // JA-41 (owner pick 2026-11-01): the first screen is the group grid, with template / saved Helpr / AI as links on
  // it (EntryChoice).
  { key: "groups", step: 1 },
  { key: "kind", step: 1 },
  { key: "details", step: 1 },
  { key: "where", step: 2 },
  { key: "price", step: 3 },
  { key: "review", step: 4 },
] as const;

export type PostJobScreen = (typeof POST_JOB_SCREENS)[number]["key"];

/** The steps the rail shows: three numbered steps, then Post (Review). `first` is the screen a tap reopens. */
export const POST_JOB_STEPS = [
  { key: "what", first: "groups" },
  { key: "when", first: "where" },
  { key: "budget", first: "price" },
  { key: "post", first: "review" },
] as const satisfies readonly { key: string; first: PostJobScreen }[];

/** The numbered steps ("1 of 3"); Post is the last screen, not a numbered step. */
export const POST_JOB_SCREEN_COUNT = 3;

/** 1-based step of a screen (groups, kind and details are all 1; Review is 4, past the three). */
export function screenNumber(screen: PostJobScreen): number {
  return POST_JOB_SCREENS.find((s) => s.key === screen)?.step ?? 1;
}

/** The form page (usePostJobForm `formPage`) that shows a screen; start and review are other steps. */
export const FORM_PAGE_OF: Partial<Record<PostJobScreen, number>> = { groups: 1, kind: 1, details: 2, where: 3, price: 4 };

/** The screen a form page shows (page 1 is "kind" while a group's categories are open). */
export function screenOfFormPage(page: number, groupOpen: boolean): PostJobScreen {
  if (page <= 1) return groupOpen ? "kind" : "groups";
  return page === 2 ? "details" : page === 3 ? "where" : "price";
}
