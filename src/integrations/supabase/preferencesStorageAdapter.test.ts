// preferencesStorageAdapter has module-level state (a Map cache + a
// hydratePromise IIFE that reads Preferences). Tests use vi.resetModules
// + dynamic import per test so each scenario gets a fresh adapter
// instance and a fresh hydrate run.

import { describe, it, expect, vi, beforeEach } from "vitest";

const isNativePlatformMock = vi.fn();
const prefsKeysMock = vi.fn();
const prefsGetMock = vi.fn();
const prefsSetMock = vi.fn();
const prefsRemoveMock = vi.fn();

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => isNativePlatformMock(),
  },
}));

vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    keys: () => prefsKeysMock(),
    get: (...args: unknown[]) => prefsGetMock(...args),
    set: (...args: unknown[]) => prefsSetMock(...args),
    remove: (...args: unknown[]) => prefsRemoveMock(...args),
  },
}));

const AUTH_KEY = "sb-fncmgoasalhdgfwzhsqa-auth-token";
const NON_AUTH_KEY = "helpr_draft_job";

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  isNativePlatformMock.mockReset();
  prefsKeysMock.mockReset();
  prefsGetMock.mockReset();
  prefsSetMock.mockReset();
  prefsRemoveMock.mockReset();
  prefsSetMock.mockResolvedValue(undefined);
  prefsRemoveMock.mockResolvedValue(undefined);
});

async function loadAdapter() {
  // Dynamic import so module-level state is fresh per test
  const mod = await import("./preferencesStorageAdapter");
  await mod.hydratePromise;
  return mod;
}

describe("preferencesStorageAdapter — web (isNativePlatform=false)", () => {
  beforeEach(() => {
    isNativePlatformMock.mockReturnValue(false);
  });

  it("hydrate is a no-op on web — no Preferences calls", async () => {
    await loadAdapter();
    expect(prefsKeysMock).not.toHaveBeenCalled();
    expect(prefsGetMock).not.toHaveBeenCalled();
  });

  it("setItem writes to localStorage but NOT to Preferences", async () => {
    const { preferencesStorageAdapter } = await loadAdapter();
    preferencesStorageAdapter.setItem(AUTH_KEY, "jwt-value");
    expect(localStorage.getItem(AUTH_KEY)).toBe("jwt-value");
    expect(prefsSetMock).not.toHaveBeenCalled();
  });

  it("getItem reads from localStorage", async () => {
    const { preferencesStorageAdapter } = await loadAdapter();
    localStorage.setItem(AUTH_KEY, "jwt-from-ls");
    expect(preferencesStorageAdapter.getItem(AUTH_KEY)).toBe("jwt-from-ls");
  });

  it("removeItem clears localStorage but NOT Preferences", async () => {
    const { preferencesStorageAdapter } = await loadAdapter();
    localStorage.setItem(AUTH_KEY, "jwt");
    preferencesStorageAdapter.removeItem(AUTH_KEY);
    expect(localStorage.getItem(AUTH_KEY)).toBeNull();
    expect(prefsRemoveMock).not.toHaveBeenCalled();
  });
});

