// The adapter's unit tests mock the plugin's methods one by one, so they could
// not see that set() JSON-encodes while getItem() returns raw: a session read
// back that way is a JSON string Supabase cannot use, and it signs the person
// out on the next launch (lh-onboarding-auth review of 598c5b2e5, 2026-10-06).
//
// This file runs the plugin's REAL SecureStorageBase (the JS every platform
// shares) over an in-memory native store, then relaunches the adapter with
// WebKit storage evicted, and asks for exactly what Supabase asks for.
//
// @mutate src/integrations/supabase/keychainStorageAdapter.ts |   const value: unknown = await SecureStorage.get(key, false); |   const value: unknown = await SecureStorage.getItem(key);

import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ keychain: new Map<string, string>(), prefs: new Map<string, string>() }));

vi.mock("@capacitor/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@capacitor/core")>();
  return { ...actual, Capacitor: { ...actual.Capacitor, isNativePlatform: () => true, getPlatform: () => "web" } };
});

vi.mock("@aparajita/capacitor-secure-storage", async () => {
  const { SecureStorageBase } = await import("@aparajita/capacitor-secure-storage/dist/esm/base.js");
  const defs = await import("@aparajita/capacitor-secure-storage/dist/esm/definitions.js");
  class MemoryKeychain extends SecureStorageBase {
    async setSynchronizeKeychain() {}
    async internalGetItem({ prefixedKey }: { prefixedKey: string }) {
      return { data: native.keychain.get(prefixedKey) ?? null };
    }
    async internalSetItem({ prefixedKey, data }: { prefixedKey: string; data: string }) {
      native.keychain.set(prefixedKey, data);
    }
    async internalRemoveItem({ prefixedKey }: { prefixedKey: string }) {
      return { success: native.keychain.delete(prefixedKey) };
    }
    async internalClearItemsWithPrefix() {}
    async clear() { native.keychain.clear(); }
    async internalGetPrefixedKeys({ prefix }: { prefix: string }) {
      return { keys: [...native.keychain.keys()].filter((k) => k.startsWith(prefix)) };
    }
  }
  return { ...defs, SecureStorage: new MemoryKeychain() };
});

vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    keys: async () => ({ keys: [...native.prefs.keys()] }),
    get: async ({ key }: { key: string }) => ({ value: native.prefs.get(key) ?? null }),
    set: async ({ key, value }: { key: string; value: string }) => { native.prefs.set(key, value); },
    remove: async ({ key }: { key: string }) => { native.prefs.delete(key); },
  },
}));

const AUTH_KEY = "sb-fncmgoasalhdgfwzhsqa-auth-token";
const SESSION = JSON.stringify({ access_token: "a.b.c", refresh_token: "r1", expires_at: 2_000_000_000, user: { id: "u-1" } });

async function launch() {
  vi.resetModules();
  const mod = await import("./keychainStorageAdapter");
  await mod.hydratePromise;
  return mod;
}

beforeEach(() => {
  native.keychain.clear();
  native.prefs.clear();
  localStorage.clear();
});

describe("Keychain session round trip through the plugin's real code", () => {
  it("a session written on one launch reads back unchanged on the next, after WebKit evicted its copy", async () => {
    const first = await launch();
    await first.keychainStorageAdapter.setItem(AUTH_KEY, SESSION);
    localStorage.clear();

    const second = await launch();
    const read = second.keychainStorageAdapter.getItem(AUTH_KEY);
    expect(read).toBe(SESSION);
    // What GoTrueClient does with it.
    expect(JSON.parse(read as string).user.id).toBe("u-1");
  });

  it("an older build's plaintext session survives the move to the Keychain across two launches", async () => {
    native.prefs.set(AUTH_KEY, SESSION);
    await launch();
    expect(native.prefs.has(AUTH_KEY)).toBe(false);
    localStorage.clear();

    const second = await launch();
    expect(second.keychainStorageAdapter.getItem(AUTH_KEY)).toBe(SESSION);
  });

  it("a sign-out stays signed out on the next launch", async () => {
    const first = await launch();
    await first.keychainStorageAdapter.setItem(AUTH_KEY, SESSION);
    await first.keychainStorageAdapter.removeItem(AUTH_KEY);
    const second = await launch();
    expect(second.keychainStorageAdapter.getItem(AUTH_KEY)).toBeNull();
  });
});
