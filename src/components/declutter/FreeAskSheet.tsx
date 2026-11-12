/**
 * "Ask for it" (owner 11-01, Mockup 3): the asker picks the pickup day and time from the giver's saved pickup times
 * WHEN THEY ASK. Day chips (the next 7 days), then that day's hour chips, then what happens, then one button that
 * names the time. The times are the ones the server checks (declutter_request_free_at, 20261101174857,
 * declutter_seller_slot_open): the giver's pickup places' hours when they have places, else their usual times.
 * Loaded only when the button is pressed (the item page stays light, B67).
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetFooter, SheetHero, SheetPrimaryAction } from "@/components/ui/sheet";
import { ErrorState } from "@/components/ui/ErrorState";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { requestFreeAt, type DeclutterItem } from "@/lib/declutter/api";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { fetchItemPickupWindows } from "@/lib/declutter/handover";
import { pickupDays, type SellerWindow } from "@/lib/declutter/pickupSlots";
import { fetchItemPickupPlaces } from "@/lib/declutter/porchPlaces";
import { Chip } from "./DeclutterFilterPanel";
import { focusSheetItself } from "./focusSheetItself";
import { firstPickSteps } from "@/lib/declutter/freePickSteps";
import { getLang, t as tr, useLanguage } from "@/lib/i18n/language";
import "@/lib/i18n/enFreeAsk";

const ZONE = "America/Chicago";

/** "Today 3 PM" / "Mon 11/2, 10 AM". */
function askTimeLabel(iso: string, nowMs = Date.now()): string {
  // F260q: day and clock words in the viewer's language.
  const locale = getLang() === "es" ? "es-US" : "en-US";
  const d = new Date(iso);
  const day = (x: Date) => new Intl.DateTimeFormat("en-US", { timeZone: ZONE, year: "numeric", month: "numeric", day: "numeric" }).format(x);
  const time = new Intl.DateTimeFormat(locale, { timeZone: ZONE, hour: "numeric", minute: "2-digit" }).format(d).replace(":00", "");
  if (day(d) === day(new Date(nowMs))) return tr("fask.todayAt", { time });
  if (day(d) === day(new Date(nowMs + 86_400_000))) return tr("fask.tomorrowAt", { time });
  const wd = new Intl.DateTimeFormat(locale, { timeZone: ZONE, weekday: "short", month: "numeric", day: "numeric" }).format(d);
  return `${wd}, ${time}`;
}

/** Is this slot today (Central)? The day chip then reads "Today". */
function isToday(iso: string, nowMs = Date.now()): boolean {
  const day = (x: Date) => new Intl.DateTimeFormat("en-US", { timeZone: ZONE, year: "numeric", month: "numeric", day: "numeric" }).format(x);
  return day(new Date(iso)) === day(new Date(nowMs));
}

