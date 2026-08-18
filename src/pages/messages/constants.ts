export const CHAT_PAGE_SIZE = 50;

/**
 * `/messages` URL contract for "is a thread open".
 *
 * MobileNav hides the whole bottom dock while `?chat=1` is present
 * (src/components/MobileNav.tsx) — an open conversation replaces the app
 * chrome with its own header, iOS-style. That makes the flag load-bearing:
 * if it is ever set while the LIST is on screen there is no bottom nav and
 * no way out of Messages at all.
 *
 * That is exactly what shipped. `openConvo` set the flag from component
 * state, and nothing on any path removed it, so:
 *   - open a thread → tap "View profile" → back → Messages remounts with
 *     `activeConvo` null but `?chat=1` still in the URL → stranded on the list;
 *   - worse on native: RouteMemory (src/components/RouteMemory.tsx) records
 *     `pathname + search`, so a WKWebView jetsam-reload restores the user to
 *     `/messages?chat=1` with no thread open — the owner's device repro.
 *
 * The invariant now enforced in Messages.tsx is: **the flag is present if and
 * only if a thread is actually open**, in both directions. Opening pushes the
 * flagged entry (so an OS/gesture back closes the thread instead of leaving
 * Messages); losing the flag closes the thread; a flag with no thread behind
 * it is stripped on sight.
 */
export const CHAT_OPEN_PATH = "/messages?chat=1";
export const MESSAGES_LIST_PATH = "/messages";

/**
 * History-entry marker set on the entry `openConvo` pushes. Its presence is
 * how the in-app back affordance knows it can honestly `navigate(-1)` (same
 * result as the swipe/hardware back) rather than having to replace — which
 * would otherwise leave a duplicate list entry and a dead back press.
 */
export const THREAD_OPEN_STATE = { threadOpen: true } as const;

/** Reads the marker off a `location.state` of unknown shape. */
export function isThreadOpenEntry(state: unknown): boolean {
  return !!(state as { threadOpen?: boolean } | null)?.threadOpen;
}
