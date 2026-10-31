/**
 * The seller's "I can deliver" settings (migration 20261027153244; switch
 * declutter_seller_delivery; docs/specs/declutter-seller-delivery.md), on the
 * Selling tab, and the per-item switch in Manage listing.
 *
 * The server keeps every rule (declutter_set_seller_delivery: free ($0) or a
 * whole-dollar rate inside the caps, with an optional "free on orders of $X or
 * more" (owner 2026-10-27), one of the distances; declutter_set_delivery_schedule:
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
import {
  SELLER_DELIVERY_RULES,
  deliveryTermsLabel,
  fetchMySellerDelivery,
  freeOverIsValid,
  rateIsValid,
  saveDeliverySchedule,
  saveSellerDelivery,
  setItemSellerDelivery,
  type DeliveryWindow,
  type MySellerDelivery,
} from "@/lib/declutter/sellerDelivery";
import { sellerDeliveryErrorMessage } from "@/lib/declutter/sellerDeliveryErrors";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { ErrorState } from "@/components/ui/ErrorState";
import { dayOffAllowed, dayOffBounds, dayOffLabel } from "@/lib/declutter/daysOff";
import { PickupTimesEditor } from "./DeclutterPickupTimes";

const KEY = ["declutter", "my-seller-delivery"] as const;
const FIRST_WINDOW: DeliveryWindow = { weekday: 6, starts: "09:00", ends: "12:00" };

/** The seller's settings, read only while the switch is on for them. */
function useMySellerDelivery(on: boolean) {
  return useQuery({ queryKey: KEY, queryFn: fetchMySellerDelivery, enabled: on });
}

/**
 * One line for the closed card: "Off", or "On · $20 delivery · up to 10 miles",
 * "On · Free delivery · ...", "On · Free delivery on $50+, otherwise $10 · ..." (owner 2026-10-27).
 */
function sellerDeliverySummary(s: MySellerDelivery | undefined): string {
  if (!s?.enabled || s.rate_cents === null || s.rate_cents === undefined) return "Off. Turn it on to offer delivery at checkout.";
  return `On · ${deliveryTermsLabel(s.rate_cents, s.free_over_cents ?? null)} · up to ${s.radius_miles} miles`;
}

/** Whole dollars typed into a box ("50"), as cents, or NaN. */
const dollarsToCents = (v: string, digits: number) => (new RegExp(`^\\d{1,${digits}}$`).test(v.trim()) ? Number(v.trim()) * 100 : NaN);

