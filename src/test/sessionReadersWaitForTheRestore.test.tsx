/**
 * Q1463: synchronous readers of the stored Supabase session must not decide
 * "signed out" before the native Keychain restore has run.
 *
 * In the app, WebKit can evict localStorage; the session then survives only in
 * the Keychain and comes back through keychainStorageAdapter's ASYNC hydrate.
 * Supabase's own reads wait for it, but a synchronous localStorage probe made
 * first reads "no session" for a signed-in person (finding
 * lh-silent-failure@ac93c18b6#1): the guest page on a cold deep link to
 * /browse, the dock jumping in late, Senior Mode text jumping, and analytics
 * and error rows filed as anonymous.
 *
 * Part 1 drives each reader through the eviction case: native shell, empty
 * localStorage, the restore still pending, then the restore landing.
 * Part 2 is the class: every source file that reads the stored session
 * synchronously is listed below with how it handles the restore window, and
 * the list is exact both ways.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { renderHook, waitFor } from "@testing-library/react";
import { walkSource } from "./helpers/walkSource";
import { blankComments } from "./helpers/blankNonCode";

const REF = new URL(import.meta.env.VITE_SUPABASE_URL as string).hostname.split(".")[0];
const KEY = `sb-${REF}-auth-token`;
const USER_ID = "00000000-0000-0000-0000-0000000000aa";
const session = (meta: Record<string, unknown> = {}) => JSON.stringify({
  access_token: "restored-jwt",
  refresh_token: "rt",
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: USER_ID, user_metadata: meta },
});

/** The app after WebKit evicted localStorage: native, nothing stored, restore pending. */
async function nativeBeforeRestore() {
  localStorage.clear();
  (window as unknown as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true, getPlatform: () => "ios" };
  vi.resetModules();
  // Evaluated first, as on a device where the native bridge is there before
  // any script: in jsdom, @capacitor/core (imported by other modules) replaces
  // this stub with a web one.
  await import("@/lib/sessionKnown");
}
/** The Keychain restore landing: the session is back in localStorage, then the signal. */
async function restore(meta: Record<string, unknown> = {}) {
  localStorage.setItem(KEY, session(meta));
  const { markSessionKnown } = await import("@/lib/sessionKnown");
  markSessionKnown();
}
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

describe("readers of the stored session wait for the native restore (Q1463)", () => {
  let calls: { auth: string; body: unknown }[];
  beforeEach(() => {
    calls = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      calls.push({ auth: String((init.headers as Record<string, string>).Authorization), body: JSON.parse(String(init.body)) });
      return new Response(null, { status: 201 });
    }));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete (window as unknown as { Capacitor?: unknown }).Capacitor;
    localStorage.clear();
    document.documentElement.classList.remove("senior-mode");
  });

  // @mutate src/lib/restInsert.ts |   if (!sessionKnown()) await whenSessionKnown(); |
  it("restInsert: a row posted before the restore goes out with the restored session's token, not as anon", async () => {
    await nativeBeforeRestore();
    const { postRows } = await import("@/lib/restInsert");
    const sent = postRows("error_logs", ["message"], () => [{ message: "m" }]);
    await settle();
    expect(calls).toHaveLength(0);
    await restore();
    await sent;
    expect(calls).toHaveLength(1);
    expect(calls[0].auth).toBe("Bearer restored-jwt");
  });

  // @mutate src/lib/analytics.ts |     for (const r of batch) if (unattributed.delete(r)) r.user_id = id; |
  it("analytics: an event tracked before the restore is attributed to the restored user", async () => {
    vi.useFakeTimers();
    await nativeBeforeRestore();
    const { track } = await import("@/lib/analytics");
    track("app_open_probe");
    await restore();
    await vi.advanceTimersByTimeAsync(1_600);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body).toEqual([expect.objectContaining({ event: "app_open_probe", user_id: USER_ID })]);
  });

  // @mutate src/lib/persistedAuthToken.ts | export const definitelyGuest = (): boolean => sessionKnown() && !hasPersistedAuthToken(); | export const definitelyGuest = (): boolean => !hasPersistedAuthToken();
  it("the guest fast path (DashboardGuest) never decides 'guest' before the restore", async () => {
    await nativeBeforeRestore();
    const { definitelyGuest } = await import("@/lib/persistedAuthToken");
    expect(definitelyGuest()).toBe(false);
    await restore();
    expect(definitelyGuest()).toBe(false); // signed in after all
    localStorage.clear();
    expect(definitelyGuest()).toBe(true); // a real guest, once the store is readable
  });

  it("control: on the web the fast path answers at once", async () => {
    localStorage.clear();
    vi.resetModules();
    const { definitelyGuest } = await import("@/lib/persistedAuthToken");
    expect(definitelyGuest()).toBe(true);
  });

  // @mutate src/hooks/useStoredSessionHint.ts |     void whenSessionKnown().then(() => { if (live) setHint(hasPersistedAuthToken()); }); |
  it("the dock's session hint (MobileNav) turns on when the restore lands, without waiting for the network", async () => {
    await nativeBeforeRestore();
    const { useStoredSessionHint } = await import("@/hooks/useStoredSessionHint");
    const { result } = renderHook(() => useStoredSessionHint());
    expect(result.current).toBe(false);
    await restore();
    await waitFor(() => expect(result.current).toBe(true));
  });

  // @mutate src/lib/simpleMode.ts |   if (!sessionKnown()) void whenSessionKnown().then(reapplyAfterRestore); |
  it("Senior Mode from the restored session applies once the restore lands", async () => {
    await nativeBeforeRestore();
    const { initSimpleMode } = await import("@/lib/simpleMode");
    initSimpleMode();
    expect(document.documentElement.classList.contains("senior-mode")).toBe(false);
    await restore({ senior_mode: true });
    await waitFor(() => expect(document.documentElement.classList.contains("senior-mode")).toBe(true));
  });
});

