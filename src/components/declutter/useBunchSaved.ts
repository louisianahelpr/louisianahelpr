/**
 * Keeps Sell a bunch on the device while the seller works (audit finding 2; the store is lib/declutter/bunchSaved.ts)
 * and warns before the tab closes. Each listing step is saved at once, even after the screen has gone (the back link
 * during a run): a bunch brought back must never make an item's draft twice.
 *
 * What is kept: a photo on an item, and every photo while it is being sorted (a crash mid-sort brings those back as
 * items to name). A photo the seller dropped is removed, so it never comes back.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { blankItem, type BunchItem, type BunchPhoto } from "@/lib/declutter/bunch";
import { clearSavedBunchNow, loadSavedBunch, removeBunchPhoto, saveBunchMeta, saveBunchPhoto } from "@/lib/declutter/bunchSaved";

export interface BunchSnapshot {
  areaLabel: string;
  pickupAddress: string;
  coords: { lat: number; lng: number; address: string } | null;
  photos: BunchPhoto[];
  items: BunchItem[];
  sorting: boolean;
  /** Everything was listed: nothing is left to bring back. */
  finished: boolean;
}

const SAVE_DELAY_MS = 400;
const BUNCH_NOT_SAVED = "We couldn't save your work on this device, so keep this page open until you've listed your items.";

/** Items and their photos, as saved; a photo no item holds becomes an item to name, so none is lost. */
function restoredItems(items: BunchItem[], photos: BunchPhoto[]): BunchItem[] {
  const present = new Set(photos.map((p) => p.key));
  const kept = items
    .map((it) => ({ ...it, photoKeys: it.photoKeys.filter((k) => present.has(k)) }))
    .filter((it) => it.photoKeys.length > 0);
  const held = new Set(kept.flatMap((it) => it.photoKeys));
  return [...kept, ...photos.filter((p) => !held.has(p.key)).map((p) => blankItem([p.key]))];
}

export function useBunchSaved(
  userId: string | undefined,
  snapshot: BunchSnapshot,
  setItems: (update: (items: BunchItem[]) => BunchItem[]) => void,
  onRestore: (snapshot: Omit<BunchSnapshot, "sorting" | "finished">) => void,
) {
  const [note, setNote] = useState<string | null>(null);
  const [restoredCount, setRestoredCount] = useState(0);
  const ready = useRef(false);
  const latest = useRef(snapshot);
  const onDisk = useRef(new Set<string>());
  const queue = useRef<Promise<void>>(Promise.resolve());
  const restore = useRef(onRestore);
  restore.current = onRestore;

  /** One write at a time, in order; a failure says so on the screen and the work on screen is untouched. */
  const enqueue = useCallback((write: () => Promise<void>) => {
    queue.current = queue.current.then(write).then(() => setNote(null)).catch((err: unknown) => {
      console.warn("[declutter] could not save the bunch on this device", err);
      setNote(BUNCH_NOT_SAVED);
    });
  }, []);

  const flush = useCallback(() => {
    if (!ready.current || !userId) return;
    enqueue(async () => {
      const s = latest.current;
      if (s.finished || (s.items.length === 0 && !s.sorting && !s.areaLabel.trim() && !s.pickupAddress.trim())) {
        await clearSavedBunchNow();
        onDisk.current.clear();
        return;
      }
      const held = new Set(s.items.flatMap((it) => it.photoKeys));
      const keep = s.sorting ? s.photos : s.photos.filter((p) => held.has(p.key));
      const keepKeys = new Set(keep.map((p) => p.key));
      for (const p of keep) {
        if (onDisk.current.has(p.key)) continue;
        await saveBunchPhoto(p);
        onDisk.current.add(p.key);
      }
      for (const k of [...onDisk.current]) {
        if (keepKeys.has(k)) continue;
        await removeBunchPhoto(k);
        onDisk.current.delete(k);
      }
      await saveBunchMeta({
        userId,
        savedAt: Date.now(),
        areaLabel: s.areaLabel,
        pickupAddress: s.pickupAddress,
        coords: s.coords,
        photos: keep.map((p) => ({ key: p.key, name: p.file.name, type: p.file.type })),
        items: s.items,
      });
    });
  }, [enqueue, userId]);

  // Bring back what was saved, once for this member, before anything is saved over it.
  useEffect(() => {
    if (!userId) return;
    let stale = false;
    void (async () => {
      try {
        const found = await loadSavedBunch(userId);
        if (stale || !found) return;
        const items = restoredItems(found.saved.items, found.photos);
        found.photos.forEach((p) => onDisk.current.add(p.key));
        setRestoredCount(items.length);
        restore.current({ areaLabel: found.saved.areaLabel, pickupAddress: found.saved.pickupAddress, coords: found.saved.coords, photos: found.photos, items });
      } catch (err) {
        // No storage (private mode, blocked site data): the page still works; the first save says so if it fails too.
        console.warn("[declutter] could not read a saved bunch", err);
      } finally {
        if (!stale) ready.current = true;
      }
    })();
    return () => {
      stale = true;
    };
  }, [userId]);

  // The snapshot's own fields, never its identity: the view builds a new object each render.
  const { areaLabel, pickupAddress, coords, photos, items, sorting, finished } = snapshot;
  useEffect(() => {
    latest.current = { areaLabel, pickupAddress, coords, photos, items, sorting, finished };
    const t = setTimeout(flush, SAVE_DELAY_MS);
    return () => clearTimeout(t);
  }, [areaLabel, pickupAddress, coords, photos, items, sorting, finished, flush]);
  // Leaving the screen saves what the delay had not reached yet.
  useEffect(() => flush, [flush]);

  // A closing tab: the browser's own "leave this page?". Saved work comes back; a run in progress stops, so it warns.
  const hasWork = items.length > 0 || photos.length > 0;
  useEffect(() => {
    if (!hasWork || finished) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasWork, finished]);

  /** A listing step on one item (null = it has left the list). Saved now, so a crash after it never repeats it. */
  const applyStep = useCallback((key: string, patch: Partial<BunchItem> | null) => {
    const change = (list: BunchItem[]) => (patch === null ? list.filter((it) => it.key !== key) : list.map((it) => (it.key === key ? { ...it, ...patch } : it)));
    latest.current = { ...latest.current, items: change(latest.current.items) };
    setItems(change);
    flush();
  }, [flush, setItems]);

  const clearSaved = useCallback(() => {
    enqueue(async () => {
      await clearSavedBunchNow();
      onDisk.current.clear();
    });
    setRestoredCount(0);
  }, [enqueue]);

  return { note, restoredCount, dismissRestored: () => setRestoredCount(0), applyStep, clearSaved };
}
