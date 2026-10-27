/**
 * Declutter slice 3 screens (docs/specs/declutter-auctions.md rows 13, 16-22,
 * 36, 38, 56-59; build decisions B25-B38): the buy/offer panel on an item, the
 * Offers view (offers on your items + your offers, accept / decline / counter),
 * the Cart view (what you must check out, by seller, with the one total), and
 * the strike count. Plain words only.
 *
 * Tabs (owner, 2026-10-18; src/lib/declutter/tabs.ts): Buying (DeclutterMineViews) holds the
 * cart, "Your offers" and Purchases; the Selling tab (DeclutterHomeView) holds
 * the listings, "Offers on your items" (OffersSection side="seller"),
 * SalesWaiting and the paid sales (PaidOrders side="seller"). Every rule is enforced by the server
 * (20261014210518); the app only explains it.
 *
 * Saving a card and paying (slice 3b, B39/B45): "Save a card" opens Stripe's
 * card-saving page (nothing is charged); "Pay" opens Stripe's payment page for
 * one seller's order. Both come back to /declutter; the webhook is the only
 * source of truth for what happened, so the screens just refetch.
 * Row 62: with the switch off, a member with an agreed sale still gets the
 * cart and their sales (FinishSalesView), nothing else.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import AppPage from "@/components/AppPage";
import { ErrorState } from "@/components/ui/ErrorState";
import { useFeature } from "@/hooks/useFeature";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { queryKeys } from "@/lib/queryKeys";
import { useFirstPayoutFeeCents, useFirstPayoutFeeKnown } from "@/hooks/useFirstPayoutFee";
import {
  fetchMyActiveStrikes,
  fetchMyCart,
  fetchMyOffers,
  respondOffer,
  sellerCancelSale,
  startCheckoutPayment,
  type CartLine,
  type Handover,
  type MyOffer,
} from "@/lib/declutter/api";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { formatPrice } from "@/lib/declutter/distance";
import { buyNowTotalCents, checkoutAmounts } from "@/lib/declutter/money";
import { fetchDeliveryQuote, type DeliveryQuote } from "@/lib/declutter/delivery";
import { fetchSellerDeliveryOffer, sellerDeliveryAmounts, type DeliveryHandoff, type SellerDeliveryOffer } from "@/lib/declutter/sellerDelivery";
import { sellerDeliveryErrorMessage } from "@/lib/declutter/sellerDeliveryErrors";
import { SellerDeliveryPicker, sellerDeliveryPriceWords, sellerDeliveryState } from "./SellerDeliveryChoice";
import { openExternalUrl } from "@/lib/openExternalUrl";
import { DeclutterNotice } from "./declutterUi";
import { PaidOrders, SectionHeading } from "./DeclutterTabParts";

/** "$12.50" -> 1250; null for anything that is not a positive amount with at most 2 decimals. */
export function dollarsInputToCents(raw: string): number | null {
  const t = raw.trim().replace(/^\$/, "");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const cents = Math.round(Number(t) * 100);
  return cents > 0 ? cents : null;
}

function timeLeft(iso: string, now = Date.now()): string {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return "time is up";
  const h = Math.floor(ms / 3_600_000);
  if (h >= 1) return `${h} hour${h === 1 ? "" : "s"} left`;
  const m = Math.max(1, Math.floor(ms / 60_000));
  return `${m} minute${m === 1 ? "" : "s"} left`;
}

export { PaidOrders, SectionHeading, useDeclutterTodo } from "./DeclutterTabParts";

export function invalidateTrades(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ["declutter"] });
}

/** "You have N of 3 strikes" (rows 7, 16, 17). Nothing when there are none. */
export function StrikeCount({ userId }: { userId: string }) {
  const strikes = useQuery({ queryKey: ["declutter", "strikes", userId], queryFn: () => fetchMyActiveStrikes(userId) });
  const n = strikes.data ?? 0;
  if (n === 0) return null;
  return (
    <DeclutterNotice tone="warn" title={`You have ${Math.min(n, 3)} of 3 strikes.`}>
      {n >= 3
        ? "Declutter is paused for you until one of them goes away. Each strike goes away 1 year after you got it."
        : "Each strike goes away 1 year after you got it. At 3 strikes you can't buy or sell on Declutter until one goes away."}
    </DeclutterNotice>
  );
}

