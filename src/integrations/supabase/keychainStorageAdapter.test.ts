// keychainStorageAdapter has module-level state (a Map cache + a
// hydratePromise IIFE that reads the Keychain). Tests use vi.resetModules
// + dynamic import per test so each scenario gets a fresh adapter
// instance and a fresh hydrate run.

import { describe, it, expect, vi, beforeEach } from "vitest";

const isNativePlatformMock = vi.fn();
// The Keychain plugin (@aparajita/capacitor-secure-storage).
const kcKeysMock = vi.fn();
const kcGetItemMock = vi.fn();
const kcSetMock = vi.fn();
const kcRemoveMock = vi.fn();
const kcSyncMock = vi.fn();
const kcAccessMock = vi.fn();
// The plaintext store an older build mirrored into (read only to migrate).
const prefsKeysMock = vi.fn();
const prefsGetMock = vi.fn();
/** Preferences' "this install has run" flag (absent only on a fresh install). */
const installFlagMock = vi.fn();
const INSTALL_FLAG_KEY = "helpr_keychain_install_seen";
const prefsSetMock = vi.fn();
const prefsRemoveMock = vi.fn();

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => isNativePlatformMock(),
  },
}));

vi.mock("@aparajita/capacitor-secure-storage", () => ({
  KeychainAccess: {
    whenUnlocked: 0,
    whenUnlockedThisDeviceOnly: 1,
    afterFirstUnlock: 2,
    afterFirstUnlockThisDeviceOnly: 3,
    whenPasscodeSetThisDeviceOnly: 4,
  },
  SecureStorage: {
    keys: () => kcKeysMock(),
    // set() JSON-encodes, so reads go through get(key, false); getItem() would
    // return the encoded string (lh-onboarding-auth review of 598c5b2e5).
    get: (...args: unknown[]) => kcGetItemMock(...args),
    getItem: () => { throw new Error("read with get(key, false): set() JSON-encodes, getItem() does not decode"); },
    set: (...args: unknown[]) => kcSetMock(...args),
    remove: (...args: unknown[]) => kcRemoveMock(...args),
    setSynchronize: (...args: unknown[]) => kcSyncMock(...args),
    setDefaultKeychainAccess: (...args: unknown[]) => kcAccessMock(...args),
  },
}));

const reportMock = vi.fn();
vi.mock("@/lib/errorLogger", () => ({ report: (...args: unknown[]) => reportMock(...args) }));

vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    keys: () => prefsKeysMock(),
    get: (arg: { key: string }) => (arg.key === INSTALL_FLAG_KEY ? installFlagMock(arg) : prefsGetMock(arg)),
    set: (...args: unknown[]) => prefsSetMock(...args),
    remove: (...args: unknown[]) => prefsRemoveMock(...args),
  },
}));

const AUTH_KEY = "sb-fncmgoasalhdgfwzhsqa-auth-token";
const NON_AUTH_KEY = "helpr_draft_job";
/** KeychainAccess.afterFirstUnlockThisDeviceOnly (owner decision Q390). */
const AFTER_FIRST_UNLOCK_THIS_DEVICE = 3;

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  for (const m of [reportMock, isNativePlatformMock, kcKeysMock, kcGetItemMock, kcSetMock, kcRemoveMock, kcSyncMock, kcAccessMock, prefsKeysMock, prefsGetMock, prefsSetMock, prefsRemoveMock, installFlagMock]) m.mockReset();
  installFlagMock.mockResolvedValue({ value: "1" });
  prefsSetMock.mockResolvedValue(undefined);
  kcKeysMock.mockResolvedValue([]);
  kcSetMock.mockResolvedValue(undefined);
  kcRemoveMock.mockResolvedValue(undefined);
  kcSyncMock.mockResolvedValue(undefined);
  kcAccessMock.mockResolvedValue(undefined);
  prefsKeysMock.mockResolvedValue({ keys: [] });
  prefsRemoveMock.mockResolvedValue(undefined);
});

