/**
 * Report a SIGNED_OUT nobody asked for.
 *
 * MEASURED (prod, 2026-10-09 02:46-02:48Z, Kaci L., Mobile Safari 27 on iOS
 * 18.7): she landed on /home from her email-confirm link with a valid session
 * (every request 02:46:53-54 carried her JWT), and from 02:47:02 every request
 * went out with no JWT at all: 401s and "permission denied" error screens for
 * 90s until she signed in again. Auth logs show no /logout and no refresh for
 * her in that window, so the session ended on the device, and nothing recorded
 * why. This records the next one: a SIGNED_OUT with no app sign-out behind it
 * is reported with what the device still held.
 */

import { safeStorage } from "@/lib/safeStorage";

/**
 * Set by the app's own sign-out paths just before they sign out.
 *
 * In memory for THIS tab, and in storage for every OTHER tab of the same
 * browser (Q1631). auth-js tells sibling tabs about a sign-out (its
 * BroadcastChannel), so a "Log Out" in one tab arrives as a SIGNED_OUT in every
 * other open tab, and a mark held only in the tab that pressed the button made
 * each of those report a sign-out nobody asked for. MEASURED (prod, Sentry
 * JAVASCRIPT-39, 2026-10-09 14:45:50.454Z): a HIDDEN tab, 38 s after its
 * SIGNED_IN, token already gone, reported "Unexpected sign-out" in the same
 * second the auth log shows a /logout (14:45:50Z) from the same site.
 */
let intentionalAt = 0;
export const INTENTIONAL_SIGN_OUT_KEY = "lh.intentionalSignOutAt";
export function markIntentionalSignOut(): void {
  intentionalAt = Date.now();
  safeStorage.setItem(INTENTIONAL_SIGN_OUT_KEY, String(intentionalAt));
}

/** The newest mark any tab of this browser left in shared storage (0: none or unreadable). */
function storedIntentionalAt(): number {
  const stored = Number(safeStorage.getItem(INTENTIONAL_SIGN_OUT_KEY));
  return Number.isFinite(stored) ? stored : 0;
}

/** A sign-out within this long of a mark is the app's own. */
const INTENTIONAL_WINDOW_MS = 15_000;

export interface SignOutWatchState {
  lastEvent: string | null;
  signedInAt: number | null;
}

/**
 * Feed every auth event through this. Returns the report payload for an
 * unexpected SIGNED_OUT (the caller sends it), or null.
 */
export function noteAuthEvent(
  state: SignOutWatchState,
  event: string,
  now: number,
  tokenStored: () => boolean,
): Record<string, unknown> | null {
  const prev = state.lastEvent;
  state.lastEvent = event;
  if (event === "SIGNED_IN" || event === "INITIAL_SESSION") {
    if (event === "SIGNED_IN" || state.signedInAt === null) state.signedInAt = now;
    return null;
  }
  if (event !== "SIGNED_OUT") return null;
  const signedInAt = state.signedInAt;
  state.signedInAt = null;
  // This tab's own sign-out. A mark dated after `now` (the clock moved back)
  // excuses nothing.
  const sinceOwnMark = now - intentionalAt;
  if (sinceOwnMark >= 0 && sinceOwnMark < INTENTIONAL_WINDOW_MS) return null;
  if (signedInAt === null) return null; // never had a session this page load
  // Another tab's Log Out AFTER this tab signed in. The session store is
  // shared, so that sign-out ended this tab's session too, however late this
  // tab hears about it (a frozen or back-forward-cached tab hears it on
  // resume, long after any fixed window). A later sign-in here moves
  // signedInAt past the mark, so the mark cannot excuse a newer sign-out, and
  // a mark dated in the future excuses nothing.
  const otherTabMark = storedIntentionalAt();
  if (otherTabMark >= signedInAt && otherTabMark <= now) return null;
  return {
    previousEvent: prev,
    msSinceSignIn: now - signedInAt,
    tokenStillStored: tokenStored(),
    visibility: typeof document === "undefined" ? null : document.visibilityState,
    online: typeof navigator === "undefined" ? null : navigator.onLine,
  };
}
