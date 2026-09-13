/**
 * The screen the user is on, as an error-log tag value: pathname only, never
 * the query string (tokens land there). Every error SURFACE — the three
 * boundaries, ErrorState, the boot watchdog, money-action failures — tags
 * `screen` with this so the prod-errors alert (.github/workflows/
 * prod-errors.yml) can say which screen failed without reading `url`.
 *
 * Its own module, with no imports, so the many tests that partially mock
 * `@/lib/errorLogger` (`{ report: vi.fn() }`) keep working.
 */
export function currentScreen(): string {
  if (typeof window === "undefined") return "";
  return window.location.pathname.slice(0, 500);
}
