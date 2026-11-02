/**
 * Small Declutter helpers the item page and Browse call, kept out of the heavier views they used to live in
 * (DeclutterWatching's list, DeclutterOffersSection's trade views), so a cold item page does not download those
 * (B67, DECL-ITEM-SPEED).
 */
import type { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

/** SS-5: a heart turned on says where the item can be found again, with a way there. */
export function toastWatching(navigate: (to: string) => void) {
  toast("Saved. Find it under Buying, in Saved.", { action: { label: "See it", onClick: () => navigate("/declutter?tab=buying") } });
}

/** After a trade or offer change: everything Declutter shows may have moved. */
export function invalidateTrades(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ["declutter"] });
}
