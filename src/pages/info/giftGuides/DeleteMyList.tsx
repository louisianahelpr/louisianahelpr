import { useState } from "react";
import { Button } from "@/components/ui/button";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { WISH } from "@/content/giftWishList";
import { deleteMyWishList, wishErrorCopy } from "@/lib/giftWishListApi";
import { forgetAccountList } from "./giftList";

/**
 * Signed in, "Delete my list" on My Wish List (holiday audit 1121, Medium: "No way to delete a wish list or stop a
 * shared link"). Asks first (the shared confirm dialog), then deletes the account's list on the server
 * (gift_wish_list_delete: its link stops opening) and empties it here, not synced, so nothing is saved back until a gift
 * is added again. Guard: src/test/wishListDelete1121.test.tsx.
 */
export function DeleteMyList() {
  const [asking, setAsking] = useState(false);
  const [said, setSaid] = useState<{ text: string; ok: boolean } | null>(null);
  const confirm = async () => {
    setAsking(false);
    try {
      await deleteMyWishList();
      forgetAccountList();
      setSaid({ text: WISH.deleteMyListDone, ok: true });
    } catch (e) {
      // Shown in plain words; the list stays as it was, here and on the account.
      console.warn("gift wish list: delete failed", e);
      setSaid({ text: wishErrorCopy(e) ?? WISH.deleteMyListFailed, ok: false });
    }
  };
  return (
    <p className="gg-price-note" data-gift-wish-delete-row="">
      <Button type="button" variant="link" size="inline" className="gg-link gg-list-delete" onClick={() => { setSaid(null); setAsking(true); }} data-gift-wish-delete="">{WISH.deleteMyList}</Button>
      {said && <span role={said.ok ? "status" : "alert"} data-gift-wish-delete-said=""> {said.text}</span>}
      <BrandConfirmDialog
        open={asking}
        onOpenChange={setAsking}
        title={WISH.deleteMyListTitle}
        description={WISH.deleteMyListBody}
        primaryLabel={WISH.deleteMyList}
        primaryTone="sienna"
        primaryHaptic="warning"
        onPrimary={() => void confirm()}
        secondaryLabel={WISH.keepList}
      />
    </p>
  );
}
