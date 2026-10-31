/**
 * The item page when the buyer already has something going on this item (deep audit 2026-10-28, #3 and #4):
 *   - YourOfferBox: an open offer of theirs. Waiting for the seller: "Your offer $25", the time left, and
 *     "Change my offer" (the server lets a buyer only take an offer back while it is the seller's turn, so a
 *     change is: take it back here, after an in-app confirm, then enter the new amount). The seller answered with
 *     a price: their price, the time left, and "Answer it" in Buying, where Accept / Answer with a price / Say no live.
 *   - ReservedForYou: the item is reserved to THIS buyer (their own Buy now or accepted offer), so the page says
 *     "Reserved for you, not paid yet" with the time left and a link to checkout, never "Someone is buying this item."
 * Members see no fee numbers here, only amounts they offered or were offered.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { respondOffer, type CartLine, type MyOffer } from "@/lib/declutter/api";
import { checkoutLinkFor, holdHasNoStrike } from "@/lib/declutter/buyNowHold";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { formatPrice } from "@/lib/declutter/distance";
import { timeLeft } from "@/lib/declutter/timeLeft";
import { ConfirmSheet } from "./DeclutterConfirmSheet";

/** The buyer's own open offer on this item, or null. */
export function myOpenOfferOn(offers: readonly MyOffer[] | undefined, itemId: string): MyOffer | null {
  return offers?.find((o) => o.item_id === itemId && o.my_side === "buyer" && o.status === "open") ?? null;
}

/** The buyer's own cart line holding this item (not paid yet), or null. */
export function myHoldOn(cart: readonly CartLine[] | undefined, itemId: string): CartLine | null {
  return cart?.find((l) => l.item_id === itemId && l.my_side === "buyer" && l.status === "in_cart") ?? null;
}

const CHECKOUT_LINK = "/declutter?tab=buying";

/** The panel's place while the hold read is in flight (no "Someone is buying" flash, no layout jump). */
export function HoldChecking() {
  return (
    <div role="status" aria-busy="true" className="h-[88px] rounded-2xl border border-border bg-card" data-hold-checking="">
      <span className="sr-only">Checking…</span>
    </div>
  );
}

export function ReservedForYou({ line, free }: { line: CartLine; free: boolean }) {
  const by = new Date(line.checkout_by).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
  return (
    <section className="rounded-2xl border border-border bg-card p-4 space-y-3" aria-label="Reserved for you" data-reserved-for-you="">
      <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-ds-15 font-semibold text-foreground">
        <span>{free ? "It's yours. Choose how you'll pick it up." : "Reserved for you, not paid yet."}</span>
        <span className="text-ds-13 font-semibold tabular-nums text-[hsl(var(--burnt-sienna))]">{timeLeft(line.checkout_by)}</span>
      </p>
      <p className="text-ds-13 text-muted-foreground">
        {/* DA-12: a free item goes back up with no strike when its 48 hours run out (declutter_deadline_sweep).
            DB-5: so does a Buy now line (source "buy"); only an accepted offer still carries a strike. */}
        {free ? `Choose it by ${by}. If you don't, it goes back up. No strike.`
          : holdHasNoStrike([line]) ? `Pay by ${by}. If you don't, it goes back up for sale. No strike.`
            : `Check out by ${by}. If you don't, you get a strike and it goes back up for sale.`}
      </p>
      <Button asChild size="wrap" className="w-full rounded-full">
        <Link to={free ? CHECKOUT_LINK : checkoutLinkFor(line.seller_id)}>{free ? "Choose a pickup" : "Go to checkout"}</Link>
      </Button>
    </section>
  );
}

export function YourOfferBox({ offer, onChange }: { offer: MyOffer; onChange: () => void }) {
  const qc = useQueryClient();
  const [asking, setAsking] = useState(false);
  const sellerAnswered = offer.awaiting === "buyer";
  const takeBack = useMutation({
    mutationFn: () => respondOffer(offer.offer_id, "withdraw"),
    onSuccess: () => {
      setAsking(false);
      toast("Offer taken back. Enter a new one, or leave it.");
      void qc.invalidateQueries({ queryKey: ["declutter"] });
      onChange();
    },
    onError: (err) => {
      setAsking(false);
      toast.error(declutterErrorMessage(err));
    },
  });
  return (
    <div className="rounded-[20px] border border-border bg-background p-3 space-y-2" data-your-offer={sellerAnswered ? "answered" : "waiting"}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-ds-14 font-semibold text-foreground">{sellerAnswered ? "The seller answered" : "Your offer"}</p>
        <p className="text-ds-20 font-bold leading-tight tabular-nums text-[hsl(var(--burnt-sienna))]">{formatPrice(offer.amount_cents)}</p>
      </div>
      <p className="text-ds-13 font-semibold text-[hsl(var(--sage-ink))]">
        {sellerAnswered ? "Your turn to answer" : "Waiting for the seller"}, {timeLeft(offer.respond_by)}.
      </p>
      {sellerAnswered ? (
        <Button asChild variant="outline" size="wrap" className="w-full rounded-full">
          <Link to={CHECKOUT_LINK}>Answer it</Link>
        </Button>
      ) : (
        <Button type="button" variant="outline" size="wrap" className="w-full rounded-full" disabled={takeBack.isPending} onClick={() => setAsking(true)}>
          Change my offer
        </Button>
      )}
      <ConfirmSheet
        open={asking}
        pending={takeBack.isPending}
        title={`Take back your ${formatPrice(offer.amount_cents)} offer?`}
        confirmLabel="Take it back"
        onConfirm={() => takeBack.mutate()}
        onClose={() => setAsking(false)}
        testId="change-offer"
      >
        The seller is told it's taken back. Then you can enter a new amount, up to 3 offers a day on one item. Nothing
        is charged.
      </ConfirmSheet>
    </div>
  );
}
