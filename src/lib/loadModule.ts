/**
 * Load a lazy module for a site that does work on it (B68, 11-01).
 *
 * In the build, `import("./x")` is wrapped in Vite's preload helper, and when main.tsx's `vite:preloadError`
 * handler starts a recovery reload it calls preventDefault(), which makes that import RESOLVE `undefined`
 * instead of rejecting. A site that then reads `m.something` throws a TypeError the page is about to reload
 * past (an unhandled rejection at boot, a failure toast flashing during the reload).
 *
 * So: resolves `null` when the module came back undefined or a recovery reload is in flight, and the module
 * otherwise. Every caller returns early, silently, on null. A real load failure still rejects as before.
 * The recovery flag lives here (chunkReload.ts sets it) so this file has no other imports: tests that mock
 * chunkReload do not reach it, and boot pulls nothing new in.
 */
let recoveryReloadInFlight = false;

/** chunkReload.ts only: a recovery reload has started (true) or was called off (false). */
export const setRecoveryReloadInFlight = (v: boolean): void => {
  recoveryReloadInFlight = v;
};

/** True from the moment a recovery reload has started until the page goes away (see chunkReload.ts). */
export const isRecoveryReloadInFlight = (): boolean => recoveryReloadInFlight;

export async function loadModule<T>(load: () => Promise<T>): Promise<T | null> {
  const m = await load();
  if (m == null || recoveryReloadInFlight) return null;
  return m;
}

/**
 * A promise that never settles: for a query, mutation or React.lazy whose module came back null. Its page is
 * reloading, so it neither throws into the query as an error nor resolves undefined data; it just waits.
 */
export const untilReload = (): Promise<never> => new Promise<never>(() => {});
