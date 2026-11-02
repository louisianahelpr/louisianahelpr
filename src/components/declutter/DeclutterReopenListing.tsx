/**
 * Relist a taken-down listing (owner 2026-10-28, deep audit SE-1). Its own module so the item page (which shows
 * Relist to the seller) does not download the Selling tab's history and handover views (B67, DECL-ITEM-SPEED).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { reopenListing } from "@/lib/declutter/api";
import { declutterErrorMessage } from "@/lib/declutter/errors";

/** Relist a taken-down listing: back to a draft, then the sell flow on it (photos first: they were deleted). */
function useReopenListing() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: (itemId: string) => reopenListing(itemId).then(() => itemId),
    onSuccess: (itemId) => {
      toast("Back in your listings. Add photos and put it up again.");
      void qc.invalidateQueries({ queryKey: ["declutter"] });
      navigate(`/declutter/sell?item=${itemId}`);
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
}

/** `quiet`: an outline button, for a list where every row carries one (Selling history, Q2580). */
export function ReopenListingButton({ itemId, quiet = false }: { itemId: string; quiet?: boolean }) {
  const reopen = useReopenListing();
  return (
    <Button type="button" size="sm" variant={quiet ? "outline" : undefined} className={quiet ? "rounded-full" : undefined} disabled={reopen.isPending} onClick={() => reopen.mutate(itemId)}>
      {reopen.isPending ? "Relisting…" : "Relist"}
    </Button>
  );
}
