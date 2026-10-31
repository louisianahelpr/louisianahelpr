/**
 * "Is it still available?" on a free listing (owner's choice, 2026-10-30). The notice from
 * declutter_free_still_available_sweep links to `?tab=selling&still=<id>`, and this sheet is one tap either way:
 * "Still available" asks again in 14 days, "It's gone" ends the listing as marked gone elsewhere (open offers and free
 * asks close, and their people are told). A link to a listing no longer up, or no longer free, just clears itself.
 */
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetFooter, SheetHero, SheetPrimaryAction, SheetSecondaryAction } from "@/components/ui/sheet";
import { markSoldElsewhere, markStillAvailable, type DeclutterItem } from "@/lib/declutter/api";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { readStillAvailableLink } from "@/lib/declutter/priceNudge";
import { focusSheetItself } from "./focusSheetItself";

export function StillAvailableSheet({ items }: { items: DeclutterItem[] | undefined }) {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const linked = readStillAvailableLink(params);
  const [asking, setAsking] = useState<DeclutterItem | null>(null);
  useEffect(() => {
    if (!linked || !items) return;
    const item = items.find((i) => i.id === linked);
    if (item?.status === "live" && item.current_price_cents === 0) setAsking(item);
    setParams((p) => {
      const next = new URLSearchParams(p);
      next.delete("still");
      return next;
    }, { replace: true });
    // `setParams` isn't stable; the link and the list are the triggers.
  }, [linked, items]);
  const answer = useMutation({
    mutationFn: async ({ id, gone }: { id: string; gone: boolean }) => { await (gone ? markSoldElsewhere(id) : markStillAvailable(id)); },
    onSuccess: (_v, { gone }) => {
      toast(gone ? "Thanks. It's off Declutter now." : "Thanks. We'll check again in 2 weeks.");
      setAsking(null);
      void qc.invalidateQueries({ queryKey: ["declutter"] });
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  return (
    <Sheet open={!!asking} onOpenChange={(o) => { if (!o && !answer.isPending) setAsking(null); }}>
      <SheetContent side="bottom" floor onOpenAutoFocus={focusSheetItself} className="max-h-[90dvh] overflow-y-auto" data-still-available="">
        <SheetHero title="Is it still available?" />
        <p className="text-ds-15 font-semibold [overflow-wrap:anywhere]">{asking?.title}</p>
        <p className="text-ds-14 text-muted-foreground">It's gone takes it off Declutter, and anyone waiting on it is told.</p>
        <SheetFooter className="mt-4">
          <SheetSecondaryAction disabled={answer.isPending} onClick={() => asking && answer.mutate({ id: asking.id, gone: true })}>It's gone</SheetSecondaryAction>
          <SheetPrimaryAction disabled={answer.isPending} onClick={() => asking && answer.mutate({ id: asking.id, gone: false })}>Still available</SheetPrimaryAction>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
