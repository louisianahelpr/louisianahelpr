/**
 * Selling work kept on the device (audit finding 2): a reload, the back link, a killed tab or a crash used to lose every
 * photo, the written words, the prices and the address. One piece of work per store at a time, in IndexedDB; it never
 * leaves the device until the seller lists it. Photos are stored once each under their own key, so typing a price
 * rewrites only the small record. Gone after 7 days, when another member opens it, and at sign-out (authSignOut).
 *
 * Only type imports from the Declutter code: authSignOut, on every first screen, imports the clears from here.
 */
import { del, delMany, get, keys, set } from "idb-keyval";
import type { BunchItem, BunchPhoto } from "@/lib/declutter/bunch";

const MAX_AGE_MS = 7 * 24 * 3_600_000;

export interface SavedPhotos {
  userId: string;
  savedAt: number;
  photos: { key: string; name: string; type: string }[];
}

export function deviceStore<M extends SavedPhotos>(metaKey: string) {
  const photoPrefix = `${metaKey}-photo:`;
  /** Everything saved, whoever's it was. Throws when IndexedDB does (the callers say why it is safe to go on). */
  const clearNow = async (): Promise<void> => {
    const all = await keys();
    await delMany(all.filter((k) => typeof k === "string" && k.startsWith(metaKey)));
  };
  return {
    saveMeta: (saved: M): Promise<void> => set(metaKey, saved),
    savePhoto: async (photo: BunchPhoto): Promise<void> => {
      try {
        await set(photoPrefix + photo.key, photo.file);
      } catch (blobRefused) {
        // WebKit's throwaway session refuses a File or Blob and takes the same bytes as an ArrayBuffer (measured 10-30, Playwright
        // ephemeral context; persistent context takes both). Private browsing is the same kind of session on a member's phone
        // (not measured there). A full disk refuses this too, and that throw is what says "couldn't save".
        console.warn("[declutter] a photo as a file wasn't stored, trying its bytes", blobRefused);
        await set(photoPrefix + photo.key, await photo.file.arrayBuffer());
      }
    },
    removePhoto: (key: string): Promise<void> => del(photoPrefix + key),
    clearNow,
    /** This member's saved work and the photos that are still there, or null. Another member's or an old one is removed. */
    load: async (userId: string, now = Date.now()): Promise<{ saved: M; photos: BunchPhoto[] } | null> => {
      const saved = await get<M>(metaKey);
      if (!saved) return null;
      if (saved.userId !== userId || now - saved.savedAt > MAX_AGE_MS) {
        await clearNow();
        return null;
      }
      const photos: BunchPhoto[] = [];
      for (const p of saved.photos) {
        const blob = await get<Blob | ArrayBuffer>(photoPrefix + p.key);
        if (blob) photos.push({ key: p.key, file: blob instanceof File ? blob : new File([blob], p.name, { type: p.type }) });
      }
      return { saved, photos };
    },
  };
}
export type DeviceStore<M extends SavedPhotos> = ReturnType<typeof deviceStore<M>>;

/** Sign-out's call: best effort beside the other disk wipes, and never in its way. */
async function clearQuietly(clearNow: () => Promise<void>): Promise<void> {
  try {
    await clearNow();
  } catch (err) {
    // Blocked or private-mode storage has nothing we can reach; it also expires after 7 days on the next open.
    console.warn("[declutter] could not clear saved work", err);
  }
}

export interface SavedBunch extends SavedPhotos {
  areaLabel: string;
  pickupAddress: string;
  coords: { lat: number; lng: number; address: string } | null;
  /** The moving sale's date, or blank (an older save has none). */
  moveDate?: string;
  items: BunchItem[];
}

export const bunchStore = deviceStore<SavedBunch>("lh-bunch-v1");
export const loadSavedBunch = bunchStore.load;
export const clearSavedBunch = () => clearQuietly(bunchStore.clearNow);

/** One item's listing (useSellSaved): the small record is that hook's own; here only so sign-out can clear it. */
export const SELL_ONE_KEY = "lh-sell-one-v1";
export const clearSavedSellOne = () => clearQuietly(deviceStore(SELL_ONE_KEY).clearNow);

/**
 * LEAD-BUNCH-DRAFT-KEEP (owner 10-31): whether this member has selling work kept on this device, read from the small
 * records only (no photos), for the Sell chooser's "Continue where you left off". A save keeps a record only while
 * there is work, so a record of theirs under 7 days old is work. Unreadable storage: nothing to offer.
 */
export async function savedSellWork(userId: string, now = Date.now()): Promise<{ bunch: boolean; moving: boolean; one: boolean }> {
  const mine = (s: SavedPhotos | undefined): boolean => !!s && s.userId === userId && now - s.savedAt <= MAX_AGE_MS;
  try {
    const [bunch, one] = await Promise.all([get<SavedBunch>("lh-bunch-v1"), get<SavedPhotos>(SELL_ONE_KEY)]);
    return { bunch: mine(bunch), moving: mine(bunch) && !!bunch?.moveDate, one: mine(one) };
  } catch (err) {
    console.warn("[declutter] could not read saved selling work", err);
    return { bunch: false, moving: false, one: false };
  }
}
