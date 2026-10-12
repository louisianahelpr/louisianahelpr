/**
 * No read in src/ races a bare reject timer: a deadline counts only the time
 * the page could run (src/lib/visibleDeadline.ts).
 *
 * The class: a wall-clock timer that ENDS a network wait: a timer that rejects
 * (`setTimeout(() => reject(...))`), aborts (`setTimeout(() => c.abort())`,
 * `AbortSignal.timeout(...)`) or resolves a timeout sentinel
 * (`setTimeout(() => resolve(TIMED_OUT))` in a Promise.race).
 * On a phone put away mid-read, iOS freezes the page, and on return the
 * overdue timer fires before the answer that is already on its way, so the
 * app reports (and shows) a timeout the server never caused. Measured
 * 2026-10-09/10: "Profile request timed out" and "notifications load timed
 * out after 15000ms" (ledger 4937f4e1c62a, 6cc892e3fa10), server answers in
 * 140-360 ms. Every such deadline goes through raceVisibleDeadline instead.
 *
 * ALLOWED is exact, both ways: each entry must still hold such a timer (a
 * stale entry fails), and every file that holds one must be listed.
 * (Review of the first cut: abort and sentinel timers were not seen, and
 * useMapKitJs's abort produced the "Fetch is aborted" MapKit row beside the
 * 2026-10-09 profile timeout.)
 *
 * @mutate src/hooks/useCurrentUser.ts |   raceVisibleDeadline(promise, ms, PROFILE_TIMEOUT_MESSAGE); |   new Promise<T>((_, reject) => window.setTimeout(() => reject(new Error(PROFILE_TIMEOUT_MESSAGE)), ms));
 * @mutate src/hooks/useMapKitJs.ts |       SERVER_TOKEN_TIMEOUT_MS,\n      "mapkit-token timed out",\n    ) | SERVER_TOKEN_TIMEOUT_MS, "late", setTimeout(() => controller.abort(), 1))
 * @mutate src/components/notificationPanel/notificationFeed.ts |   raceVisibleDeadline(pending, LOAD_TIMEOUT_MS, `notifications load timed out after ${LOAD_TIMEOUT_MS}ms`); |   new Promise<T>((_, reject) => { setTimeout(() => reject(new Error("late")), LOAD_TIMEOUT_MS); void pending; });
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { trackedFiles } from "./helpers/trackedFiles";

const REPO = resolve(__dirname, "../..");

/**
 * Files that keep a plain wall-clock timer, each for a stated reason. None is
 * a background read: each is a wait the person started and is watching, an
 * app launch they are looking at, or no network read at all.
 */
// @two-way src/test/readDeadlinesCountVisibleTime.test.ts:stale allowlist entry
const ALLOWED: Record<string, string> = {
  // Log In: the person just tapped the button and is looking at the spinner.
  "src/lib/loginTransport.ts": "foreground sign-in the person is watching",
  // Finish your profile / sign-up uploads: a tapped submit with a 60 s cap.
  "src/pages/auth/completeProfile/constants.ts": "foreground submit the person is watching",
  // Local image decode / canvas encode: no network request to be frozen behind.
  "src/lib/imageCompression.ts": "on-device image work, not a network read",
  // "Use my location": the person tapped it and is looking at "Locating...".
  "src/components/postjob/CurrentLocationPill.tsx": "foreground lookup the person is watching",
  // Sign-out caps (3 s / 1.5 s): the person tapped Log Out.
  "src/lib/authSignOut.ts": "foreground sign-out the person is watching",
  // App launch: the first session read, while the person watches the app open.
  "src/hooks/useAuthReady.ts": "launch-time session read the person is watching",
  // Native launch: the Keychain hydrate cap, before the first screen.
  "src/integrations/supabase/keychainStorageAdapter.ts": "launch-time Keychain read, no network",
};

/** A timer callback: `() =>`, `(x) =>`, `x =>` or `function () {`. */
const CB = String.raw`(?:\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>|function\s*\([^)]*\))\s*\{?[^{}]{0,200}?`;
/** Every timer shape that ends a wait: reject, abort, or a timeout sentinel. */
const WAIT_ENDING_TIMERS = [
  new RegExp(String.raw`setTimeout\(\s*${CB}\b(?:reject|rej)\w*\(`),
  new RegExp(String.raw`setTimeout\(\s*(?:reject|rej)\w*\s*,`),
  new RegExp(String.raw`setTimeout\(\s*${CB}[\w$.]+\.abort\(`),
  /AbortSignal\.timeout\(/,
  new RegExp(String.raw`setTimeout\(\s*${CB}\bresolve\(`),
];
const REJECT_TIMER = { test: (src: string) => WAIT_ENDING_TIMERS.some((re) => re.test(src)) };

function filesWithRejectTimers(): string[] {
  return trackedFiles("src")
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f) && !f.includes("/test/"))
    .filter((f) => REJECT_TIMER.test(blankComments(readFileSync(resolve(REPO, f), "utf8"))))
    .sort();
}

describe("read deadlines count only visible time", () => {
  const found = filesWithRejectTimers();

  it("scans real source (inventory floor)", () => {
    expect(trackedFiles("src").filter((f) => /\.(ts|tsx)$/.test(f)).length).toBeGreaterThan(500);
    // The allowed files are found by the same pattern, so the pattern still matches real code.
    expect(found.length).toBeGreaterThan(2);
  });

  it("every reject timer in src/ is an allowed foreground wait; every other deadline uses raceVisibleDeadline", () => {
    expect(found.filter((f) => !(f in ALLOWED))).toEqual([]);
  });

  it("no allowlist entry outlives its reject timer", () => {
    const stale = Object.keys(ALLOWED)
      .filter((f) => !found.includes(f))
      .map((f) => `stale allowlist entry ${f}: it no longer races a reject timer; remove it from ALLOWED`);
    expect(stale).toEqual([]);
  });

  it("the reads behind the 2026-10-09/10 alerts go through raceVisibleDeadline", () => {
    for (const f of [
      "src/hooks/useCurrentUser.ts",
      "src/components/notificationPanel/notificationFeed.ts",
      "src/components/NotificationPanel.tsx",
      "src/hooks/useDashboardData.ts",
    ]) {
      const src = blankComments(readFileSync(resolve(REPO, f), "utf8"));
      expect(src, f).toMatch(/raceVisibleDeadline\(/);
    }
  });
});
