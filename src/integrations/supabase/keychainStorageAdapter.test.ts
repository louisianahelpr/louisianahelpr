// keychainStorageAdapter has module-level state (a Map cache + a
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
  const mod = await import("./keychainStorageAdapter");
  await mod.hydratePromise;
  return mod;
}

describe("keychainStorageAdapter — web (isNativePlatform=false)", () => {
  beforeEach(() => {
    isNativePlatformMock.mockReturnValue(false);
  });

  it("hydrate is a no-op on web — no Preferences calls", async () => {
    await loadAdapter();
    expect(prefsKeysMock).not.toHaveBeenCalled();
    expect(prefsGetMock).not.toHaveBeenCalled();
  });

  it("setItem writes to localStorage but NOT to Preferences", async () => {
    const { keychainStorageAdapter } = await loadAdapter();
    keychainStorageAdapter.setItem(AUTH_KEY, "jwt-value");
    expect(localStorage.getItem(AUTH_KEY)).toBe("jwt-value");
    expect(prefsSetMock).not.toHaveBeenCalled();
  });

  it("getItem reads from localStorage", async () => {
    const { keychainStorageAdapter } = await loadAdapter();
    localStorage.setItem(AUTH_KEY, "jwt-from-ls");
    expect(keychainStorageAdapter.getItem(AUTH_KEY)).toBe("jwt-from-ls");
  });

  it("removeItem clears localStorage but NOT Preferences", async () => {
    const { keychainStorageAdapter } = await loadAdapter();
    localStorage.setItem(AUTH_KEY, "jwt");
    keychainStorageAdapter.removeItem(AUTH_KEY);
    expect(localStorage.getItem(AUTH_KEY)).toBeNull();
    expect(prefsRemoveMock).not.toHaveBeenCalled();
  });
});

describe("keychainStorageAdapter — native (isNativePlatform=true)", () => {
  beforeEach(() => {
    isNativePlatformMock.mockReturnValue(true);
  });

  it("hydrate copies auth-token keys from Preferences into localStorage + cache", async () => {
    prefsKeysMock.mockResolvedValue({ keys: [AUTH_KEY] });
    prefsGetMock.mockResolvedValue({ value: "restored-jwt" });

    const { keychainStorageAdapter } = await loadAdapter();
    expect(localStorage.getItem(AUTH_KEY)).toBe("restored-jwt");
    // Cache wins on read even if localStorage is wiped after hydrate
    localStorage.removeItem(AUTH_KEY);
    expect(keychainStorageAdapter.getItem(AUTH_KEY)).toBe("restored-jwt");
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
    const { keychainStorageAdapter } = await loadAdapter();

    keychainStorageAdapter.setItem(AUTH_KEY, "new-jwt");
    expect(localStorage.getItem(AUTH_KEY)).toBe("new-jwt");
    expect(prefsSetMock).toHaveBeenCalledWith({ key: AUTH_KEY, value: "new-jwt" });
  });

  it("setItem does NOT mirror non-auth-token keys to Preferences", async () => {
    prefsKeysMock.mockResolvedValue({ keys: [] });
    const { keychainStorageAdapter } = await loadAdapter();

    keychainStorageAdapter.setItem(NON_AUTH_KEY, "draft-content");
    expect(localStorage.getItem(NON_AUTH_KEY)).toBe("draft-content");
    expect(prefsSetMock).not.toHaveBeenCalled();
  });

  it("getItem prefers cache over localStorage when cache has the key", async () => {
    prefsKeysMock.mockResolvedValue({ keys: [AUTH_KEY] });
    prefsGetMock.mockResolvedValue({ value: "from-cache" });
    const { keychainStorageAdapter } = await loadAdapter();

    // Sabotage: write a different value into localStorage post-hydrate.
    // Cache should still win — that's the durability story.
    localStorage.setItem(AUTH_KEY, "from-localstorage");
    expect(keychainStorageAdapter.getItem(AUTH_KEY)).toBe("from-cache");
  });

  it("getItem falls back to localStorage when key not in cache", async () => {
    prefsKeysMock.mockResolvedValue({ keys: [] });
    const { keychainStorageAdapter } = await loadAdapter();

    localStorage.setItem("never-cached", "ls-value");
    expect(keychainStorageAdapter.getItem("never-cached")).toBe("ls-value");
  });

  it("removeItem clears cache + localStorage + Preferences for auth-token keys", async () => {
    prefsKeysMock.mockResolvedValue({ keys: [AUTH_KEY] });
    prefsGetMock.mockResolvedValue({ value: "jwt" });
    const { keychainStorageAdapter } = await loadAdapter();

    keychainStorageAdapter.removeItem(AUTH_KEY);
    expect(localStorage.getItem(AUTH_KEY)).toBeNull();
    expect(prefsRemoveMock).toHaveBeenCalledWith({ key: AUTH_KEY });
    // Cache cleared too — getItem should now fall back to localStorage (also null)
    expect(keychainStorageAdapter.getItem(AUTH_KEY)).toBeNull();
  });

  it("removeItem skips Preferences for non-auth-token keys", async () => {
    prefsKeysMock.mockResolvedValue({ keys: [] });
    const { keychainStorageAdapter } = await loadAdapter();

    localStorage.setItem(NON_AUTH_KEY, "v");
    keychainStorageAdapter.removeItem(NON_AUTH_KEY);
    expect(localStorage.getItem(NON_AUTH_KEY)).toBeNull();
    expect(prefsRemoveMock).not.toHaveBeenCalled();
  });

  it("isAuthTokenKey requires both prefix AND suffix — partial matches not mirrored", async () => {
    prefsKeysMock.mockResolvedValue({ keys: [] });
    const { keychainStorageAdapter } = await loadAdapter();

    // Has 'sb-' prefix but no '-auth-token' suffix
    keychainStorageAdapter.setItem("sb-something-else", "v");
    // Has '-auth-token' suffix but no 'sb-' prefix
    keychainStorageAdapter.setItem("foo-auth-token", "v");
    expect(prefsSetMock).not.toHaveBeenCalled();
  });
});
