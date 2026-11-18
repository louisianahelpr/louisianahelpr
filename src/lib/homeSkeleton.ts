/**
 * Design audit r2 #44: Home's skeleton did not match the loaded layout, so the page jumped when the first card came in.
 * The loaded Needs-you card measured about 176px tall on a phone (the audit's live walk, 11-17); both of Home's loading
 * frames (the route skeleton, which index.html's #lh-home-shell copies, and HomeDashboard's in-page top card) reserve
 * that height. A tiny module of its own so Home's chunk does not pull in the route skeleton.
 */
export const HOME_NEEDS_YOU_MIN_PX = 176;
