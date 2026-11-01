/**
 * The buy / offer panel on someone else's live Declutter item and its card
 * step (rows 36, 53, 56-59; owner 2026-10-19: Buy now and Make an offer always
 * show, and with no saved card either one asks for a card and comes back to
 * itself; DA-11: an offer asks at Send, after the amount is typed). Moved out of DeclutterTradeViews.tsx unchanged (component size limit).
 */
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/ErrorState";
import { useAgeGate } from "@/hooks/useAgeGate";
import { useDockYield } from "@/components/mobileNav/useDockYield";
import { buyNow, fetchItemHandovers, fetchMyCard, fetchMyCart, fetchMyOffers, makeOffer, startCardSave, type DeclutterItem, type DeliverySize } from "@/lib/declutter/api";
import { noDeliveryWay, totalPhrase, type NoDeliveryWay } from "@/lib/declutter/pickupWords";
import { deliveryPriceCents } from "@/lib/declutter/delivery";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { formatPrice } from "@/lib/declutter/distance";
import { minOfferCents } from "@/lib/declutter/money";
import { BuyerTotal } from "./BuyerTotal";
import { openExternalUrl } from "@/lib/openExternalUrl";
import { afterCardFromState, cardCancelledFromState, offerAmountFromState, rememberAfterCard, type AfterCardAction } from "@/lib/declutter/afterCard";
import { DeclutterNotice } from "./declutterUi";
import { OfferSentWhatNext } from "./OfferSentWhatNext";
import { checkoutLinkFor } from "@/lib/declutter/buyNowHold";
import { HoldChecking, myHoldOn, myOpenOfferOn, ReservedForYou, YourOfferBox } from "./DeclutterYourOffer";
import { dollarsInputToCents } from "@/lib/declutter/money";
import { invalidateTrades } from "./declutterLightActions";

/**
 * Row 36, as the step INSIDE a buy or an offer (owner, 2026-10-19): a buyer
 * with no saved card still sees Buy now and Make an offer; tapping either asks
 * for a card here, then carries on with that same action (see afterCard.ts:
 * on the web via the return from Stripe's page, in the app on return from the
 * in-app browser). Nothing is charged by saving a card.
 */
/** NIGHT-BUYING0-7: the step's line when the member came back from the card page without saving one. */
const CARD_NOT_SAVED = "No card was saved, so nothing happened yet.";

function AddCardStep({ action, itemId, offerAmount, onReturned, onCancel, note }: {
  action: AfterCardAction;
  /** Said above the step's own words (back from the card page with none saved). */
  note?: string;
  itemId: string;
  /** DA-11: the amount already typed, kept across the trip to Stripe's page. */
  offerAmount?: string;
  onReturned: () => void;
  onCancel: () => void;
}) {
  const [opening, setOpening] = useState(false);
  return (
    <div className="rounded-2xl border border-border bg-muted/40 p-4 space-y-2" role="group" aria-label="Add a card">
      {note && <p className="text-sm text-foreground" role="status" data-card-not-saved="">{note}</p>}
      <p className="text-sm font-semibold">Add a card to finish.</p>
      <p className="text-xs text-muted-foreground">
        {/* #21 (owner chose C, 2026-10-28): two Stripe pages stay; this line says what the first one is for. */}
        We save your card now; you're only charged when you check out. {action === "buy" ? "Then checkout opens." : "Then you send your offer."}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <Button
          type="button"
          size="sm"
          className="w-full rounded-full"
          disabled={opening}
          onClick={async () => {
            setOpening(true);
            try {
              const url = await startCardSave();
              rememberAfterCard(itemId, action, undefined, offerAmount);
              await openExternalUrl(url, () => { setOpening(false); onReturned(); });
            } catch (err) {
              toast.error(declutterErrorMessage(err));
              setOpening(false);
            }
          }}
        >
          {opening ? "Opening…" : "Add a card"}
        </Button>
        <Button type="button" variant="outline" size="sm" className="w-full rounded-full" onClick={onCancel}>
          Not now
        </Button>
      </div>
    </div>
  );
}

/**
 * How much of the screen's bottom edge the dock (MobileNav's `.mobile-nav-frame`) covers, in px; 0 where there is
 * none (desktop hides it). Measured, because `--bottom-nav-h` is only ever zeroed, never set. The dock keeps its box
 * while it yields (`visibility: hidden`), so the answer does not change when the bar takes its place.
 */
