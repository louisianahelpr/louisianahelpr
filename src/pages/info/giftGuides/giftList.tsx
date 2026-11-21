import { useSyncExternalStore, type MouseEvent } from "react";
import { RoundIconButton } from "@/components/ui/RoundIconButton";
import { ICON_STROKE_PX } from "@/lib/iconWeight";
import { cleanGiftName } from "@/lib/giftNameClean";

/**
 * "My Wish List" (owner 2026-11-18 "My list"; 2026-11-20: "add something that they can add to their list and send their
 * list to someone"): the guides and gifts a visitor hearts, kept in this browser (localStorage, every read and write in
 * try/catch: a private window or blocked storage just means a list that lasts the visit). Every heart on the page reads
 * the same store, so a heart and the list count change together. Signed in, useWishListSync (wishListSync.ts) keeps it
 * on the account too. A gift is kept as a REF: the guide it was saved from (`guide`, a slug; the deals page's and the
 * Small Business page's slugs for their cards) and its item id (itemId of its link, or of the business's slug), which
 * is all a shared list stores. `href` and `name` are kept as well while known (a ref synced from another device has
 * none until the list page finds it in its guide).
 */
/** A hearted gift. `guide` is where it was saved from (its chunk is fetched to show it); `id` is its item id. */
export interface SavedPick { href: string; name: string; guide?: string; id?: string }
/** A gift's reference in a shared or synced list: the guide slug and the item id, nothing else. */
export interface WishRef { g: string; i: string }
/**
 * The list in this browser. `owner` is the account it belongs to (null: a guest's list), so on a shared device the next
 * person never inherits it (security review 2026-11-20 #2). `synced` is what the account held at this browser's last
 * sync (item ids and name), so a later sync applies only the changes made here since (#3): a gift removed on another
 * device stays removed.
 */
interface GiftList { guides: string[]; picks: SavedPick[]; name: string; owner: string | null; synced: { ids: string[]; name: string } | null }

const KEY = "lh-gift-list";
/** My Wish List's page: /gift-guides/my-list. */
export const MY_LIST_SLUG = "my-list";
/** The list's name until the visitor gives it one (no field is ever required). */
export const DEFAULT_LIST_NAME = "My Wish List";
/** The most gifts one list holds (the server's own cap, gift_wish_list_save). */
const MAX_LIST_ITEMS = 100;
/** The longest list name (the server's CHECK). */
const MAX_LIST_NAME = 60;
const EMPTY: GiftList = { guides: [], picks: [], name: "", owner: null, synced: null };
let memory: GiftList = EMPTY;
let loaded = false;
const listeners = new Set<() => void>();

/**
 * A gift's item id: a 53-bit hash (cyrb53) of its link, in base 36 (at most 11 characters, matching the server's
 * ^[a-z0-9]{1,16}$). The same link gives the same id on every guide it sits on, so one heart covers them all.
 */
export function itemId(key: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let k = 0; k < key.length; k++) {
    const c = key.charCodeAt(k);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** A saved gift's id (an old save from before ids carries only its link). */
export const pickId = (p: SavedPick) => p.id ?? itemId(p.href);
/** A saved gift's ref, or null when it was saved with no guide (an old save; it shows, but a share leaves it out). */
const refOf = (p: SavedPick): WishRef | null => (p.guide ? { g: p.guide, i: pickId(p) } : null);

const isPick = (v: unknown): v is SavedPick => {
  const p = v as SavedPick;
  return !!p && typeof p === "object" && typeof p.href === "string" && typeof p.name === "string";
};

function read(): GiftList {
  if (loaded) return memory;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as Partial<GiftList>) : null;
    if (v && Array.isArray(v.guides) && Array.isArray(v.picks)) {
      const synced = v.synced && Array.isArray(v.synced.ids) && typeof v.synced.name === "string" ? { ids: v.synced.ids.filter((x) => typeof x === "string"), name: v.synced.name } : null;
      memory = { guides: v.guides.filter((s) => typeof s === "string"), picks: v.picks.filter(isPick), name: typeof v.name === "string" ? v.name : "", owner: typeof v.owner === "string" ? v.owner : null, synced };
    }
  } catch {
    // Storage blocked or the saved value is not ours: start from an empty list for this visit.
    memory = EMPTY;
  }
  return memory;
}

function write(next: GiftList) {
  memory = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage blocked (private window, full): the list still works for this visit, in memory.
  }
  listeners.forEach((l) => l());
}

export const subscribeGiftList = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** The list as it is now (outside React: the sync and the share read it). */
export const giftListNow = (): GiftList => read();

/** True when the gift with this id is on the list. */
export const isSaved = (list: GiftList, id: string) => list.picks.some((p) => pickId(p) === id);

/**
 * Add a gift to the wish list (the hearts, and any page that adds one, e.g. a swipe page). A gift already on the list
 * stays once; a full list (MAX_LIST_ITEMS) is left as it is. Returns true when the gift is on the list afterwards.
 */
export function addToWishList(pick: SavedPick): boolean {
  const cur = read();
  const id = pickId(pick);
  if (isSaved(cur, id)) return true;
  if (cur.picks.length >= MAX_LIST_ITEMS) return false;
  write({ ...cur, picks: [...cur.picks, { ...pick, id }] });
  return true;
}

/** Undo a removal (the wish list page's "Removed · Undo"): the gift goes back where it was. False when the list is full. */
export function putBackInWishList(pick: SavedPick, index: number): boolean {
  const cur = read();
  const id = pickId(pick);
  if (isSaved(cur, id)) return true;
  if (cur.picks.length >= MAX_LIST_ITEMS) return false;
  const at = Math.max(0, Math.min(index, cur.picks.length));
  write({ ...cur, picks: [...cur.picks.slice(0, at), { ...pick, id }, ...cur.picks.slice(at)] });
  return true;
}

