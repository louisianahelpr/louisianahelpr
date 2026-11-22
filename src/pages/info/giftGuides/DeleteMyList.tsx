import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { BrandConfirmDialog as BrandConfirmDialogType } from "@/components/ui/BrandConfirmDialog";
import { loadModule, untilReload } from "@/lib/loadModule";
import { report } from "@/lib/errorLogger";
import { WISH } from "@/content/giftWishList";
import { LISTS } from "@/content/giftListsManage";
import { wishErrorCopy } from "@/lib/giftWishListApi";
import { deleteMyWishList } from "@/lib/giftWishListOwnApi";
import { forgetAccountList } from "./giftList";

/**
 * Signed in, "Delete my list" on My Wish List (holiday audit 1121, Medium: "No way to delete a wish list or stop a
 * shared link"). Asks first (the shared confirm dialog), then deletes the account's list on the server
 * (gift_wish_list_delete: its link stops opening) and empties it here, not synced, so nothing is saved back until a gift
 * is added again. Guard: src/test/wishListDelete1121.test.tsx. The confirm dialog loads on the first tap, so its
 * dialog chunks stay off the guide pages' critical path (/gift-guides/:slug budget, train 1121i; lander3's pattern).
 */
const loadConfirm = () => loadModule(() => import("@/components/ui/BrandConfirmDialog"));
export function DeleteMyList() {
  const [asking, setAsking] = useState(false);
  const [said, setSaid] = useState<{ text: string; ok: boolean } | null>(null);
  const [Confirm, setConfirm] = useState<typeof BrandConfirmDialogType | null>(null);
  const ask = () => {
    setSaid(null);
    if (Confirm) return setAsking(true);
    // An empty module (a stale-chunk reload on its way) waits on untilReload().
    void loadConfirm()
      .then((m) => m ?? untilReload())
      .then(
        (m) => {
          setConfirm(() => m.BrandConfirmDialog);
          setAsking(true);
        },
        (e) => {
          // Not silent: reported, and the row says the list was not deleted.
          report(e as Error, { tags: { source: "DeleteMyList.loadConfirm" } });
          setSaid({ text: LISTS.deleteMyListFailed, ok: false });
        },
      );
  };
  const confirm = async () => {
    setAsking(false);
    try {
      await deleteMyWishList();
      forgetAccountList();
      setSaid({ text: LISTS.deleteMyListDone, ok: true });
    } catch (e) {
      // Shown in plain words; the list stays as it was, here and on the account.
      console.warn("gift wish list: delete failed", e);
      setSaid({ text: wishErrorCopy(e) ?? LISTS.deleteMyListFailed, ok: false });
    }
  };
  return (
    <p className="gg-price-note" data-gift-wish-delete-row="">
      <Button type="button" variant="link" size="inline" className="gg-link gg-list-delete" onClick={ask} data-gift-wish-delete="">{LISTS.deleteMyList}</Button>
      {said && <span role={said.ok ? "status" : "alert"} data-gift-wish-delete-said=""> {said.text}</span>}
      {Confirm && (
        <Confirm
          open={asking}
          onOpenChange={setAsking}
          title={LISTS.deleteMyListTitle}
          description={LISTS.deleteMyListBody}
          primaryLabel={LISTS.deleteMyList}
          primaryTone="sienna"
          primaryHaptic="warning"
          onPrimary={() => void confirm()}
          secondaryLabel={WISH.keepList}
        />
      )}
    </p>
  );
}
