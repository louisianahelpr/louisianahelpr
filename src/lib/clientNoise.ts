/**
 * Errors the page's ENVIRONMENT throws, never a line of ours: a link-preview
 * crawler, a host app's injected bridge, a browser refusing a service worker.
 * report() (src/lib/errorLogger.ts) drops them before they reach error_logs,
 * and Sentry's beforeSend (src/lib/sentry.ts isBenignEvent) drops them too,
 * so neither the weekly Sentry report nor the prod-errors issue counts them.
 *
 * Each entry is a measured prod row (read-only SQL on error_logs, 2026-11-14,
 * the 8 days to then), not a guess at one:
 *   · "Object Not Found Matching Id:N, MethodName:update, ParamCount:4": 124
 *     rows, all guests, no stack, from just 2 guest fingerprints under 8
 *     rotating user agents, on /sponsor and /. The string is the Microsoft
 *     Outlook / Safe Links link-preview crawler's own (it scans links pasted
 *     in mail); no code of ours or our libraries contains it.
 *   · "Error invoking postMessage: Java object is gone": 5 rows from an
 *     Android in-app WebView (Q1604: Facebook's browser throws it from its own
 *     iabjs:// scripts).
 *   · "Failed to register a ServiceWorker ...": 6 rows (a 403 on /sw.js from a
 *     proxy, an Opera refusal). Offline support is an extra; the registration
 *     in main.tsx catches its own failure, this covers a cached older page.
 *   · "null is not an object (evaluating 't.themes')": 76 rows from ONE
 *     iPhone Safari visitor in 3 minutes on 2026-11-10, all unhandled
 *     rejections with no stack. Nothing we ship reads `.themes`: no source
 *     file, no dependency, and no chunk of the live build (every JS file
 *     reachable from www's index.html, fetched and searched 2026-11-14). It is
 *     an injected script (a Safari extension) on that phone.
 */
const ENVIRONMENT_NOISE: RegExp[] = [
  /Object Not Found Matching Id:\d+, MethodName:\w+, ParamCount:\d+/,
  /Java object is gone/,
  /Failed to register a ServiceWorker/,
  /evaluating '[a-z]\.themes'/,
];

/** True when this message is one of the environment's own errors above. */
export function isEnvironmentNoiseMessage(message: string | null | undefined): boolean {
  if (!message) return false;
  return ENVIRONMENT_NOISE.some((re) => re.test(message));
}

/** Test seam: how many patterns there are (the guard's inventory floor). */
export const ENVIRONMENT_NOISE_COUNT = ENVIRONMENT_NOISE.length;
