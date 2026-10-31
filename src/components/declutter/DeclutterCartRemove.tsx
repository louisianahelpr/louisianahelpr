/**
 * "Remove" on a cart line (Declutter audit 2 B2-4 / lead A2-8, 2026-10-28): a buyer could not take an item out of
 * their cart, so it stayed held for 48 hours and a second "Buy now" from the same seller joined its checkout.
 * declutter_remove_cart_item (20261028221904) releases the hold: the item goes back on sale, the seller is told, no
 * strike. It asks first in the shared ConfirmSheet (never window.confirm).
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { removeCartItem, type CartLine } from "@/lib/declutter/api";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { ConfirmSheet } from "./DeclutterConfirmSheet";

export function RemoveFromCart({ line }: { line: Pick<CartLine, "line_id" | "item_title"> }) {
  const qc = useQueryClient();
  const [asking, setAsking] = useState(false);
  const remove = useMutation({
    mutationFn: () => removeCartItem(line.line_id),
    onSettled: () => setAsking(false),
    onSuccess: () => {
      toast("Removed from your cart. It's back on sale.");
      void qc.invalidateQueries({ queryKey: ["declutter"] });
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  return (
    <>
      <button type="button" className="shrink-0 text-ds-13 font-semibold underline underline-offset-2 min-h-11 px-1"
        aria-label={`Remove ${line.item_title} from your cart`} disabled={remove.isPending} onClick={() => setAsking(true)}>
        Remove
      </button>
      <ConfirmSheet open={asking} title="Remove it from your cart?" confirmLabel="Remove" cancelLabel="Keep it" pending={remove.isPending}
        testId="declutter-remove-cart-line" onConfirm={() => remove.mutate()} onClose={() => setAsking(false)}>
        &quot;{line.item_title}&quot; goes back on sale for everyone. Nothing is charged, and you get no strike.
      </ConfirmSheet>
    </>
  );
}
