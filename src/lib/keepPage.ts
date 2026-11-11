/**
 * History-state flag for a step WITHIN a page: a push to the same pathname whose state carries it keeps the page
 * mounted in RoutePageTransition (sign-up's step 2, F260n; the guest /browse job sheet's ?job= entry, F260u). Without
 * it every push or replace makes a new location.key, the page remounts, and anything kept only in React state is gone
 * (sign-up lost the typed password and fell back to step 1; audit 2026-11-10). Back to the entry the step was pushed
 * from finds that entry's own key, which is the one the page kept, so it stays mounted too.
 */
export const KEEP_PAGE = "lhKeepPage";

export const keepsPageState = (state: unknown): boolean =>
  !!state && typeof state === "object" && (state as Record<string, unknown>)[KEEP_PAGE] === true;
