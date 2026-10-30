/**
 * Sell a bunch, kept on the device (audit finding 2): a reload, the back link, a killed tab or a crash used to lose
 * every photo, the written words, the prices and the address. One seller's bunch at a time, in IndexedDB; it never
 * leaves the device until the seller lists it. Photos are stored once each under their own key, so typing a price
 * rewrites only the small record. Gone after 7 days, when another member opens it, and at sign-out (authSignOut).
 *
 * Only type imports from the Declutter code: authSignOut, on every first screen, imports clearSavedBunch from here.
 */
import { del, delMany, get, keys, set } from "idb-keyval";
import type { BunchItem, BunchPhoto } from "@/lib/declutter/bunch";

const META_KEY = "lh-bunch-v1";
const PHOTO_PREFIX = "lh-bunch-v1-photo:";
const MAX_AGE_MS = 7 * 24 * 3_600_000;

export interface SavedBunch {
  userId: string;
  savedAt: number;
  areaLabel: string;
  pickupAddress: string;
  coords: { lat: number; lng: number; address: string } | null;
  photos: { key: string; name: string; type: string }[];
  items: BunchItem[];
}

export function saveBunchMeta(saved: SavedBunch): Promise<void> {
  return set(META_KEY, saved);
}

export function saveBunchPhoto(photo: BunchPhoto): Promise<void> {
  return set(PHOTO_PREFIX + photo.key, photo.file);
}

export function removeBunchPhoto(key: string): Promise<void> {
  return del(PHOTO_PREFIX + key);
}

/** Everything saved, whoever's it was. Throws when IndexedDB does (the callers say why it is safe to go on). */
export async function clearSavedBunchNow(): Promise<void> {
  const all = await keys();
  await delMany(all.filter((k) => typeof k === "string" && k.startsWith(META_KEY)));
}

/** Sign-out's call: best effort beside the other disk wipes, and never in its way. */
export async function clearSavedBunch(): Promise<void> {
  try {
    await clearSavedBunchNow();
  } catch (err) {
    // Blocked or private-mode storage has nothing we can reach; it also expires after 7 days on the next open.
    console.warn("[declutter] could not clear the saved bunch", err);
  }
}

/** This member's saved bunch and the photos that are still there, or null. Another member's or an old one is removed. */
export async function loadSavedBunch(userId: string, now = Date.now()): Promise<{ saved: SavedBunch; photos: BunchPhoto[] } | null> {
  const saved = await get<SavedBunch>(META_KEY);
  if (!saved) return null;
  if (saved.userId !== userId || now - saved.savedAt > MAX_AGE_MS) {
    await clearSavedBunchNow();
    return null;
  }
  const photos: BunchPhoto[] = [];
  for (const p of saved.photos) {
    const blob = await get<Blob>(PHOTO_PREFIX + p.key);
    if (blob) photos.push({ key: p.key, file: blob instanceof File ? blob : new File([blob], p.name, { type: p.type }) });
  }
  return { saved, photos };
}
