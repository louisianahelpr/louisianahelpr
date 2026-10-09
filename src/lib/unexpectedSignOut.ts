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

/** Set by the app's own sign-out paths just before they sign out. */
let intentionalAt = 0;
export function markIntentionalSignOut(): void {
  intentionalAt = Date.now();
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
  if (now - intentionalAt < INTENTIONAL_WINDOW_MS) return null;
  if (signedInAt === null) return null; // never had a session this page load
  return {
    previousEvent: prev,
    msSinceSignIn: now - signedInAt,
    tokenStillStored: tokenStored(),
    visibility: typeof document === "undefined" ? null : document.visibilityState,
    online: typeof navigator === "undefined" ? null : navigator.onLine,
  };
}
