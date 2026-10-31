/**
 * Declutter offers (split from DeclutterTradeViews.tsx, componentSizeRatchet, batch 1030e): "Offers on your items"
 * (side="seller", the Selling tab) and "Your offers" (side="buyer", the Buying tab), each offer a card with
 * accept / decline / counter. Every rule is enforced by the server (20261014210518); the app only explains it.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ErrorState } from "@/components/ui/ErrorState";
import { noDeliveryWay, totalPhrase } from "@/lib/declutter/pickupWords";
import { fetchItemHandovers, fetchMyOffers, respondOffer, type MyOffer } from "@/lib/declutter/api";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { formatPrice } from "@/lib/declutter/distance";
import { dollarsInputToCents } from "@/lib/declutter/money";
import { BuyerTotal } from "./BuyerTotal";
import { NoSellerOffers, SectionHeading } from "./DeclutterTabParts";
import { GOOD_NEWS_NOTE } from "./goodNews";
import { timeLeft } from "@/lib/declutter/timeLeft";
import { ConfirmSheet } from "./DeclutterConfirmSheet";

/** Every Declutter read refetches after a trade (offers, cart, orders). */
export function invalidateTrades(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ["declutter"] });
}

/** "3 hours left" -> "3 hours left.", "time is up" -> "Time is up.": a status line is a sentence. */
const sentence = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;

/**
 * The counter box's example (audit 1030 DC-12: it was a hard-coded "30" on every offer, whatever the numbers). The
 * seller sees whole dollars halfway between the buyer's offer and the price now, the usual place to meet. The buyer
 * answering a counter sees none: the row doesn't carry their earlier offer, so any number would be made up.
 */
