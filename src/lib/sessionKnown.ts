/**
 * "Is the stored session readable yet?" — one signal for every synchronous
 * reader of the persisted Supabase session (Q1463).
 *
 * On the web, yes from the first line: supabase-js keeps the session in
 * localStorage, which is there before any script runs.
 *
 * In the native app, not always. WebKit can evict localStorage, and the copy
 * that survives is in the Keychain (src/integrations/supabase/keychainStorageAdapter.ts),
 * restored into localStorage by an ASYNC hydrate. Supabase's own reads wait
 * for it (getItem returns a Promise until it settles), but a synchronous
 * `localStorage` probe made before it settles reads "no session" for a person
 * who is signed in: the guest page on a cold deep link to /browse, the dock
 * jumping in late, Senior Mode text jumping, and analytics/error rows filed as
 * anonymous. Such a reader asks `sessionKnown()` first, and when it is false
 * waits for `whenSessionKnown()` and reads again.
 *
 * No import of Capacitor or the adapter: this sits under restInsert (every
 * error report) and the pre-paint path, so platform is read from the bridge
 * global the native shell injects before any script runs (the same probe as
 * src/boot/entryAuthRefresh.ts), and the adapter calls markSessionKnown() when
 * its restore settles. Guard: src/test/sessionReadersWaitForTheRestore.test.ts.
 */

/** Backstop: the adapter's hydrate is capped at 2 s; never wait past this. */
export const SESSION_KNOWN_CAP_MS = 2_500;

function isNativeShell(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as { Capacitor?: { getPlatform?: () => string; isNativePlatform?: () => boolean } }).Capacitor;
  try {
    if (cap?.isNativePlatform?.() === true) return true;
    if (typeof cap?.getPlatform === "function" && cap.getPlatform() !== "web") return true;
    return typeof location !== "undefined" && location.protocol === "capacitor:";
  } catch {
    /* a half-initialised bridge: native */
    return true;
  }
}

let known = !isNativeShell();
let release: () => void = () => {};
const knownPromise = new Promise<void>((resolve) => { release = resolve; });
if (known) release();
else setTimeout(() => markSessionKnown(), SESSION_KNOWN_CAP_MS);

/** Called by the Keychain adapter once its restore has settled (or hit its cap). */
export function markSessionKnown(): void {
  if (known) return;
  known = true;
  release();
}

/** True once a synchronous read of the stored session can be trusted. */
export function sessionKnown(): boolean {
  return known;
}

/** Resolves when sessionKnown() turns true (at once on the web). Never rejects. */
export function whenSessionKnown(): Promise<void> {
  return knownPromise;
}
