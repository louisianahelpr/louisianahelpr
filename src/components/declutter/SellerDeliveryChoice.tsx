/**
 * Checkout's "Seller delivers" choice (migration 20261027153244; switch
 * declutter_seller_delivery; docs/specs/declutter-seller-delivery.md).
 *
 * The server decides everything: whether this seller delivers these items,
 * whether the buyer's address is in range (yes/no only), the rate and the open
 * times (declutter_seller_delivery_offer). This file draws its answer:
 *   hidden        the seller doesn't deliver, an item is switched off, or a
 *                 stored address is out of range (the spec: hide it)
 *   address       "Deliver to" first (the server geocodes it)
 *   out_of_range  the address the buyer just typed is too far (say so)
 *   no_times      "No delivery times open", not choosable
 *   pick          day chips, then time chips, then the door choice (owner
 *                 2026-10-22): "Leave it at my door" (the seller leaves it with
 *                 a photo) or "Hand it to me"
 * A failed address check (deep audit 2026-10-28 D-1/#13: a 503 geocode_unavailable
 * left "Checking…" and the order went through) says so under the field, in words,
 * and clears and hides the times until the address is changed or checks out, so
 * Pay stays off: checkout never goes ahead on an address nobody checked.
 * Audit 2026-10-30 DB-9: the server keeps the last drop-off per buyer and seller (the Helpr delivery
 * box writes the same row), and the box used to open empty with Pay on, silently delivering to an
 * address the buyer never saw here. Now the buyer types and checks the full address in THIS checkout
 * (`checked`), sees it written out in full, and only then gets the times; Pay waits for it.
 */

/** The door choice's words (owner 2026-10-22). */
export const HANDOFF_WORDS: Record<DeliveryHandoff, { title: string; words: string }> = {
  leave: { title: "Leave it at my door", words: "The seller leaves it and takes a photo. You don't need to be home." },
  hand: { title: "Hand it to me", words: "The seller hands it to you at the door, so be home at that time." },
};
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ChoicePill } from "@/components/ui/ChoicePill";
import { formatPrice } from "@/lib/declutter/distance";
import {
  deliveryTermsLabel,
  groupSlotsByDay,
  quoteSellerDelivery,
  sameSlot,
  slotLabel,
  slotTimeLabel,
  type DeliveryHandoff,
  type SellerDeliveryOffer,
} from "@/lib/declutter/sellerDelivery";
import { sellerDeliveryErrorMessage } from "@/lib/declutter/sellerDeliveryErrors";

export type SellerDeliveryState = "hidden" | "address" | "out_of_range" | "no_times" | "pick";

/** What checkout shows for this offer. `typed`: the buyer typed an address in this checkout. */
export function sellerDeliveryState(offer: SellerDeliveryOffer | null | undefined, typed: boolean): SellerDeliveryState {
  if (!offer) return "hidden";
  if (offer.available) return "pick";
  switch (offer.reason) {
    case "address_needed": return "address";
    case "out_of_range": return typed ? "out_of_range" : "hidden";
    case "no_times": return "no_times";
    default: return "hidden";
  }
}

/** The price side of the option card: what THIS order pays ("Free" when it pays nothing). */
export function sellerDeliveryPriceWords(offer: SellerDeliveryOffer | null | undefined, state: SellerDeliveryState): string {
  if (state === "no_times") return "No delivery times open";
  if (offer?.rate_cents === 0) return "Free";
  return offer?.rate_cents ? formatPrice(offer.rate_cents) : "";
}

/**
 * The seller's terms and which one applies to this order, in plain words (owner 2026-10-27):
 * "Free delivery.", "$10 delivery.", or "Free delivery on $50+, otherwise $10. Your order is
 * $52.00, so delivery is free." / "... Your order is $49.00, so delivery is $10.00."
 */
export function sellerDeliveryTermsLine(offer: SellerDeliveryOffer | null | undefined): string {
  if (!offer || offer.base_rate_cents === null || offer.base_rate_cents === undefined) return "";
  const terms = `${deliveryTermsLabel(offer.base_rate_cents, offer.free_over_cents ?? null)}.`;
  if (offer.base_rate_cents <= 0 || offer.free_over_cents == null || offer.items_cents == null || offer.rate_cents == null) return terms;
  return `${terms} Your order is ${formatPrice(offer.items_cents)}, so delivery is ${offer.rate_cents === 0 ? "free" : formatPrice(offer.rate_cents)}.`;
}

/**
 * Under the chosen option: the address (always changeable) and the times.
 * `onOffer` receives a new answer after an address check; `checked` is the address checked in this
 * checkout (null until then, and again as soon as the buyer edits it).
 */
