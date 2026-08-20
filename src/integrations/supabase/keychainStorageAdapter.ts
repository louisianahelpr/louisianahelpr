import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

// Native-side mirror for sb-*-auth-token entries. WebKit can evict
// localStorage under memory pressure on iOS, silently logging users out.
// Mirror auth-token writes to NSUserDefaults so a hydrate-on-boot step
// can restore them. NSUserDefaults survives Offload App + reinstall.

const cache = new Map<string, string>();
const isAuthTokenKey = (key: string): boolean => key.startsWith('sb-') && key.endsWith('-auth-token');

// Hydrate cache + localStorage from Preferences. Top-level Promise so
// client.ts can await it before constructing the supabase client.
// HARD CAP. client.ts does `await hydratePromise` at TOP LEVEL on native,
// which gates its module evaluation — and client.ts is reached eagerly from
// App.tsx (useCurrentUser / nativePush / useLoginTracking). So this promise
// sits in front of `createRoot().render(<App/>)`: if it never settles, React
// never mounts and the app is stuck on index.html's #boot-loader forever,
// with no error anywhere.
//
// The try/catch below is NOT sufficient on its own. It catches a REJECTION;
// it does nothing for a Capacitor bridge call that never settles at all.
// These calls are issued during module evaluation — the earliest point in the
// WebView lifecycle, potentially before the native bridge is ready — so
// "never settles" is a real state, and it presents as an intermittent
// hang-on-launch that depends on device and timing.
//
// Nothing here is worth blocking launch for: this only RESTORES a mirrored
// auth token. If the cap fires, the adapter falls back to localStorage in
// getItem() and the user is at worst signed out — recoverable, unlike a
// permanently frozen splash. Never remove this cap without moving the
// top-level await out of client.ts first.
const HYDRATE_TIMEOUT_MS = 2000;

export const hydratePromise: Promise<void> = (async () => {
  if (!Capacitor.isNativePlatform()) return;
  const hydrate = (async () => {
    const { keys } = await Preferences.keys();
    for (const key of keys) {
      if (!isAuthTokenKey(key)) continue;
      const { value } = await Preferences.get({ key });
      if (value !== null && value !== undefined) {
        cache.set(key, value);
        try { localStorage.setItem(key, value); } catch { /* ignore */ }
      }
    }
  })();
  try {
    await Promise.race([
      hydrate,
      new Promise<void>((resolve) => setTimeout(resolve, HYDRATE_TIMEOUT_MS)),
    ]);
  } catch { /* best-effort */ }
  // A late-resolving hydrate would otherwise surface as an unhandled
  // rejection once the race has already moved on.
  void hydrate.catch(() => { /* ignore */ });
})();

// Synchronous Storage adapter for Supabase Auth.
export const keychainStorageAdapter = {
  getItem(key: string): string | null {
    if (cache.has(key)) return cache.get(key) ?? null;
    try { return localStorage.getItem(key); } catch { return null; }
  },
  setItem(key: string, value: string): void {
    cache.set(key, value);
    try { localStorage.setItem(key, value); } catch { /* ignore */ }
    if (Capacitor.isNativePlatform() && isAuthTokenKey(key)) {
      void Preferences.set({ key, value }).catch(() => { /* fire and forget */ });
    }
  },
  removeItem(key: string): void {
    cache.delete(key);
    try { localStorage.removeItem(key); } catch { /* ignore */ }
    if (Capacitor.isNativePlatform() && isAuthTokenKey(key)) {
      void Preferences.remove({ key }).catch(() => { /* fire and forget */ });
    }
  },
};