const counterExample = (o: MyOffer) =>
  o.my_side === "seller" ? String(Math.round((Math.min(o.amount_cents, o.current_price_cents) + o.current_price_cents) / 200)) : undefined;

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
  // Accept asks in the app, never window.confirm (lead 2026-10-28, DeclutterConfirmSheet).
  const [accepting, setAccepting] = useState(false);
  // Audit 1d D4-9: "Say no" asks first too; it ends the offer for good.
  const [declining, setDeclining] = useState(false);
  const act = useMutation({
    mutationFn: (v: { action: "accept" | "decline" | "counter" | "withdraw"; cents?: number }) => respondOffer(o.offer_id, v.action, v.cents ?? null),
    onSettled: () => { setAccepting(false); setDeclining(false); },
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
  const underFloor = o.my_side === "seller" && myTurn && o.floor_price_cents !== null && o.floor_price_cents < o.current_price_cents && o.amount_cents < o.floor_price_cents;
  // D4-3: a seller's answer to the buyer's Wanted post (stored as a seller counter) is a reply, never "their counter".
  const wantedReply = o.from_wanted === true && o.my_side === "buyer";
  // What accepting really sells for: least(offer, price now) (live declutter_respond_offer -> declutter_take_item).
  const takeCents = Math.min(o.amount_cents, o.current_price_cents);
  // Audit 1030 DB-4: the counter's plain total is said for a way the seller offers (the item page's read and key).
  const ways = useQuery({ queryKey: ["declutter", "item-handovers", o.item_id], queryFn: () => fetchItemHandovers(o.item_id), enabled: myTurn && o.my_side === "buyer" });
  return (
    // Boards 68-70: the offer as a card (Declutter has no pre-purchase chat): the amount in money ink with who set it,
    // the asking price, whose turn it is, and what the answer means in money, from the real rules.
    <li className="rounded-[20px] border border-border bg-card p-4 space-y-2.5" data-offer-row="">
      <div className="flex items-start justify-between gap-3 min-w-0">
        <div className="min-w-0">
          {wantedReply && <p className="text-ds-12 font-semibold text-[hsl(var(--sage-ink))]" data-wanted-reply="">Reply to your Wanted</p>}
          <Link to={`/declutter/item/${o.item_id}`} className="text-ds-15 font-semibold truncate block" title={o.item_title}>{o.item_title}</Link>
          <p className="text-ds-13 text-muted-foreground">Price now {formatPrice(o.current_price_cents)}</p>
        </div>
        <div className="shrink-0 text-right">
          {/* Spec v2 §1.1: amounts wear the money ink. */}
          <p className="text-ds-20 font-bold leading-tight tabular-nums text-[hsl(var(--burnt-sienna))]">{formatPrice(o.amount_cents)}</p>
          <p className="text-ds-12 text-muted-foreground">
            {o.awaiting === o.my_side ? (o.my_side === "seller" ? "their offer" : wantedReply ? "their price" : "their counter") : o.my_side === "buyer" ? "your offer" : "your price"}
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
          {/* A plain sentence, never "Your turn to answer · 3 hours left" (lead 2026-10-28). */}
          {myTurn ? "Your turn to answer. " : `Waiting for the ${o.my_side === "buyer" ? "seller" : "buyer"}. `}
          {sentence(timeLeft(o.respond_by))}
        </p>
      )}
      {myTurn && o.my_side === "seller" && (
        // Sellers keep the whole price (spec v2 §9.11). Members never see a fee name or number (owner 2026-10-25).
        // Good news, so the sage tint, not the rust one problems use (audit 1030 DC-13).
        <p className={GOOD_NEWS_NOTE} data-offer-note="" data-tone="good">
          If you accept and the buyer pays, you keep the whole <strong className="tabular-nums">{formatPrice(takeCents)}</strong>.
        </p>
      )}
      {myTurn && o.my_side === "buyer" && (
        // Board 70: what accepting the counter costs at checkout (pickup), from the same rule as Buy now.
        <dl className="space-y-1 rounded-xl border border-border p-3 text-ds-13" data-offer-bill="">
          <div className="flex justify-between gap-3"><dt>Their price</dt><dd className="font-semibold tabular-nums text-[hsl(var(--burnt-sienna))]">{formatPrice(takeCents)}</dd></div>
          <div className="flex items-baseline justify-between gap-3 border-t border-border pt-1"><dt className="font-bold">You pay {totalPhrase(noDeliveryWay(ways.data))}</dt><dd className="text-ds-16 font-bold tabular-nums text-[hsl(var(--burnt-sienna))]"><BuyerTotal priceCents={takeCents} /></dd></div>
          <p className="text-ds-12 text-muted-foreground">At most. More items from this seller make it less.</p>
        </dl>
      )}
      {myTurn && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-grad-primary rounded-full px-4 py-2 text-sm font-semibold"
            disabled={act.isPending}
            onClick={() => setAccepting(true)}
          >
            Accept
          </button>
          <button type="button" className="rounded-full border border-border px-4 py-2 text-sm font-semibold" disabled={act.isPending} onClick={() => setCountering((v) => !v)} aria-expanded={countering}>
            Answer with a price
          </button>
          <button type="button" className="rounded-full border border-border px-4 py-2 text-sm font-semibold" disabled={act.isPending} onClick={() => setDeclining(true)}>
            Say no
          </button>
        </div>
      )}
      {myTurn && countering && (
        <form
          className="space-y-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (counterCents) act.mutate({ action: "counter", cents: counterCents });
          }}
        >
          {/* A shown label and a "$" in the field (deep audit #47: no "$" and no label). */}
          <label className="block text-sm font-semibold" htmlFor={`counter-${o.offer_id}`}>Your price</label>
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1" data-counter-field="">
              <span aria-hidden className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm font-semibold text-muted-foreground">$</span>
              <input
                id={`counter-${o.offer_id}`}
                inputMode="decimal"
                className="w-full min-w-0 rounded-lg border border-input bg-background py-2 pl-6 pr-3 text-sm"
                value={counter}
                onChange={(e) => setCounter(e.target.value)}
                placeholder={counterExample(o)}
              />
            </div>
            <button type="submit" className="btn-grad-primary rounded-full px-4 text-sm font-semibold" disabled={act.isPending || !counterCents}>
              Send
            </button>
          </div>
        </form>
      )}
      {o.status === "open" && o.my_side === "buyer" && !(wantedReply && o.awaiting === "buyer") && (
        <button type="button" className="text-sm underline underline-offset-2" disabled={act.isPending} onClick={() => act.mutate({ action: "withdraw" })}>
          Take back my offer
        </button>
      )}
      <ConfirmSheet open={accepting} pending={act.isPending} onConfirm={() => act.mutate({ action: "accept" })} onClose={() => setAccepting(false)}
        title={o.my_side === "seller" ? `Sell it for ${formatPrice(o.amount_cents)}?` : `Buy it for ${formatPrice(o.amount_cents)}?`}
        confirmLabel="Accept" testId="accept-offer">
        {o.my_side === "seller"
          ? `"${o.item_title}": every other offer on it closes, and the buyer gets 48 hours to pay.`
          : <>{`"${o.item_title}": you pay at most `}<BuyerTotal priceCents={takeCents} />{` ${totalPhrase(noDeliveryWay(ways.data))}. You'll have 48 hours to check out and pay, or you get a strike. Nothing is charged until you do.`}</>}
      </ConfirmSheet>
      <ConfirmSheet open={declining} pending={act.isPending} onConfirm={() => act.mutate({ action: "decline" })} onClose={() => setDeclining(false)}
        title={`Say no to ${formatPrice(o.amount_cents)}?`} confirmLabel="Say no" testId="decline-offer">
        {o.my_side === "seller"
          ? `"${o.item_title}": this offer ends, and the buyer is told you said no.`
          : wantedReply
            ? `"${o.item_title}": this reply ends, and the seller is told you said no. Nothing is charged.`
            : `"${o.item_title}": this counter ends. Nothing is charged.`}
      </ConfirmSheet>
    </li>
  );
}

