/**
 * Unit tests never talk to prod Supabase (Q55a).
 *
 * vitest.config.ts `test.env` gives the app's Supabase client a URL so
 * createClient() does not throw at import. Until 2026-09-23 that URL was
 * PROD, so any spec that rendered a component without mocking its data
 * layer (Messages → src/lib/pinnedConversations.ts / archivedConversations.ts)
 * sent real requests: ~4,190/day `invalid input syntax for type uuid: "user-1"`
 * in the prod Postgres logs, user-agent `node`.
 *
 * Installed from src/test/setup.ts (the one setupFile every spec loads), so
 * no spec can opt out by omission. Every request to a Supabase host by
 * fetch, XMLHttpRequest or WebSocket is REFUSED (the call rejects/throws with
 * an Error naming the URL and the spec) AND RECORDED; afterEach fails the test
 * that made it, so a leak whose rejection the app code swallows (most of them:
 * a React Query error state renders fine) still turns the spec red.
 *
 * Opt-in for a deliberate live test: add a `// @live-prod: <reason>` line to
 * the spec AND an entry to LIVE_PROD_ALLOWLIST below. The two are checked
 * against each other both ways by src/test/prodNetworkGuard.test.ts.
 */
import { afterAll, afterEach, expect } from "vitest";

/**
 * Spec path (repo-relative) → why it must reach prod. EMPTY on 2026-09-23: the
 * full unit suite was run with the guard on and no spec needed a real
 * response (every one that reached Supabase did so by accident).
 */
// @two-way src/test/prodNetworkGuard.test.ts:stale LIVE_PROD_ALLOWLIST entry
export const LIVE_PROD_ALLOWLIST: Readonly<Record<string, string>> = {};

const LIVE_PROD_MARKER = "@live-prod:";

/** The host the app's Supabase client is configured with in unit tests (vitest.config.ts test.env). */
function configuredClientHost(): string | null {
  try {
    return new URL(String(import.meta.env.VITE_SUPABASE_URL)).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Any Supabase-hosted project, or whatever host the unit-test client is pointed at. */
export function isGuardedHost(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return /(^|\.)supabase\.(co|in|com)$/.test(host) || host === configuredClientHost();
}

function urlOf(input: unknown): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  if (input && typeof input === "object" && "url" in input) return String((input as { url: unknown }).url);
  return String(input);
}

function currentSpec(): string {
  const p = (expect.getState() as { testPath?: string }).testPath ?? "";
  const i = p.lastIndexOf("/src/");
  return i >= 0 ? p.slice(i + 1) : p || "<unknown spec>";
}

function specIsAllowed(spec: string): boolean {
  return Object.prototype.hasOwnProperty.call(LIVE_PROD_ALLOWLIST, spec);
}

const leaks: string[] = [];

function refuse(kind: string, url: string): Error | null {
  const spec = currentSpec();
  if (!isGuardedHost(url) || specIsAllowed(spec)) return null;
  const msg =
    `[prodNetworkGuard] ${kind} to ${url} from ${spec} refused: unit tests must not reach Supabase. ` +
    `Mock the data layer (vi.mock the src/lib module or @/integrations/supabase/client), or if this spec ` +
    `is deliberately live add "// ${LIVE_PROD_MARKER} <reason>" and a LIVE_PROD_ALLOWLIST entry in src/test/prodNetworkGuard.ts.`;
  leaks.push(msg);
  return new Error(msg);
}

/** Drain and return the leaks recorded so far (used by the guard's own test). */
export function takeRecordedLeaks(): string[] {
  return leaks.splice(0, leaks.length);
}

export function installProdNetworkGuard(): void {
  const g = globalThis as typeof globalThis & { __lhProdNetworkGuard?: boolean };
  if (g.__lhProdNetworkGuard) return;
  g.__lhProdNetworkGuard = true;

  if (typeof g.fetch === "function") {
    const realFetch = g.fetch;
    g.fetch = function guardedFetch(this: unknown, input: RequestInfo | URL, init?: RequestInit) {
      const err = refuse("fetch", urlOf(input));
      if (err) return Promise.reject(err);
      return realFetch.call(this, input, init);
    } as typeof fetch;
  }

  if (typeof g.XMLHttpRequest === "function") {
    const realOpen = g.XMLHttpRequest.prototype.open;
    g.XMLHttpRequest.prototype.open = function guardedOpen(this: XMLHttpRequest, ...args: unknown[]) {
      const err = refuse("XMLHttpRequest", urlOf(args[1]));
      if (err) throw err;
      return (realOpen as (...a: unknown[]) => void).apply(this, args);
    } as typeof realOpen;
  }

  if (typeof g.WebSocket === "function") {
    const RealWebSocket = g.WebSocket;
    const Guarded = function GuardedWebSocket(url: string | URL, protocols?: string | string[]) {
      const err = refuse("WebSocket", urlOf(url));
      if (err) throw err;
      return new RealWebSocket(url, protocols);
    } as unknown as typeof WebSocket;
    Object.setPrototypeOf(Guarded, RealWebSocket);
    (Guarded as unknown as { prototype: WebSocket }).prototype = RealWebSocket.prototype;
    g.WebSocket = Guarded;
  }

  const failOnLeaks = () => {
    const found = takeRecordedLeaks();
    if (found.length) throw new Error(`${found.length} prod Supabase request(s) refused:\n${found.join("\n")}`);
  };
  afterEach(failOnLeaks);
  afterAll(failOnLeaks);
}