async function loadAdapter() {
  const mod = await import("./keychainStorageAdapter");
  await mod.hydratePromise;
  return mod;
}

describe("keychainStorageAdapter — web (isNativePlatform=false)", () => {
  beforeEach(() => {
    isNativePlatformMock.mockReturnValue(false);
  });

  it("hydrate is a no-op on web — no native store calls", async () => {
    await loadAdapter();
    expect(kcKeysMock).not.toHaveBeenCalled();
    expect(prefsKeysMock).not.toHaveBeenCalled();
  });

  it("setItem writes to localStorage but NOT to the Keychain", async () => {
    const { keychainStorageAdapter } = await loadAdapter();
    await keychainStorageAdapter.setItem(AUTH_KEY, "jwt-value");
    expect(localStorage.getItem(AUTH_KEY)).toBe("jwt-value");
    expect(kcSetMock).not.toHaveBeenCalled();
  });

  it("getItem reads from localStorage", async () => {
    localStorage.setItem(AUTH_KEY, "jwt-from-ls");
    const { keychainStorageAdapter } = await loadAdapter();
    expect(keychainStorageAdapter.getItem(AUTH_KEY)).toBe("jwt-from-ls");
  });

  it("removeItem clears localStorage but NOT the Keychain", async () => {
    localStorage.setItem(AUTH_KEY, "jwt");
    const { keychainStorageAdapter } = await loadAdapter();
    await keychainStorageAdapter.removeItem(AUTH_KEY);
    expect(localStorage.getItem(AUTH_KEY)).toBeNull();
    expect(kcRemoveMock).not.toHaveBeenCalled();
  });
});