export default function FreeAskSheet({ item, giverFirstName, open, onClose, oneTimeCheckAhead = false, change = false }: {
  item: DeclutterItem; giverFirstName: string; open: boolean; onClose: () => void;
  /** Audit 11-10 F359c: the asker moves the time of their open ask. declutter_request_free_at on an item already asked
   *  for returns that same ask and sets its pickup_at (20261101174857; the 20261102011547 trigger re-arms the giver's
   *  reminder), so the same sheet and call serve. */
  change?: boolean;
  /** 11-07: a member whose first pick carries the one-time ID check (FreeClaimPanel's reading): no "nothing is charged",
   *  and their asked time is not booked at the pick (declutter_pick_free_request books it only for a verified member). */
  oneTimeCheckAhead?: boolean;
}) {
  const qc = useQueryClient();
  const { t } = useLanguage();
  const webDesktop = useIsWebDesktop();
  // The same reads (and cache keys) as the item page's pickup block.
  const places = useQuery({ queryKey: ["declutter", "item-pickup-places", item.id], queryFn: () => fetchItemPickupPlaces(item.id), enabled: open });
  // "not_deployed" (an older server) reads as no places: the usual times then.
  const placeList = Array.isArray(places.data) ? places.data : [];
  const hasPlaces = placeList.length > 0;
  const usual = useQuery({
    queryKey: ["declutter", "item-pickup-windows", item.id],
    queryFn: () => fetchItemPickupWindows(item.id),
    enabled: open && places.isSuccess && !hasPlaces,
  });
  const windows: SellerWindow[] | null = hasPlaces
    ? placeList.flatMap((p) => p.windows ?? [])
    : usual.data ?? null;
  // The next 7 days; on-the-hour starts keep the chips few (the server takes any 30-minute start inside the hours).
  const days = useMemo(() => {
    if (!windows) return [];
    const now = Date.now();
    return pickupDays(windows, now, now + 7 * 86_400_000)
      .map((d) => ({ ...d, slots: d.slots.filter((s) => new Date(s.iso).getUTCMinutes() === 0) }))
      .filter((d) => d.slots.length > 0);
  }, [windows]);
  const [dayPick, setDayPick] = useState<string | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const day = days.find((d) => d.ymd === dayPick) ?? days[0] ?? null;
  const where = hasPlaces ? [...new Set(placeList.map((p) => p.area))].join(t("fask.or")) : item.area_label;
  const ask = useMutation({
    mutationFn: (iso: string) => requestFreeAt(item.id, iso),
    onSuccess: () => {
      toast(change ? t("fask.changed") : t("fask.asked", { name: giverFirstName }));
      void qc.invalidateQueries({ queryKey: ["declutter"] });
      onClose();
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const loading = places.isLoading || (!hasPlaces && places.isSuccess && usual.isLoading);
  const failed = places.isError ? places.error : usual.isError ? usual.error : null;
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o && !ask.isPending) onClose(); }}>
      <SheetContent
        side="bottom"
        floor={!webDesktop}
        className={`bg-premium-page max-h-[90dvh] overflow-y-auto ${webDesktop ? "sm:max-w-[480px]" : ""}`}
        onOpenAutoFocus={focusSheetItself}
        data-free-ask-sheet=""
      >
        <SheetHero title={change ? t("fask.changeTitle") : t("fask.title")} />
        <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
          {item.title} · <span className="font-semibold text-[hsl(var(--burnt-sienna))]">{t("fask.free")}</span>
        </p>
        <section className="mt-4 space-y-2" aria-labelledby="free-ask-when">
          <h2 id="free-ask-when" className="text-base font-semibold">{t("fask.when")}</h2>
          <p className="text-ds-13 text-muted-foreground">{giverFirstName === tr("free.theGiver") ? t("fask.fromGiver", { where }) : t("fask.fromName", { name: giverFirstName, where })}</p>
          {failed ? (
            <ErrorState variant="inline" title={t("fask.loadFailed")} body={declutterErrorMessage(failed)}
              onRetry={() => { void places.refetch(); void usual.refetch(); }} />
          ) : loading ? (
            <p className="text-sm text-muted-foreground" role="status">{t("fask.loading")}</p>
          ) : days.length === 0 || !day ? (
            <p className="text-sm text-muted-foreground" data-free-ask-no-times="">
              {t("fask.noTimes", { name: giverFirstName })}
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2" role="group" aria-label={t("fask.dayAria")}>
                {days.map((d) => (
                  <Chip key={d.ymd} on={d.ymd === day.ymd} onClick={() => { setDayPick(d.ymd); setSlot(null); }}>
                    {isToday(d.slots[0].iso) ? t("fask.today") : d.label}
                  </Chip>
                ))}
              </div>
              <div className="flex flex-wrap gap-2" role="group" aria-label={t("fask.timeAria", { day: day.label })}>
                {day.slots.map((s) => (
                  <Chip key={s.iso} on={s.iso === slot} onClick={() => setSlot(s.iso)}>{s.label.replace(":00", "")}</Chip>
                ))}
              </div>
            </>
          )}
        </section>
        <p className="mt-4 rounded-xl px-3 py-2 text-ds-14 text-foreground" style={{ background: "hsl(var(--burnt-sienna) / 0.08)" }} data-sheet-note="">
          {/* Owner mockup 11-01: the pick books this time (declutter_pick_free_request, 20261101181129), for a verified
              member only; a first-timer is told the steps they will really see (11-07 free-claim trace). */}
          {oneTimeCheckAhead ? (
            <>{t("fask.noteFirst", { name: giverFirstName, steps: firstPickSteps() })}</>
          ) : (
            <>
              {t("fask.noteLead", { name: giverFirstName })}
              {slot ? <strong>{askTimeLabel(slot)}</strong> : t("fask.theTimeYouPick")}{t("fask.noteTail")}
            </>
          )}
        </p>
        <SheetFooter className="mt-4">
          <SheetPrimaryAction onClick={() => slot && ask.mutate(slot)} disabled={!slot || ask.isPending}>
            {slot ? t(change ? "fask.changeTo" : "fask.askAt", { time: askTimeLabel(slot) }) : change ? t("fask.pickNew") : t("fask.pickToAsk")}
          </SheetPrimaryAction>
        </SheetFooter>
        <p className="mt-2 text-center text-ds-13 text-muted-foreground">{t("fask.upTo3")}</p>
      </SheetContent>
    </Sheet>
  );
}
