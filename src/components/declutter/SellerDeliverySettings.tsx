/**
 * The seller's "I can deliver" settings (migration 20261023130254; switch
 * declutter_seller_delivery; docs/specs/declutter-seller-delivery.md), on the
 * Selling tab, and the per-item switch in Manage listing.
 *
 * The server keeps every rule (declutter_set_seller_delivery: a whole-dollar
 * rate inside the caps, one of the distances; declutter_set_delivery_schedule:
 * windows at least one slot long, days off within a year). The caps and
 * choices shown come from the answer's `rules`, so the screen never says a
 * number the server does not use.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Truck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ChoicePill } from "@/components/ui/ChoicePill";
import { Switch } from "@/components/ui/switch";
import { useFeature } from "@/hooks/useFeature";
import { formatPrice } from "@/lib/declutter/distance";
import {
  SELLER_DELIVERY_RULES,
  fetchMySellerDelivery,
  rateIsValid,
  saveDeliverySchedule,
  saveSellerDelivery,
  setItemSellerDelivery,
  type DeliveryWindow,
  type MySellerDelivery,
} from "@/lib/declutter/sellerDelivery";
import { sellerDeliveryErrorMessage } from "@/lib/declutter/sellerDeliveryErrors";
import { PickupTimesEditor } from "./DeclutterPickupTimes";

const KEY = ["declutter", "my-seller-delivery"] as const;
const FIRST_WINDOW: DeliveryWindow = { weekday: 6, starts: "09:00", ends: "12:00" };

/** The seller's settings, read only while the switch is on for them. */
export function useMySellerDelivery(on: boolean) {
  return useQuery({ queryKey: KEY, queryFn: fetchMySellerDelivery, enabled: on });
}

/** One line for the closed card: "Off", or "On · $20 · up to 10 miles". */
export function sellerDeliverySummary(s: MySellerDelivery | undefined): string {
  if (!s?.enabled || !s.rate_cents) return "Off. Turn it on to offer delivery at checkout.";
  return `On · ${formatPrice(s.rate_cents)} an order · up to ${s.radius_miles} miles`;
}

/** The Selling tab's card. Renders nothing while the switch is off for this member. */
export function SellerDeliveryCard() {
  const on = useFeature("declutter_seller_delivery");
  const mine = useMySellerDelivery(on);
  const [open, setOpen] = useState(false);
  if (!on || mine.isError) return null;
  return (
    <section className="rounded-2xl border border-border bg-card" aria-label="Your delivery" data-seller-delivery-card="">
      <button type="button" className="flex w-full min-h-11 items-center gap-3 px-4 py-3 text-left" aria-expanded={open}
        onClick={() => setOpen((o) => !o)}>
        <Truck className="h-5 w-5 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">I can deliver</span>
          <span className="block text-xs text-muted-foreground">{mine.isLoading ? "Loading…" : sellerDeliverySummary(mine.data)}</span>
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open && mine.data && <SellerDeliveryForm current={mine.data} onDone={() => setOpen(false)} />}
    </section>
  );
}

