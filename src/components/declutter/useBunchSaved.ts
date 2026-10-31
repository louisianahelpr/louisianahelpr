/**
 * Keeps Sell a bunch on the device while the seller works (audit finding 2; the store is lib/declutter/bunchSaved.ts,
 * the saving itself is useDeviceSaved) and warns before the tab closes. Each listing step is saved at once, even after
 * the screen has gone (the back link during a run): a bunch brought back must never make an item's draft twice.
 *
 * What is kept: a photo on an item, and every photo while it is being sorted (a crash mid-sort brings those back
 * together, not sorted, with a Sort again button: never sorted again by itself, or a sort that crashes the page would
 * crash it again on every reload). A photo the seller dropped is removed, so it never comes back.
 */
import { useCallback, useRef, useState } from "react";
import { addSorted, keepCleanablePhotos, keptItemIds, notSortedPile, PILE_PAGE_CLOSED, withoutPosted, type BunchItem, type BunchPhoto, type GroupResult } from "@/lib/declutter/bunch";
import { fetchItemStatuses } from "@/lib/declutter/api";
import { bunchStore, type SavedBunch } from "@/lib/declutter/bunchSaved";
import { useDeviceSaved } from "./useDeviceSaved";

export interface BunchSnapshot {
  areaLabel: string;
  pickupAddress: string;
  coords: { lat: number; lng: number; address: string } | null;
  moveDate: string;
  photos: BunchPhoto[];
  items: BunchItem[];
  sorting: boolean;
  /** Everything was listed: nothing is left to bring back. */
  finished: boolean;
}

const BUNCH_NOT_SAVED = "We couldn't save your work on this device, so keep this page open until you've listed your items.";

/** Which photos go on the device. Mid-sort no item holds them yet, so all of them: a crash must not lose a seller's photos. Otherwise only those an item holds, so a dropped item's photo never comes back. */
export function photosToSave(s: Pick<BunchSnapshot, "photos" | "items" | "sorting">): BunchPhoto[] {
  if (s.sorting) return s.photos;
  const held = new Set(s.items.flatMap((it) => it.photoKeys));
  return s.photos.filter((p) => held.has(p.key));
}

/** Items and their photos, as saved; the photos no item holds come back together as not sorted, so none is lost. */
function restoredItems(items: BunchItem[], photos: BunchPhoto[]): BunchItem[] {
  const present = new Set(photos.map((p) => p.key));
  const kept = items
    .map((it) => ({ ...it, photoKeys: it.photoKeys.filter((k) => present.has(k)) }))
    .filter((it) => it.photoKeys.length > 0);
  const held = new Set(kept.flatMap((it) => it.photoKeys));
  const orphans = photos.filter((p) => !held.has(p.key)).map((p) => p.key);
  return orphans.length > 0 ? addSorted(kept, [notSortedPile(orphans, PILE_PAGE_CLOSED)]) : kept;
}

export function useBunchSaved(
  userId: string | undefined,
  snapshot: BunchSnapshot,
  setItems: (update: (items: BunchItem[]) => BunchItem[]) => void,
  onRestore: (snapshot: Omit<BunchSnapshot, "sorting" | "finished"> & { unusable: GroupResult["unusable"] }) => void,
) {
  const [restoredCount, setRestoredCount] = useState(0);
  const { areaLabel, pickupAddress, coords, photos, items, sorting, finished } = snapshot;
  const clearOnDiskRef = useRef<() => Promise<void>>(async () => {});
  const { note, flush, latest, clearSaved: clearOnDisk } = useDeviceSaved<BunchSnapshot, SavedBunch>({
    store: bunchStore,
    userId,
    snapshot,
    watch: [areaLabel, pickupAddress, coords, photos, items, sorting, finished],
    plan: (s) => {
      if (s.finished || (s.items.length === 0 && !s.sorting && !s.areaLabel.trim() && !s.pickupAddress.trim())) return null;
      const keep = photosToSave(s);
      return { photos: keep, meta: { areaLabel: s.areaLabel, pickupAddress: s.pickupAddress, coords: s.coords, moveDate: s.moveDate, items: s.items } };
    },
    restore: async (found, stale) => {
      // LEAD-RESUME-REPOSTS: an item already posted is never offered back (the server is asked), nor its photos.
      const ids = keptItemIds(found.saved.items);
      let statuses: Map<string, string> | null = null;
      if (ids.length > 0) {
        try {
          statuses = await fetchItemStatuses(ids);
        } catch (err) {
          // Not a blocker: listing asks the server again, and an id already posted is refused there (AlreadyPosted).
          console.warn("[declutter] could not check the kept items against the server", err);
        }
      }
      if (stale()) return;
      const fresh = withoutPosted(found.saved.items, found.photos, statuses);
      const { photos: usable, unusable } = await keepCleanablePhotos(fresh.photos, fresh.items);
      if (stale()) return;
      const back = restoredItems(fresh.items, usable);
      // Everything kept was already posted: nothing comes back, and the device forgets it.
      if (back.length === 0 && fresh.posted > 0) {
        void clearOnDiskRef.current();
        return;
      }
      setRestoredCount(back.length);
      onRestore({ areaLabel: found.saved.areaLabel, pickupAddress: found.saved.pickupAddress, coords: found.saved.coords, moveDate: found.saved.moveDate ?? "", photos: usable, items: back, unusable });
    },
    warn: (items.length > 0 || photos.length > 0) && !finished,
    notSaved: BUNCH_NOT_SAVED,
  });

  clearOnDiskRef.current = clearOnDisk;

  /** A listing step on one item (null = it has left the list). Saved now, so a crash after it never repeats it. */
  const applyStep = useCallback((key: string, patch: Partial<BunchItem> | null) => {
    const change = (list: BunchItem[]) => (patch === null ? list.filter((it) => it.key !== key) : list.map((it) => (it.key === key ? { ...it, ...patch } : it)));
    latest.current = { ...latest.current, items: change(latest.current.items) };
    setItems(change);
    flush();
  }, [flush, latest, setItems]);

  const clearSaved = useCallback(() => {
    void clearOnDisk();
    setRestoredCount(0);
  }, [clearOnDisk]);

  return { note, restoredCount, dismissRestored: () => setRestoredCount(0), applyStep, clearSaved };
}
