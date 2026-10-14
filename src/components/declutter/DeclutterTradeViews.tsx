/**
 * Declutter slice 3 screens (docs/specs/declutter-auctions.md rows 13, 16-22,
 * 36, 38, 56-59; build decisions B25-B38): the buy/offer panel on an item, the
 * Offers view (offers on your items + your offers, accept / decline / counter),
 * the Cart view (what you must check out, by seller, with the one total), and
 * the strike count. Plain words only. Every rule is enforced by the server
 * (20261014210518); the app only explains it.
 *
 * Saving a card and paying (slice 3b, B39/B45): "Save a card" opens Stripe's
 * card-saving page (nothing is charged); "Pay" opens Stripe's payment page for
 * one seller's order. Both come back to /declutter; the webhook is the only
 * source of truth for what happened, so the screens just refetch.
 * Row 62: with the switch off, a member with an agreed sale still gets the
 * cart and their sales (FinishSalesView), nothing else.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import AppPage from "@/components/AppPage";
import { ErrorState } from "@/components/ui/ErrorState";
import { useAgeGate } from "@/hooks/useAgeGate";
import {
  buyNow,
  fetchMyActiveStrikes,
  fetchMyCard,
  fetchMyCart,
  fetchMyOffers,
  makeOffer,
  respondOffer,
  sellerCancelSale,
  startCardSave,
  startCheckoutPayment,
  type CartLine,
  type Handover,
  type DeclutterItem,
  type MyOffer,
} from "@/lib/declutter/api";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { formatPrice } from "@/lib/declutter/distance";
import { checkoutAmounts, minOfferCents } from "@/lib/declutter/money";
import { openExternalUrl } from "@/lib/openExternalUrl";
import { DeclutterNotice } from "./declutterUi";

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

function invalidateTrades(qc: ReturnType<typeof useQueryClient>) {
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

/** Row 36: save a card on Stripe's own page. Nothing is charged. */
function SaveCardPrompt({ onBack }: { onBack: () => void }) {
  const [opening, setOpening] = useState(false);
  return (
    <DeclutterNotice title="Save a card to buy or make offers.">
      <p>Your card is never charged until you check out and pay.</p>
      <button
        type="button"
        className="btn-grad-primary mt-3 rounded-full px-5 py-2.5 text-sm font-semibold"
        disabled={opening}
        onClick={async () => {
          setOpening(true);
          try {
            await openExternalUrl(await startCardSave(), () => { setOpening(false); onBack(); });
          } catch (err) {
            toast.error(declutterErrorMessage(err));
            setOpening(false);
          }
        }}
      >
        {opening ? "Opening…" : "Save a card"}
      </button>
    </DeclutterNotice>
  );
}