function SellerDeliveryForm({ current, onDone }: { current: MySellerDelivery; onDone: () => void }) {
  const qc = useQueryClient();
  const rules = current.rules ?? SELLER_DELIVERY_RULES;
  const [enabled, setEnabled] = useState(current.enabled);
  const [rate, setRate] = useState(current.rate_cents ? String(current.rate_cents / 100) : "");
  const [radius, setRadius] = useState(current.radius_miles || rules.radius_default_miles);
  const [windows, setWindows] = useState<DeliveryWindow[]>(current.windows.length ? current.windows : [FIRST_WINDOW]);
  const [daysOff, setDaysOff] = useState<string[]>(current.days_off);
  const [newDay, setNewDay] = useState("");
  useEffect(() => { setDaysOff(current.days_off); }, [current.days_off]);
  const rateCents = /^\d{1,3}$/.test(rate.trim()) ? Number(rate.trim()) * 100 : NaN;
  const rateOk = rateIsValid(rateCents, rules);
  const save = useMutation({
    mutationFn: async () => {
      await saveDeliverySchedule(windows, daysOff);
      return saveSellerDelivery(enabled, rateCents, radius);
    },
    onSuccess: (s) => {
      qc.setQueryData(KEY, s);
      toast.success(s.enabled ? "Delivery is on. Buyers near you can pick a time at checkout." : "Delivery is off.");
      onDone();
    },
    onError: (err) => toast.error(sellerDeliveryErrorMessage(err)),
  });
  const min = rules.rate_min_cents / 100;
  const max = rules.rate_max_cents / 100;
  return (
    <form className="space-y-5 border-t border-border px-4 py-4" onSubmit={(e) => { e.preventDefault(); if (rateOk) save.mutate(); }}>
      <div className="flex items-center justify-between gap-3">
        <label htmlFor="sd-enabled" className="text-sm font-medium">Offer delivery to buyers</label>
        <Switch id="sd-enabled" checked={enabled} onCheckedChange={setEnabled} />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="sd-rate" className="block text-sm font-medium">Your delivery price, per order</label>
        <div className="flex items-center gap-2">
          <span className="text-sm" aria-hidden>$</span>
          <input id="sd-rate" inputMode="numeric" className="w-28 rounded-lg border border-input bg-background px-3 py-2 text-sm"
            value={rate} onChange={(e) => setRate(e.target.value.replace(/[^\d]/g, "").slice(0, 3))} aria-describedby="sd-rate-help" />
        </div>
        <p id="sd-rate-help" className={`text-xs ${rate && !rateOk ? "text-destructive" : "text-muted-foreground"}`}>
          Whole dollars, ${min} to ${max}. One price for the whole order, and you keep all of it.
        </p>
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-medium" id="sd-radius-label">How far you'll go</p>
        <div role="radiogroup" aria-labelledby="sd-radius-label" className="flex flex-wrap gap-2">
          {rules.radius_choices_miles.map((m) => (
            <ChoicePill key={m} selected={radius === m} onClick={() => setRadius(m)}>{m} miles</ChoicePill>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">From your item's pickup address. Buyers farther away don't see delivery.</p>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">When you can deliver</p>
        <p className="text-xs text-muted-foreground">
          Buyers pick a {rules.slot_minutes === 60 ? "1-hour" : `${rules.slot_minutes}-minute`} time inside these, from {rules.lead_hours} hours ahead
          up to {rules.horizon_days} days out. One delivery per time.
        </p>
        <PickupTimesEditor windows={windows} setWindows={setWindows} />
      </div>
      <div className="space-y-2">
        <label htmlFor="sd-day-off" className="block text-sm font-medium">Days off</label>
        {daysOff.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {daysOff.map((d) => (
              <li key={d} className="flex items-center gap-1 rounded-full border border-border px-3 py-1 text-xs">
                {new Date(`${d}T12:00:00`).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}
                <button type="button" className="min-h-0 px-1 underline" aria-label={`Remove ${d}`} onClick={() => setDaysOff((xs) => xs.filter((x) => x !== d))}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <input id="sd-day-off" type="date" className="min-w-0 rounded-lg border border-input bg-background px-3 py-2 text-sm"
            value={newDay} onChange={(e) => setNewDay(e.target.value)} />
          <Button type="button" variant="outline" size="sm" disabled={!newDay || daysOff.includes(newDay) || daysOff.length >= 60}
            onClick={() => { setDaysOff((xs) => [...xs, newDay].sort()); setNewDay(""); }}>
            Add day off
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        You see the buyer's address after they pay. They choose "Leave it at my door" (take a photo when you leave it) or
        "Hand it to me". You're paid with the item, when the buyer has it.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={!rateOk || save.isPending}>{save.isPending ? "Saving…" : "Save delivery"}</Button>
        <Button type="button" variant="outline" onClick={onDone} disabled={save.isPending}>Cancel</Button>
      </div>
    </form>
  );
}

/**
 * Manage listing's "Deliver this item" row: on unless the seller switched it
 * off (too heavy, say). Shown only while the switch is on and the seller
 * offers delivery at all.
 */
export function ItemDeliveryRow({ itemId, rowClassName }: { itemId: string; rowClassName: string }) {
  const on = useFeature("declutter_seller_delivery");
  const mine = useMySellerDelivery(on);
  const qc = useQueryClient();
  const set = useMutation({
    mutationFn: (deliver: boolean) => setItemSellerDelivery(itemId, deliver),
    onSuccess: (deliver) => {
      toast.success(deliver ? "You'll offer delivery for this item." : "No delivery for this item.");
      void qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (err) => toast.error(sellerDeliveryErrorMessage(err)),
  });
  if (!on || !mine.data?.enabled) return null;
  const deliverable = !mine.data.items_off.includes(itemId);
  return (
    <li className={rowClassName}>
      <span className="min-w-0 flex-1" id={`sd-item-${itemId}`}>
        <span className="block text-sm font-semibold">Deliver this item</span>
        <span className="block text-xs text-muted-foreground">{deliverable ? "Buyers can choose your delivery" : "Pickup only for this item"}</span>
      </span>
      <Switch aria-labelledby={`sd-item-${itemId}`} checked={deliverable} disabled={set.isPending} onCheckedChange={(v) => set.mutate(v)} />
    </li>
  );
}
