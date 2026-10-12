/**
 * A read's deadline counts only the time the page could actually run.
 *
 * Measured on prod (error_logs + edge logs, 2026-10-09/10): two iPhones
 * reported "Profile request timed out" (6 s) and "notifications load timed
 * out after 15000ms" although the server answered those very reads in
 * 140-360 ms. The phone had been put away mid-read: iOS freezes the page, the
 * request waits on the device, and on return the overdue timer fires first,
 * so the race is lost to a timer that never measured a wait. In the profile
 * case every queued request reached the server in the same 20 ms on return,
 * beside a "TypeError: Load failed" and an aborted MapKit fetch from the same
 * phone.
 *
 * So the deadline restarts whenever the page comes back:
 *   - the page went hidden during the wait (visibilitychange), or
 *   - the timer itself fired more than FROZEN_SLACK_MS late (the event loop
 *     did not run, which is what a frozen page looks like even when no
 *     visibility event was delivered).
 * A wait that stays visible and on time still fails at exactly `ms`, so a
 * real stall still reaches its error state on the same budget as before.
 *
 * Guard: src/lib/visibleDeadline.test.ts (behaviour) and
 * src/test/readDeadlinesCountVisibleTime.test.ts (no data read in src races a
 * bare reject timer).
 */

/** A timer this late means the page was frozen, not that the read was slow. */
export const FROZEN_SLACK_MS = 1_000;

/** At most this many restarts per wait: a page frozen again and again still ends. */
export const MAX_RESTARTS = 3;

let lastHiddenAt = Number.NEGATIVE_INFINITY;
let lastShownAt = Number.NEGATIVE_INFINITY;
let listening = false;
const onShown = new Set<() => void>();

function listen(): void {
  if (listening || typeof document === "undefined") return;
  listening = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      lastHiddenAt = Date.now();
      return;
    }
    lastShownAt = Date.now();
    for (const resume of [...onShown]) resume();
  });
}

const pageHidden = (): boolean => typeof document !== "undefined" && document.visibilityState === "hidden";

/**
 * Settle with `pending`, or reject with `new Error(message)` once `ms` of
 * VISIBLE, unfrozen time has passed without an answer. The timer is cleared
 * as soon as either side settles.
 */
export function raceVisibleDeadline<T>(pending: PromiseLike<T>, ms: number, message: string): Promise<T> {
  listen();
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let windowStart = Date.now();
    let dueAt = windowStart + ms;
    let waitForShow: (() => void) | null = null;
    let restarts = 0;

    const stop = () => {
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      if (waitForShow) onShown.delete(waitForShow);
    };

    const arm = (delay: number) => {
      dueAt = Date.now() + delay;
      timer = setTimeout(check, delay);
    };

    function check(): void {
      if (settled) return;
      const now = Date.now();
      if (pageHidden()) {
        // Put away right now: start over when the page comes back. The timer
        // is re-armed too (free while hidden: frozen or throttled), so the
        // wait still settles if a WebView never delivers the "shown" event.
        if (!waitForShow) {
          waitForShow = () => {
            if (waitForShow) onShown.delete(waitForShow);
            waitForShow = null;
            if (settled) return;
            if (timer !== undefined) clearTimeout(timer);
            windowStart = Date.now();
            arm(ms);
          };
          onShown.add(waitForShow);
        }
        arm(ms);
        return;
      }
      const frozen = now - dueAt > FROZEN_SLACK_MS;
      const wentHidden = lastHiddenAt >= windowStart;
      if ((frozen || wentHidden) && restarts < MAX_RESTARTS) {
        // The page was away for part of this window: the clock starts again
        // from when it came back (now, if no "shown" event has arrived yet).
        // Capped, so long tasks at every due time cannot restart it forever.
        restarts += 1;
        windowStart = !frozen && lastShownAt > lastHiddenAt ? lastShownAt : now;
        const left = ms - (now - windowStart);
        if (left > 0) {
          arm(left);
          return;
        }
      }
      stop();
      reject(new Error(message));
    }

    arm(ms);
    Promise.resolve(pending).then(
      (value) => {
        if (settled) return;
        stop();
        resolve(value);
      },
      (err: unknown) => {
        if (settled) return;
        stop();
        reject(err);
      },
    );
  });
}

/** Test-only: forget the visibility history so one test cannot feed the next. */
export function __resetVisibleDeadlineForTests(): void {
  lastHiddenAt = Number.NEGATIVE_INFINITY;
  lastShownAt = Number.NEGATIVE_INFINITY;
  onShown.clear();
}
