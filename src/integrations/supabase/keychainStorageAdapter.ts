import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { KeychainAccess, SecureStorage } from '@aparajita/capacitor-secure-storage';

// Native-side mirror for sb-*-auth-token entries. WebKit can evict
// localStorage under memory pressure on iOS, silently logging users out, so
// auth-token writes are mirrored to a native store a hydrate-on-boot step
// restores from.
//
// THE STORE IS THE iOS KEYCHAIN / ANDROID KEYSTORE (Q390, owner 2026-10-05:
// "Keychain session before launch"). Until this change the mirror was
// @capacitor/preferences, i.e. UserDefaults: an unencrypted plist in the app
// container, included in device backups, not gated by the passcode (OA-004).
// Items are written afterFirstUnlockThisDeviceOnly: readable in the
// background after the first unlock since boot (a refresh can run while the
// screen is locked), never synced to iCloud Keychain, never restored to
// another device from a backup. setSynchronize(false) keeps every operation
// on the local keychain.
//
// MIGRATION: a session mirrored by an older build sits in Preferences. The
// first hydrate on this build copies any auth-token key it finds there into
// the Keychain, then deletes it from Preferences, so the plaintext copy is
// gone after one launch and nobody is signed out by the switch.
//
// Still true and out of scope: Supabase also keeps the session in WKWebView
// localStorage (the sync getItem fallback below). src/test/secureStorageNamesAreTrue.test.ts
// requires this file, which names the Keychain, to import a Keychain plugin.
const KEYCHAIN_ACCESS = KeychainAccess.afterFirstUnlockThisDeviceOnly;

// A Keychain item outlives the app: delete and reinstall, and the old session
// would come straight back. UserDefaults (Preferences) does NOT survive an
// uninstall, so this flag marks "this install has run". Absent flag and no
// older build's Preferences token = a fresh install: its leftover Keychain
// session is deleted before anything reads it.
const INSTALL_FLAG_KEY = 'helpr_keychain_install_seen';

const cache = new Map<string, string>();
const isAuthTokenKey = (key: string): boolean => key.startsWith('sb-') && key.endsWith('-auth-token');

// ROUND TRIP. The plugin pairs set()/get() (JSON-encoded) and
// setItem()/getItem() (raw). Writes use set() for its per-call access level,
// so reads MUST use get(key, false): getItem() would hand Supabase the
// JSON-encoded string, which it cannot parse as a session, and it signs the
// person out on the next launch (lh-onboarding-auth review of 598c5b2e5).
async function readKeychain(key: string): Promise<string | null> {
  const value: unknown = await SecureStorage.get(key, false);
  return typeof value === 'string' ? value : null;
}

// errorLogger posts through restInsert and no longer imports the Supabase
// client (Q161), so reporting is safe; it stays a lazy import so this module,
// which the client imports at the top of the boot path, stays small.
function reportKeychain(err: unknown, step: string): void {
  void import('@/lib/errorLogger')
    .then(({ report }) => report(err, { severity: 'error', tags: { area: 'keychain_session' }, context: { step } }))
    .catch(() => { /* Silent by design: the logger itself failed to load; nothing else can record it. */ });
}

// Hydrate cache + localStorage from the Keychain, once, at module load.
// HARD CAP. Every Supabase session read waits for this (getItem returns a
// Promise until it settles, see NO TOP-LEVEL AWAIT below), so if it never
// settled no session read would ever finish.
//
// The try/catch below is NOT sufficient on its own. It catches a REJECTION;
// it does nothing for a Capacitor bridge call that never settles at all.
// These calls are issued during module evaluation, the earliest point in the
// WebView lifecycle, potentially before the native bridge is ready, so
// "never settles" is a real state that depends on device and timing.
//
// Nothing here is worth blocking on: this only RESTORES a mirrored auth
// token. If the cap fires, getItem falls back to localStorage and the user is
// at worst signed out, which is recoverable. Never remove this cap.
const HYDRATE_TIMEOUT_MS = 2000;

