import { useEffect, useRef, useSyncExternalStore } from "react";
import { useAuthReady } from "@/hooks/useAuthReady";
import { getMyWishList, saveWishList, wishErrorCopy } from "@/lib/giftWishListApi";
import { clearWishList, giftListNow, listName, listRefs, markSynced, pickId, reconcileWithAccount, subscribeGiftList } from "./giftList";
import { WISH } from "@/content/giftWishList";

/**
 * Signed in, the wish list lives on the account too (owner 2026-11-20). Security review 2026-11-20:
 *   #2 the list in this browser carries its account (owner). Signed out, a list that belongs to an account is cleared,
 *      so on a shared device the next person never inherits it; signed in as someone else, it is dropped, never merged.
 *   #3 after this browser's first sync the account's list is the truth: on arrival only the changes made here since
 *      the last sync are applied (reconcileWithAccount), so a gift removed on another device stays removed.
 * Each change is saved back 1.5 s after the last one. Nothing is saved until the first read succeeds, so a failed read
 * never overwrites the account's list. A failed save leaves the list on the device and is retried on the next change.
 */
const SAVE_AFTER_MS = 1500;

// The last sync refusal's words (null: none), for My Wish List.
let syncProblem: string | null = null;
const problemListeners = new Set<() => void>();
function setSyncProblem(p: string | null) {
  if (p === syncProblem) return;
  syncProblem = p;
  problemListeners.forEach((l) => l());
}
const subscribeProblem = (l: () => void) => {
  problemListeners.add(l);
  return () => {
    problemListeners.delete(l);
  };
};
/** Why the account's copy is behind (a refused save), or null. */
export const useSyncProblem = () => useSyncExternalStore(subscribeProblem, () => syncProblem, () => null);
// The signed-in sync's save, for My Wish List's "Try again" (null while no account sync runs).
let retry: (() => void) | null = null;
/** Save the list to the account again now (after a failed save). */
export const retryWishListSync = () => retry?.();

export function useWishListSync() {
  const { user, isReady } = useAuthReady();
  const uid = user?.id ?? null;
  const wasSignedIn = useRef(false);

  // Signed out (now, or since this list was saved under an account): this browser keeps no account's list.
  useEffect(() => {
    if (!isReady || uid) return;
    if (wasSignedIn.current || giftListNow().owner !== null) clearWishList();
    wasSignedIn.current = false;
  }, [isReady, uid]);

  useEffect(() => {
    if (!uid) return;
    wasSignedIn.current = true;
    let live = true;
    let timer: number | undefined;
    let unsubscribe: (() => void) | undefined;
    const push = () => {
      const l = giftListNow();
      if (l.owner !== uid) return;
      const now = { ids: l.picks.map(pickId), name: l.name };
      if (l.synced && JSON.stringify(l.synced) === JSON.stringify(now)) return;
      // Never synced and nothing in it (a member who only opened a guide): no row is made for an empty list.
      if (!l.synced && l.picks.length === 0 && !l.name.trim()) return;
      saveWishList(listName(l), listRefs(l)).then(
        () => {
          markSynced(uid);
          setSyncProblem(null);
        },
        (e: unknown) => {
          // The list stays on this device; the next change tries again. A refusal with words (a name the server will not
          // keep) is shown on My Wish List instead of "Saved to your account".
          console.warn("gift wish list: sync save failed", e);
          // Holiday audit 1121: ANY failed save says so (offline used to say nothing, under "Saved to your account").
          setSyncProblem(wishErrorCopy(e) ?? WISH.syncFailed);
        },
      );
    };
    // Back online: try again at once (the list waited on the device).
    const online = () => push();
    retry = push;
    window.addEventListener("online", online);
    getMyWishList().then(
      (remote) => {
        if (!live) return;
        reconcileWithAccount(uid, remote);
        // Holiday audit 1121: nothing to send when this device's list is already the account's (a first visit from a
        // new device used to save it again anyway).
        const l = giftListNow();
        if (remote && JSON.stringify(listRefs(l)) === JSON.stringify(remote.items) && listName(l) === listName({ ...l, name: remote.name })) markSynced(uid);
        unsubscribe = subscribeGiftList(() => {
          window.clearTimeout(timer);
          timer = window.setTimeout(push, SAVE_AFTER_MS);
        });
        push();
      },
      (e: unknown) => {
        // Not read: nothing is saved this visit (never overwrite the account's list blind); the list works on the device.
        console.warn("gift wish list: sync read failed", e);
      },
    );
    return () => {
      live = false;
      window.clearTimeout(timer);
      unsubscribe?.();
      window.removeEventListener("online", online);
      if (retry === push) retry = null;
    };
  }, [uid]);
}
