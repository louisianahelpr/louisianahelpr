/**
 * Q275: an automated browser never records a Session Replay.
 *
 * MEASURED 2026-09-23 (Sentry helpr-4m, last 30 days): 63 replays, the newest
 * 2026-09-14 (none since: "Replay Quota Exceeded"). 39 of the 63 carry a
 * Playwright build signature (Chrome/HeadlessChrome 151.0.7922 = Playwright
 * 1.62's bundled Chromium 151.0.7922.34; Mobile Safari 16.0 / 26.5 = its
 * iPhone descriptors); 45 were signed in as a shared test account and 3 more
 * were anonymous HeadlessChrome. Automation spent the replay quota. Errors are
 * different: 93 of 265 (35%) carry the same signature, so errors still report,
 * tagged `automated` so the share is exact from now on.
 *
 * `navigator.webdriver` is true under Playwright, Selenium and every other
 * WebDriver/CDP-automation launch, headed or headless, whatever user agent a
 * device descriptor fakes; a person's browser reports false.
 */
export function isAutomatedBrowser(): boolean {
  try {
    return typeof navigator !== "undefined" && navigator.webdriver === true;
  } catch {
    return false; // an unreadable navigator is treated as a person's browser
  }
}

/**
 * Q?analytics-test-traffic: why this session is NOT a person, or null.
 *
 * MEASURED 2026-10-15 on prod analytics_events (30 days): signup_started 4573
 * rows (4556 anonymous) and payment_made 2284 against ~35 real members; the
 * test robots wrote the funnel. Every automated session is tagged, never
 * dropped (journeys still assert events fire):
 *  - "webdriver": a Playwright/Selenium-launched browser (see above);
 *  - "flag": a harness that cannot rely on webdriver (Playwright attached over
 *    CDP to a normal Chrome reports false) sets localStorage `lh_automation`
 *    to "1" before the app loads;
 *  - a dev or preview build on http://localhost / 127.0.0.1 (the CI robots'
 *    LOCAL_PREVIEW_URL, still on the prod backend) is tagged by the DATABASE
 *    from the browser's Origin header, which page code cannot change, and
 *    never starts PostHog (isLocalDevOrigin). Not tagged here: unit tests run
 *    in jsdom on http://localhost and assert exact event properties;
 *  - "seed_user": the signed-in profile is a test profile (is_seed), marked
 *    by the boot path via markTestProfileSession().
 * The database tags the same rows again (tag_automated_analytics_event), so
 * an old build or a harness that forgot still lands tagged.
 */
export type AutomationReason = "webdriver" | "flag" | "seed_user";

const AUTOMATION_FLAG_KEY = "lh_automation";

let testProfileSession = false;

/** The boot path: true once the signed-in profile reads is_seed, false on sign-out. */
export function markTestProfileSession(isTestProfile = true): void {
  testProfileSession = isTestProfile;
}

export function automationReason(): AutomationReason | null {
  if (isAutomatedBrowser()) return "webdriver";
  try {
    if (typeof localStorage !== "undefined" && localStorage.getItem(AUTOMATION_FLAG_KEY) === "1") return "flag";
  } catch {
    /* storage blocked: no flag can have been set */
  }
  return testProfileSession ? "seed_user" : null;
}

/**
 * A dev or preview build served over plain http from this machine. The apps
 * are never http: (iOS capacitor://localhost, Android https://localhost).
 */
export function isLocalDevOrigin(): boolean {
  try {
    const { protocol, hostname } = window.location;
    return protocol === "http:" && (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]");
  } catch {
    return false; // no location: not a browser page
  }
}