describe("preferencesStorageAdapter — native (isNativePlatform=true)", () => {
  beforeEach(() => {
    isNativePlatformMock.mockReturnValue(true);
  });

  it("hydrate copies auth-token keys from Preferences into localStorage + cache", async () => {
    prefsKeysMock.mockResolvedValue({ keys: [AUTH_KEY] });
    prefsGetMock.mockResolvedValue({ value: "restored-jwt" });

    const { preferencesStorageAdapter } = await loadAdapter();
    expect(localStorage.getItem(AUTH_KEY)).toBe("restored-jwt");
    // Cache wins on read even if localStorage is wiped after hydrate
    localStorage.removeItem(AUTH_KEY);
    expect(preferencesStorageAdapter.getItem(AUTH_KEY)).toBe("restored-jwt");
  });

  it("hydrate skips non-auth-token keys", async () => {
    prefsKeysMock.mockResolvedValue({ keys: [NON_AUTH_KEY, AUTH_KEY] });
    prefsGetMock.mockImplementation(async (arg: { key: string }) =>
      arg.key === AUTH_KEY ? { value: "auth-jwt" } : { value: "draft" },
    );

    await loadAdapter();
    // Only auth key got hydrated
    expect(localStorage.getItem(AUTH_KEY)).toBe("auth-jwt");
    expect(localStorage.getItem(NON_AUTH_KEY)).toBeNull();
    // Preferences.get only called for the auth-token key
    expect(prefsGetMock).toHaveBeenCalledTimes(1);
    expect(prefsGetMock).toHaveBeenCalledWith({ key: AUTH_KEY });
  });

  it("hydrate handles Preferences errors gracefully", async () => {
    prefsKeysMock.mockRejectedValue(new Error("Preferences unavailable"));
    // Should not throw
    await expect(loadAdapter()).resolves.toBeDefined();
  });

  it("setItem mirrors auth-token writes to Preferences", async () => {
    prefsKeysMock.mockResolvedValue({ keys: [] });
    const { preferencesStorageAdapter } = await loadAdapter();

    preferencesStorageAdapter.setItem(AUTH_KEY, "new-jwt");
    expect(localStorage.getItem(AUTH_KEY)).toBe("new-jwt");
    expect(prefsSetMock).toHaveBeenCalledWith({ key: AUTH_KEY, value: "new-jwt" });
  });

  it("setItem does NOT mirror non-auth-token keys to Preferences", async () => {
    prefsKeysMock.mockResolvedValue({ keys: [] });
    const { preferencesStorageAdapter } = await loadAdapter();

    preferencesStorageAdapter.setItem(NON_AUTH_KEY, "draft-content");
    expect(localStorage.getItem(NON_AUTH_KEY)).toBe("draft-content");
    expect(prefsSetMock).not.toHaveBeenCalled();
  });

  it("getItem prefers cache over localStorage when cache has the key", async () => {
    prefsKeysMock.mockResolvedValue({ keys: [AUTH_KEY] });
    prefsGetMock.mockResolvedValue({ value: "from-cache" });
    const { preferencesStorageAdapter } = await loadAdapter();

    // Sabotage: write a different value into localStorage post-hydrate.
    // Cache should still win — that's the durability story.
    localStorage.setItem(AUTH_KEY, "from-localstorage");
    expect(preferencesStorageAdapter.getItem(AUTH_KEY)).toBe("from-cache");
  });

  it("getItem falls back to localStorage when key not in cache", async () => {
    prefsKeysMock.mockResolvedValue({ keys: [] });
    const { preferencesStorageAdapter } = await loadAdapter();

    localStorage.setItem("never-cached", "ls-value");
    expect(preferencesStorageAdapter.getItem("never-cached")).toBe("ls-value");
  });

  it("removeItem clears cache + localStorage + Preferences for auth-token keys", async () => {
    prefsKeysMock.mockResolvedValue({ keys: [AUTH_KEY] });
    prefsGetMock.mockResolvedValue({ value: "jwt" });
    const { preferencesStorageAdapter } = await loadAdapter();

    preferencesStorageAdapter.removeItem(AUTH_KEY);
    expect(localStorage.getItem(AUTH_KEY)).toBeNull();
    expect(prefsRemoveMock).toHaveBeenCalledWith({ key: AUTH_KEY });
    // Cache cleared too — getItem should now fall back to localStorage (also null)
    expect(preferencesStorageAdapter.getItem(AUTH_KEY)).toBeNull();
  });

  it("removeItem skips Preferences for non-auth-token keys", async () => {
    prefsKeysMock.mockResolvedValue({ keys: [] });
    const { preferencesStorageAdapter } = await loadAdapter();

    localStorage.setItem(NON_AUTH_KEY, "v");
    preferencesStorageAdapter.removeItem(NON_AUTH_KEY);
    expect(localStorage.getItem(NON_AUTH_KEY)).toBeNull();
    expect(prefsRemoveMock).not.toHaveBeenCalled();
  });

  it("setItem does not resolve until the native mirror write has landed", async () => {
    // HOLLOW UNTIL 2026-09-21. Every assertion above only checked THAT
    // Preferences.set was called, so turning the awaited mirror write back
    // into fire-and-forget (`void Preferences.set(...)`) left this whole file
    // green — while re-opening the exact session-loss race the file header
    // documents: GoTrueClient._saveSession awaits this method, so a token
    // rotation that returns before the NSUserDefaults write lands can be
    // suspended by iOS with the OLD refresh token still on disk. Next cold
    // boot hydrates that stale token and Supabase rejects it as reuse.
    prefsKeysMock.mockResolvedValue({ keys: [] });
    let landNativeWrite!: () => void;
    prefsSetMock.mockImplementation(
      () => new Promise<void>((resolve) => { landNativeWrite = () => resolve(); }),
    );
    const { preferencesStorageAdapter } = await loadAdapter();

    let settled = false;
    const write = preferencesStorageAdapter.setItem(AUTH_KEY, "rotated-jwt").then(() => {
      settled = true;
    });
    // Drain every microtask: a fire-and-forget mirror resolves inside this.
    for (let i = 0; i < 50; i++) await Promise.resolve();
    expect(prefsSetMock).toHaveBeenCalledWith({ key: AUTH_KEY, value: "rotated-jwt" });
    expect(settled).toBe(false); // still waiting on the durable copy

    landNativeWrite();
    await write;
    expect(settled).toBe(true);
  });

  it("removeItem does not resolve until the native mirror delete has landed", async () => {
    // Same contract on the sign-out side: a removeItem that returns before
    // NSUserDefaults is cleared leaves a signed-out device holding a token
    // that the next hydrate restores.
    prefsKeysMock.mockResolvedValue({ keys: [] });
    let landNativeDelete!: () => void;
    prefsRemoveMock.mockImplementation(
      () => new Promise<void>((resolve) => { landNativeDelete = () => resolve(); }),
    );
    const { preferencesStorageAdapter } = await loadAdapter();

    let settled = false;
    const gone = preferencesStorageAdapter.removeItem(AUTH_KEY).then(() => { settled = true; });
    for (let i = 0; i < 50; i++) await Promise.resolve();
    expect(prefsRemoveMock).toHaveBeenCalledWith({ key: AUTH_KEY });
    expect(settled).toBe(false);

    landNativeDelete();
    await gone;
    expect(settled).toBe(true);
  });

  it("hydrate gives up on a bridge call that NEVER settles, so launch is never blocked", async () => {
    // HOLLOW UNTIL 2026-09-21. The only hydrate-failure test above used a
    // REJECTION, which the try/catch handles — so deleting the Promise.race
    // timeout cap entirely left the file green. A rejection is not the state
    // this cap exists for: client.ts does `await hydratePromise` at TOP LEVEL
    // on native, in front of createRoot().render(<App/>), so a Capacitor
    // bridge call issued during module evaluation that never settles at all
    // freezes the app on index.html's #boot-loader forever, with no error
    // anywhere. Timeout literal mirrors HYDRATE_TIMEOUT_MS in the source.
    vi.useFakeTimers();
    try {
      prefsKeysMock.mockImplementation(() => new Promise<never>(() => { /* never settles */ }));
      const mod = await import("./preferencesStorageAdapter");
      let settled = false;
      void mod.hydratePromise.then(() => { settled = true; });

      await vi.advanceTimersByTimeAsync(1_999);
      expect(settled).toBe(false); // the cap has not fired yet...
      await vi.advanceTimersByTimeAsync(2);
      expect(settled).toBe(true); // ...and at 2000ms it lets the app boot.

      // And the adapter still works, falling back to localStorage.
      localStorage.setItem(AUTH_KEY, "ls-only");
      expect(mod.preferencesStorageAdapter.getItem(AUTH_KEY)).toBe("ls-only");
    } finally {
      vi.useRealTimers();
    }
  });

  it("isAuthTokenKey requires both prefix AND suffix — partial matches not mirrored", async () => {
    prefsKeysMock.mockResolvedValue({ keys: [] });
    const { preferencesStorageAdapter } = await loadAdapter();

    // Has 'sb-' prefix but no '-auth-token' suffix
    preferencesStorageAdapter.setItem("sb-something-else", "v");
    // Has '-auth-token' suffix but no 'sb-' prefix
    preferencesStorageAdapter.setItem("foo-auth-token", "v");
    expect(prefsSetMock).not.toHaveBeenCalled();
  });
});

// Shown able to fail:
// The awaited native mirror write. Fire-and-forget re-opens the rotated-token
// session loss documented in the source header.
// @mutate src/integrations/supabase/preferencesStorageAdapter.ts | try { await Preferences.set({ key, value }); } | try { void Preferences.set({ key, value }); }
// The hard cap in front of `await hydratePromise` in client.ts. Without it a
// bridge call that never settles freezes the app on the boot loader forever.
// @mutate src/integrations/supabase/preferencesStorageAdapter.ts | await Promise.race([\n      hydrate,\n      new Promise<void>((resolve) => setTimeout(resolve, HYDRATE_TIMEOUT_MS)),\n    ]); | await hydrate;
// Both halves of isAuthTokenKey — a looser test would mirror every
// localStorage key this app writes into NSUserDefaults.
// @mutate src/integrations/supabase/preferencesStorageAdapter.ts | key.startsWith('sb-') && key.endsWith('-auth-token') | key.startsWith('sb-') \|\| key.endsWith('-auth-token')