/**
 * Offers on your items (side="seller", the Selling tab) or the offers you sent
 * (side="buyer", the Buying tab): rows 57-58.
 */
/** onlyMyTurn (audit DC-9, Selling's "To answer"): only the open offers waiting for this member, nothing else. */
export function OffersSection({ side, onlyMyTurn = false }: { side: "buyer" | "seller"; onlyMyTurn?: boolean }) {
  const offers = useQuery({ queryKey: ["declutter", "my-offers"], queryFn: fetchMyOffers });
  const seller = side === "seller";
  const title = seller ? "Offers on your items" : "Your offers";
  const [showClosed, setShowClosed] = useState(false);
  if (offers.isError) {
    return <ErrorState variant="inline" title="We couldn't load offers." body={declutterErrorMessage(offers.error)} onRetry={() => void offers.refetch()} />;
  }
  if (offers.isLoading) return <p className="text-sm text-muted-foreground" role="status">Loading offers…</p>;
  const mine = (offers.data ?? []).filter((o) => o.my_side === side);
  const toAnswer = mine.filter((o) => o.status === "open" && o.awaiting === side).length;
  if (onlyMyTurn) {
    const waiting = mine.filter((o) => o.status === "open" && o.awaiting === side);
    if (waiting.length === 0) return null;
    return (
      <section className="space-y-2" aria-label={title} data-offers-my-turn="">
        <SectionHeading title={title} todo={toAnswer} todoWords="to answer" />
        <ul className="space-y-3">{waiting.map((o) => <OfferRow key={o.offer_id} o={o} />)}</ul>
      </section>
    );
  }
  // Deep audit #30: closed offers (said no, taken back, ran out, sold) piled up above the seller's live ones. The
  // seller sees the open ones; the closed ones fold under one button. declutter_my_offers keeps a closed offer 30 days.
  const shown = seller ? mine.filter((o) => o.status === "open") : mine;
  const closed = seller ? mine.filter((o) => o.status !== "open") : [];
  return (
    <section className="space-y-2" aria-label={title}>
      <SectionHeading title={title} todo={toAnswer} todoWords="to answer" />
      {mine.length === 0 ? (
        seller ? <NoSellerOffers /> : <p className="text-sm text-muted-foreground">You haven&apos;t made any offers.</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">No open offers.</p>
      ) : (
        <ul className="space-y-3">{shown.map((o) => <OfferRow key={o.offer_id} o={o} />)}</ul>
      )}
      {closed.length > 0 && (
        <>
          <button type="button" className="link-standard text-sm font-medium" aria-expanded={showClosed}
            onClick={() => setShowClosed((v) => !v)} data-closed-offers-toggle="">
            {showClosed ? "Hide closed offers" : `Show ${closed.length} closed ${closed.length === 1 ? "offer" : "offers"} from the last 30 days`}
          </button>
          {showClosed && <ul className="space-y-3" data-closed-offers="">{closed.map((o) => <OfferRow key={o.offer_id} o={o} />)}</ul>}
        </>
      )}
    </section>
  );
}
