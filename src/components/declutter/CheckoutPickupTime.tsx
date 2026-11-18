/**
 * B110 (owner 11-01 11:44 AM; lead 1:14 PM): the buyer picks the pickup day and time AT CHECKOUT, before paying, from
 * the seller's pickup times (the chosen place's own hours, else the seller's usual times). A porch pickup is a
 * 2-hour window the seller leaves it out for ("3–5 PM"); a door pickup or a meetup is an exact time ("3:00 PM").
 * declutter_start_checkout (20261101191500) checks the time and freezes it on the order; payment books it and tells
 * the seller. Pure display: the days are worked out by the caller (pickupDays / porchWindowDays).
 */
import { useState } from "react";
import type { PickupDay } from "@/lib/declutter/pickupSlots";
import { Chip } from "./DeclutterFilterPanel";
import { t, useLanguage } from "@/lib/i18n/language";
import "@/lib/i18n/enDeclPanels";

export function CheckoutPickupTime({ days, porch, meetup = false, value, onPick, loading = false }: {
  days: PickupDay[];
  porch: boolean;
  meetup?: boolean;
  value: string | null;
  onPick: (iso: string | null) => void;
  loading?: boolean;
}) {
  const [dayPick, setDayPick] = useState<string | null>(null);
  useLanguage();
  if (loading) return <p className="text-ds-13 text-muted-foreground" role="status">{t("dbuy.time.loading")}</p>;
  // A3-54 (audit 11-01): no open time in the next 7 days. Pay stays open (the order's book_by and the 7-day close,
  // declutter_handover_sweep), so the buyer is told what happens after paying instead of the picker vanishing.
  if (days.length === 0) {
    return (
      <p className="text-ds-13 text-muted-foreground" role="status" data-checkout-no-times="">
        {meetup ? t("dbuy.time.noneMeet") : t("dbuy.time.nonePickup")}
      </p>
    );
  }
  const chosenDay = days.find((d) => d.ymd === dayPick) ?? days.find((d) => d.slots.some((s) => s.iso === value)) ?? days[0];
  return (
    <div className="space-y-2" data-checkout-pickup-time="">
      <p className="text-ds-14 font-semibold text-foreground">{porch || !meetup ? t("dbuy.time.whenPickUp") : t("dbuy.time.whenMeet")}</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label={t("dbuy.time.day")}>
        {days.map((d) => (
          <Chip key={d.ymd} on={d.ymd === chosenDay.ymd} onClick={() => { setDayPick(d.ymd); onPick(null); }}>{d.label}</Chip>
        ))}
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label={t("dbuy.time.timeOn", { day: chosenDay.label })}>
        {chosenDay.slots.map((s) => (
          <Chip key={s.iso} on={s.iso === value} onClick={() => onPick(s.iso)}>{s.label}</Chip>
        ))}
      </div>
      <p className="text-ds-12 text-muted-foreground">
        {porch ? t("dbuy.time.porchNote") : meetup ? t("dbuy.time.meetNote") : t("dbuy.time.doorNote")}
      </p>
    </div>
  );
}