/**
 * THE CLASS. Every non-test source file that reads the persisted session
 * synchronously (the `sb-…-auth-token` key, or a probe of it), and why its
 * read is safe in the native restore window. "waits" files must use the
 * sessionKnown signal; the others say why they need not.
 */
const READERS: Record<string, string> = {
  // Waits for the restore (the Q1463 fixes):
  "src/lib/restInsert.ts": "waits",
  "src/lib/analytics.ts": "waits",
  "src/lib/simpleMode.ts": "waits",
  "src/lib/persistedAuthToken.ts": "waits", // definitelyGuest(); hasPersistedAuthToken stays the raw probe
  "src/hooks/useStoredSessionHint.ts": "waits",
  "src/lib/signedInRequestGuard.ts": "waits: awaits the auth client's own storage adapter (getItem), the store auth-js reads; it only names the key",
  // Read only through the waiting helpers above:
  "src/pages/home/DashboardGuest.tsx": "via definitelyGuest()",
  "src/components/MobileNav.tsx": "via useStoredSessionHint()",
  // Web only: the native app never reaches the read.
  "src/components/MarketingRedirect.tsx": "web only: gated on !isNativePlatform",
  "src/lib/prePaintShellClasses.ts": "web only: the value only matters with web-desktop, which native never sets",
  "src/hooks/useAppShellViewport.ts": "web only: the rail inset needs web-desktop, which native never sets",
  "src/boot/entryAuthRefresh.ts": "web only: isNativeShell() returns first",
  // A hint whose wrong guess costs a chunk download, nothing a person sees:
  "src/boot/routePreload.ts": "preload hint: a wrong guess fetches the other route's chunk",
  "src/boot/guestJobsPrefetch.ts": "prefetch hint: a wrong guess fetches the guest job list once",
  "src/entry.ts": "prefetch hint: hasToken() picks which next routes to warm",
  // Read after the restore by construction:
  "src/hooks/useAuthReady.ts": "after the restore: read only once AUTH_BOOTSTRAP_TIMEOUT_MS (2.5 s) passed, past the 2 s hydrate cap",
  "src/main.tsx": "after the restore: read inside onAuthStateChange, which auth-js emits after its storage read",
  // Writers / the store itself:
  "src/integrations/supabase/keychainStorageAdapter.ts": "the store: writes the restore and marks it known",
};

const PROBE = /-auth-token|hasPersistedAuthToken|\bhasToken\(|definitelyGuest|useStoredSessionHint/;

describe("every synchronous reader of the stored session is accounted for (Q1463)", () => {
  const root = process.cwd();
  const files = walkSource([`${root}/src`])
    .map((f) => relative(root, f))
    .filter((f) => !/\.test\.tsx?$/.test(f) && !f.startsWith("src/test/") && !f.includes("/__tests__/"));
  const readers = files.filter((f) => PROBE.test(blankComments(readFileSync(`${root}/${f}`, "utf8"))));

  it("the inventory is exact both ways", () => {
    expect(readers.length).toBeGreaterThan(12);
    expect([...readers].sort()).toEqual(Object.keys(READERS).sort());
  });

  // @mutate src/pages/home/DashboardGuest.tsx | useState(definitelyGuest); | useState(() => !Object.keys(localStorage).some((k) => /^sb-.+-auth-token$/.test(k)));
  it("a reader that goes 'via' a waiting helper does not also read the store raw", () => {
    for (const [file, how] of Object.entries(READERS)) {
      if (!how.startsWith("via ")) continue;
      const code = blankComments(readFileSync(`${root}/${file}`, "utf8"));
      expect(/-auth-token|hasPersistedAuthToken|\bhasToken\(/.test(code), file).toBe(false);
    }
  });

  it("each 'waits' reader uses the restore signal", () => {
    for (const [file, how] of Object.entries(READERS)) {
      if (how !== "waits") continue;
      const code = blankComments(readFileSync(`${root}/${file}`, "utf8"));
      expect(/\bsessionKnown\(|\bwhenSessionKnown\(/.test(code), file).toBe(true);
    }
  });
});
