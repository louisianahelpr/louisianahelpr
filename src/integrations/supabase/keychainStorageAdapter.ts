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
export const hydratePromise: Promise<void> = (async () => {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { keys } = await Preferences.keys();
    for (const key of keys) {
      if (!isAuthTokenKey(key)) continue;
      const { value } = await Preferences.get({ key });
      if (value !== null && value !== undefined) {
        cache.set(key, value);
        try { localStorage.setItem(key, value); } catch { /* ignore */ }
      }
    }
  } catch { /* best-effort */ }
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