/** Take a gift off the wish list by its id. */
export const removeFromWishList = (id: string) => {
  const cur = read();
  write({ ...cur, picks: cur.picks.filter((p) => pickId(p) !== id) });
};

/** A heart's tap: add the gift, or take it off when it is already saved. "full": the list already holds 100. */
export const togglePick = (pick: SavedPick): "added" | "removed" | "full" => {
  const id = pickId(pick);
  if (isSaved(read(), id)) {
    removeFromWishList(id);
    return "removed";
  }
  return addToWishList(pick) ? "added" : "full";
};

/** Rename the list (an empty name means the default, DEFAULT_LIST_NAME). */
export const setListName = (name: string) => write({ ...read(), name: cleanListName(name) });

/** A list name as typed, made safe to keep (src/lib/giftNameClean.ts: security review #4 and #6). */
export const cleanListName = (name: string): string => cleanGiftName(name, MAX_LIST_NAME);

/** The list's name as shown: the visitor's, or the default. */
export const listName = (list: GiftList) => list.name.trim() || DEFAULT_LIST_NAME;

/** Empty the list in this browser (sign-out, or another account's list found on this device). */
export const clearWishList = () => write(EMPTY);

/**
 * Bring this browser's list together with the signed-in account's (`remote`, null when the account has none yet).
 *   - The list belongs to another account (a shared device): it is dropped, and the account's list is taken as it is.
 *   - A guest list, or this account's list never synced here: everything either side holds (this browser's first).
 *   - This account's list synced here before: the account's list is the truth, plus only what changed here since the
 *     last sync (gifts added here are added, gifts removed here are removed; a gift removed elsewhere stays removed).
 * The list is then this account's. The caller saves the result and calls markSynced.
 */
export function reconcileWithAccount(uid: string, remote: { name: string; items: WishRef[] } | null) {
  const mine = read();
  const cur = mine.owner !== null && mine.owner !== uid ? EMPTY : mine;
  const remoteItems = remote?.items ?? [];
  const remoteName = remote && remote.name !== DEFAULT_LIST_NAME ? remote.name : "";
  const synced = cur.owner === uid ? cur.synced : null;
  const localIds = cur.picks.map(pickId);
  const known = new Map(cur.picks.map((p) => [pickId(p), p] as const));
  const fromRemote = (r: WishRef): SavedPick => known.get(r.i) ?? { href: "", name: "", guide: r.g, id: r.i };
  let ids: string[];
  let picks: SavedPick[];
  if (!synced) {
    const seen = new Set(localIds);
    picks = [...cur.picks, ...remoteItems.filter((r) => !seen.has(r.i) && seen.add(r.i)).map(fromRemote)];
  } else {
    const was = new Set(synced.ids);
    const removedHere = new Set(synced.ids.filter((i) => !localIds.includes(i)));
    const addedHere = cur.picks.filter((p) => !was.has(pickId(p)));
    const kept = remoteItems.filter((r) => !removedHere.has(r.i)).map(fromRemote);
    ids = kept.map(pickId);
    picks = [...kept, ...addedHere.filter((p) => !ids.includes(pickId(p)))];
  }
  // The name: this browser's when it was changed here since the last sync (or never synced and set here), else the account's.
  const nameChangedHere = synced ? cur.name !== synced.name : cur.name.trim() !== "";
  const name = nameChangedHere ? cur.name : remoteName;
  write({ ...cur, picks: picks.slice(0, MAX_LIST_ITEMS), name, owner: uid, synced: cur.owner === uid ? cur.synced : null });
}

/** The account now holds this browser's list as it is (after a successful save). */
export function markSynced(uid: string) {
  const cur = read();
  if (cur.owner !== uid) return;
  write({ ...cur, synced: { ids: cur.picks.map(pickId), name: cur.name } });
}

/** The list's gifts as refs (what a share or a sync stores), each once, in list order. */
export const listRefs = (list: GiftList): WishRef[] => list.picks.map(refOf).filter((r): r is WishRef => r !== null).slice(0, MAX_LIST_ITEMS);

/** The visitor's list; re-renders whenever any heart changes it. */
export const useGiftList = (): GiftList => useSyncExternalStore(subscribeGiftList, read, () => EMPTY);

/** For tests: forget the in-memory copy so the next read goes back to storage. */
export const resetGiftListForTests = () => {
  loaded = false;
  memory = EMPTY;
};

/**
 * A heart (owner 2026-11-18): a real button with aria-pressed, never inside the link it sits on, so tapping it saves
 * and does not open the guide or the shop.
 */
export function Heart({ saved, label, onToggle, className, data }: { saved: boolean; label: string; onToggle: () => void; className: string; data?: Record<`data-${string}`, string> }) {
  const click = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onToggle();
  };
  return (
    <RoundIconButton className={`gg-heart ${className}`} aria-pressed={saved} aria-label={label} onClick={click} data-gift-heart="" {...data}>
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 7.9 3.7 4.5 7.2 4.5c2 0 3.6 1.1 4.8 2.8 1.2-1.7 2.8-2.8 4.8-2.8 3.5 0 5.8 3.4 4.5 6.8-1.8 4.6-9.3 9.2-9.3 9.2z" fill={saved ? "#b26862" : "none"} stroke="#b26862" strokeWidth={ICON_STROKE_PX} strokeLinejoin="round" />
      </svg>
    </RoundIconButton>
  );
}
