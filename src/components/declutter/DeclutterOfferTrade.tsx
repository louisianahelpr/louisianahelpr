/**
 * Declutter trades (owner 10-31): "Offer a trade" on a listing that is Open to trades. The buyer picks ONE of their
 * own live, priced listings in a sheet (the shared Sheet + RadioCardList) and sends it (declutter_offer_swap,
 * 20261106163703); the seller accepts or declines within 48 hours. Free: no money changes hands, and each side then
 * picks up the other's item like a free item.
 *
 * Shown only when the listing takes trades (the item read's accepts_trades; trades audit 11-08 #22 folded the extra
 * read into it) and the viewer can act on it; the buyer's own listings load only when the sheet opens, so the item page
 * reads nothing extra.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { RadioCardList } from "@/components/ui/RadioCardList";
import { Sheet, SheetContent, SheetFooter, SheetHero, SheetPrimaryAction, SheetSecondaryAction } from "@/components/ui/sheet";
import { fetchPhotos, type DeclutterItem } from "@/lib/declutter/api";
import { ListingThumb } from "./ListingThumb";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { formatPrice } from "@/lib/declutter/distance";
import { offerSwap, tradeableListings } from "@/lib/declutter/trades";
import { focusSheetItself } from "./focusSheetItself";
import { myItemsQuery } from "./myItemsQuery";
import { SELL_START_PATH } from "@/lib/declutter/sellChooser";
import { timeLeft } from "@/lib/declutter/timeLeft";
import { useMyTrades } from "./useMyTrades";
import "@/lib/i18n/enDeclPanels";
import "@/lib/i18n/enOfferTrade";
import { useLanguage } from "@/lib/i18n/language";

export function OfferTradeButton({ item, userId }: { item: Pick<DeclutterItem, "id" | "title" | "accepts_trades">; userId: string }) {
  const qc = useQueryClient();
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState("");
  const mine = useQuery({ ...myItemsQuery(userId), enabled: open });
  const choices = tradeableListings(mine.data ?? [], item.id);
  // Design audit r3 #10: each row shows its listing's cover, so "Throw pillows" and "Table lamp" don't look alike. The
  // photos read the Selling list uses (fetchPhotos), only while the sheet is open.
  const choiceIds = choices.map((c) => c.id);
  const photos = useQuery({ queryKey: ["declutter", "photos", choiceIds.join(",")], queryFn: () => fetchPhotos(choiceIds), enabled: open && choiceIds.length > 0 });
  const cover = useMemo(() => {
    const out = new Map<string, string>();
    for (const p of photos.data ?? []) if (!out.has(p.item_id)) out.set(p.item_id, p.storage_path);
    return out;
  }, [photos.data]);
  // Audit 1110 F359f: an open trade offer of the viewer's on this item was invisible here ("Offer a trade" as if none
  // was sent), unlike a cash offer's "Your offer". The same read and key as Buying's trade section, only on a listing
  // that takes trades.
  const myTrades = useMyTrades("buyer", item.accepts_trades === true ? userId : null);
  const myOpen = myTrades.data?.find((t) => t.status === "open" && t.item?.id === item.id) ?? null;
  const send = useMutation({
    mutationFn: (offeredId: string) => offerSwap(item.id, offeredId),
    onSuccess: () => {
      toast(t("dp.tradeSent"));
      setOpen(false);
      setPicked("");
      void qc.invalidateQueries({ queryKey: ["declutter"] });
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  if (item.accepts_trades !== true) return null;
  if (myOpen) {
    return (
      <div className="rounded-[20px] border border-border bg-background p-3 space-y-1" data-my-open-trade="">
        <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-ds-14 font-semibold text-foreground">
          <span className="[overflow-wrap:anywhere]">{t("dp.youOffered", { title: myOpen.offered?.title ?? t("dp.yourListing") })}</span>
          <span className="text-ds-13 tabular-nums text-muted-foreground">{timeLeft(myOpen.respond_by)}</span>
        </p>
        <p className="text-ds-13 text-muted-foreground">
          {t("dp.waitingSeller")} <Link to="/declutter?tab=buying" className="font-semibold underline underline-offset-2">{t("dp.seeInBuying")}</Link>
        </p>
      </div>
    );
  }

  return (
    <div data-offer-trade="">
      <Button type="button" variant="outline" className="w-full" onClick={() => setOpen(true)}>
        {t("dp.offerTrade")}
      </Button>
      {/* Audit 11-10 F359g: what a trade is, before the sheet. Trades move no money and are pickup only
          (declutter_checkout_free for the $0 lines; TRADE_CHECKOUT_LINE in the cart). */}
      <p className="mt-1.5 text-ds-13 text-muted-foreground" data-offer-trade-what="">
        {t("dp.tradeWhat")}
      </p>
      <Sheet open={open} onOpenChange={(o) => { if (!send.isPending) setOpen(o); }}>
        <SheetContent side="bottom" floor onOpenAutoFocus={focusSheetItself} className="max-h-[90dvh] overflow-y-auto" data-offer-trade-sheet="">
          <SheetHero title={t("dp.offerTrade")} />
          <p className="text-ds-14 text-muted-foreground [overflow-wrap:anywhere]">
            {t("dp.tradePick", { title: item.title })}
          </p>
          {mine.isLoading && <p role="status" className="mt-3 text-sm text-muted-foreground">{t("dp.loadingListings")}</p>}
          {mine.isError && <p role="alert" className="mt-3 text-sm text-destructive-ink">{declutterErrorMessage(mine.error)}</p>}
          {mine.isSuccess && choices.length === 0 && (
            <p className="mt-3 text-ds-14" data-offer-trade-empty="">
              {t("dp.noListings")} <Link to={SELL_START_PATH} className="font-semibold underline underline-offset-2">{t("dp.listAnItem")}</Link> {t("dp.first")}
            </p>
          )}
          {choices.length > 0 && (
            <div className="mt-3">
              <RadioCardList
                label={t("dp.tradeListLabel")}
                required
                options={choices.map((c) => ({ value: c.id, label: c.title, sub: formatPrice(c.current_price_cents), media: <ListingThumb small path={cover.get(c.id)} category={c.category} /> }))}
                value={picked}
                onChange={(v) => setPicked(v)}
              />
            </div>
          )}
          {/* Design audit r3 #2: Cancel left + Send right side by side, pinned to the bottom of the scrolling sheet like
              the Report dialog's, so it isn't 9 rows down. Deep audit 11-22 #41: the shared footer row lays them out (no
              grid of two fixed halves), so a label wider than its half wraps onto its own row instead of running to the
              screen edge. */}
          <SheetFooter className="sticky bottom-0 -mx-4 -mb-4 border-t border-border bg-background px-4 pb-4 pt-3 sm:-mx-5 sm:-mb-5 sm:px-5 sm:pb-5" data-offer-trade-footer="">
            <SheetSecondaryAction disabled={send.isPending} onClick={() => setOpen(false)}>{t("dp.cancel")}</SheetSecondaryAction>
            <SheetPrimaryAction disabled={!picked || send.isPending} onClick={() => picked && send.mutate(picked)}>
              {send.isPending ? t("dp.sending") : t("dp.sendTrade")}
            </SheetPrimaryAction>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
