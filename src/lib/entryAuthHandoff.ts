/**
 * The app side of the entry's token refresh (Q1170; the entry side, and the
 * measurement, is src/boot/entryAuthRefresh.ts).
 *
 * When the entry has started a refresh, auth-js's read of the session key
 * waits for it to settle, then reads storage: it finds the new session the
 * entry wrote and does not refresh again. If the entry's refresh failed, it
 * finds the old session and refreshes itself exactly as it did before.
 * Reads of any other key, and every write, pass straight through.
 */

/** Copy of ENTRY_AUTH_REFRESH_KEY (src/test/entryAuthRefresh.test.ts pins them equal). */
const WINDOW_KEY = "__lhEntryAuthRefresh";

type Pending = { key: string; done: Promise<void> };
type AuthStorage = {
  getItem: (key: string) => string | null | Promise<string | null>;
  setItem: (key: string, value: string) => void | Promise<void>;
  removeItem: (key: string) => void | Promise<void>;
};

export function withEntryAuthHandoff<S extends AuthStorage>(storage: S): AuthStorage {
  return {
    getItem: (key) => {
      const w = typeof window === "undefined" ? undefined : (window as unknown as Record<string, Pending | undefined>);
      const pending = w?.[WINDOW_KEY];
      if (!pending || pending.key !== key) return storage.getItem(key);
      return pending.done.then(() => {
        if (w[WINDOW_KEY] === pending) delete w[WINDOW_KEY];
        return storage.getItem(key);
      });
    },
    setItem: (key, value) => storage.setItem(key, value),
    removeItem: (key) => storage.removeItem(key),
  };
}
