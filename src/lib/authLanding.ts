/**
 * The boot half of the session-loss diagnostics (Q1596): the landing URL's auth shape, read once at module
 * evaluation, and the auth events since load. It imports nothing (no Supabase): main.tsx imports it THIRD, so the
 * landing URL is read before the Supabase client module can detect and strip it. The report itself
 * (authDiagnostics.ts: the in-app browser table and the report fields) is read only when a report is sent, so it
 * stays off the boot chunk (Builder 2, 11-15; src/test/bootSkipsLateHelpers.test.ts).
 */

type LandingAuthKind = "code" | "access_token" | "token_hash" | "error";

export interface LandingAuthHint {
  /** True when the URL this page loaded with carried a sign-in token of any kind. */
  hadAuthToken: boolean;
  /** Which kind; never the value. */
  kind: LandingAuthKind | null;
  /** The `type=` the link named (signup, magiclink, recovery, ...), when it named one. */
  linkType: string | null;
  /** Path only, no query or fragment (both can hold the token). */
  path: string;
}

/** Read the landing URL's auth shape. Pure; never returns a token value. */
export function readLandingAuthHint(search: string, hash: string, path: string): LandingAuthHint {
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const h = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const has = (k: string) => q.has(k) || h.has(k);
  let kind: LandingAuthKind | null = null;
  if (has("access_token")) kind = "access_token";
  else if (has("code")) kind = "code";
  else if (has("token_hash")) kind = "token_hash";
  else if (has("error_code") || has("error_description")) kind = "error";
  const rawType = q.get("type") ?? h.get("type");
  const linkType = rawType && /^[a-z_]{1,24}$/.test(rawType) ? rawType : null;
  return { hadAuthToken: kind !== null && kind !== "error", kind, linkType, path };
}

export const loadedAt = typeof performance !== "undefined" && typeof performance.now === "function" ? () => Math.round(performance.now()) : () => 0;

let landing: LandingAuthHint = { hadAuthToken: false, kind: null, linkType: null, path: "" };
try {
  if (typeof window !== "undefined" && window.location) {
    landing = readLandingAuthHint(window.location.search, window.location.hash, window.location.pathname);
  }
} catch {
  // Diagnostics only: an unreadable location leaves the empty hint.
}

/** The landing hint captured once, at module evaluation. */
export function landingAuthHint(): LandingAuthHint {
  return landing;
}

/** Test seam: replace the captured landing hint. */
export function setLandingAuthHintForTest(next: LandingAuthHint): void {
  landing = next;
}

const MAX_EVENTS = 16;
const events: Array<{ event: string; ms: number }> = [];

/** Record one auth event (event name and ms since page load), newest last, last 16 kept. */
export function noteAuthEventForDiagnostics(event: string, ms: number = loadedAt()): void {
  events.push({ event, ms });
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
}

/** Test seam. */
export function resetAuthEventsForTest(): void {
  events.length = 0;
}

/** The auth events noted since load, oldest first (a copy). */
export function authEventsSinceLoad(): Array<{ event: string; ms: number }> {
  return events.slice();
}
