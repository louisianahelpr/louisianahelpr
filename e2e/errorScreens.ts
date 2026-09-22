/**
 * EVERY way a screen can be an error instead of the screen (owner, 2026-09-12:
 * "make sure no screens hit an error page, no update ready pages, anything like
 * that — this needs to be perfect"). One list, used by every harness: the
 * visual sweep, press-every-control, the stale-deploy spec and the journeys.
 * A new error surface added to the app gets a line here, or no check sees it.
 *
 * Erasable TypeScript only, so the Node harnesses can import it directly.
 */
export const ERROR_SCREEN_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "route crash (RouteErrorBoundary)", re: /This page hit a problem/i },
  { name: "app crash (ErrorBoundary)", re: /Something went sideways/i },
  /*
   * ANCHORED, and case-sensitive on the capital S. `/Something went wrong/i`
   * matched any prose containing the phrase, and on 2026-09-21 that made
   * 02-marketplace's apply step report an "error screen" on /dashboard whose
   * actual excerpt was "…message your Helpr, or report a problem if something
   * went wrong." — the notification surface's own legitimate copy. J3 through
   * J5 of that journey were dead behind it.
   *
   * Left in rather than deleted, because the owner's instruction behind this
   * list is that every error surface gets a line. But note what the app really
   * renders: ErrorState's title is "We couldn't load this.", already covered by
   * "section/data load failure" below, and "Something went wrong" appears
   * nowhere in src/ except comments. So this line exists for a surface we do
   * not currently paint — a third party or an edge-function body — and it only
   * needs to fire when the phrase IS the message, not when it is the tail of
   * someone's sentence.
   */
  { name: "generic failure copy", re: /(?:^|[.!?]\s+|\n\s*)Something went wrong/ },
  { name: "retired 'Update ready' screen", re: /Update ready|A newer version of the app/i },
  { name: "boot watchdog failure", re: /Helpr couldn't load/i },
  { name: "account load failure (ProtectedRoute)", re: /We couldn't load your account/i },
  { name: "section/data load failure", re: /\bCouldn't load\b|\bWe couldn't load\b/i },
  { name: "404 on a real route", re: /Page Not Found/i },
  { name: "admin access gate (AdminRoute unknown)", re: /We couldn't verify your access/i },
];

export interface ErrorScreenFinding {
  name: string;
  excerpt: string;
}

/** Match body text against every pattern. `allow` names patterns expected on this screen (e.g. the 404 route). */
export function findErrorScreen(text: string, allow: string[] = []): ErrorScreenFinding | null {
  for (const p of ERROR_SCREEN_PATTERNS) {
    if (allow.includes(p.name)) continue;
    const m = p.re.exec(text);
    if (m) {
      const i = Math.max(0, m.index - 40);
      return { name: p.name, excerpt: text.slice(i, i + 140).replace(/\s+/g, " ") };
    }
  }
  return null;
}

/**
 * A screen that never finished loading is an error too: blank body, or
 * loading placeholders still present. Run in the page.
 */
export function detectStuckOrBlank(): string | null {
  const text = (document.body?.innerText ?? "").trim();
  if (text.length < 20) return `blank page (${text.length} chars of text)`;
  if (document.getElementById("boot-loader")) return "boot loader still showing";
  const busy = document.querySelectorAll('[aria-busy="true"]').length;
  const pulses = [...document.querySelectorAll('[class*="animate-pulse"]')].filter((e) => !e.closest("[aria-hidden='true']")).length;
  if (busy || pulses) return `still loading (${busy} aria-busy, ${pulses} skeleton pulses)`;
  return null;
}
