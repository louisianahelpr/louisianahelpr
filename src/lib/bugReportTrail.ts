/**
 * The boot half of "Report a bug" (Q1028): the last errors errorLogger reported and the last screen the person was
 * on, kept in memory for bugReportContext.ts to attach when a report is written. Split out (Builder 2, 11-15):
 * errorLogger runs on every page's boot, and importing bugReportContext put the report's text building in
 * app-shared, the chunk every page boots with. This file imports nothing; src/test/bootSkipsLateHelpers.test.ts
 * keeps the support half off boot.
 */

export const MAX_RECENT_ERRORS = 10;
const MAX_ERROR_CHARS = 200;

export interface RecentError {
  /** ISO time it was reported. */
  at: string;
  message: string;
}

const recent: RecentError[] = [];
let lastScreen: { route: string; title: string } | null = null;

/** Screens that ARE the bug report, never the screen being reported. */
export function isSupportScreen(pathname: string, search = ""): boolean {
  if (pathname === "/support" || pathname === "/help") return true;
  return pathname === "/profile" && new URLSearchParams(search).get("tab") === "support";
}

/** The route with query VALUES dropped: `/profile?tab=security` keeps its tab, never an id or token. */
export function routeLabel(pathname: string, search = ""): string {
  const params = new URLSearchParams(search);
  const keep = ["tab", "filter", "view"];
  const shown = [...params.keys()].filter((k) => keep.includes(k)).map((k) => `${k}=${params.get(k)}`);
  const other = [...params.keys()].filter((k) => !keep.includes(k));
  return `${pathname}${shown.length ? `?${shown.join("&")}` : ""}${other.length ? ` (+${other.length} param${other.length > 1 ? "s" : ""})` : ""}`;
}

/** errorLogger calls this with the message it already redacted. */
export function noteRecentError(message: string, now: Date = new Date()): void {
  const text = message.trim().slice(0, MAX_ERROR_CHARS);
  if (!text) return;
  recent.push({ at: now.toISOString(), message: text });
  while (recent.length > MAX_RECENT_ERRORS) recent.shift();
}

/** The route tracker calls this once a screen has settled (its title is set). */
export function noteScreen(pathname: string, search: string, title: string): void {
  if (isSupportScreen(pathname, search)) return;
  lastScreen = { route: routeLabel(pathname, search), title: title.trim() };
}

/** The errors noted so far, oldest first (a copy). */
export function recentErrors(): RecentError[] {
  return [...recent];
}

/** The last screen noted, or null. */
export function lastScreenNoted(): { route: string; title: string } | null {
  return lastScreen;
}

/** Test seam (bugReportContext's _resetBugReportContext). */
export function resetBugReportTrail(): void {
  recent.length = 0;
  lastScreen = null;
}