export const hydratePromise: Promise<void> = (async () => {
  if (!Capacitor.isNativePlatform()) return;
  // Once the cap below fires, Supabase may already hold a NEWER token (a
  // refresh) or none (a sign-out); a late hydrate must not overwrite either.
  let raceOver = false;
  const hydrate = (async () => {
    await SecureStorage.setSynchronize(false);
    await SecureStorage.setDefaultKeychainAccess(KEYCHAIN_ACCESS);
    const { keys: legacy } = await Preferences.keys();
    const { value: installSeen } = await Preferences.get({ key: INSTALL_FLAG_KEY });
    if (installSeen === null) {
      // First run of this install. An older build's Preferences token means
      // an upgrade (keep everything); none means a fresh install, so a
      // Keychain session left by a deleted copy of the app is removed.
      if (!legacy.some(isAuthTokenKey)) {
        for (const key of await SecureStorage.keys()) {
          // Past the cap the person may already have signed in on this
          // install: that token is theirs, not a leftover.
          if (isAuthTokenKey(key) && !raceOver) await SecureStorage.remove(key);
        }
      }
      await Preferences.set({ key: INSTALL_FLAG_KEY, value: '1' });
    }
    for (const key of await SecureStorage.keys()) {
      if (!isAuthTokenKey(key)) continue;
      let value: string | null;
      try {
        value = await readKeychain(key);
      } catch (err) {
        // Reported (reportKeychain); this key is skipped, the others still load.
        reportKeychain(err, 'hydrate read');
        continue;
      }
      if (value !== null && !raceOver && !cache.has(key)) {
        cache.set(key, value);
        try { localStorage.setItem(key, value); } catch { /* Silent by design: WebKit storage blocked or evicted; the in-memory cache and the Keychain still hold the value. */ }
      }
    }
    // One-time move of an older build's plaintext copy (see MIGRATION above).
    for (const key of legacy) {
      if (!isAuthTokenKey(key)) continue;
      const { value } = await Preferences.get({ key });
      // Past the cap Supabase is already running from WebKit storage and may
      // have refreshed or signed out since: the old copy is dropped, never
      // moved (a late move could restore a session the person just left).
      if (value !== null && value !== undefined && !cache.has(key) && !raceOver) {
        try {
          await SecureStorage.set(key, value, false, false, KEYCHAIN_ACCESS);
        } catch (err) {
          // The plaintext copy stays and the move is retried next launch.
          reportKeychain(err, 'migrate set');
          continue;
        }
        if (!raceOver) {
          cache.set(key, value);
          try { localStorage.setItem(key, value); } catch { /* Silent by design: WebKit storage blocked or evicted; the in-memory cache and the Keychain still hold the value. */ }
        }
      }
      await Preferences.remove({ key }); // the plaintext copy: moved or dropped
    }
  })();
  let capped = false;
  try {
    await Promise.race([
      hydrate,
      new Promise<void>((resolve) => setTimeout(() => { capped = true; resolve(); }, HYDRATE_TIMEOUT_MS)),
    ]);
  } catch (err) {
    // This launch still works from WebKit storage; the person may look signed
    // out if WebKit evicted it. Recorded so a broken hydrate is visible.
    reportKeychain(err, 'hydrate');
  }
  raceOver = true;
  if (capped) {
    // A hang is the failure this cap exists for: it is recorded too, and a
    // late rejection (reported once, here) cannot surface as unhandled.
    reportKeychain(new Error(`Keychain hydrate exceeded its ${HYDRATE_TIMEOUT_MS}ms cap`), 'hydrate cap');
    void hydrate.catch((err: unknown) => reportKeychain(err, 'hydrate late'));
  }
})();

