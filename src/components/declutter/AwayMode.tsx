/**
 * Declutter top 5 #5 (owner 11-19): away mode. On Selling, AwayCard: "Go away" pauses every listing for sale until a
 * day the seller picks (3 days to 2 weeks); while away it says until when, with "I'm back". On the seller's public page,
 * AwayBanner says "Away until Mon, Nov 30". The server pauses with Pause's own steps and puts the listings back up on
 * that day by itself (20261120015456).
 *
 * Post-merge check 11-20 (~/.lh-shots/declutter-top5-1120): #2 "1 week", never "1 weeks"; #8 the sheet is the plain
 * one with Not now and the action side by side, as the Sale and bulk sheets are; #13 while its read is on the way the
 * card holds its place (ShopToolBones), so it never pops in.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plane } from "lucide-react";
import { fetchMyAway, fetchSellerAwayUntil } from "@/lib/declutter/api";
import { calendarDayWords, comeBack, dateInDays, goAway } from "@/lib/declutter/sellerTools";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { Button } from "@/components/ui/button";
import { ToggleChip } from "@/components/ui/ToggleChip";
import { ConfirmSheet } from "./DeclutterConfirmSheet";
import { SHOP_TOOL_MIN, ShopToolBones } from "./ShopSaleCard";
import "@/lib/i18n/enDeclTop5";
import { getLang, t } from "@/lib/i18n/language";

const AWAY_CHOICES = [3, 7, 14] as const;

/** "3 days", "1 week", "2 weeks" (11-20 #2: the chip said "1 weeks"). */
export function awayChoiceWords(days: number): string {
  if (days % 7 !== 0) return t("dt5.away.days", { n: days });
  return days === 7 ? t("dt5.away.week1") : t("dt5.away.weeks", { n: days / 7 });
}

const dayWords = (ymd: string) => calendarDayWords(ymd, getLang() === "es" ? "es" : "en");

export function AwayCard({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const away = useQuery({ queryKey: ["declutter", "away", userId], queryFn: () => fetchMyAway(userId) });
  const [open, setOpen] = useState(false);
  const back = useMutation({
    mutationFn: () => comeBack(),
    onSuccess: () => { toast(t("dt5.away.returned")); void qc.invalidateQueries({ queryKey: ["declutter"] }); },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  if (away.isPending) return <ShopToolBones name="away" />;
  if (away.isError) return null;
  const a = away.data;
  return (
    <section className={`flex ${SHOP_TOOL_MIN} items-start gap-3 rounded-[20px] border border-border bg-card p-4`} aria-label={t("dt5.away.title")} data-away={a ? "on" : "off"}>
      <Plane className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-ds-15 font-semibold">{t("dt5.away.title")}</p>
        <p className="text-ds-13 text-muted-foreground">{a ? t("dt5.away.on", { when: dayWords(a.back_on) }) : t("dt5.away.off")}</p>
        {a ? (
          <Button type="button" size="sm" className="rounded-full" disabled={back.isPending} onClick={() => back.mutate()} data-away-back="">{t("dt5.away.back")}</Button>
        ) : (
          <Button type="button" size="sm" variant="outline" className="rounded-full" onClick={() => setOpen(true)} data-away-go="">{t("dt5.away.go")}</Button>
        )}
      </div>
      {open && <GoAwaySheet onClose={() => setOpen(false)} onDone={() => void qc.invalidateQueries({ queryKey: ["declutter"] })} />}
    </section>
  );
}

function GoAwaySheet({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [days, setDays] = useState<number>(7);
  const backOn = dateInDays(days);
  const go = useMutation({
    mutationFn: () => goAway(backOn),
    onSuccess: () => { toast(t("dt5.away.paused")); onDone(); onClose(); },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  return (
    <ConfirmSheet open plain title={t("dt5.away.sheetTitle")} confirmLabel={t("dt5.away.confirm")} pending={go.isPending}
      onConfirm={() => go.mutate()} onClose={onClose} testId="declutter-go-away">
      <span className="block space-y-3">
        <span className="block">{t("dt5.away.sheetBody")}</span>
        <span role="group" aria-label={t("dt5.away.sheetTitle")} className="flex flex-wrap gap-2">
          {AWAY_CHOICES.map((d) => (
            <ToggleChip key={d} pressed={days === d} onClick={() => setDays(d)} data-away-days={d}>{awayChoiceWords(d)}</ToggleChip>
          ))}
        </span>
        <span className="block font-semibold text-foreground" data-away-back-on="">{t("dt5.away.backOn", { when: dayWords(backOn) })}</span>
      </span>
    </ConfirmSheet>
  );
}

/** The public page's line while the seller is away; nothing otherwise. */
export function AwayBanner({ sellerId }: { sellerId: string }) {
  const until = useQuery({ queryKey: ["declutter", "seller-away", sellerId], queryFn: () => fetchSellerAwayUntil(sellerId), staleTime: 60_000 });
  if (!until.data) return null;
  return (
    <p className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-2 text-ds-13 font-semibold text-foreground" data-away-banner="">
      <Plane className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      {t("dt5.away.banner", { when: dayWords(until.data) })}
    </p>
  );
}
