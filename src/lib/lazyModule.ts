import { useSyncExternalStore } from "react";
import { report } from "@/lib/errorLogger";
import { getChunkRecoveryDecline, handOffStaleChunk, isChunkLoadError } from "@/lib/chunkReload";

/**
 * A module fetched on demand, read synchronously once it has arrived (Q1172).
 *
 * The shape every "framer-motion stays off the first paint" surface needs: the
 * component draws a plain version, `start()` fetches the chunk (idempotent),
 * `use()` returns the module or `null`, and the component swaps to the animated
 * version when it flips. The plain version keeps working through any failure.
 *
 * A STALE CHUNK (a deploy changed the hashes) goes to the shared recovery, the
 * bounded hard reload the error boundaries and main.tsx's vite:preloadError use
 * (chunkReload.ts handOffStaleChunk): quiet while that reload is on its way,
 * reported only when recovery declined (offline, attempts spent), with the reason.
 * It used to be reported as a member error and the dead hashed file retried on
 * every start() (error_logs e9286ab7, 2026-11-08, MobileNav.loadDockSheets).
 * Any other failure is reported and retried by the next `start()`. A module that
 * came back undefined (main.tsx prevented the preload while recovering) is not
 * kept as loaded either, so the next `start()` fetches it again.
 */
export function createLazyModule<T>(load: () => Promise<T>, source: string) {
  let loaded: T | null = null;
  let pending: Promise<T | null> | null = null;
  const listeners = new Set<() => void>();

  const start = (): void => {
    if (loaded || pending) return;
    pending = load().then(
      (mod) => {
        if (mod == null) {
          pending = null;
          return null;
        }
        loaded = mod;
        listeners.forEach((l) => l());
        return mod;
      },
      (err: unknown) => {
        pending = null;
        if (handOffStaleChunk(err)) return null;
        report(err, {
          tags: { source },
          ...(isChunkLoadError(err) ? { context: { chunkRecovery: getChunkRecoveryDecline() } } : {}),
        });
        return null;
      },
    );
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
