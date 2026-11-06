/**
 * Declutter trades (owner 10-31): "Offer a trade" on a listing that is Open to trades. The buyer picks ONE of their
 * own live, priced listings in a sheet (the shared Sheet + RadioCardList) and sends it (declutter_offer_swap,
 * 20261106163703); the seller accepts or declines within 48 hours. Free: no money changes hands, and each side then
 * picks up the other's item like a free item.
 *
 * Shown only when the listing takes trades (fetchAcceptsTrades) and the viewer can act on it; the buyer's own listings
 * load only when the sheet opens, so the item page reads nothing extra for a listing that takes no trades.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { RadioCardList } from "@/components/ui/RadioCardList";
import { Sheet, SheetContent, SheetFooter, SheetHero, SheetPrimaryAction, SheetSecondaryAction } from "@/components/ui/sheet";
import type { DeclutterItem } from "@/lib/declutter/api";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { formatPrice } from "@/lib/declutter/distance";
import { fetchAcceptsTrades, offerSwap, tradeableListings } from "@/lib/declutter/trades";
import { tradesKey } from "./DeclutterTradeRules";
import { focusSheetItself } from "./focusSheetItself";
import { myItemsQuery } from "./myItemsQuery";
import { SELL_CHOOSER_PATH } from "@/lib/declutter/sellChooser";

export function OfferTradeButton({ item, userId }: { item: Pick<DeclutterItem, "id" | "title">; userId: string }) {
  const qc = useQueryClient();
  const takes = useQuery({ queryKey: tradesKey(item.id), queryFn: () => fetchAcceptsTrades(item.id) });
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState("");
  const mine = useQuery({ ...myItemsQuery(userId), enabled: open });
  const choices = tradeableListings(mine.data ?? [], item.id);
  const send = useMutation({
    mutationFn: (offeredId: string) => offerSwap(item.id, offeredId),
    onSuccess: () => {
      toast("Trade offer sent. The seller has 48 hours to answer.");
      setOpen(false);
      setPicked("");
      void qc.invalidateQueries({ queryKey: ["declutter"] });
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  if (takes.data !== true) return null;

  return (
    <div data-offer-trade="">
      <Button type="button" variant="outline" className="w-full" onClick={() => setOpen(true)}>
        Offer a trade
      </Button>
      <Sheet open={open} onOpenChange={(o) => { if (!send.isPending) setOpen(o); }}>
        <SheetContent side="bottom" floor onOpenAutoFocus={focusSheetItself} className="max-h-[90dvh] overflow-y-auto" data-offer-trade-sheet="">
          <SheetHero title="Offer a trade" />
          <p className="text-ds-14 text-muted-foreground [overflow-wrap:anywhere]">
            Pick one of your listings to trade for "{item.title}". No money changes hands. The seller has 48 hours to answer.
          </p>
          {mine.isLoading && <p role="status" className="mt-3 text-sm text-muted-foreground">Loading your listings…</p>}
          {mine.isError && <p role="alert" className="mt-3 text-sm text-destructive">{declutterErrorMessage(mine.error)}</p>}
          {mine.isSuccess && choices.length === 0 && (
            <p className="mt-3 text-ds-14" data-offer-trade-empty="">
              You have no listings up to trade. <Link to={SELL_CHOOSER_PATH} className="font-semibold underline underline-offset-2">List an item</Link> first.
            </p>
          )}
          {choices.length > 0 && (
            <div className="mt-3">
              <RadioCardList
                label="Your listing to trade"
                required
                options={choices.map((c) => ({ value: c.id, label: c.title, sub: formatPrice(c.current_price_cents) }))}
                value={picked}
                onChange={(v) => setPicked(v)}
              />
            </div>
          )}
          <SheetFooter className="mt-4">
            <SheetSecondaryAction disabled={send.isPending} onClick={() => setOpen(false)}>Cancel</SheetSecondaryAction>
            <SheetPrimaryAction disabled={!picked || send.isPending} onClick={() => picked && send.mutate(picked)}>
              {send.isPending ? "Sending…" : "Send trade offer"}
            </SheetPrimaryAction>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
