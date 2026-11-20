import { useEffect, useRef } from "react";
import { useAuthReady } from "@/hooks/useAuthReady";
import { getMyWishList, saveWishList } from "@/lib/giftWishListApi";
import { clearWishList, giftListNow, listName, listRefs, markSynced, pickId, reconcileWithAccount, subscribeGiftList } from "./giftList";

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
      saveWishList(listName(l), listRefs(l)).then(
        () => markSynced(uid),
        (e: unknown) => {
          // The list stays on this device; the next change tries again.
          console.warn("gift wish list: sync save failed", e);
        },
      );
    };
    getMyWishList().then(
      (remote) => {
        if (!live) return;
        reconcileWithAccount(uid, remote);
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
    };
  }, [uid]);
}
