/**
 * Load a lazy module for a site that does work on it (B68, 11-01).
 *
 * In the build, `import("./x")` is wrapped in Vite's preload helper, and when main.tsx's `vite:preloadError`
 * handler starts a recovery reload it calls preventDefault(), which makes that import RESOLVE `undefined`
 * instead of rejecting. A site that then reads `m.something` throws a TypeError the page is about to reload
 * past (an unhandled rejection at boot, a failure toast flashing during the reload).
 *
 * So: resolves `null` when the module came back undefined, and the module otherwise. Every caller returns
 * early, silently, on null, or waits on untilReload() below. A real load failure still rejects as before.
 * The recovery flag lives here (chunkReload.ts sets it) so this file has no other imports: tests that mock
 * chunkReload do not reach it, and boot pulls nothing new in.
 */
let recoveryReloadInFlight = false;
/** Pending untilReload() waits, failed at once when the reload is called off. */
const waiters = new Set<() => void>();

/** chunkReload.ts only: a recovery reload has started (true) or was called off (false). */
export const setRecoveryReloadInFlight = (v: boolean): void => {
  recoveryReloadInFlight = v;
  if (!v) for (const fail of [...waiters]) fail();
};

/** True from the moment a recovery reload has started until the page goes away (see chunkReload.ts). */
export const isRecoveryReloadInFlight = (): boolean => recoveryReloadInFlight;

/**
 * Null ONLY when the module itself came back undefined (a prevented preload). A module that loaded is returned
 * even while the reload flag is on: the flag can clear without a reload (navigation during a scheduled retry, a
 * failed fire-time re-check), and work started in that window must run (review of b04c978c8f).
 */
export async function loadModule<T>(load: () => Promise<T>): Promise<T | null> {
  const m = await load();
  return m == null ? null : m;
}

/** What untilReload() rejects with; errorLogger reports it (onModuleUnavailable). */
export class ModuleUnavailableError extends Error {
  constructor(why: string) {
    super(`A lazy module came back empty: ${why}`);
    this.name = "ModuleUnavailableError";
  }
}

let unavailableListener: ((err: ModuleUnavailableError) => void) | null = null;
/** errorLogger registers the one listener told about each ModuleUnavailableError. */
export const onModuleUnavailable = (fn: ((err: ModuleUnavailableError) => void) | null): void => {
  unavailableListener = fn;
};

/** How long a site waits for the recovery reload before it fails for real. */
export const UNTIL_RELOAD_TIMEOUT_MS = 10_000;

/**
 * For a query, mutation or React.lazy whose module came back null (only before any side effect: work that has
 * already written must never wait here). While the recovery reload is under way it waits, so no failure shows
 * a moment before the page goes; it REJECTS with a reported ModuleUnavailableError at once when no reload is
 * under way, as soon as the reload is called off, or after UNTIL_RELOAD_TIMEOUT_MS.
 */
export const untilReload = (): Promise<never> =>
  new Promise<never>((_resolve, reject) => {
    const inFlight = recoveryReloadInFlight;
    const onCalledOff = () => fail("the recovery reload was called off");
    const timer = inFlight ? setTimeout(() => fail(`no reload within ${UNTIL_RELOAD_TIMEOUT_MS / 1000} s`), UNTIL_RELOAD_TIMEOUT_MS) : undefined;
    function fail(why: string) {
      if (timer !== undefined) clearTimeout(timer);
      waiters.delete(onCalledOff);
      const err = new ModuleUnavailableError(why);
      try {
        unavailableListener?.(err);
      } catch {
        /* the listener is best-effort; the caller still gets the error */
      }
      reject(err);
    }
    if (!inFlight) {
      fail("no recovery reload is under way");
      return;
    }
    waiters.add(onCalledOff);
  });
