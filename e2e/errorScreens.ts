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
  { name: "generic failure copy", re: /Something went wrong/i },
  { name: "retired 'Update ready' screen", re: /Update ready|A newer version of the app/i },
  { name: "boot watchdog failure", re: /Helpr couldn't load/i },
  { name: "account load failure (ProtectedRoute)", re: /We couldn't load your account/i },
  { name: "section/data load failure", re: /\bCouldn't load\b|\bWe couldn't load\b/i },
  { name: "404 on a real route", re: /Page Not Found/i },
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
