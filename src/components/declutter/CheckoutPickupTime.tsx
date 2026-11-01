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

export function CheckoutPickupTime({ days, porch, meetup = false, value, onPick, loading = false }: {
  days: PickupDay[];
  porch: boolean;
  meetup?: boolean;
  value: string | null;
  onPick: (iso: string | null) => void;
  loading?: boolean;
}) {
  const [dayPick, setDayPick] = useState<string | null>(null);
  if (loading) return <p className="text-ds-13 text-muted-foreground" role="status">Loading the seller's pickup times…</p>;
  if (days.length === 0) return null;
  const chosenDay = days.find((d) => d.ymd === dayPick) ?? days.find((d) => d.slots.some((s) => s.iso === value)) ?? days[0];
  const what = meetup ? "meet" : "pick it up";
  return (
    <div className="space-y-2" data-checkout-pickup-time="">
      <p className="text-ds-14 font-semibold text-foreground">{porch ? "When you'll pick it up" : `When you'll ${what}`}</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Pickup day">
        {days.map((d) => (
          <Chip key={d.ymd} on={d.ymd === chosenDay.ymd} onClick={() => { setDayPick(d.ymd); onPick(null); }}>{d.label}</Chip>
        ))}
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label={`Pickup time on ${chosenDay.label}`}>
        {chosenDay.slots.map((s) => (
          <Chip key={s.iso} on={s.iso === value} onClick={() => onPick(s.iso)}>{s.label}</Chip>
        ))}
      </div>
      <p className="text-ds-12 text-muted-foreground">
        {porch ? "The seller leaves it out on the porch for this window." : meetup ? "Be there at this time; the seller is told when you pay." : "The seller is told this time when you pay."}
      </p>
    </div>
  );
}
