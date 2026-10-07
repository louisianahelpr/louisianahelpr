/**
 * "Report a bug" (docs/OPEN.md Q1028, owner 2026-10-07): what a bug report
 * carries automatically, TEXT ONLY (owner: no screen capture library):
 *
 *   - screen   the title of the screen the person was on before opening the
 *              support form (the form is a screen of its own)
 *   - route    that screen's path, with query VALUES dropped
 *   - viewport width x height in CSS px
 *   - platform ios | android | web, and the browser/device in a few words
 *   - build    the app's commit (the release the prod-errors issue names)
 *   - errors   the last 10 client errors errorLogger reported, already
 *              redacted there (tokens, keys, emails), each cut to 200 chars
 *
 * The person sees every item before sending (BugReportAttachments). Nothing
 * here imports a module that is not already on the boot path: errorLogger
 * calls noteRecentError() on every report.
 */

export const MAX_RECENT_ERRORS = 10;
const MAX_ERROR_CHARS = 200;

interface RecentError {
  /** ISO time it was reported. */
  at: string;
  message: string;
}

export interface BugReportContext {
  screen: string;
  route: string;
  viewport: string;
  platform: string;
  build: string;
  errors: RecentError[];
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

function platformLabel(): string {
  const cap = (globalThis as { Capacitor?: { getPlatform?: () => string } }).Capacitor;
  const platform = cap?.getPlatform?.() ?? "web";
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const device = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Macintosh/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "other";
  const browser = /Edg\//.test(ua) ? "Edge" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /FxiOS|Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "other";
  return platform === "web" ? `web (${device}, ${browser})` : `${platform} app (${device})`;
}

/** Everything a bug report attaches, read now. */
export function bugReportContext(): BugReportContext {
  const w = typeof window !== "undefined" ? window : undefined;
  return {
    screen: lastScreen?.title || "(no earlier screen in this visit)",
    route: lastScreen?.route ?? "(none)",
    viewport: w ? `${w.innerWidth} x ${w.innerHeight}` : "(unknown)",
    platform: platformLabel(),
    build: typeof __APP_COMMIT__ !== "undefined" ? __APP_COMMIT__ : "dev",
    errors: [...recent],
  };
}

/** The rows the person sees before sending. */
export function bugReportItems(ctx: BugReportContext): { label: string; value: string }[] {
  return [
    { label: "Screen", value: ctx.screen },
    { label: "Route", value: ctx.route },
    { label: "Screen size", value: ctx.viewport },
    { label: "Device", value: ctx.platform },
    { label: "App build", value: ctx.build },
    { label: "Recent errors", value: ctx.errors.length ? `${ctx.errors.length} (last ${MAX_RECENT_ERRORS} kept)` : "none" },
  ];
}

/** The text block appended to the report the support team reads. */
export function bugReportBlock(ctx: BugReportContext): string {
  const lines = [
    "--- Attached automatically ---",
    ...bugReportItems(ctx).map((i) => `${i.label}: ${i.value}`),
    ...ctx.errors.map((e, n) => `  ${n + 1}. ${e.at} ${e.message}`),
  ];
  return lines.join("\n");
}

/**
 * The person's message with the block after it, within `max` characters (the
 * server's own limit). Room is made by dropping the OLDEST errors first, then
 * by shortening the message; the block itself is never cut off.
 */
export function withBugReport(message: string, ctx: BugReportContext, max: number): string {
  let errors = [...ctx.errors];
  let block = bugReportBlock({ ...ctx, errors });
  while (`${message}\n\n${block}`.length > max && errors.length > 0) {
    errors = errors.slice(1);
    block = bugReportBlock({ ...ctx, errors });
  }
  const room = Math.max(0, max - block.length - 2);
  return `${message.slice(0, room)}\n\n${block}`;
}

/** Test seam. */
export function _resetBugReportContext(): void {
  recent.length = 0;
  lastScreen = null;
}