/** The card in Declutter settings (and the sell form's off notice). Renders nothing while the switch is off for this member. */
export function SellerDeliveryCard() {
  const on = useFeature("declutter_seller_delivery");
  const mine = useMySellerDelivery(on);
  const [open, setOpen] = useState(false);
  if (!on) return null;
  // NIGHT-SET-Declutterse-1: a failed read says so, with Try again.
  if (mine.isError) return <ErrorState variant="inline" title="We couldn't load your delivery setting." body={declutterErrorMessage(mine.error)} onRetry={() => void mine.refetch()} />;
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

/**
 * LEAD-DELIVER-TWICE (owner 2026-10-31): on Declutter settings the one delivery control is the "I'll deliver" tick in
 * Listing defaults; while it is ticked, the price, distance, times and days off open right under it (this), with no
 * second "I can deliver" row or on/off switch of its own: saving it turns delivery on with those terms.
 * Guard: src/components/declutter/declutterSettings.test.tsx.
 */
export function SellerDeliveryDetails() {
  const on = useFeature("declutter_seller_delivery");
  const mine = useMySellerDelivery(on);
  if (!on) return null;
  // The card's own retry line (NIGHT-SET-Declutterse-1), for this read too.
  const readFailed = mine.isError;
  if (readFailed) return <ErrorState variant="inline" title="We couldn't load your delivery setting." body={declutterErrorMessage(mine.error)} onRetry={() => void mine.refetch()} />;
  if (!mine.data) return <p role="status" className="text-ds-13 text-muted-foreground">Loading…</p>;
  return (
    <div role="group" aria-label="Your delivery price and times" data-seller-delivery-details=""
      className="rounded-[16px] border border-border bg-card">
      <SellerDeliveryForm current={mine.data} onDone={() => undefined} embedded />
    </div>
  );
}

function SellerDeliveryForm({ current, onDone, embedded = false }: { current: MySellerDelivery; onDone: () => void; embedded?: boolean }) {
  const qc = useQueryClient();
  const rules = current.rules ?? SELLER_DELIVERY_RULES;
  // Embedded under the ticked "I'll deliver": delivery is what the tick means, so there is no switch to turn it on.
  const [enabled, setEnabled] = useState(embedded ? true : current.enabled);
  // Free delivery, or a set price (owner 2026-10-27). A set price may be free on bigger orders.
  const [priceMode, setPriceMode] = useState<"free" | "paid">(current.rate_cents === 0 ? "free" : "paid");
  const [rate, setRate] = useState(current.rate_cents ? String(current.rate_cents / 100) : "");
  const [freeOverOn, setFreeOverOn] = useState(current.free_over_cents != null);
  const [freeOver, setFreeOver] = useState(current.free_over_cents ? String(current.free_over_cents / 100) : "");
  const [radius, setRadius] = useState(current.radius_miles || rules.radius_default_miles);
  const [windows, setWindows] = useState<DeliveryWindow[]>(current.windows.length ? current.windows : [FIRST_WINDOW]);
  const [daysOff, setDaysOff] = useState<string[]>(current.days_off);
  const [newDay, setNewDay] = useState("");
  useEffect(() => { setDaysOff(current.days_off); }, [current.days_off]);
  const rateCents = priceMode === "free" ? rules.free_rate_cents : dollarsToCents(rate, 3);
  const freeOverCents = priceMode === "paid" && freeOverOn ? dollarsToCents(freeOver, 5) : null;
  const rateOk = rateIsValid(rateCents, rules) && (priceMode === "free" || rateCents > 0);
  const freeOverOk = freeOverIsValid(freeOverCents, rateCents, rules);
  const formOk = rateOk && freeOverOk;
  const min = rules.rate_min_cents / 100;
  const max = rules.rate_max_cents / 100;
  // Audit #35 (2026-10-28): Save sat disabled with nothing saying why. With delivery on, the one thing
  // still missing is said beside the button; with it off there is nothing to fill in.
  const missing = !enabled || formOk
    ? null
    : !rateOk
      ? (rate.trim() ? `Your delivery price must be whole dollars, $${min} to $${max}.` : "Enter your delivery price to save, or choose Free.")
      : freeOver.trim()
        ? `The free-delivery amount must be whole dollars, $${rules.free_over_min_cents / 100} or more.`
        : "Enter the order amount for free delivery, or turn \"Free on bigger orders\" off.";
  /**
   * Turning delivery OFF saves only that. The server still checks the price it is sent
   * (declutter_set_seller_delivery), so an off save keeps what you typed when it is valid,
   * else the price you had saved, else free; the schedule (hidden while off) is left as it was.
   */
  const offTerms = (): { rate: number; freeOver: number | null } => {
    if (formOk) return { rate: rateCents, freeOver: freeOverCents };
    const saved = current.rate_cents;
    if (saved != null && rateIsValid(saved, rules)) {
      const fo = current.free_over_cents ?? null;
      return { rate: saved, freeOver: freeOverIsValid(fo, saved, rules) ? fo : null };
    }
    return { rate: rules.free_rate_cents, freeOver: null };
  };
  const save = useMutation({
    mutationFn: async () => {
      if (!enabled) {
        const t = offTerms();
        return saveSellerDelivery(false, t.rate, radius, t.freeOver);
      }
      await saveDeliverySchedule(windows, daysOff);
      return saveSellerDelivery(enabled, rateCents, radius, freeOverCents);
    },
    onSuccess: (s) => {
      qc.setQueryData(KEY, s);
      toast(s.enabled ? "Delivery is on. Buyers near you can pick a time at checkout." : "Delivery is off.");
      onDone();
    },
    onError: (err) => toast.error(sellerDeliveryErrorMessage(err)),
  });
  const canSave = !enabled || formOk;
  return (
    <form className={`space-y-5 px-4 py-4 ${embedded ? "" : "border-t border-border"}`} onSubmit={(e) => { e.preventDefault(); if (canSave) save.mutate(); }}>
      {!embedded && (
      <div className="flex items-center justify-between gap-3">
        <label htmlFor="sd-enabled" className="text-sm font-medium">Offer delivery to buyers</label>
        <Switch id="sd-enabled" checked={enabled} onCheckedChange={setEnabled} />
      </div>
      )}
      {/* Audit #35: the price, distance and times appear once delivery is switched on. */}
      {enabled ? (
      <>
      <div className="space-y-2">
        <p className="text-sm font-medium" id="sd-price-label">Your delivery price, per order</p>
        <div role="radiogroup" aria-labelledby="sd-price-label" className="flex flex-wrap gap-2">
          <ChoicePill selected={priceMode === "free"} onClick={() => setPriceMode("free")}>Free</ChoicePill>
          <ChoicePill selected={priceMode === "paid"} onClick={() => setPriceMode("paid")}>A set price</ChoicePill>
        </div>
        {priceMode === "paid" && (
          <>
            <div className="flex items-center gap-2">
              <span className="text-sm" aria-hidden>$</span>
              <input id="sd-rate" inputMode="numeric" aria-label="Delivery price in dollars"
                className="w-28 rounded-lg border border-input bg-background px-3 py-2 text-sm"
                value={rate} onChange={(e) => setRate(e.target.value.replace(/[^\d]/g, "").slice(0, 3))} aria-describedby="sd-rate-help" />
            </div>
            <p id="sd-rate-help" className={`text-xs ${rate && !rateOk ? "text-destructive-ink" : "text-muted-foreground"}`}>
              Whole dollars, ${min} to ${max}. One price for the whole order, and you keep all of it.
            </p>
            <div className="flex items-center justify-between gap-3 pt-1">
              <label htmlFor="sd-free-over-on" className="text-sm">Free on bigger orders</label>
              <Switch id="sd-free-over-on" checked={freeOverOn} onCheckedChange={setFreeOverOn} />
            </div>
            {freeOverOn && (
              <div className="space-y-1.5">
                <label htmlFor="sd-free-over" className="flex flex-wrap items-center gap-2 text-sm">
                  <span>Free delivery on orders of $</span>
                  <input id="sd-free-over" inputMode="numeric" className="w-24 rounded-lg border border-input bg-background px-3 py-2 text-sm"
                    value={freeOver} onChange={(e) => setFreeOver(e.target.value.replace(/[^\d]/g, "").slice(0, 5))}
                    aria-describedby="sd-free-over-help" />
                  <span>or more</span>
                </label>
                <p id="sd-free-over-help" className={`text-xs ${freeOver && !freeOverOk ? "text-destructive-ink" : "text-muted-foreground"}`}>
                  The items' total from you, whole dollars. Below that, your price applies.
                </p>
              </div>
            )}
          </>
        )}
        {formOk && (
          <p className="text-xs font-medium" data-sd-terms="">Buyers see: {deliveryTermsLabel(rateCents, freeOverCents)}</p>
        )}
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
                {dayOffLabel(d)}
                <button type="button" className="min-h-0 px-1 underline" aria-label={`Remove ${d}`} onClick={() => setDaysOff((xs) => xs.filter((x) => x !== d))}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <input id="sd-day-off" type="date" className="min-w-0 rounded-lg border border-input bg-background px-3 py-2 text-sm"
            min={dayOffBounds().min} max={dayOffBounds().max} value={newDay} onChange={(e) => setNewDay(e.target.value)} />
          <Button type="button" variant="outline" size="sm" disabled={!dayOffAllowed(newDay) || daysOff.includes(newDay) || daysOff.length >= 60}
            onClick={() => { setDaysOff((xs) => [...xs, newDay].sort()); setNewDay(""); }}>
            Add day off
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        You see the buyer's address after they pay. They choose "Leave it at my door" (take a photo when you leave it) or
        "Hand it to me". You're paid with the item, when the buyer has it.
      </p>
      </>
      ) : (
        <p className="text-xs text-muted-foreground" data-sd-off-hint="">
          Turn it on to set your price, how far you'll go and when you can deliver. Buyers near you can then pick a time at checkout.
        </p>
      )}
      {missing && <p className="text-xs text-destructive-ink" role="status" data-sd-missing="">{missing}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={!canSave || save.isPending}>{save.isPending ? "Saving…" : "Save delivery"}</Button>
        {!embedded && <Button type="button" variant="outline" onClick={onDone} disabled={save.isPending}>Cancel</Button>}
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
      toast(deliver ? "You'll offer delivery for this item." : "No delivery for this item.");
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
