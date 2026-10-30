/**
 * Work kept on this device while a seller lists, for Sell a bunch (useBunchSaved) and one item (useSellSaved): one
 * write at a time, a short delay after each change, a save when the screen goes, what was saved brought back once for
 * this member before anything is saved over it, and the browser's own "leave this page?" while there is work.
 *
 * The caller says what a snapshot means: `plan` turns it into the photos and the small record to keep (null: nothing to
 * keep, so everything saved goes). Photos are written once each, so typing rewrites only the small record.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { BunchPhoto } from "@/lib/declutter/bunch";
import type { DeviceStore, SavedPhotos } from "@/lib/declutter/bunchSaved";

const SAVE_DELAY_MS = 400;

export function useDeviceSaved<S, M extends SavedPhotos>({ store, userId, snapshot, watch, plan, restore, warn, notSaved }: {
  store: DeviceStore<M>;
  userId: string | undefined;
  snapshot: S;
  /** The snapshot's own fields, never its identity: a view builds a new object each render. */
  watch: readonly unknown[];
  plan: (s: S) => { photos: BunchPhoto[]; meta: Omit<M, keyof SavedPhotos> } | null;
  restore: (found: { saved: M; photos: BunchPhoto[] }, stale: () => boolean) => void | Promise<void>;
  /** Warn before the tab closes. */
  warn: boolean;
  /** Said on the screen when a write fails; the work on screen is untouched. */
  notSaved: string;
}) {
  const [note, setNote] = useState<string | null>(null);
  const ready = useRef(false);
  const latest = useRef(snapshot);
  const onDisk = useRef(new Set<string>());
  const queue = useRef<Promise<void>>(Promise.resolve());
  const planNow = useRef(plan);
  planNow.current = plan;
  const restoreNow = useRef(restore);
  restoreNow.current = restore;

  /** One write at a time, in order; a failure says so on the screen. */
  const enqueue = useCallback((write: () => Promise<void>) => {
    queue.current = queue.current.then(write).then(() => setNote(null)).catch((err: unknown) => {
      console.warn("[declutter] could not save the work on this device", err);
      setNote(notSaved);
    });
    return queue.current;
  }, [notSaved]);

  const clearSaved = useCallback(() => enqueue(async () => {
    await store.clearNow();
    onDisk.current.clear();
  }), [enqueue, store]);

  const flush = useCallback(() => {
    if (!ready.current || !userId) return;
    void enqueue(async () => {
      const p = planNow.current(latest.current);
      if (!p) {
        await store.clearNow();
        onDisk.current.clear();
        return;
      }
      const keepKeys = new Set(p.photos.map((x) => x.key));
      for (const x of p.photos) {
        if (onDisk.current.has(x.key)) continue;
        await store.savePhoto(x);
        onDisk.current.add(x.key);
      }
      for (const k of [...onDisk.current]) {
        if (keepKeys.has(k)) continue;
        await store.removePhoto(k);
        onDisk.current.delete(k);
      }
      await store.saveMeta({
        ...p.meta,
        userId,
        savedAt: Date.now(),
        photos: p.photos.map((x) => ({ key: x.key, name: x.file.name, type: x.file.type })),
      } as M);
    });
  }, [enqueue, store, userId]);

  // Bring back what was saved, once for this member, before anything is saved over it.
  useEffect(() => {
    if (!userId) return;
    let stale = false;
    void (async () => {
      try {
        const found = await store.load(userId);
        if (stale || !found) return;
        // All of them: a photo the caller leaves out is on disk, so the next save removes it.
        found.photos.forEach((p) => onDisk.current.add(p.key));
        await restoreNow.current(found, () => stale);
      } catch (err) {
        // No storage (private mode, blocked site data): the page still works; the first save says so if it fails too.
        console.warn("[declutter] could not read saved work", err);
      } finally {
        if (!stale) ready.current = true;
      }
    })();
    return () => {
      stale = true;
    };
  }, [userId, store]);

  useEffect(() => {
    latest.current = snapshot;
    const t = setTimeout(flush, SAVE_DELAY_MS);
    return () => clearTimeout(t);
  }, [...watch, flush]);
  // Leaving the screen saves what the delay had not reached yet.
  useEffect(() => flush, [flush]);

  // A closing tab: the browser's own "leave this page?". Saved work comes back; a run in progress stops, so it warns.
  useEffect(() => {
    if (!warn) return;
    const warnNow = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warnNow);
    return () => window.removeEventListener("beforeunload", warnNow);
  }, [warn]);

  return { note, flush, latest, clearSaved };
}