// Storage adapter for Supabase Auth. getItem is synchronous once the
// Keychain restore has settled, and a Promise of the restored value before
// it (see NO TOP-LEVEL AWAIT below).
// setItem/removeItem are async and AWAIT the native mirror write — see
// below for why that isn't optional.
//
// THE RACE THIS CLOSES. setItem used to fire the `Preferences.set()` mirror
// write and return immediately ("fire and forget"), because the interface
// looked synchronous. But Supabase's `SupportedStorage` type is
// `PromisifyMethods<...>` and `GoTrueClient._saveSession` does
// `await this.storage.setItem(...)` — a Promise return IS honored and
// awaited by the caller, so returning `void` was leaving a real await point
// on the table.
//
// Every refresh-token rotation calls this once with the new token,
// synchronously overwriting `cache` + `localStorage`, then kicks off a
// native bridge call that used to resolve on its own time, unobserved by
// the caller. If iOS suspends/evicts the WKWebView in the window between
// "rotation happened" and "native write landed" (e.g. the process gets
// reclaimed while an SFSafariViewController / Stripe Checkout sheet is on
// top — exactly the WebKit eviction this file's header comment already
// documents), the NSUserDefaults mirror is left holding the OLD, now
// rotated-out refresh token. On the next cold boot `hydratePromise`
// restores that STALE token into localStorage, and Supabase Auth correctly
// rejects it as refresh-token reuse — a real, unrecoverable session loss
// that looks to the user like "the app randomly signed me out" (reported
// after a Stripe gift-card return round-trip, 2026-08-30). Awaiting the
// native write here means `_saveSession` doesn't consider the rotation
// complete until the durable copy is actually on disk, closing that window.
// NO TOP-LEVEL AWAIT (2026-10-06). client.ts used to `await hydratePromise`
// at module top level on native. A top-level await turns every module that
// imports the client (most of the app) into an async module, and on iOS that
// reordered how Rollup's shared chunks evaluate: a chunk ran before the chunk
// it imports had finished ("undefined is not an object (evaluating
// 'l.displayName')" on /browse in a build of main, and a Debug build stuck on
// #boot-loader; TestFlight 7115 run on a Mac froze on the H). The wait now
// lives HERE, in the one read Supabase awaits: until the Keychain hydrate
// settles (capped at HYDRATE_TIMEOUT_MS), getItem returns a Promise, which
// supabase-js's storage contract allows (`await this.storage.getItem`).
let hydrated = false;
void hydratePromise.finally(() => { hydrated = true; });
function readSync(key: string): string | null {
  if (cache.has(key)) return cache.get(key) ?? null;
  try { return localStorage.getItem(key); } catch { /* Silent by design: WebKit storage blocked; no stored session is the honest answer and the caller signs in again. */ return null; }
}

export const keychainStorageAdapter = {
  getItem(key: string): string | null | Promise<string | null> {
    if (!hydrated && Capacitor.isNativePlatform()) return hydratePromise.then(() => readSync(key), () => readSync(key));
    return readSync(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    cache.set(key, value);
    try { localStorage.setItem(key, value); } catch { /* Silent by design: WebKit storage blocked or evicted; the in-memory cache and the Keychain still hold the value. */ }
    if (Capacitor.isNativePlatform() && isAuthTokenKey(key)) {
      try {
        await SecureStorage.set(key, value, false, false, KEYCHAIN_ACCESS); // awaited: THE RACE above
      } catch (err) {
        // This launch works from memory and WebKit storage, but the Keychain may
        // now hold a rotated-out token the next cold launch cannot use.
        reportKeychain(err, 'setItem');
      }
    }
  },
  async removeItem(key: string): Promise<void> {
    cache.delete(key);
    try { localStorage.removeItem(key); } catch { /* Silent by design: WebKit storage blocked, so there is nothing readable to remove; the Keychain delete below is what keeps the sign-out. */ }
    if (Capacitor.isNativePlatform() && isAuthTokenKey(key)) {
      // A sign-out whose Keychain delete fails would be undone on the next
      // launch (hydrate restores the token), so this one is retried once and
      // then REPORTED.
      let failure: { err: unknown } | null = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          await SecureStorage.remove(key);
          failure = null;
          break;
        } catch (err) {
          // Kept, not dropped: retried once, then reported below.
          failure = { err };
        }
      }
      if (failure) reportKeychain(failure.err, 'sign-out remove');
      // An older build's plaintext copy, if a capped first launch left one.
      try { await Preferences.remove({ key }); } catch (err) { /* Reported (reportKeychain): only a leftover plaintext copy is at stake. */ reportKeychain(err, 'sign-out legacy remove'); }
    }
  },
};

/**
 * The floor under a sign-out the SDK did not finish (src/lib/authSignOut.ts:
 * auth.signOut() threw or returned an error without removing the session).
 * Clearing localStorage alone left this cache serving the token for the rest
 * of the process and the Keychain restoring it on the next launch.
 */
export async function clearNativeSessionMirror(): Promise<void> {
  const known = [...cache.keys()].filter(isAuthTokenKey);
  for (const key of known) cache.delete(key);
  if (!Capacitor.isNativePlatform()) return;
  try {
    // By name first: the Keychain's key listing reads an OS error as "no
    // keys", while a named remove reports a real failure.
    const listed = (await SecureStorage.keys()).filter(isAuthTokenKey);
    for (const key of new Set([...known, ...listed])) {
      await SecureStorage.remove(key);
      await Preferences.remove({ key }); // any plaintext copy a capped launch left
    }
  } catch (err) {
    // Reported (reportKeychain): the cache is already empty, so this launch is signed out.
    reportKeychain(err, 'sign-out fallback');
  }
}