describe("keychainStorageAdapter — native (isNativePlatform=true)", () => {
  beforeEach(() => {
    isNativePlatformMock.mockReturnValue(true);
  });

  it("hydrate pins the local keychain and afterFirstUnlockThisDeviceOnly before reading", async () => {
    await loadAdapter();
    expect(kcSyncMock).toHaveBeenCalledWith(false);
    expect(kcAccessMock).toHaveBeenCalledWith(AFTER_FIRST_UNLOCK_THIS_DEVICE);
  });

  it("hydrate copies auth-token keys from the Keychain into localStorage + cache", async () => {
    kcKeysMock.mockResolvedValue([AUTH_KEY]);
    kcGetItemMock.mockResolvedValue("restored-jwt");
    const { keychainStorageAdapter } = await loadAdapter();
    expect(localStorage.getItem(AUTH_KEY)).toBe("restored-jwt");
    localStorage.removeItem(AUTH_KEY);
    expect(keychainStorageAdapter.getItem(AUTH_KEY)).toBe("restored-jwt");
  });

  it("hydrate skips non-auth-token keys", async () => {
    kcKeysMock.mockResolvedValue([NON_AUTH_KEY, AUTH_KEY]);
    kcGetItemMock.mockImplementation(async (key: string) => (key === AUTH_KEY ? "auth-jwt" : "draft"));
    await loadAdapter();
    expect(localStorage.getItem(AUTH_KEY)).toBe("auth-jwt");
    expect(localStorage.getItem(NON_AUTH_KEY)).toBeNull();
    expect(kcGetItemMock).toHaveBeenCalledTimes(1);
    expect(kcGetItemMock).toHaveBeenCalledWith(AUTH_KEY, false);
  });

  it("MIGRATION: an older build's plaintext copy moves into the Keychain and is deleted from Preferences", async () => {
    prefsKeysMock.mockResolvedValue({ keys: [AUTH_KEY, NON_AUTH_KEY] });
    prefsGetMock.mockImplementation(async (arg: { key: string }) => ({ value: arg.key === AUTH_KEY ? "legacy-jwt" : "draft" }));
    const { keychainStorageAdapter } = await loadAdapter();
    expect(kcSetMock).toHaveBeenCalledWith(AUTH_KEY, "legacy-jwt", false, false, AFTER_FIRST_UNLOCK_THIS_DEVICE);
    expect(prefsRemoveMock).toHaveBeenCalledWith({ key: AUTH_KEY });
    // Never the app's other Preferences keys.
    expect(prefsRemoveMock).not.toHaveBeenCalledWith({ key: NON_AUTH_KEY });
    // The user stays signed in across the switch.
    expect(keychainStorageAdapter.getItem(AUTH_KEY)).toBe("legacy-jwt");
  });

  it("MIGRATION: a Keychain copy wins over a stale plaintext one, which is still deleted", async () => {
    kcKeysMock.mockResolvedValue([AUTH_KEY]);
    kcGetItemMock.mockResolvedValue("current-jwt");
    prefsKeysMock.mockResolvedValue({ keys: [AUTH_KEY] });
    prefsGetMock.mockResolvedValue({ value: "stale-jwt" });
    const { keychainStorageAdapter } = await loadAdapter();
    expect(kcSetMock).not.toHaveBeenCalled();
    expect(prefsRemoveMock).toHaveBeenCalledWith({ key: AUTH_KEY });
    expect(keychainStorageAdapter.getItem(AUTH_KEY)).toBe("current-jwt");
  });

  // @mutate src/integrations/supabase/keychainStorageAdapter.ts |       if (!legacy.some(isAuthTokenKey)) { |       if (false) {
  it("FRESH INSTALL: a Keychain session left by a deleted copy of the app is removed, not restored", async () => {
    installFlagMock.mockResolvedValue({ value: null });
    kcKeysMock.mockResolvedValueOnce([AUTH_KEY, NON_AUTH_KEY]).mockResolvedValue([]);
    kcGetItemMock.mockResolvedValue("old-install-jwt");
    const { keychainStorageAdapter } = await loadAdapter();
    expect(kcRemoveMock).toHaveBeenCalledWith(AUTH_KEY);
    expect(kcRemoveMock).not.toHaveBeenCalledWith(NON_AUTH_KEY);
    expect(keychainStorageAdapter.getItem(AUTH_KEY)).toBeNull();
    expect(prefsSetMock).toHaveBeenCalledWith({ key: INSTALL_FLAG_KEY, value: "1" });
  });

  it("UPGRADE: the first launch on this build keeps the session (an older build's Preferences token proves it is not a fresh install)", async () => {
    installFlagMock.mockResolvedValue({ value: null });
    prefsKeysMock.mockResolvedValue({ keys: [AUTH_KEY] });
    prefsGetMock.mockResolvedValue({ value: "legacy-jwt" });
    const { keychainStorageAdapter } = await loadAdapter();
    expect(kcRemoveMock).not.toHaveBeenCalled();
    expect(keychainStorageAdapter.getItem(AUTH_KEY)).toBe("legacy-jwt");
    expect(prefsSetMock).toHaveBeenCalledWith({ key: INSTALL_FLAG_KEY, value: "1" });
  });

  it("an install that has run before never deletes its Keychain session at launch", async () => {
    kcKeysMock.mockResolvedValue([AUTH_KEY]);
    kcGetItemMock.mockResolvedValue("jwt");
    const { keychainStorageAdapter } = await loadAdapter();
    expect(kcRemoveMock).not.toHaveBeenCalled();
    expect(keychainStorageAdapter.getItem(AUTH_KEY)).toBe("jwt");
  });

  // @mutate src/integrations/supabase/keychainStorageAdapter.ts |   for (const key of known) cache.delete(key); |   void known;
  it("clearNativeSessionMirror (the failed-sign-out floor) empties the cache and the Keychain", async () => {
    kcKeysMock.mockResolvedValue([AUTH_KEY, NON_AUTH_KEY]);
    kcGetItemMock.mockResolvedValue("jwt");
    const { keychainStorageAdapter, clearNativeSessionMirror } = await loadAdapter();
    localStorage.removeItem(AUTH_KEY);
    expect(keychainStorageAdapter.getItem(AUTH_KEY)).toBe("jwt");
    await clearNativeSessionMirror();
    expect(keychainStorageAdapter.getItem(AUTH_KEY)).toBeNull();
    expect(kcRemoveMock).toHaveBeenCalledWith(AUTH_KEY);
    expect(kcRemoveMock).not.toHaveBeenCalledWith(NON_AUTH_KEY);
  });

  it("a failed Keychain write on a token refresh is REPORTED (the next launch would restore a rotated-out token)", async () => {
    kcSetMock.mockRejectedValue(new Error("errSecInteractionNotAllowed"));
    const { keychainStorageAdapter } = await loadAdapter();
    await keychainStorageAdapter.setItem(AUTH_KEY, "rotated");
    await vi.waitFor(() => expect(reportMock).toHaveBeenCalledTimes(1));
    expect(reportMock.mock.calls[0][1]).toMatchObject({ tags: { area: "keychain_session" }, context: { step: "setItem" } });
  });

  // @mutate src/integrations/supabase/keychainStorageAdapter.ts |       if (value !== null && !raceOver && !cache.has(key)) { |       if (value !== null) {
  it("a hydrate that finishes after the cap never overwrites a token Supabase wrote meanwhile", async () => {
    vi.useFakeTimers();
    try {
      let releaseKeys!: (keys: string[]) => void;
      kcKeysMock.mockImplementationOnce(() => new Promise<string[]>((r) => { releaseKeys = r; })).mockResolvedValue([AUTH_KEY]);
      kcGetItemMock.mockResolvedValue("old-jwt");
      const mod = await import("./keychainStorageAdapter");
      await vi.advanceTimersByTimeAsync(2_000);
      await mod.hydratePromise;
      await mod.keychainStorageAdapter.setItem(AUTH_KEY, "newer-jwt");
      releaseKeys([AUTH_KEY]);
      await vi.advanceTimersByTimeAsync(10);
      for (let i = 0; i < 50; i++) await Promise.resolve();
      expect(mod.keychainStorageAdapter.getItem(AUTH_KEY)).toBe("newer-jwt");
      expect(localStorage.getItem(AUTH_KEY)).toBe("newer-jwt");
    } finally {
      vi.useRealTimers();
    }
  });

  // @mutate src/integrations/supabase/keychainStorageAdapter.ts |       if (value !== null && value !== undefined && !cache.has(key) && !raceOver) { |       if (value !== null && value !== undefined && !cache.has(key)) {
  it("a migration that resumes after the cap drops the old plaintext copy instead of moving it (it could undo a sign-out)", async () => {
    vi.useFakeTimers();
    try {
      let releaseKeys!: (v: { keys: string[] }) => void;
      prefsKeysMock.mockImplementationOnce(() => new Promise((r) => { releaseKeys = r; }));
      prefsGetMock.mockResolvedValue({ value: "legacy-jwt" });
      const mod = await import("./keychainStorageAdapter");
      await vi.advanceTimersByTimeAsync(2_000);
      await mod.hydratePromise;
      releaseKeys({ keys: [AUTH_KEY] });
      for (let i = 0; i < 50; i++) await Promise.resolve();
      expect(kcSetMock).not.toHaveBeenCalled();
      expect(prefsRemoveMock).toHaveBeenCalledWith({ key: AUTH_KEY });
    } finally {
      vi.useRealTimers();
    }
  });

  // @mutate src/integrations/supabase/keychainStorageAdapter.ts |   if (capped) { |   if (false) {
  it("a hydrate that hits the cap is REPORTED (a hang is the failure the cap exists for)", async () => {
    vi.useFakeTimers();
    try {
      kcSyncMock.mockImplementation(() => new Promise<never>(() => { /* never settles */ }));
      const mod = await import("./keychainStorageAdapter");
      await vi.advanceTimersByTimeAsync(2_000);
      await mod.hydratePromise;
      vi.useRealTimers();
      await vi.waitFor(() => expect(reportMock).toHaveBeenCalledTimes(1));
      expect(reportMock.mock.calls[0][1]).toMatchObject({ context: { step: "hydrate cap" } });
    } finally {
      vi.useRealTimers();
    }
  });

  it("clearNativeSessionMirror removes the keys it knew by name, and any old plaintext copy", async () => {
    kcKeysMock.mockResolvedValueOnce([AUTH_KEY]).mockResolvedValue([]);
    kcGetItemMock.mockResolvedValue("jwt");
    const { clearNativeSessionMirror } = await loadAdapter();
    await clearNativeSessionMirror();
    expect(kcRemoveMock).toHaveBeenCalledWith(AUTH_KEY);
    expect(prefsRemoveMock).toHaveBeenCalledWith({ key: AUTH_KEY });
  });

  it("hydrate handles native store errors gracefully", async () => {
    kcKeysMock.mockRejectedValue(new Error("Keychain unavailable"));
    await expect(loadAdapter()).resolves.toBeDefined();
  });

  it("setItem mirrors auth-token writes to the Keychain (this device, after first unlock), never to Preferences", async () => {
    const { keychainStorageAdapter } = await loadAdapter();
    await keychainStorageAdapter.setItem(AUTH_KEY, "new-jwt");
    expect(localStorage.getItem(AUTH_KEY)).toBe("new-jwt");
    expect(kcSetMock).toHaveBeenCalledWith(AUTH_KEY, "new-jwt", false, false, AFTER_FIRST_UNLOCK_THIS_DEVICE);
    expect(prefsSetMock).not.toHaveBeenCalledWith(expect.objectContaining({ key: AUTH_KEY }));
  });

  it("setItem does NOT mirror non-auth-token keys", async () => {
    const { keychainStorageAdapter } = await loadAdapter();
    await keychainStorageAdapter.setItem(NON_AUTH_KEY, "draft-content");
    expect(localStorage.getItem(NON_AUTH_KEY)).toBe("draft-content");
    expect(kcSetMock).not.toHaveBeenCalled();
  });

  it("getItem prefers cache over localStorage when cache has the key", async () => {
    kcKeysMock.mockResolvedValue([AUTH_KEY]);
    kcGetItemMock.mockResolvedValue("from-cache");
    const { keychainStorageAdapter } = await loadAdapter();
    localStorage.setItem(AUTH_KEY, "from-localstorage");
    expect(keychainStorageAdapter.getItem(AUTH_KEY)).toBe("from-cache");
  });

  it("getItem falls back to localStorage when key not in cache", async () => {
    const { keychainStorageAdapter } = await loadAdapter();
    localStorage.setItem("never-cached", "ls-value");
    expect(keychainStorageAdapter.getItem("never-cached")).toBe("ls-value");
  });

  it("removeItem clears cache + localStorage + Keychain for auth-token keys", async () => {
    kcKeysMock.mockResolvedValue([AUTH_KEY]);
    kcGetItemMock.mockResolvedValue("jwt");
    const { keychainStorageAdapter } = await loadAdapter();
    await keychainStorageAdapter.removeItem(AUTH_KEY);
    expect(localStorage.getItem(AUTH_KEY)).toBeNull();
    expect(kcRemoveMock).toHaveBeenCalledWith(AUTH_KEY);
    expect(keychainStorageAdapter.getItem(AUTH_KEY)).toBeNull();
  });

  // A sign-out whose Keychain delete fails is undone on the next launch
  // (hydrate restores the token), so it is retried once, then reported.
  // @mutate src/integrations/supabase/keychainStorageAdapter.ts | for (let attempt = 0; attempt < 2; attempt++) { | for (let attempt = 0; attempt < 1; attempt++) {
  // @mutate src/integrations/supabase/keychainStorageAdapter.ts | .then(({ report }) => report(err, | .then(({ report }) => void (err,
  it("removeItem retries a failed Keychain delete once, so one bridge hiccup cannot undo a sign-out", async () => {
    kcRemoveMock.mockRejectedValueOnce(new Error("errSecInteractionNotAllowed")).mockResolvedValueOnce(undefined);
    const { keychainStorageAdapter } = await loadAdapter();
    await keychainStorageAdapter.removeItem(AUTH_KEY);
    expect(kcRemoveMock).toHaveBeenCalledTimes(2);
    expect(reportMock).not.toHaveBeenCalled();
  });

  it("removeItem REPORTS a Keychain delete that fails twice (the next launch would restore the session)", async () => {
    kcRemoveMock.mockRejectedValue(new Error("errSecInteractionNotAllowed"));
    const { keychainStorageAdapter } = await loadAdapter();
    await keychainStorageAdapter.removeItem(AUTH_KEY);
    await vi.waitFor(() => expect(reportMock).toHaveBeenCalledTimes(1));
    expect(reportMock.mock.calls[0][1]).toMatchObject({ severity: "error", tags: { area: "keychain_session" } });
  });

  it("removeItem skips the Keychain for non-auth-token keys", async () => {
    const { keychainStorageAdapter } = await loadAdapter();
    localStorage.setItem(NON_AUTH_KEY, "v");
    await keychainStorageAdapter.removeItem(NON_AUTH_KEY);
    expect(localStorage.getItem(NON_AUTH_KEY)).toBeNull();
    expect(kcRemoveMock).not.toHaveBeenCalled();
  });

  it("setItem does not resolve until the native mirror write has landed", async () => {
    // GoTrueClient._saveSession awaits this method; a token rotation that
    // returns before the durable write lands can be suspended by iOS with the
    // OLD refresh token on disk, which the next cold boot restores and
    // Supabase rejects as reuse (see the source header).
    let landNativeWrite!: () => void;
    kcSetMock.mockImplementation(() => new Promise<void>((resolve) => { landNativeWrite = () => resolve(); }));
    const { keychainStorageAdapter } = await loadAdapter();
    let settled = false;
    const write = keychainStorageAdapter.setItem(AUTH_KEY, "rotated-jwt").then(() => { settled = true; });
    for (let i = 0; i < 50; i++) await Promise.resolve();
    expect(kcSetMock).toHaveBeenCalledWith(AUTH_KEY, "rotated-jwt", false, false, AFTER_FIRST_UNLOCK_THIS_DEVICE);
    expect(settled).toBe(false);
    landNativeWrite();
    await write;
    expect(settled).toBe(true);
  });

  it("removeItem does not resolve until the native mirror delete has landed", async () => {
    let landNativeDelete!: () => void;
    kcRemoveMock.mockImplementation(() => new Promise<void>((resolve) => { landNativeDelete = () => resolve(); }));
    const { keychainStorageAdapter } = await loadAdapter();
    let settled = false;
    const gone = keychainStorageAdapter.removeItem(AUTH_KEY).then(() => { settled = true; });
    for (let i = 0; i < 50; i++) await Promise.resolve();
    expect(kcRemoveMock).toHaveBeenCalledWith(AUTH_KEY);
    expect(settled).toBe(false);
    landNativeDelete();
    await gone;
    expect(settled).toBe(true);
  });

  it("hydrate gives up on a bridge call that NEVER settles, so launch is never blocked", async () => {
    // Every session read awaits the restore (getItem); a bridge call that
    // never settles would hang every one of them, so the restore is capped.
    // Timeout literal mirrors HYDRATE_TIMEOUT_MS in the source.
    vi.useFakeTimers();
    try {
      kcSyncMock.mockImplementation(() => new Promise<never>(() => { /* never settles */ }));
      const mod = await import("./keychainStorageAdapter");
      let settled = false;
      void mod.hydratePromise.then(() => { settled = true; });
      await vi.advanceTimersByTimeAsync(1_999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(2);
      expect(settled).toBe(true);
      localStorage.setItem(AUTH_KEY, "ls-only");
      expect(mod.keychainStorageAdapter.getItem(AUTH_KEY)).toBe("ls-only");
    } finally {
      vi.useRealTimers();
    }
  });

  it("isAuthTokenKey requires both prefix AND suffix — partial matches not mirrored", async () => {
    const { keychainStorageAdapter } = await loadAdapter();
    await keychainStorageAdapter.setItem("sb-something-else", "v");
    await keychainStorageAdapter.setItem("foo-auth-token", "v");
    expect(kcSetMock).not.toHaveBeenCalled();
  });
});

// Shown able to fail:
// The awaited native mirror write (fire-and-forget re-opens rotated-token loss).
// @mutate src/integrations/supabase/keychainStorageAdapter.ts | await SecureStorage.set(key, value, false, false, KEYCHAIN_ACCESS); // awaited: THE RACE above | void SecureStorage.set(key, value, false, false, KEYCHAIN_ACCESS); // awaited: THE RACE above
// The hard cap in front of `await hydratePromise` in client.ts.
// @mutate src/integrations/supabase/keychainStorageAdapter.ts | new Promise<void>((resolve) => setTimeout(() => { capped = true; resolve(); }, HYDRATE_TIMEOUT_MS)), | new Promise<void>(() => { /* no cap */ }),
// Both halves of isAuthTokenKey.
// @mutate src/integrations/supabase/keychainStorageAdapter.ts | key.startsWith('sb-') && key.endsWith('-auth-token') | key.startsWith('sb-') \|\| key.endsWith('-auth-token')
// Owner decision Q390: this device only, readable after first unlock.
// @mutate src/integrations/supabase/keychainStorageAdapter.ts | const KEYCHAIN_ACCESS = KeychainAccess.afterFirstUnlockThisDeviceOnly; | const KEYCHAIN_ACCESS = KeychainAccess.afterFirstUnlock;
// The plaintext copy is deleted after the move.
// @mutate src/integrations/supabase/keychainStorageAdapter.ts | await Preferences.remove({ key }); // the plaintext copy: moved or dropped | void key;
// @mutate src/integrations/supabase/keychainStorageAdapter.ts | await Preferences.remove({ key }); // any plaintext copy a capped launch left | void key;
// Never iCloud Keychain.
// @mutate src/integrations/supabase/keychainStorageAdapter.ts | await SecureStorage.setSynchronize(false); | await SecureStorage.setSynchronize(true);

describe("keychainStorageAdapter: no top-level await (2026-10-06)", () => {
  // client.ts no longer awaits hydratePromise at module top level (that
  // reordered iOS chunk evaluation: boot freeze, /browse crash). The wait
  // lives in getItem: before the Keychain restore settles it returns a
  // Promise that resolves to the Keychain value, so a launch after WebKit
  // evicted localStorage still finds the session.
  it("getItem called BEFORE the restore settles resolves to the Keychain session", async () => {
    isNativePlatformMock.mockReturnValue(true);
    let release: () => void = () => {};
    kcSyncMock.mockImplementation(() => new Promise<void>((r) => { release = r; }));
    kcKeysMock.mockResolvedValue([AUTH_KEY]);
    kcGetItemMock.mockResolvedValue("kc-session");
    const mod = await import("./keychainStorageAdapter");
    const early = mod.keychainStorageAdapter.getItem(AUTH_KEY);
    expect(early).toBeInstanceOf(Promise);
    release();
    await expect(early).resolves.toBe("kc-session");
    // After the restore it is synchronous again.
    expect(mod.keychainStorageAdapter.getItem(AUTH_KEY)).toBe("kc-session");
  });
});