const OFFER_STATUS_WORDS: Record<MyOffer["status"], string> = {
  open: "Waiting",
  accepted: "Accepted",
  declined: "Declined",
  expired: "Ran out of time",
  withdrawn: "Taken back",
  voided: "Item went to someone else",
};

function OfferRow({ o }: { o: MyOffer }) {
  const qc = useQueryClient();
  const [counter, setCounter] = useState("");
  const [countering, setCountering] = useState(false);
  const counterCents = dollarsInputToCents(counter);
  const act = useMutation({
    mutationFn: (v: { action: "accept" | "decline" | "counter" | "withdraw"; cents?: number }) => respondOffer(o.offer_id, v.action, v.cents ?? null),
    onSuccess: (res) => {
      setCountering(false);
      setCounter("");
      toast.success(
        res === "accepted" ? (o.my_side === "buyer" ? "Accepted. Check out within 48 hours." : "Accepted. The buyer has 48 hours to pay.")
          : res === "countered" ? "Sent. They have 48 hours to answer."
            : res === "withdrawn" ? "Offer taken back."
              : "Declined.",
      );
      invalidateTrades(qc);
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const myTurn = o.status === "open" && o.awaiting === o.my_side;
  const underFloor = o.my_side === "seller" && o.floor_price_cents !== null && o.amount_cents < o.floor_price_cents;
  // What accepting really sells for: least(offer, price now) (live declutter_respond_offer -> declutter_take_item).
  const takeCents = Math.min(o.amount_cents, o.current_price_cents);
  return (
    // Boards 68-70: the offer as a card (Declutter has no pre-purchase chat): the amount in money ink with who set it,
    // the asking price, whose turn it is, and what the answer means in money, from the real rules.
    <li className="rounded-[20px] border border-border bg-card p-4 space-y-2.5" data-offer-row="">
      <div className="flex items-start justify-between gap-3 min-w-0">
        <div className="min-w-0">
          <Link to={`/declutter/item/${o.item_id}`} className="text-ds-15 font-semibold truncate block" title={o.item_title}>{o.item_title}</Link>
          <p className="text-ds-13 text-muted-foreground">Price now {formatPrice(o.current_price_cents)}</p>
        </div>
        <div className="shrink-0 text-right">
          {/* Spec v2 §1.1: amounts wear the money ink. */}
          <p className="text-ds-20 font-bold leading-tight tabular-nums text-[hsl(var(--burnt-sienna))]">{formatPrice(o.amount_cents)}</p>
          <p className="text-ds-12 text-muted-foreground">
            {o.awaiting === o.my_side ? (o.my_side === "seller" ? "their offer" : "their counter") : o.my_side === "buyer" ? "your offer" : "your price"}
          </p>
        </div>
      </div>
      {o.status !== "open" && (
        <span className="inline-flex rounded-full bg-muted px-2.5 py-1 text-xs font-medium">{OFFER_STATUS_WORDS[o.status]}</span>
      )}
      {/* Board 160: an offer that ended unpaid never charged anything (offers charge only at checkout). The item page says
          whether it can still be bought; this card does not know, so it never promises "Offer again". */}
      {o.my_side === "buyer" && (o.status === "declined" || o.status === "expired") && (
        <p className="text-ds-13 text-muted-foreground" data-offer-ended="">
          Nothing was charged.{" "}
          <Link to={`/declutter/item/${o.item_id}`} className="font-semibold text-foreground underline underline-offset-2">See the item</Link>
        </p>
      )}
      {underFloor && <p className="text-xs text-amber-700 dark:text-amber-300">This is under your lowest price ({formatPrice(o.floor_price_cents as number)}). Only you can see that.</p>}
      {o.status === "open" && (
        <p className="text-ds-13 font-semibold text-[hsl(var(--sage-ink))]">
          {myTurn ? `Your turn to answer · ${timeLeft(o.respond_by)}` : `Waiting for the ${o.my_side === "buyer" ? "seller" : "buyer"} · ${timeLeft(o.respond_by)}`}
        </p>
      )}
      {myTurn && o.my_side === "seller" && (
        // Sellers keep the whole price; the buyer's fee is on top (spec v2 §9.11).
        <p className="rounded-xl bg-[hsl(var(--burnt-sienna)/0.10)] px-3 py-2 text-ds-13 text-[hsl(var(--sienna-ink))]" data-offer-note="">
          If you accept and the buyer pays, you keep the whole {formatPrice(takeCents)}. The buyer pays the buyer's fee on top.
        </p>
      )}
      {myTurn && o.my_side === "buyer" && (
        // Board 70: what accepting the counter costs at checkout (pickup), from the same rule as Buy now.
        <dl className="space-y-1 rounded-xl border border-border p-3 text-ds-13" data-offer-bill="">
          <div className="flex justify-between gap-3"><dt>Their price</dt><dd className="font-semibold tabular-nums text-[hsl(var(--burnt-sienna))]">{formatPrice(takeCents)}</dd></div>
          <div className="flex justify-between gap-3"><dt>Buyer's fee (5% + 70¢)</dt><dd className="font-semibold tabular-nums text-[hsl(var(--burnt-sienna))]">{formatPrice(buyNowTotalCents(takeCents) - takeCents)}</dd></div>
          <div className="flex items-baseline justify-between gap-3 border-t border-border pt-1"><dt className="font-bold">You pay with pickup</dt><dd className="text-ds-16 font-bold tabular-nums text-[hsl(var(--burnt-sienna))]">{formatPrice(buyNowTotalCents(takeCents))}</dd></div>
          <p className="text-ds-12 text-muted-foreground">At most. More items from this seller make it less.</p>
        </dl>
      )}
      {myTurn && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-grad-primary rounded-full px-4 py-2 text-sm font-semibold"
            disabled={act.isPending}
            onClick={() => {
              const words = o.my_side === "seller"
                ? `Sell "${o.item_title}" for ${formatPrice(o.amount_cents)}? Every other offer on it closes, and the buyer gets 48 hours to pay.`
                : `Buy "${o.item_title}" for ${formatPrice(o.amount_cents)}? You'll have 48 hours to check out and pay.`;
              if (window.confirm(words)) act.mutate({ action: "accept" });
            }}
          >
            Accept
          </button>
          <button type="button" className="rounded-full border border-border px-4 py-2 text-sm font-semibold" disabled={act.isPending} onClick={() => setCountering((v) => !v)} aria-expanded={countering}>
            Answer with a price
          </button>
          <button type="button" className="rounded-full border border-border px-4 py-2 text-sm font-semibold" disabled={act.isPending} onClick={() => act.mutate({ action: "decline" })}>
            Say no
          </button>
        </div>
      )}
      {myTurn && countering && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (counterCents) act.mutate({ action: "counter", cents: counterCents });
          }}
        >
          <label className="sr-only" htmlFor={`counter-${o.offer_id}`}>Your price</label>
          <input
            id={`counter-${o.offer_id}`}
            inputMode="decimal"
            className="flex-1 min-w-0 rounded-lg border border-input bg-background px-3 py-2 text-sm"
            value={counter}
            onChange={(e) => setCounter(e.target.value)}
            placeholder="Your price, like 30"
          />
          <button type="submit" className="btn-grad-primary rounded-full px-4 text-sm font-semibold" disabled={act.isPending || !counterCents}>
            Send
          </button>
        </form>
      )}
      {o.status === "open" && o.my_side === "buyer" && (
        <button type="button" className="text-sm underline underline-offset-2" disabled={act.isPending} onClick={() => act.mutate({ action: "withdraw" })}>
          Take back my offer
        </button>
      )}
    </li>
  );
}