function dockCoverPx(): number {
  const dock = document.querySelector<HTMLElement>(".mobile-nav-frame");
  if (!dock) return 0;
  const r = dock.getBoundingClientRect();
  return r.height > 0 ? Math.max(0, Math.round(window.innerHeight - r.top)) : 0;
}

/**
 * True until `el` is fully in view ABOVE the dock (IntersectionObserver). False where the observer does not exist,
 * so the in-page buttons are then the only ones.
 *
 * Audit 1030 DB-14: the observer used to count the strip behind the dock as on screen. At 375 the in-page Buy now
 * sat in that strip on a short-titled item, so it was hidden under the dock while the bar stayed away. The strip is
 * now cut off the observed screen (rootMargin), and a group only partly clear of the dock still gets the bar.
 */
function useOffScreen(el: RefObject<HTMLElement>): boolean {
  const [off, setOff] = useState(false);
  useEffect(() => {
    const node = el.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([entry]) => setOff(!entry.isIntersecting || (entry.intersectionRatio ?? 1) < 0.99),
      { rootMargin: `0px 0px -${dockCoverPx()}px 0px`, threshold: [0, 0.99] },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [el]);
  return off;
}

/** Back from saving a card: how long to wait for Stripe's webhook to file it, and how often to look. */
const CARD_WAIT_MS = 10_000;
const CARD_POLL_MS = 1_500;

/**
 * The buy / offer panel on someone else's live item (rows 36, 53, 56-59).
 * Buy now and Make an offer ALWAYS show (owner, 2026-10-19: as on Marketplace,
 * OfferUp and Mercari); with no saved card, either one goes through
 * AddCardStep and comes back to itself: Buy to its confirm, Offer to the
 * amount entry with what was typed still there. DA-11 (Declutter audit
 * 2026-10-30): Make an offer opens the amount box at once and the card is asked
 * for at Send, so nobody hands over a card before knowing what they would pay. The age, reserved and own-item gates stay as they were, and
 * the server checks every buy and offer (strikes, card, sold) on its own.
 */
/**
 * Board 4: "Buy now" over "$40.60 total". The total is the checkout
 * total (buyNowTotalCents = checkoutAmounts, the rule declutter_start_checkout
 * freezes), never the bare price (D6), PLUS the one-time account setup fee a
 * first purchase carries (A1-B2: the button said $32.20 while Stripe charged
 * $34.20; checkout's payCents adds the same useFirstPayoutFeeCents). Until that
 * answer is in, the label says a setup fee may be added rather than show a
 * figure $2 low. Screen readers hear one line.
 */
function BuyNowLabel({ priceCents, way, size }: { priceCents: number; way: NoDeliveryWay; size: DeliverySize }) {
  // Audit BUY-3: on an item the seller offers only delivered (way "none"), the pickup total is a figure nobody can
  // pay. The label names the least it costs delivered instead, the item page's own "from" floor (fromDeliveredCents).
  const delivered = way === "none";
  return (
    <span className="flex flex-col items-center leading-tight">
      <span className="font-semibold">Buy now</span>{" "}
      <span className="sr-only">·</span>{" "}
      <span className="text-xs font-medium">
        {delivered && "from "}
        <BuyerTotal
          priceCents={priceCents}
          addCents={delivered ? deliveryPriceCents(1, [size]) : 0}
          suffix={delivered ? " delivered" : " total"}
          pendingClassName="text-xs font-medium"
        />
      </span>
    </span>
  );
}

export function OfferPanel({ item, userId, askSignal = 0, footer = null }: {
  item: DeclutterItem; userId: string;
  /** AUD31-15: the Questions hint's "Make an offer" counts up; each new count opens the offer box, as the button does. */
  askSignal?: number;
  /** Owner mockup 11-01: the delivery line sits under the two buttons, inside this card. */
  footer?: ReactNode;
}) {
  const qc = useQueryClient();
  const { underAge } = useAgeGate();
  const location = useLocation();
  const navigate = useNavigate();
  // DA-11: the amount typed before the trip to Stripe's page comes back with the member (router state, like the action).
  const [amount, setAmount] = useState(() => offerAmountFromState(location.state) ?? "");
  const [open, setOpen] = useState(() => !!offerAmountFromState(location.state));
  // Make an offer opens the box ready to type: one tap, not two (audit BUY-19).
  const offerBox = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) offerBox.current?.focus(); }, [open]);
  const panel = useRef<HTMLElement>(null);
  const buttons = useRef<HTMLDivElement>(null);
  // Phone (owner, 2026-10-19): while the in-page buttons are scrolled out of
  // view, the same two actions ride in a bar above the bottom dock.
  const barShown = useOffScreen(buttons);
  // The bar owns the bottom strip while it shows; the dock steps aside (Q1646).
  useDockYield(barShown && !underAge && item.status === "live");
  /** The action waiting for a card: shown as AddCardStep, then resumed once a card is on file. */
  const [needCard, setNeedCard] = useState<AfterCardAction | null>(null);
  /**
   * An action to carry on with once the card read shows a saved card: back
   * from Stripe's page on the web (router state set by DeclutterPage, never the
   * address) or from the in-app browser in the app.
   */
  const [resume, setResume] = useState<AfterCardAction | null>(() => afterCardFromState(location.state));
  // NIGHT-BUYING0-7: back from the card page with no card saved (they cancelled), the step opens again for the same
  // action, saying so, instead of dropping the buy with no words.
  const [cardCancelled, setCardCancelled] = useState<AfterCardAction | null>(() => cardCancelledFromState(location.state));
  // NIGHT-BUYING0-6: the server said card_required (the read said yes, or could not be read): its card step shows.
  const [serverNoCard, setServerNoCard] = useState(false);
  // NIGHT-BUYING0-3: back with a card for an offer, the typed amount waits unsent; this line says so.
  const [cardSaved, setCardSaved] = useState(false);
  // NIGHT-BUYING0-1: back from the card page the member lands at the top of the item, with "Checking for your
  // card…" (and later the card step or the offer box) below a phone's screen. Bring the panel into view.
  const showPanel = () => panel.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  useEffect(() => { if (resume) showPanel(); }, [resume]);
  useEffect(() => {
    if (!cardCancelled) return;
    setNeedCard(cardCancelled);
    showPanel();
  }, [cardCancelled]);
  /** The server refused for want of a card: ask for one for this action, at the panel. True when it did. */
  const askCardIfRefused = (err: unknown, action: AfterCardAction) => {
    if (String((err as { message?: unknown } | null)?.message ?? "").trim() !== "card_required") return false;
    setServerNoCard(true);
    if (action === "buy") setOpen(false);
    setNeedCard(action);
    showPanel();
    return true;
  };
  // The saved card is written by Stripe's webhook, which can land a moment
  // after the member is back: while resuming, read again every CARD_POLL_MS.
  const card = useQuery({
    queryKey: ["declutter", "card", userId],
    queryFn: () => fetchMyCard(userId),
    refetchInterval: resume ? CARD_POLL_MS : false,
  });
  // Deep audit #3/#4: the buyer's own hold or open offer on this item changes what the panel says. The same reads
  // (and keys) as Buying, so they are usually already in.
  const cart = useQuery({ queryKey: ["declutter", "my-cart"], queryFn: fetchMyCart, enabled: item.status === "reserved" });
  const offers = useQuery({ queryKey: ["declutter", "my-offers"], queryFn: fetchMyOffers, enabled: item.status === "live" });
  // Audit 1030 DB-4: the plain total is said for a way the seller offers (the item page's ItemPickupWays reads the same key).
  const ways = useQuery({ queryKey: ["declutter", "item-handovers", item.id], queryFn: () => fetchItemHandovers(item.id) });
  const way = noDeliveryWay(ways.data);
  const myHold = myHoldOn(cart.data, item.id);
  const myOffer = myOpenOfferOn(offers.data, item.id);
  // Smart offers (20261029162620): the seller turned offers off = Buy only. An open offer of the buyer's still shows.
  const offersOff = item.accepts_offers === false;
  const minCents = minOfferCents(item.current_price_cents);
  const cents = dollarsInputToCents(amount);
  const offerProblem =
    cents === null ? "Enter an amount, like 25 or 25.50."
      : cents >= item.current_price_cents ? "Offer less than the price. To pay the price, tap Buy now."
        : cents < minCents ? `Offers must be at least ${formatPrice(minCents)} (half the price).`
          : null;
  // Board 79: the offer just sent, for the "What next" sheet (replaces the toast).
  const [sentCents, setSentCents] = useState<number | null>(null);
  const send = useMutation({
    mutationFn: () => makeOffer(item.id, cents as number),
    onSuccess: () => {
      setOpen(false);
      setAmount("");
      setCardSaved(false);
      setSentCents(cents);
      invalidateTrades(qc);
    },
    onError: (err) => { if (!askCardIfRefused(err, "offer")) toast.error(declutterErrorMessage(err)); },
  });
  // DB-5 (owner 2026-10-30): "Buy now goes straight to checkout, with no strike for backing out before paying." No
  // reserve sheet: the tap holds the item (the server's 48-hour line, needed for checkout) and opens this seller's
  // checkout in Buying, where Pay is its own press and nothing is charged before it. The button already shows the
  // pickup total; a buyer who backs out gets no strike (declutter_deadline_sweep, 20261030064929) and can Remove it.
  const buy = useMutation({
    mutationFn: () => buyNow(item.id, item.current_price_cents),
    onSuccess: () => {
      invalidateTrades(qc);
      navigate(checkoutLinkFor(item.seller_id));
    },
    onError: (err) => { if (!askCardIfRefused(err, "buy")) toast.error(declutterErrorMessage(err)); },
  });

  const confirmBuy = () => {
    if (!buy.isPending) buy.mutate();
  };
  const run = (action: AfterCardAction) => {
    if (action === "buy") confirmBuy();
    else setOpen(true);
  };
  const tap = (action: AfterCardAction) => {
    setResume(null);
    // DA-11: the amount comes first; the card is asked for at Send (sendOffer).
    if (action === "offer") {
      setNeedCard(null);
      setOpen(true);
      return;
    }
    if (card.data) {
      setNeedCard(null);
      run(action);
      return;
    }
    // NIGHT-BUYING0-2: a card Stripe's webhook filed after the CARD_WAIT_MS wait was never noticed (polling had
    // stopped), so Buy now kept asking for a card. With no card in the last answer, read it again before asking.
    // NIGHT-BUYING0-5: a card read that fails does not block, as at Send: the server checks the card itself, and
    // its card_required opens the step (askCardIfRefused).
    void card.refetch().then((r) => {
      if (r.data || r.isError) {
        setNeedCard(null);
        run(action);
      } else {
        setOpen(false);
        setNeedCard(action);
      }
    });
  };
  // DA-11: Send with no saved card asks for one here and keeps the typed amount. A failed card read does not block:
  // the server checks the card itself and says so.
  const sendOffer = () => {
    if (offerProblem || send.isPending) return;
    if (card.data || card.isError) send.mutate();
    else setNeedCard("offer");
  };
  // AUD31-15: "Make an offer" in the Questions hint opens the same box (or your offer's box) and brings it into view.
  useEffect(() => {
    if (askSignal === 0 || offersOff) return;
    if (myOffer) setOpen(true);
    else tap("offer");
    showPanel();
    // Only a new tap of the hint; `tap` and the offer reads change every render.
  }, [askSignal]);

  // The action came back in the router state: drop it from history so a
  // reload or Back never replays it.
  useEffect(() => {
    if (afterCardFromState(location.state) || cardCancelledFromState(location.state) || offerAmountFromState(location.state)) {
      navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: null });
    }
  }, []);

  // Back from saving a card: as soon as the read shows it, carry on with the
  // action the member started.
  const hasCard = !!card.data;
  useEffect(() => {
    if (!resume || !hasCard) return;
    setResume(null);
    setNeedCard(null);
    if (item.status === "live" && !underAge) {
      if (resume === "offer") {
        setCardSaved(true);
        showPanel();
      }
      run(resume);
    }
  }, [resume, hasCard]);
  // No card after CARD_WAIT_MS (they closed Stripe's page, or it failed):
  // stop waiting and show the card step again for the same action.
  useEffect(() => {
    if (!resume) return;
    const t = window.setTimeout(() => {
      setResume(null);
      setNeedCard(resume);
      showPanel();
    }, CARD_WAIT_MS);
    return () => window.clearTimeout(t);
  }, [resume]);

  const showCardStep = !!needCard && !resume && (!card.isError || serverNoCard);
  // Back from Stripe's page: the Send press comes once the card is in.
  const checkingCard = !!resume && !hasCard && !card.isError;

  const cardStep = (action: AfterCardAction) => (
    <AddCardStep
      action={action}
      itemId={item.id}
      offerAmount={action === "offer" ? amount.trim() : undefined}
      onReturned={() => {
        setCardCancelled(null);
        setResume(action);
        setNeedCard(null);
        void card.refetch();
      }}
      onCancel={() => { setNeedCard(null); setCardCancelled(null); }}
      note={cardCancelled === action ? CARD_NOT_SAVED : undefined}
    />
  );

  // Until the cart read is in, say nothing yet: "Someone is buying" would flash before "Reserved for you".
  if (item.status === "reserved" && cart.isLoading) return <HoldChecking />;
  if (item.status === "reserved" && myHold) {
    return <ReservedForYou line={myHold} free={false} />;
  }
  if (item.status === "reserved") {
    return <DeclutterNotice title="Someone is buying this item.">If they don't check out in time, it goes back up for sale.</DeclutterNotice>;
  }
  if (underAge) {
    return <DeclutterNotice tone="warn" title="You must be 18 or older to buy on Declutter." />;
  }
  return (
    <section ref={panel} tabIndex={-1} className="rounded-2xl border border-border bg-card p-4 space-y-3 scroll-mt-4 focus:outline-none" aria-label="Buy or make an offer">
      {/* Owner mockup 11-01 (Mockup 1/2): Make an offer on the LEFT (outline), Buy now on the RIGHT (solid, with the
          total), side by side at every width, as in the phone bar below. Alone (offers off, or an offer already sent),
          Buy now takes the whole row. */}
      <div ref={buttons} className={myOffer || offersOff ? "grid gap-2" : "grid grid-cols-2 gap-2"} data-offer-buttons="">
        {!myOffer && !offersOff && (
          <Button
            type="button"
            variant="outline"
            size="wrap"
            className="w-full min-w-0 rounded-full"
            aria-expanded={open}
            disabled={offers.isLoading}
            onClick={() => (open ? setOpen(false) : tap("offer"))}
          >
            Make an offer
          </Button>
        )}
        {/* ONE primary at a time (audit #47): while the card step asks for a card, "Add a card" is the primary
            and Buy now steps back to an outline. */}
        <Button
          type="button"
          size="wrap"
          variant={showCardStep ? "outline" : undefined}
          className="w-full min-w-0 rounded-full"
          disabled={buy.isPending || card.isLoading}
          aria-busy={card.isLoading || undefined}
          onClick={() => tap("buy")}
        >
          <BuyNowLabel priceCents={item.current_price_cents} way={way} size={item.delivery_size} />
        </Button>
      </div>
      {footer}
      {myOffer && <YourOfferBox offer={myOffer} onChange={() => setOpen(true)} />}
      {offersOff && !myOffer && <p className="text-xs text-muted-foreground" data-offers-off="">The seller isn't taking offers on this one.</p>}
      {/* LEAD-ITEM-PAGE-LAYOUT (owner 2026-10-31): no reassurance lines under the buttons; the card step says when the card is charged. */}
      {card.isError && (
        <ErrorState variant="inline" title="We couldn't check your saved card." body={declutterErrorMessage(card.error)} onRetry={() => void card.refetch()} />
      )}
      {checkingCard && (
        <p role="status" className="text-sm text-muted-foreground">Checking for your card…</p>
      )}
      {showCardStep && needCard === "buy" && cardStep("buy")}
      {open && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            sendOffer();
          }}
        >
          {cardSaved && <p role="status" className="text-sm font-medium" data-card-saved="">Card saved. Now send your offer.</p>}
          <label htmlFor="declutter-offer" className="text-sm font-medium">Your offer</label>
          <div className="flex gap-2">
            <input
              id="declutter-offer"
              ref={offerBox}
              inputMode="decimal"
              className="flex-1 min-w-0 rounded-lg border border-input bg-background px-3 py-2 text-sm"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={`At least ${formatPrice(minCents)}`}
              aria-describedby="declutter-offer-help"
            />
            <Button
              type="submit"
              size="sm"
              variant={needCard === "offer" ? "outline" : undefined}
              className="rounded-full"
              disabled={send.isPending || !!offerProblem || card.isLoading || checkingCard}
            >
              Send offer
            </Button>
          </div>
          {cents !== null && !offerProblem && (
            // Board 67: what the buyer would pay if the seller says yes, from the same fee rule as Buy now and
            // checkout (buyNowTotalCents = checkoutAmounts for one item, pickup). Delivery is added at checkout.
            <dl className="space-y-1 rounded-[20px] border border-border bg-background p-3 text-ds-14" data-offer-bill="">
              <div className="flex justify-between gap-3"><dt>Your offer</dt><dd className="font-semibold tabular-nums text-[hsl(var(--burnt-sienna))]">{formatPrice(cents)}</dd></div>
              <div className="flex items-baseline justify-between gap-3 border-t border-border pt-1.5">
                <dt className="font-bold text-foreground">You pay if the seller says yes</dt>
                <dd className="text-ds-18 font-bold tabular-nums text-[hsl(var(--burnt-sienna))]"><BuyerTotal priceCents={cents} /></dd>
              </div>
              {/* lh-money-escrow re-review #2: a ceiling. Accepting charges the lower of the offer and the price now,
                  and more items from this seller share one 70¢. Delivery, if chosen, is added at checkout. */}
              <p className="text-ds-12 text-muted-foreground">At most, {totalPhrase(way)}. A price drop or more items from this seller makes it less.</p>
            </dl>
          )}
          <p id="declutter-offer-help" className="text-xs text-muted-foreground">
            {amount.trim() && offerProblem
              ? offerProblem
              : `The seller has 48 hours to accept, say no or answer with another price. If they accept, you have 24 hours to check out. Nothing is charged until you pay.`}
          </p>
        </form>
      )}
      {showCardStep && needCard === "offer" && cardStep("offer")}
      {barShown && typeof document !== "undefined" &&
        createPortal(
          // Portaled to <body>: a fixed bar inside the page would be placed by its transformed ancestor, not the screen.
          // Flush on the bottom edge while the dock yields (useDockYield), as on Marketplace's item page.
          <div data-declutter-buybar="" data-rail-inset="" className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card px-4 pt-2 pb-[calc(var(--safe-area-bottom,0px)+0.5rem)] shadow-[0_-4px_16px_rgb(0_0_0/0.06)] sm:hidden">
            <div role="group" aria-label="Buy or make an offer" className="mx-auto flex max-w-xl gap-2">
              {myOffer ? (
                <Button
                  type="button"
                  variant="outline"
                  size="wrap"
                  className="flex-1 min-w-0 whitespace-nowrap rounded-full px-3 font-semibold"
                  onClick={() => panel.current?.scrollIntoView({ behavior: "smooth", block: "center" })}
                >
                  Your offer
                </Button>
              ) : offersOff ? null : (
                <Button
                  type="button"
                  variant="outline"
                  size="wrap"
                  className="flex-1 min-w-0 whitespace-nowrap rounded-full px-3 font-semibold"
                  disabled={offers.isLoading}
                  onClick={() => {
                    tap("offer");
                    panel.current?.scrollIntoView({ behavior: "smooth", block: "center" });
                  }}
                >
                  {/* The same words as the panel's button (audit 3 A3-7: "Make offer" here, "Make an offer" there).
                      One line at 320 and 375, measured 2026-10-28. */}
                  Make an offer
                </Button>
              )}
              <Button
                type="button"
                size="wrap"
                className="flex-[1.3] min-w-0 rounded-full px-3"
                disabled={buy.isPending || card.isLoading}
                onClick={() => {
                  tap("buy");
                  if (!card.data) panel.current?.scrollIntoView({ behavior: "smooth", block: "center" });
                }}
              >
                <BuyNowLabel priceCents={item.current_price_cents} way={way} size={item.delivery_size} />
              </Button>
            </div>
          </div>,
          document.body,
        )}
      <OfferSentWhatNext way={way} cents={sentCents} returnFocusTo={panel} onClose={() => setSentCents(null)} onBrowse={() => { setSentCents(null); navigate("/declutter"); }} />
    </section>
  );
}
