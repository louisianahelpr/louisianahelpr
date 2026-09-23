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

/**
 * `tags.kind` on every error_logs row that means "a person was shown an error
 * screen" (the boundaries, ErrorState, the boot watchdog, the pane-level
 * error cards via <ReportErrorScreen>). The database keys on it: trigger
 * trg_error_logs_zz_user_error_screen (migration 20260923085642) turns a
 * non-seed person's row into an ops alert ledger item, fingerprinted by
 * screen + message (docs/OPEN.md Q39). src/test/errorSurfacesReport.test.tsx
 * proves every surface sends it.
 */
export const USER_ERROR_SCREEN = "user-error-screen";