/**
 * Offers on your items (side="seller", the Selling tab) or the offers you sent
 * (side="buyer", the Buying tab): rows 57-58.
 */
export function OffersSection({ side }: { side: "buyer" | "seller" }) {
  const offers = useQuery({ queryKey: ["declutter", "my-offers"], queryFn: fetchMyOffers });
  const seller = side === "seller";
  const title = seller ? "Offers on your items" : "Your offers";
  if (offers.isError) {
    return <ErrorState variant="inline" title="We couldn't load offers." body={declutterErrorMessage(offers.error)} onRetry={() => void offers.refetch()} />;
  }
  if (offers.isLoading) return <p className="text-sm text-muted-foreground" role="status">Loading offers…</p>;
  const mine = (offers.data ?? []).filter((o) => o.my_side === side);
  const toAnswer = mine.filter((o) => o.status === "open" && o.awaiting === side).length;
  return (
    <section className="space-y-2" aria-label={title}>
      <SectionHeading title={title} todo={toAnswer} todoWords="to answer" />
      {mine.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {seller ? "No offers yet. Buyers can offer at least half your price; you have 48 hours to answer each one." : "You haven't made any offers."}
        </p>
      ) : (
        <ul className="space-y-3">{mine.map((o) => <OfferRow key={o.offer_id} o={o} />)}</ul>
      )}
    </section>
  );
}

