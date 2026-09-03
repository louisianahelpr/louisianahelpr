import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The cache wipe on sign-out, tested by BEHAVIOUR.
 *
 * This exists because the wipe was unreachable in production and every test in
 * the repo passed anyway. `queryClient.clear()` and `removePersistedClient()`
 * are the only two calls in the whole codebase that stop the next person on a
 * shared device rehydrating the previous user's data, and they lived inside
 * `main.tsx`'s analytics bootstrap: behind five dynamic imports, behind a
 * first-interaction gate, inside a `try` with an empty `catch`. `vite.config.ts`
 * names those chunks `sentry-*.js` and `posthog-*.js`, so a content blocker was
 * enough to remove the listener entirely — and sign-out still looked normal.
 *
 * So these assertions are on OBSERVED CALLS, never on where the code sits.
 */

const signOut = vi.fn(async (_options?: unknown) => ({ error: null }));
const getUser = vi.fn(async () => ({ data: { user: { id: "u1" } } }));
const clear = vi.fn();
const removePersistedClient = vi.fn(async () => {});
const unregisterPushOnSignOut = vi.fn(async () => {});
const clearRememberedRoute = vi.fn();
const order: string[] = [];

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getUser: () => getUser(),
      signOut: (o?: unknown) => {
        order.push("signOut");
        return signOut(o as never);
      },
    },
  },
}));
vi.mock("@/lib/queryClient", () => ({
  queryClient: {
    clear: () => {
      order.push("clear");
      clear();
    },
  },
}));
vi.mock("@/lib/queryPersister", () => ({
  removePersistedClient: () => {
    order.push("removePersisted");
    return removePersistedClient();
  },
}));
vi.mock("@/lib/nativePush", () => ({ unregisterPushOnSignOut }));
vi.mock("@/lib/lastRoute", () => ({ clearRememberedRoute }));

beforeEach(() => {
  order.length = 0;
  vi.clearAllMocks();
});

describe("signOutWithPushCleanup", () => {
  it("wipes both caches", async () => {
    const { signOutWithPushCleanup } = await import("./authSignOut");
    await signOutWithPushCleanup();
    expect(clear).toHaveBeenCalledTimes(1);
    expect(removePersistedClient).toHaveBeenCalledTimes(1);
  });

  it("wipes AFTER signOut, so an in-flight query cannot repopulate with a live session", async () => {
    const { signOutWithPushCleanup } = await import("./authSignOut");
    await signOutWithPushCleanup();
    expect(order.indexOf("signOut")).toBeLessThan(order.indexOf("clear"));
    expect(order.indexOf("signOut")).toBeLessThan(order.indexOf("removePersisted"));
  });

  it("still signs out, and still wipes, when push cleanup throws", async () => {
    unregisterPushOnSignOut.mockRejectedValueOnce(new Error("offline"));
    const { signOutWithPushCleanup } = await import("./authSignOut");
    await signOutWithPushCleanup();
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it("LOGS rather than swallows when the persisted delete fails — a silent failure here IS the leak", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    removePersistedClient.mockRejectedValueOnce(new Error("idb blocked"));
    const { signOutWithPushCleanup } = await import("./authSignOut");
    await expect(signOutWithPushCleanup()).resolves.toBeDefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("does not import sentry or posthog — the wipe must not ride on analytics", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(resolve(process.cwd(), "src/lib/authSignOut.ts"), "utf8");
    // The coupling IS the bug this file exists for, so it is asserted directly.
    expect(src).not.toMatch(/from\s+["'][^"']*(sentry|posthog)/i);
  });
});