export function SellerDeliveryPicker({ sellerId, offer, state, slot, onSlot, onOffer, handoff, onHandoff, checked, onChecked, typed = "", onTyped }: {
  sellerId: string;
  offer: SellerDeliveryOffer | null | undefined;
  state: SellerDeliveryState;
  slot: string | null;
  onSlot: (slot: string | null) => void;
  onOffer: (offer: SellerDeliveryOffer) => void;
  handoff: DeliveryHandoff | null;
  onHandoff: (h: DeliveryHandoff) => void;
  checked: string | null;
  onChecked: (address: string | null) => void;
  /** BUY-9: what the buyer already typed in this checkout's other Deliver to box; it is not typed twice. */
  typed?: string;
  onTyped?: (address: string) => void;
}) {
  const [address, setAddress] = useState(checked ?? typed);
  const days = groupSlotsByDay(offer?.slots ?? []);
  const [day, setDay] = useState<string | null>(null);
  const shownDay = days.find((d) => d.day === day) ?? days.find((d) => d.slots.some((s) => sameSlot(s, slot))) ?? days[0];
  // The words of the last failed check, shown until the address changes or a check succeeds.
  const [failed, setFailed] = useState<string | null>(null);
  const check = useMutation({
    mutationFn: (typed: string) => quoteSellerDelivery(sellerId, typed),
    // A new check drops the time picked before it and the address checked before: Pay waits for this answer.
    onMutate: () => { setFailed(null); onSlot(null); onChecked(null); },
    onSuccess: (o, typed) => { onSlot(null); setDay(null); onOffer(o); onChecked(typed); },
    onError: (err) => setFailed(sellerDeliveryErrorMessage(err)),
  });
  const errorId = `dcl-sd-address-error-${sellerId}`;
  const addressId = `dcl-sd-address-${sellerId}`;
  return (
    <div className="space-y-3 rounded-xl border border-border p-3" data-seller-delivery-picker="">
      <div className="space-y-2">
        <label htmlFor={addressId} className="block text-xs font-medium">
          Deliver to (street number, street and town)
        </label>
        <div className="flex gap-2">
          <input id={addressId} className="w-full min-w-0 rounded-lg border border-input bg-background px-3 py-2 text-sm"
            autoComplete="street-address" maxLength={300} value={address}
            aria-invalid={failed ? true : undefined} aria-describedby={failed ? errorId : undefined}
            onChange={(e) => { setAddress(e.target.value); onTyped?.(e.target.value); setFailed(null); if (checked !== null && e.target.value.trim() !== checked) onChecked(null); }} />
          <button type="button" className="shrink-0 rounded-full border border-border px-4 py-2 text-sm font-semibold"
            disabled={check.isPending || address.trim().length < 5} onClick={() => check.mutate(address.trim())}>
            {check.isPending ? "Checking…" : "Check"}
          </button>
        </div>
        {failed ? (
          <p id={errorId} role="alert" className="rounded-lg px-3 py-2 text-sm text-foreground" style={{ background: "hsl(var(--burnt-sienna) / 0.10)" }}
            data-sd-check-failed="">
            {failed} Delivery can't be booked until the address checks out. Try again, or choose another way to get it.
          </p>
        ) : checked !== null && state === "pick" ? (
          <p className="rounded-lg bg-muted px-3 py-2 text-sm" data-sd-deliver-to="">
            Delivering to <span className="font-semibold">{checked}</span>. The seller sees this address only after you pay.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground" data-sd-address-needed="">Type the full address and tap Check to see the delivery times. The seller sees it only after you pay.</p>
        )}
      </div>
      {state === "out_of_range" && (
        <p className="rounded-lg bg-muted px-3 py-2 text-sm" role="status">The seller doesn't deliver that far. Choose another way to get it, or try another address.</p>
      )}
      {state === "no_times" && (
        <p className="rounded-lg bg-muted px-3 py-2 text-sm" role="status">No delivery times are open in the next two weeks. Choose another way to get it.</p>
      )}
      {state === "pick" && !failed && sellerDeliveryTermsLine(offer) && (
        <p className="text-sm font-medium" data-sd-terms="">{sellerDeliveryTermsLine(offer)}</p>
      )}
      {state === "pick" && shownDay && checked !== null && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Pick a day</p>
          <div role="radiogroup" aria-label="Delivery day" className="flex flex-wrap gap-2">
            {days.map((d) => (
              <ChoicePill key={d.day} selected={d.day === shownDay.day} onClick={() => { setDay(d.day); if (!d.slots.some((s) => sameSlot(s, slot))) onSlot(null); }}>
                {d.label}
              </ChoicePill>
            ))}
          </div>
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Pick a time</p>
          <div role="radiogroup" aria-label="Delivery time" className="flex flex-wrap gap-2">
            {shownDay.slots.map((s) => (
              <ChoicePill key={s} selected={sameSlot(s, slot)} onClick={() => onSlot(s)}>
                {slotTimeLabel(s, offer?.slot_minutes)}
              </ChoicePill>
            ))}
          </div>
          <p className="text-xs text-muted-foreground" role="status">
            {slot ? `Delivery ${slotLabel(slot, offer?.slot_minutes)}. We hold this time while you pay.` : "Times are Louisiana time."}
          </p>
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">When the seller arrives</p>
          <div role="radiogroup" aria-label="When the seller arrives" className="grid gap-2 sm:grid-cols-2">
            {(["leave", "hand"] as const).map((h) => (
              <ChoicePill key={h} selected={handoff === h} onClick={() => onHandoff(h)}
                className="h-auto flex-col items-start rounded-2xl px-4 py-2.5 text-left">
                <span className="block text-ds-14 font-semibold">{HANDOFF_WORDS[h].title}</span>
                <span className="block text-ds-12 font-normal opacity-80">{HANDOFF_WORDS[h].words}</span>
              </ChoicePill>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