/** The seller's accepted sales waiting for the buyer to pay, with the way out (row 19). */
export function SalesWaiting() {
  const qc = useQueryClient();
  const cart = useQuery({ queryKey: ["declutter", "my-cart"], queryFn: fetchMyCart });
  const cancel = useMutation({
    mutationFn: (itemId: string) => sellerCancelSale(itemId),
    onSuccess: (n) => {
      toast.success(`Sale cancelled. You have ${Math.min(n, 3)} of 3 strikes.`);
      invalidateTrades(qc);
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  // Paid sales are handled by PaidOrders side="seller" (slice 4), below this on the Selling tab.
  const waiting = (cart.data ?? []).filter((l) => l.my_side === "seller" && l.status === "in_cart");
  if (cart.isError) {
    return <ErrorState variant="inline" title="We couldn't load your sales." body={declutterErrorMessage(cart.error)} onRetry={() => void cart.refetch()} />;
  }
  if (waiting.length === 0) return null;
  return (
    <section className="space-y-2" aria-label="Sold, waiting for the buyer to pay">
      <h2 className="text-base font-semibold">Sold, waiting for the buyer to pay</h2>
      <ul className="space-y-3">
        {waiting.map((l) => (
          <li key={l.line_id} className="rounded-2xl border border-border bg-card p-4 space-y-2">
            <p className="font-semibold">{l.item_title} · {formatPrice(l.price_cents)}</p>
            <p className="text-sm text-muted-foreground">Waiting for the buyer to pay · {timeLeft(l.checkout_by)}</p>
            <button
              type="button"
              className="rounded-full border border-border px-4 py-2 text-sm font-semibold"
              disabled={cancel.isPending}
              onClick={() => {
                if (window.confirm("Cancel this sale? You'll get a Declutter strike, and the buyer is told. 3 strikes pause Declutter for you.")) {
                  if (l.item_id) cancel.mutate(l.item_id);
                }
              }}
            >
              Cancel sale
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

const HANDOVER_TITLE: Record<Handover, string> = {
  porch: "Porch pickup",
  pickup_home: "Meet at the seller's home",
  seller_delivery: "Seller delivers",
  delivery: "Helpr delivery",
};
const HANDOVER_WORDS: Record<Handover, string> = {
  porch: "The seller leaves it out for you, no need to meet. Address after you pay.",
  pickup_home: "Pick it up at the seller's door. Address after you pay.",
  seller_delivery: "The seller brings it to you at a time you pick.",
  delivery: "A local Helpr picks it up and brings it to you. Best for big items.",
};
/** With seller delivery open, the porch choice says what it is: porch or another safe place (the spec's wording). */
const PORCH_OR_SAFE_PLACE = "Porch or safe place";

/**
 * Row 24 + B30 + row 101 + slice 5: choose how you get it, then pay on Stripe's
 * page. Porch is first and chosen when every item allows it; when any item's
 * seller turned porch off, only pickup at the seller's home is offered (the server
 * refuses porch for such an order anyway, porch_unavailable). Helpr delivery
 * (rows 29-30) is offered while Declutter is open for the member: the buyer types
 * the drop-off address, the SERVER geocodes it and prices the trip ($10 + $2 per
 * road mile + size), and the Pay button carries that price.
 */
function PayForSeller({ sellerId, itemsTotalCents, premiumCents, totalCents, porchOk, onBack, itemCount = 1 }: {
  sellerId: string; itemsTotalCents: number; premiumCents: number; totalCents: number; porchOk: boolean; onBack: () => void;
  /** Board 161: how many items this one checkout covers (the fee is charged once on their total). */
  itemCount?: number;
}) {
  const qc = useQueryClient();
  const deliveryOpen = useFeature("declutter");
  // Seller delivery (20261027153244): asked of the server only while the switch is on for this member.
  const sellerDeliveryOn = useFeature("declutter_seller_delivery");
  const sdKey = ["declutter", "seller-delivery-offer", sellerId, itemsTotalCents] as const;
  const sdOffer = useQuery({ queryKey: sdKey, queryFn: () => fetchSellerDeliveryOffer(sellerId), enabled: sellerDeliveryOn });
  const [sdTyped, setSdTyped] = useState(false);
  const [slot, setSlot] = useState<string | null>(null);
  const [handoff, setHandoff] = useState<DeliveryHandoff | null>(null);
  const sdState = sellerDeliveryOn && !sdOffer.isError ? sellerDeliveryState(sdOffer.data, sdTyped) : "hidden";
  // The spec's order: porch / safe place, pickup at the home, the seller delivers, Helpr delivery.
  const order: Handover[] = [...(porchOk ? ["porch" as const] : []), "pickup_home", ...(sdState !== "hidden" ? ["seller_delivery" as const] : [])];
  const offered: Handover[] = deliveryOpen ? [...order, "delivery"] : order;
  const [handover, setHandover] = useState<Handover>(order[0]);
  // A refetched cart can lose porch (never gain a stale choice): fall back to the first offered.
  const chosen = offered.includes(handover) ? handover : offered[0];
  const [opening, setOpening] = useState(false);
  const [address, setAddress] = useState("");
  const [quote, setQuote] = useState<DeliveryQuote | null>(null);
  // The quote is for the cart as it was priced: a changed cart total asks again.
  const [quotedFor, setQuotedFor] = useState<number | null>(null);
  const priceIt = useMutation({
    mutationFn: () => fetchDeliveryQuote(sellerId, address.trim()),
    onSuccess: (q) => { setQuote(q); setQuotedFor(itemsTotalCents); },
    onError: (err) => { setQuote(null); toast.error(declutterErrorMessage(err)); },
  });
  const liveQuote = quote && quotedFor === itemsTotalCents ? quote : null;
  const delivering = chosen === "delivery";
  // Q2352 (owner 2026-10-22, terms #9): the one-time account setup fee rides the first purchase of an account that
  // never paid it (declutter_start_checkout freezes the same platform amount on the order, outside the sale's
  // total). The same "still owed" answer every payout preview reads: 0 once paid, and 0 until known.
  const setupFeeCents = useFirstPayoutFeeCents();
  // lh-silent-failure review of the Q2352 rebase #4: the fee flag is read from the cached profile, which nothing
  // refreshes after it flips elsewhere (the standalone fee page, another Declutter purchase), so a cart opened
  // later would show the fee and a total $2 too high. Re-read the profile whenever a checkout panel opens.
  const profileQc = useQueryClient();
  const { user: me } = useCurrentUser();
  useEffect(() => {
    if (me?.id) void profileQc.invalidateQueries({ queryKey: queryKeys.currentUser.byId(me.id) });
  }, [profileQc, me?.id]);
  // Until the fee answer is in (or if its read failed) the total may be short by it: say so, never a figure $2 low.
  const setupFeeKnown = useFirstPayoutFeeKnown();
  const sellerDelivering = chosen === "seller_delivery";
  const sdRate = sellerDelivering && sdOffer.data?.available ? sdOffer.data.rate_cents : null;
  // The seller's rate counts in the buyer's fee (5% of items + rate, + 70c): the server's rule, shown before checkout.
  // A free seller delivery (rate 0, or the order is over the seller's free-delivery amount) adds nothing:
  // the fee is on the items alone, the same number the server freezes.
  const sdAmounts = sdRate !== null ? sellerDeliveryAmounts(itemsTotalCents, sdRate) : null;
  const shownPremium = sdAmounts ? sdAmounts.premiumCents : premiumCents;
  const payCents = (delivering && liveQuote ? totalCents + liveQuote.delivery_cents : sdAmounts ? sdAmounts.totalCents : totalCents) + setupFeeCents;
  const sdReady = sellerDelivering && sdState === "pick" && !!slot && !!handoff;
  const addressId = `dcl-dropoff-${sellerId}`;
  return (
    <>
      {/* Board 30: "How you'll get it" as radio cards; each price from the real rule (pickups are free; delivery is
          the server's quote, or "Get a price" until there is one). */}
      <fieldset className="space-y-2">
        <legend className="mb-2 text-ds-12 font-semibold uppercase tracking-[0.08em] text-muted-foreground">How you'll get it</legend>
        {offered.map((h) => (
          <label key={h}
            className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-[20px] border bg-card px-4 py-3.5 ${chosen === h ? "border-2 border-primary" : "border-border"}`}
          >
            <input type="radio" className="mt-1 h-4 w-4 min-h-0 min-w-0 shrink-0" name={`handover-${sellerId}`} value={h} checked={chosen === h} onChange={() => setHandover(h)} style={{ accentColor: "hsl(var(--primary))" }} />
            <span className="min-w-0 flex-1">
              <span className="block text-ds-15 font-semibold text-foreground">{h === "porch" && sellerDeliveryOn ? PORCH_OR_SAFE_PLACE : HANDOVER_TITLE[h]}</span>
              <span className="block text-ds-13 text-muted-foreground">{HANDOVER_WORDS[h]}</span>
            </span>
            <span className="shrink-0 text-ds-15 font-bold text-[hsl(var(--burnt-sienna))]">
              {h === "delivery" ? (liveQuote ? formatPrice(liveQuote.delivery_cents) : <span className="font-semibold text-muted-foreground">Get a price</span>)
                : h === "seller_delivery" ? (sdState === "no_times"
                  ? <span className="font-semibold text-muted-foreground">{sellerDeliveryPriceWords(sdOffer.data, sdState)}</span>
                  : sellerDeliveryPriceWords(sdOffer.data, sdState))
                : "Free"}
            </span>
          </label>
        ))}
        {!porchOk && (
          <p className="text-xs text-muted-foreground">The seller asked buyers to meet at their home for this order, so porch pickup isn't available.</p>
        )}
      </fieldset>
      {sellerDelivering && (
        <SellerDeliveryPicker sellerId={sellerId} offer={sdOffer.data} state={sdState} slot={slot} onSlot={setSlot}
          handoff={handoff} onHandoff={setHandoff}
          onOffer={(o: SellerDeliveryOffer) => { setSdTyped(true); qc.setQueryData(sdKey, o); }} />
      )}
      {delivering && (
        <div className="space-y-2 rounded-xl border border-border p-3">
          <label htmlFor={addressId} className="block text-xs font-medium">Deliver to (street number, street and town)</label>
          <div className="flex gap-2">
            <input id={addressId} className="w-full min-w-0 rounded-lg border border-input bg-background px-3 py-2 text-sm"
              autoComplete="street-address" maxLength={300} value={address}
              onChange={(e) => { setAddress(e.target.value); setQuote(null); }} />
            <button type="button" className="shrink-0 rounded-full border border-border px-4 py-2 text-sm font-semibold"
              disabled={priceIt.isPending || address.trim().length < 5} onClick={() => priceIt.mutate()}>
              {priceIt.isPending ? "Pricing…" : "Get price"}
            </button>
          </div>
          {liveQuote ? (
            <dl className="text-sm space-y-1">
              <div className="flex justify-between"><dt>Helpr delivery, about {liveQuote.road_miles} {liveQuote.road_miles === 1 ? "mile" : "miles"}</dt><dd>{formatPrice(liveQuote.delivery_cents)}</dd></div>
              <div className="flex justify-between text-xs text-muted-foreground"><dt>$10 + $2 a mile{liveQuote.size_cents > 0 ? " + size" : ""}</dt><dd>{formatPrice(liveQuote.base_cents)} + {formatPrice(liveQuote.per_mile_cents)}{liveQuote.size_cents > 0 ? ` + ${formatPrice(liveQuote.size_cents)}` : ""}</dd></div>
            </dl>
          ) : (
            <p className="text-xs text-muted-foreground">$10 + $2 a mile, plus $20 for a large item or $40 for an extra large one. If no Helpr takes it within 48 hours, the delivery fee comes back and you pick it up instead.</p>
          )}
        </div>
      )}
      <dl className="space-y-1.5 rounded-[20px] border border-border bg-card p-4 text-ds-14" data-checkout-breakdown="">
        <div className="flex justify-between gap-3"><dt>{itemCount > 1 ? `${itemCount} items` : "Item"}</dt><dd className="font-semibold tabular-nums text-[hsl(var(--burnt-sienna))]">{formatPrice(itemsTotalCents)}</dd></div>
        {delivering && liveQuote && (
          <div className="flex justify-between gap-3"><dt>Helpr delivery</dt><dd className="font-semibold tabular-nums text-[hsl(var(--burnt-sienna))]">{formatPrice(liveQuote.delivery_cents)}</dd></div>
        )}
        {sdRate !== null && (
          <div className="flex justify-between gap-3"><dt>Seller delivery</dt><dd className="font-semibold tabular-nums text-[hsl(var(--burnt-sienna))]">{sdRate === 0 ? "Free" : formatPrice(sdRate)}</dd></div>
        )}
        <div className="flex justify-between gap-3"><dt>{itemCount > 1 ? "Buyer's fee (5% + 70¢, once)" : "Buyer's fee (5% + 70¢)"}</dt><dd className="font-semibold tabular-nums text-[hsl(var(--burnt-sienna))]">{formatPrice(shownPremium)}</dd></div>
        {setupFeeCents > 0 && (
          <div className="flex justify-between gap-3" data-checkout-setup-fee=""><dt>One-time account setup fee</dt><dd className="font-semibold tabular-nums text-[hsl(var(--burnt-sienna))]">{formatPrice(setupFeeCents)}</dd></div>
        )}
        <div className="flex items-baseline justify-between gap-3 border-t border-border pt-2">
          <dt className="text-ds-16 font-bold text-foreground">You pay</dt>
          <dd className="text-ds-24 font-bold tabular-nums text-[hsl(var(--burnt-sienna))]">
            {formatPrice(payCents)}
            {/* Delivery chosen but not priced yet: the total is not complete, so say so (money review #4). */}
            {delivering && !liveQuote && <span className="ml-1 text-ds-14 font-semibold text-muted-foreground">+ delivery</span>}
            {!setupFeeKnown && <span className="ml-1 text-ds-14 font-semibold text-muted-foreground" data-setup-fee-pending="">+ any setup fee</span>}
          </dd>
        </div>
        {/* Spec v2 §9.11: Declutter buyer screens may say what the seller keeps; sellers keep the whole price. */}
      </dl>
      {/* lh-money-escrow review (2026-10-20): the seller can be paid without a buyer step (home pickup marked by the
          seller; declutter_handover_sweep pays 24 h after the slot unless a problem is open, porch also needs the
          set-out photo: measured live with pg_get_functiondef), so never "held until you have your items". */}
      <p className="rounded-xl bg-[hsl(var(--burnt-sienna)/0.10)] px-3 py-2 text-ds-13 text-[hsl(var(--sienna-ink))]" data-checkout-note="">
        The seller keeps the whole {formatPrice(itemsTotalCents)}{sdRate ? ` and the ${formatPrice(sdRate)} delivery` : ""}.{" "}
        {delivering
          ? "It's paid to the seller once the delivery is done."
          : sellerDelivering
            ? "It's paid to the seller when you have your items, or 24 hours after they mark it delivered unless you report a problem."
            : "It's paid to the seller when the handover is done, or 24 hours after your pickup time unless you report a problem."}
      </p>
      <button
        type="button"
        className="btn-grad-primary !text-[hsl(var(--parchment))] h-14 w-full rounded-full px-5 text-ds-16 font-semibold"
        disabled={opening || (delivering && !liveQuote) || (sellerDelivering && !sdReady)}
        onClick={async () => {
          setOpening(true);
          try {
            const res = await startCheckoutPayment(sellerId, chosen, sellerDelivering ? slot : null, sellerDelivering ? handoff : null,
              sellerDelivering ? sdRate : null);
            if (res.paid || !res.url) {
              toast.success("This order is already paid.");
              invalidateTrades(qc);
              setOpening(false);
              return;
            }
            await openExternalUrl(res.url, () => { setOpening(false); invalidateTrades(qc); onBack(); });
          } catch (err) {
            if (sellerDelivering) {
              // A time taken by someone else meanwhile: say so, show the times again, ask for a new pick.
              toast.error(sellerDeliveryErrorMessage(err));
              if ((err as { message?: string } | null)?.message === "slot_unavailable") setSlot(null);
              // The seller changed their delivery price meanwhile: the offer is read again, so the
              // screen shows the new price before the buyer taps Pay again.

              void qc.invalidateQueries({ queryKey: sdKey });
            } else {
              toast.error(declutterErrorMessage(err));
            }
            setOpening(false);
          }
        }}
      >
        {opening ? "Opening…" : `Pay ${formatPrice(payCents)}`}
      </button>
      <p className="text-xs text-muted-foreground">You pay on a secure payment page.</p>
      <AddHelprNote />
    </>
  );
}

/** Declutter "Add a Helpr" at checkout: the add-on is one tap on the paid order (docs/specs/declutter-add-a-helpr.md). */
function AddHelprNote() {
  const on = useFeature("declutter_add_helpr");
  if (!on) return null;
  return (
    <p className="text-xs text-muted-foreground">
      Need it put together or hung on the wall? Once you pay, one tap posts a Helpr job for your place. You set the price and pay for it separately.
    </p>
  );
}

/** Row 62 (B44): the switch is off for this member, but they agreed a sale: finish it here. */
export function FinishSalesView() {
  return (
    <AppPage title="Declutter">
      <DeclutterNotice title="Declutter is closed for now.">
        You can still pay for, hand over or cancel the sales you already agreed to. Nothing new can start.
      </DeclutterNotice>
      <CartView />
      <PaidOrders side="buyer" />
      <SalesWaiting />
      <PaidOrders side="seller" />
    </AppPage>
  );
}

/** The buyer's cart (rows 13, 20-22, 24, 38, 59): one checkout per seller. */
export function CartView() {
  const cart = useQuery({ queryKey: ["declutter", "my-cart"], queryFn: fetchMyCart });
  if (cart.isError) {
    return <ErrorState variant="inline" title="We couldn't load your cart." body={declutterErrorMessage(cart.error)} onRetry={() => void cart.refetch()} />;
  }
  if (cart.isLoading) return <p className="text-sm text-muted-foreground" role="status">Loading your cart…</p>;
  const mine = (cart.data ?? []).filter((l) => l.my_side === "buyer");
  // Only lines still inside their 48 h: checkout drops expired ones (money review #10).
  const now = Date.now();
  const waiting = mine.filter((l) => l.status === "in_cart" && new Date(l.checkout_by).getTime() > now);
  const bySeller = new Map<string, CartLine[]>();
  // A line still waiting for checkout always has its seller (an account with a line in flight cannot be deleted).
  for (const l of waiting) if (l.seller_id) bySeller.set(l.seller_id, [...(bySeller.get(l.seller_id) ?? []), l]);
  return (
    <section className="space-y-3" aria-label="Your cart">
      <SectionHeading title="Your cart" todo={waiting.length} todoWords="to check out" />
      {waiting.length === 0 ? (
        <DeclutterNotice title="Your cart is empty.">When a seller accepts your offer, or you tap Buy, the item comes here. You then have 48 hours to check out.</DeclutterNotice>
      ) : (
        [...bySeller.entries()].map(([sellerId, lines], i) => {
          const amounts = checkoutAmounts(lines.map((l) => l.price_cents));
          const soonest = lines.map((l) => l.checkout_by).sort()[0];
          return (
            <section key={sellerId} className="rounded-2xl border border-border bg-card p-4 space-y-3" aria-label={`Checkout ${i + 1}`}>
              {/* Board 161: several items from one seller are one checkout, one pickup and ONE buyer fee on the total. */}
              <h3 className="text-base font-semibold">From one seller · one checkout</h3>
              {lines.length > 1 && <p className="text-ds-13 text-muted-foreground">One checkout, one pickup, one fee.</p>}
              <ul className="space-y-1">
                {lines.map((l) => (
                  <li key={l.line_id} className="flex justify-between gap-3 text-sm min-w-0">
                    {l.item_id ? (
                      <Link to={`/declutter/item/${l.item_id}`} className="truncate" title={l.item_title}>{l.item_title}</Link>
                    ) : (
                      <span className="truncate" title={l.item_title}>{l.item_title}</span>
                    )}
                    <span className="shrink-0 font-semibold tabular-nums text-[hsl(var(--burnt-sienna))]">{formatPrice(l.price_cents)}</span>
                  </li>
                ))}
              </ul>
              <p className="text-sm font-medium">Check out by {new Date(soonest).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })} ({timeLeft(soonest)}). If you don't, you get a strike and the item goes back up for sale.</p>
              <PayForSeller sellerId={sellerId} itemsTotalCents={amounts.itemsCents} premiumCents={amounts.premiumCents} totalCents={amounts.totalCents} porchOk={lines.every((l) => l.porch_ok !== false)} onBack={() => void cart.refetch()} itemCount={lines.length} />
            </section>
          );
        })
      )}
    </section>
  );
}
