/**
 * Declutter top 5 #4 (owner 11-19): the shop-wide sale on Selling. With none set: one line and "Start a sale", which
 * opens a sheet (10 to 30% off, now or tomorrow, 2 to 14 days). With one set or running: what it is, until when, and
 * End / Cancel. The server lowers each live listing's price to its sale price and puts it back at the end
 * (20261120014036), so this card only starts and ends it.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Tag } from "lucide-react";
import { fetchMyShopSale } from "@/lib/declutter/api";
import { SHOP_SALE_PERCENTS, endShopSale, saleEnd, startShopSale } from "@/lib/declutter/sellerTools";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { Button } from "@/components/ui/button";
import { ToggleChip } from "@/components/ui/ToggleChip";
import { ConfirmSheet } from "./DeclutterConfirmSheet";
import "@/lib/i18n/enDeclTop5";
import { getLang, t } from "@/lib/i18n/language";

const DAY_CHOICES = [2, 3, 7, 14] as const;

/** "Sun, Nov 23" in the member's language. */
function saleDay(iso: string | Date): string {
  return new Date(iso).toLocaleDateString(getLang() === "es" ? "es-US" : "en-US", { weekday: "short", month: "short", day: "numeric" });
}

export function ShopSaleCard({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const sale = useQuery({ queryKey: ["declutter", "shop-sale", userId], queryFn: () => fetchMyShopSale(userId) });
  const [open, setOpen] = useState(false);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["declutter"] });
  const end = useMutation({
    mutationFn: () => endShopSale(),
    onSuccess: (r) => { toast(r === "cancelled" ? t("dt5.sale.cancelled") : t("dt5.sale.ended")); refresh(); },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  if (sale.isPending || sale.isError) return null;
  const s = sale.data;
  return (
    <section className="flex items-start gap-3 rounded-[20px] border border-border bg-card p-4" aria-label={t("dt5.sale.title")} data-shop-sale={s?.status ?? "none"}>
      <Tag className="mt-0.5 h-5 w-5 shrink-0 text-[hsl(var(--sienna-ink))]" aria-hidden />
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-ds-15 font-semibold">{t("dt5.sale.title")}</p>
        <p className="text-ds-13 text-muted-foreground">
          {!s ? t("dt5.sale.none")
            : s.status === "on" ? t("dt5.sale.on", { pct: s.percent_off, when: saleDay(s.ends_at) })
              : t("dt5.sale.scheduled", { pct: s.percent_off, from: saleDay(s.starts_at), when: saleDay(s.ends_at) })}
        </p>
        {!s ? (
          <Button type="button" size="sm" variant="outline" className="rounded-full" onClick={() => setOpen(true)} data-shop-sale-start="">{t("dt5.sale.start")}</Button>
        ) : (
          <Button type="button" size="sm" variant="outline" className="rounded-full" disabled={end.isPending} onClick={() => end.mutate()} data-shop-sale-end="">
            {s.status === "on" ? t("dt5.sale.end") : t("dt5.sale.cancel")}
          </Button>
        )}
      </div>
      {open && <StartSaleSheet onClose={() => setOpen(false)} onDone={refresh} />}
    </section>
  );
}

function StartSaleSheet({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [pct, setPct] = useState<number>(20);
  const [tomorrow, setTomorrow] = useState(false);
  const [days, setDays] = useState<number>(3);
  const start = useMutation({
    mutationFn: () => {
      const now = new Date();
      const from = tomorrow ? new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0) : now;
      return startShopSale(pct, from, saleEnd(from, days)); // review 11-19 #5: clamped to 1-14 days
    },
    onSuccess: () => { toast(tomorrow ? t("dt5.sale.set") : t("dt5.sale.started")); onDone(); onClose(); },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const from = tomorrow ? new Date(Date.now() + 86_400_000) : new Date();
  return (
    <ConfirmSheet open plain title={t("dt5.sale.sheetTitle")} confirmLabel={t("dt5.sale.confirm")} pending={start.isPending}
      onConfirm={() => start.mutate()} onClose={onClose} testId="declutter-shop-sale">
      <span className="block space-y-3">
        <span className="block">{t("dt5.sale.sheetBody")}</span>
        <span role="group" aria-label={t("dt5.sale.title")} className="flex flex-wrap gap-2">
          {SHOP_SALE_PERCENTS.map((p) => (
            <ToggleChip key={p} pressed={pct === p} onClick={() => setPct(p)} data-shop-sale-pct={p}>{t("dt5.sale.pctOff", { pct: p })}</ToggleChip>
          ))}
        </span>
        <span className="block text-ds-13 font-semibold text-foreground">{t("dt5.sale.starts")}</span>
        <span role="group" aria-label={t("dt5.sale.starts")} className="flex flex-wrap gap-2">
          <ToggleChip pressed={!tomorrow} onClick={() => setTomorrow(false)}>{t("dt5.sale.today")}</ToggleChip>
          <ToggleChip pressed={tomorrow} onClick={() => setTomorrow(true)}>{t("dt5.sale.tomorrow")}</ToggleChip>
        </span>
        <span className="block text-ds-13 font-semibold text-foreground">{t("dt5.sale.through")} {saleDay(saleEnd(from, days))}</span>
        <span role="group" aria-label={t("dt5.sale.through")} className="flex flex-wrap gap-2">
          {DAY_CHOICES.map((d) => (
            <ToggleChip key={d} pressed={days === d} onClick={() => setDays(d)} data-shop-sale-days={d}>{t("dt5.sale.days", { n: d })}</ToggleChip>
          ))}
        </span>
      </span>
    </ConfirmSheet>
  );
}
