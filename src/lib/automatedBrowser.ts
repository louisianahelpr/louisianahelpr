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
