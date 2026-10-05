import { useSyncExternalStore } from "react";
import { report } from "@/lib/errorLogger";

/**
 * A module fetched on demand, read synchronously once it has arrived (Q1172).
 *
 * The shape every "framer-motion stays off the first paint" surface needs: the
 * component draws a plain version, `start()` fetches the chunk (idempotent),
 * `use()` returns the module or `null`, and the component swaps to the animated
 * version when it flips. A failed fetch is reported once and retried by the next
 * `start()`; the plain version keeps working.
 */
export function createLazyModule<T>(load: () => Promise<T>, source: string) {
  let loaded: T | null = null;
  let pending: Promise<T> | null = null;
  const listeners = new Set<() => void>();

  const start = (): void => {
    if (loaded || pending) return;
    pending = load().then(
      (mod) => {
        loaded = mod;
        listeners.forEach((l) => l());
        return mod;
      },
      (err: unknown) => {
        pending = null;
        report(err, { tags: { source } });
        throw err;
      },
    );
    // The rejection is reported above; nothing awaits this promise.
    pending.catch(() => {});
  };
  const subscribe = (l: () => void) => {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  };
  const use = (): T | null => useSyncExternalStore(subscribe, () => loaded, () => null);
  return { start, use };
}
