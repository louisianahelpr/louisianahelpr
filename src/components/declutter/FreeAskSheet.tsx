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

const ZONE = "America/Chicago";

/** "Today 3 PM" / "Mon 11/2, 10 AM". */
function askTimeLabel(iso: string, nowMs = Date.now()): string {
  const d = new Date(iso);
  const day = (x: Date) => new Intl.DateTimeFormat("en-US", { timeZone: ZONE, year: "numeric", month: "numeric", day: "numeric" }).format(x);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: ZONE, hour: "numeric", minute: "2-digit" }).format(d).replace(":00", "");
  if (day(d) === day(new Date(nowMs))) return `Today ${time}`;
  if (day(d) === day(new Date(nowMs + 86_400_000))) return `Tomorrow ${time}`;
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: ZONE, weekday: "short", month: "numeric", day: "numeric" }).format(d);
  return `${wd}, ${time}`;
}

export default function FreeAskSheet({ item, giverFirstName, open, onClose }: {
  item: DeclutterItem; giverFirstName: string; open: boolean; onClose: () => void;
}) {
  const qc = useQueryClient();
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
  const where = hasPlaces ? [...new Set(placeList.map((p) => p.area))].join(" or ") : item.area_label;
  const ask = useMutation({
    mutationFn: (iso: string) => requestFreeAt(item.id, iso),
    onSuccess: () => {
      toast(`Asked. ${giverFirstName} picks who gets it, and we'll tell you.`);
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
        <SheetHero title="Ask for it" />
        <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
          {item.title} · <span className="font-semibold text-[hsl(var(--burnt-sienna))]">Free</span>
        </p>
        <section className="mt-4 space-y-2" aria-labelledby="free-ask-when">
          <h2 id="free-ask-when" className="text-base font-semibold">When can you pick it up?</h2>
          <p className="text-ds-13 text-muted-foreground">From {giverFirstName === "The giver" ? "the giver" : giverFirstName}'s pickup times · {where}</p>
          {failed ? (
            <ErrorState variant="inline" title="We couldn't load the pickup times." body={declutterErrorMessage(failed)}
              onRetry={() => { void places.refetch(); void usual.refetch(); }} />
          ) : loading ? (
            <p className="text-sm text-muted-foreground" role="status">Loading the pickup times…</p>
          ) : days.length === 0 || !day ? (
            <p className="text-sm text-muted-foreground" data-free-ask-no-times="">
              {giverFirstName} has no pickup times open in the next week, so this item can't be asked for right now.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Pickup day">
                {days.map((d) => (
                  <Chip key={d.ymd} on={d.ymd === day.ymd} onClick={() => { setDayPick(d.ymd); setSlot(null); }}>
                    {askTimeLabel(d.slots[0].iso).startsWith("Today") ? "Today" : d.label}
                  </Chip>
                ))}
              </div>
              <div className="flex flex-wrap gap-2" role="group" aria-label={`Pickup time on ${day.label}`}>
                {day.slots.map((s) => (
                  <Chip key={s.iso} on={s.iso === slot} onClick={() => setSlot(s.iso)}>{s.label.replace(":00", "")}</Chip>
                ))}
              </div>
            </>
          )}
        </section>
        <p className="mt-4 rounded-xl px-3 py-2 text-ds-14 text-foreground" style={{ background: "hsl(var(--burnt-sienna) / 0.08)" }} data-sheet-note="">
          {/* Owner mockup 11-01: the pick books this time (declutter_pick_free_request, 20261101181129). */}
          Free, nothing is charged. {giverFirstName} picks who gets it. If it's you,{" "}
          {slot ? <strong>{askTimeLabel(slot)}</strong> : "the time you pick"} is already set, and you'll get the address.
        </p>
        <SheetFooter className="mt-4">
          <SheetPrimaryAction onClick={() => slot && ask.mutate(slot)} disabled={!slot || ask.isPending}>
            {slot ? `Ask for it · ${askTimeLabel(slot)}` : "Pick a time to ask"}
          </SheetPrimaryAction>
        </SheetFooter>
        <p className="mt-2 text-center text-ds-13 text-muted-foreground">You can ask for up to 3 free items at a time.</p>
      </SheetContent>
    </Sheet>
  );
}
