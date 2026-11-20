import { useEffect } from "react";
import { useAuthReady } from "@/hooks/useAuthReady";
import { getMyWishList, saveWishList } from "@/lib/giftWishListApi";
import { giftListNow, listName, listRefs, mergeWishList, subscribeGiftList } from "./giftList";

/**
 * Signed in, the wish list lives on the account too (owner 2026-11-20): on arrival the account's list is read and folded
 * into this browser's (mergeWishList: every gift either side holds), then each change is saved back (1.5 s after the
 * last one). Nothing is saved until that first read succeeds, so a failed read never overwrites the account's list with
 * this browser's. A failed save leaves the list on the device and is retried on the next change. Signed out: nothing.
 */
const SAVE_AFTER_MS = 1500;

/** The list as it was last saved (name + refs), so an unchanged list is not saved again. */
const snapshot = () => {
  const l = giftListNow();
  return JSON.stringify([listName(l), listRefs(l)]);
};

export function useWishListSync() {
  const { user } = useAuthReady();
  const uid = user?.id ?? null;
  useEffect(() => {
    if (!uid) return;
    let live = true;
    let timer: number | undefined;
    let saved = "";
    let unsubscribe: (() => void) | undefined;
    const push = () => {
      const now = snapshot();
      if (now === saved) return;
      const l = giftListNow();
      saveWishList(listName(l), listRefs(l)).then(
        () => {
          saved = now;
        },
        (e: unknown) => {
          // The list stays on this device; the next change tries again.
          console.warn("gift wish list: sync save failed", e);
        },
      );
    };
    getMyWishList().then(
      (remote) => {
        if (!live) return;
        if (remote) {
          saved = JSON.stringify([remote.name, remote.items]);
          mergeWishList(remote);
        }
        unsubscribe = subscribeGiftList(() => {
          window.clearTimeout(timer);
          timer = window.setTimeout(push, SAVE_AFTER_MS);
        });
        // This browser held gifts the account did not (or the account had no list yet): save the merged list.
        if (giftListNow().picks.length > 0 || remote) push();
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
