/**
 * F052 (UI audit 11-09): a guest sees the heart on every Declutter card; pressing it opens sign-up, which says "Sign up
 * to save items." (signupSubtitle, ?reason=save_item) and brings them back here after. Its own tiny file so the Browse
 * grid pays for no sign-up code.
 */
export const SAVE_ITEM_REASON = "save_item";

/** Sign-up for a guest who pressed a heart, coming back to `here` (path + search) after. */
export function guestSaveHref(here: string): string {
  return `/signup?reason=${SAVE_ITEM_REASON}&redirect=${encodeURIComponent(here)}`;
}