/** The buy / offer panel on someone else's live item (rows 36, 53, 56-59). */
export function OfferPanel({ item, userId }: { item: DeclutterItem; userId: string }) {
  const qc = useQueryClient();
  const { underAge } = useAgeGate();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const card = useQuery({ queryKey: ["declutter", "card", userId], queryFn: () => fetchMyCard(userId) });
  const minCents = minOfferCents(item.current_price_cents);
  const cents = dollarsInputToCents(amount);
  const offerProblem =
    cents === null ? "Enter an amount, like 25 or 25.50."
      : cents >= item.current_price_cents ? "Offer less than the price. To pay the price, tap Buy."
        : cents < minCents ? `Offers must be at least ${formatPrice(minCents)} (half the price).`
          : null;
  const send = useMutation({
    mutationFn: () => makeOffer(item.id, cents as number),
    onSuccess: () => {
      setOpen(false);
      setAmount("");
      toast.success("Offer sent. The seller has 48 hours to answer.");
      invalidateTrades(qc);
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const buy = useMutation({
    mutationFn: () => buyNow(item.id, item.current_price_cents),
    onSuccess: () => {
      toast.success("It's yours. Check out within 48 hours.");
      invalidateTrades(qc);
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });

  if (item.status === "reserved") {
    return <DeclutterNotice title="Someone is buying this item.">If they don't check out in time, it goes back up for sale.</DeclutterNotice>;
  }
  if (underAge) {
    return <DeclutterNotice tone="warn" title="You must be 18 or older to buy on Declutter." />;
  }
  if (card.isLoading) return <p role="status" className="text-sm text-muted-foreground">Loading…</p>;
  if (card.isError) {
    return <ErrorState variant="inline" title="We couldn't check your saved card." body={declutterErrorMessage(card.error)} onRetry={() => void card.refetch()} />;
  }
  if (!card.data) return <SaveCardPrompt onBack={() => void card.refetch()} />;
  return (
    <section className="rounded-2xl border border-border bg-card p-4 space-y-3" aria-label="Buy or make an offer">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-grad-primary rounded-full px-5 py-2.5 text-sm font-semibold"
          disabled={buy.isPending}
          onClick={() => {
            if (window.confirm(`Buy "${item.title}" for ${formatPrice(item.current_price_cents)}? You'll have 48 hours to check out and pay. Your card isn't charged now.`)) {
              buy.mutate();
            }
          }}
        >
          Buy for {formatPrice(item.current_price_cents)}
        </button>
        <button
          type="button"
          className="rounded-full border border-border px-5 py-2.5 text-sm font-semibold"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          Make an offer
        </button>
      </div>
      {open && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!offerProblem) send.mutate();
          }}
        >
          <label htmlFor="declutter-offer" className="text-sm font-medium">Your offer</label>
          <div className="flex gap-2">
            <input
              id="declutter-offer"
              inputMode="decimal"
              className="flex-1 min-w-0 rounded-lg border border-input bg-background px-3 py-2 text-sm"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={`At least ${formatPrice(minCents)}`}
              aria-describedby="declutter-offer-help"
            />
            <button type="submit" className="btn-grad-primary rounded-full px-4 text-sm font-semibold" disabled={send.isPending || !!offerProblem}>
              Send offer
            </button>
          </div>
          <p id="declutter-offer-help" className="text-xs text-muted-foreground">
            {amount.trim() && offerProblem
              ? offerProblem
              : `The seller has 48 hours to accept, say no or answer with another price. If they accept, you have 48 hours to check out. Nothing is charged until you pay.`}
          </p>
        </form>
      )}
      <p className="text-xs text-muted-foreground">
        At checkout you pay the price plus a 15% buyer's fee (at least $1). The seller keeps the whole price.
      </p>
    </section>
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
  return (
    <li className="rounded-2xl border border-border bg-card p-4 space-y-2">
      <div className="flex items-start justify-between gap-3 min-w-0">
        <div className="min-w-0">
          <Link to={`/declutter/item/${o.item_id}`} className="font-semibold truncate block">{o.item_title}</Link>
          <p className="text-sm">
            {formatPrice(o.amount_cents)}
            <span className="text-muted-foreground"> · price now {formatPrice(o.current_price_cents)}</span>
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-medium">{OFFER_STATUS_WORDS[o.status]}</span>
      </div>
      {underFloor && <p className="text-xs text-amber-700 dark:text-amber-300">This is under your lowest price ({formatPrice(o.floor_price_cents as number)}). Only you can see that.</p>}
      {o.status === "open" && (
        <p className="text-xs text-muted-foreground">
          {myTurn ? `Your turn to answer · ${timeLeft(o.respond_by)}` : `Waiting for the ${o.my_side === "buyer" ? "seller" : "buyer"} · ${timeLeft(o.respond_by)}`}
        </p>
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

/** Offers on your items and your own offers (rows 57-58). */
export function OffersView() {
  const offers = useQuery({ queryKey: ["declutter", "my-offers"], queryFn: fetchMyOffers });
  if (offers.isError) {
    return <ErrorState variant="inline" title="We couldn't load offers." body={declutterErrorMessage(offers.error)} onRetry={() => void offers.refetch()} />;
  }
  if (offers.isLoading) return <p className="text-sm text-muted-foreground" role="status">Loading offers…</p>;
  const all = offers.data ?? [];
  const onMine = all.filter((o) => o.my_side === "seller");
  const mineOut = all.filter((o) => o.my_side === "buyer");
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h2 className="text-base font-semibold">Offers on your items</h2>
        {onMine.length === 0 ? (
          <p className="text-sm text-muted-foreground">No offers yet. Buyers can offer at least half your price; you have 48 hours to answer each one.</p>
        ) : (
          <ul className="space-y-3">{onMine.map((o) => <OfferRow key={o.offer_id} o={o} />)}</ul>
        )}
      </section>
      <section className="space-y-2">
        <h2 className="text-base font-semibold">Your offers</h2>
        {mineOut.length === 0 ? (
          <p className="text-sm text-muted-foreground">You haven't made any offers.</p>
        ) : (
          <ul className="space-y-3">{mineOut.map((o) => <OfferRow key={o.offer_id} o={o} />)}</ul>
        )}
      </section>
      <SalesWaiting />
    </div>
  );
}

/** The seller's accepted sales waiting for the buyer to pay, with the way out (row 19). */
function SalesWaiting() {
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
  const waiting = (cart.data ?? []).filter((l) => l.my_side === "seller" && (l.status === "in_cart" || l.status === "paid"));
  if (cart.isError) {
    return <ErrorState variant="inline" title="We couldn't load your sales." body={declutterErrorMessage(cart.error)} onRetry={() => void cart.refetch()} />;
  }
  if (waiting.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold">Your sales</h2>
      <ul className="space-y-3">
        {waiting.map((l) => (
          <li key={l.line_id} className="rounded-2xl border border-border bg-card p-4 space-y-2">
            <p className="font-semibold">{l.item_title} · {formatPrice(l.price_cents)}</p>
            {l.status === "paid" ? (
              <p className="text-sm text-muted-foreground">Paid. You get the whole price when the buyer has the item.</p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">Waiting for the buyer to pay · {timeLeft(l.checkout_by)}</p>
                <button
                  type="button"
                  className="rounded-full border border-border px-4 py-2 text-sm font-semibold"
                  disabled={cancel.isPending}
                  onClick={() => {
                    if (window.confirm("Cancel this sale? You'll get a Declutter strike, and the buyer is told. 3 strikes pause Declutter for you.")) {
                      cancel.mutate(l.item_id);
                    }
                  }}
                >
                  Cancel sale
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

const HANDOVER_WORDS: Record<Handover, string> = {
  pickup_home: "Pickup at the seller's home",
  porch: "Porch pickup (the seller sets it out for you)",
};

/** Row 24 (63: no Helpr delivery yet) + B30: choose how you get it, then pay on Stripe's page. */
function PayForSeller({ sellerId, totalCents, onBack }: { sellerId: string; totalCents: number; onBack: () => void }) {
  const qc = useQueryClient();
  const [handover, setHandover] = useState<Handover>("pickup_home");
  const [opening, setOpening] = useState(false);
  return (
    <>
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">How you get it</legend>
        {(Object.keys(HANDOVER_WORDS) as Handover[]).map((h) => (
          <label key={h} className="flex items-center gap-2 text-sm">
            <input type="radio" name={`handover-${sellerId}`} value={h} checked={handover === h} onChange={() => setHandover(h)} />
            {HANDOVER_WORDS[h]}
          </label>
        ))}
        <p className="text-xs text-muted-foreground">Delivery by a Helpr is coming later.</p>
      </fieldset>
      <button
        type="button"
        className="btn-grad-primary rounded-full px-5 py-2.5 text-sm font-semibold"
        disabled={opening}
        onClick={async () => {
          setOpening(true);
          try {
            const res = await startCheckoutPayment(sellerId, handover);
            if (res.paid || !res.url) {
              toast.success("This order is already paid.");
              invalidateTrades(qc);
              setOpening(false);
              return;
            }
            await openExternalUrl(res.url, () => { setOpening(false); invalidateTrades(qc); onBack(); });
          } catch (err) {
            toast.error(declutterErrorMessage(err));
            setOpening(false);
          }
        }}
      >
        {opening ? "Opening…" : `Pay ${formatPrice(totalCents)}`}
      </button>
      <p className="text-xs text-muted-foreground">You pay on Stripe's secure page. The money is held until you have your items.</p>
    </>
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
      <SalesWaiting />
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
  const paid = mine.filter((l) => l.status === "paid");
  const bySeller = new Map<string, CartLine[]>();
  for (const l of waiting) bySeller.set(l.seller_id, [...(bySeller.get(l.seller_id) ?? []), l]);
  return (
    <div className="space-y-6">
      {waiting.length === 0 ? (
        <DeclutterNotice title="Your cart is empty.">When a seller accepts your offer, or you tap Buy, the item comes here. You then have 48 hours to check out.</DeclutterNotice>
      ) : (
        [...bySeller.entries()].map(([sellerId, lines], i) => {
          const amounts = checkoutAmounts(lines.map((l) => l.price_cents));
          const soonest = lines.map((l) => l.checkout_by).sort()[0];
          return (
            <section key={sellerId} className="rounded-2xl border border-border bg-card p-4 space-y-3" aria-label={`Checkout ${i + 1}`}>
              <h2 className="text-base font-semibold">From one seller · one checkout</h2>
              <ul className="space-y-1">
                {lines.map((l) => (
                  <li key={l.line_id} className="flex justify-between gap-3 text-sm min-w-0">
                    <Link to={`/declutter/item/${l.item_id}`} className="truncate">{l.item_title}</Link>
                    <span className="shrink-0">{formatPrice(l.price_cents)}</span>
                  </li>
                ))}
              </ul>
              <dl className="text-sm space-y-1 border-t border-border pt-2">
                <div className="flex justify-between"><dt>Items</dt><dd>{formatPrice(amounts.itemsCents)}</dd></div>
                <div className="flex justify-between"><dt>Buyer's fee (15%, at least $1)</dt><dd>{formatPrice(amounts.premiumCents)}</dd></div>
                <div className="flex justify-between font-semibold"><dt>Total</dt><dd>{formatPrice(amounts.totalCents)}</dd></div>
              </dl>
              <p className="text-sm font-medium">Check out by {new Date(soonest).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })} ({timeLeft(soonest)}). If you don't, you get a strike and the item goes back up for sale.</p>
              <PayForSeller sellerId={sellerId} totalCents={amounts.totalCents} onBack={() => void cart.refetch()} />
            </section>
          );
        })
      )}
      {paid.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-base font-semibold">Paid</h2>
          <ul className="space-y-2">
            {paid.map((l) => (
              <li key={l.line_id} className="rounded-xl border border-border p-3 text-sm">
                {l.item_title} · {formatPrice(l.price_cents)} · paid. Pick-up details come next.
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
