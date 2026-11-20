/**
 * Declutter top 5 #1 (owner 11-19): "N people saved this. Send them an offer" under a live priced listing on Selling.
 * One tap opens a sheet with 10 / 15 / 20% off and the price they will see; Send offer gives each saver a private offer
 * in their Offers (declutter_send_saver_offer, once per item per 24 hours). After a send the line says how many got it
 * until the next one may go.
 *
 * The save counts are the Browse hearts' read (declutter_item_save_counts, which counts the seller's own items too);
 * the last sends are the seller's own rows of declutter_saver_offer_sends. Both are read once for the whole list.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchSaverOfferState, type DeclutterItem } from "@/lib/declutter/api";
import { formatPrice } from "@/lib/declutter/formatPrice";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import {
  SAVER_OFFER_PERCENTS, saverOfferAllowed, saverOfferCents, sendSaverOffer,
} from "@/lib/declutter/sellerTools";
import { Button } from "@/components/ui/button";
import { ToggleChip } from "@/components/ui/ToggleChip";
import { ConfirmSheet } from "./DeclutterConfirmSheet";
import "@/lib/i18n/enDeclTop5";
import { t } from "@/lib/i18n/language";

/** The save counts and last sends for the seller's live priced listings: one read each for the whole list. */
export function useSaverOfferData(userId: string, items: DeclutterItem[] | undefined) {
  const ids = (items ?? []).filter((i) => i.status === "live" && i.current_price_cents >= 200).map((i) => i.id);
  const state = useQuery({
    queryKey: ["declutter", "saver-offer-sends", userId, ids.join(",")],
    queryFn: () => fetchSaverOfferState(userId, ids),
    enabled: ids.length > 0,
  });
  return { saves: state.data?.saves ?? null, sends: state.data?.sends ?? null };
}

export function SaverOfferLine({ item, saves, lastSend }: { item: DeclutterItem; saves: number; lastSend: { at: string; sent: number } | undefined }) {
  const [open, setOpen] = useState(false);
  if (item.status !== "live" || item.current_price_cents < 200) return null;
  if (lastSend) {
    return (
      <p className="text-ds-13 text-muted-foreground" data-saver-offer-sent="">
        {lastSend.sent === 1 ? t("dt5.so.sent1") : t("dt5.so.sentN", { n: lastSend.sent })}
      </p>
    );
  }
  if (saves < 1) return null;
  return (
    <>
      {/* Post-merge check 11-20 #10: a real 44px button, not a 19px underlined link inside the line. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1" data-saver-offer="">
        <p className="text-ds-13 text-muted-foreground">{saves === 1 ? t("dt5.so.saved1") : t("dt5.so.savedN", { n: saves })}</p>
        <Button type="button" size="sm" variant="outline" className="rounded-full" onClick={() => setOpen(true)} data-saver-offer-open="">
          {t("dt5.so.send")}
        </Button>
      </div>
      {open && <SaverOfferSheet item={item} onClose={() => setOpen(false)} />}
    </>
  );
}

function SaverOfferSheet({ item, onClose }: { item: DeclutterItem; onClose: () => void }) {
  const qc = useQueryClient();
  const price = item.current_price_cents;
  const first = SAVER_OFFER_PERCENTS.find((p) => saverOfferAllowed(price, p, null)) ?? SAVER_OFFER_PERCENTS[0];
  const [pct, setPct] = useState<number>(first);
  const send = useMutation({
    mutationFn: () => sendSaverOffer(item.id, pct),
    onSuccess: (r) => {
      toast(r.sent === 1 ? t("dt5.so.toast1") : t("dt5.so.toastN", { n: r.sent }));
      void qc.invalidateQueries({ queryKey: ["declutter", "saver-offer-sends"] });
      void qc.invalidateQueries({ queryKey: ["declutter", "my-offers"] });
      onClose();
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  return (
    <ConfirmSheet
      open
      plain
      title={t("dt5.so.title", { title: item.title })}
      confirmLabel={t("dt5.so.confirm")}
      pending={send.isPending}
      confirmDisabled={!saverOfferAllowed(price, pct, null)}
      onConfirm={() => send.mutate()}
      onClose={onClose}
      testId="declutter-saver-offer"
    >
      <span className="block space-y-3">
        <span className="block">{t("dt5.so.body")}</span>
        <span role="group" aria-label={t("dt5.so.send")} className="flex flex-wrap gap-2">
          {SAVER_OFFER_PERCENTS.map((p) => (
            <ToggleChip key={p} pressed={pct === p} disabled={!saverOfferAllowed(price, p, null)} onClick={() => setPct(p)} data-saver-offer-pct={p}>
              {t("dt5.so.pctOff", { pct: p })}
            </ToggleChip>
          ))}
        </span>
        <span className="block font-semibold tabular-nums text-foreground" data-saver-offer-price="">
          {t("dt5.so.theySee", { price: formatPrice(saverOfferCents(price, pct)), was: formatPrice(price) })}
        </span>
      </span>
    </ConfirmSheet>
  );
}
