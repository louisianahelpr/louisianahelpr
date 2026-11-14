/**
 * The buy / offer panel on someone else's live Declutter item and its card
 * step (rows 36, 53, 56-59; owner 2026-10-19: Buy now and Make an offer always
 * show; DA-11: an offer asks for a card at Send, after the amount is typed).
 * Owner 11-07 (ONE Stripe page, replacing the 10-28 two-page choice): Buy now
 * never asks for a card first. It holds the item and opens checkout, whose one
 * pay page also saves the card for later offers. Only an offer asks for a card,
 * because it is charged later. Moved out of DeclutterTradeViews.tsx unchanged (component size limit).
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/ErrorState";
import { useAgeGate } from "@/hooks/useAgeGate";
import { StickyActionBar } from "@/components/ui/StickyActionBar";
import { buyNow, fetchItemHandovers, fetchMyCard, fetchMyCart, fetchMyOffers, makeOffer, startCardSave, type DeclutterItem, type DeliverySize } from "@/lib/declutter/api";
import { noDeliveryWay, totalPhrase, type NoDeliveryWay } from "@/lib/declutter/pickupWords";
import { deliveryPriceCents } from "@/lib/declutter/delivery";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { formatPrice } from "@/lib/declutter/distance";
import { centsToDollars, minOfferCents, OFFER_CHIP_PERCENTS, offerChipCents } from "@/lib/declutter/money";
import { BuyerTotal } from "./BuyerTotal";
import { PriceInclFee, inclFeeText } from "./PriceInclFee";
import { openExternalUrl } from "@/lib/openExternalUrl";
import { afterCardFromState, cardCancelledFromState, offerAmountFromState, rememberAfterCard, type AfterCardAction } from "@/lib/declutter/afterCard";
import { DeclutterNotice } from "./declutterUi";
import { OfferSentWhatNext } from "./OfferSentWhatNext";
import { checkoutLinkFor } from "@/lib/declutter/buyNowHold";
import { HoldChecking, myHoldOn, myOpenOfferOn, ReservedForYou, YourOfferBox } from "./DeclutterYourOffer";
import { dollarsInputToCents } from "@/lib/declutter/money";
import { invalidateTrades } from "./declutterLightActions";
import { Input } from "@/components/ui/input";
import { OfferSuggestion } from "./OfferSuggestion";
import { ChoicePill } from "@/components/ui/ChoicePill";
import { useLanguage } from "@/lib/i18n/language";
import "@/lib/i18n/enOffer";
import "@/lib/i18n/enDeclutter";

/**
 * Row 36, as the step INSIDE an offer (owner, 2026-10-19; owner 11-07: offers
 * only, Buy now pays on one page that saves the card): Send with no saved card
 * asks for a card here, then carries on with the offer (see afterCard.ts: on the
 * web via the return from Stripe's page, in the app on return from the in-app
 * browser). Nothing is charged by saving a card.
 */
/** NIGHT-BUYING0-7: the step's line when the member came back from the card page without saving one. */
const CARD_NOT_SAVED = "offer.cardNotSaved" as const;

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
  const { t } = useLanguage();
  return (
    <div className="rounded-2xl border border-border bg-muted/40 p-4 space-y-2" role="group" aria-label={t("offer.addCard")}>
      {note && <p className="text-sm text-foreground" role="status" data-card-not-saved="">{note}</p>}
      {/* Q2573 (audit 1102a): "Add a card to finish." on the first tap, before anything had started. */}
      {/* Owner 11-07: only an offer asks for a card first (Buy now's one pay page saves it), so the step names the offer. */}
      <p className="text-sm font-semibold" data-card-step-title="">{t("offer.cardStepTitle")}</p>
      <p className="text-xs text-muted-foreground">
        {t("offer.cardStepBody")}
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
          {opening ? t("offer.opening") : t("offer.addCard")}
        </Button>
        <Button type="button" variant="outline" size="sm" className="w-full rounded-full" onClick={onCancel}>
          {t("offer.notNow")}
        </Button>
      </div>
    </div>
  );
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
 * Owner 11-01 (app-wide): side-by-side buttons are ONE line with short labels. So "Buy · $37.45", not "Buy now" over
 * "$37.45 total + any one-time setup fee" (four lines at 375); the setup-fee words were a small note under the
 * buttons. The figure is the checkout total (buyNowTotalCents = checkoutAmounts, the rule declutter_start_checkout
 * freezes), never the bare price (D6), PLUS the one-time account setup fee a first purchase carries (A1-B2: the
 * button said $32.20 while Stripe charged $34.20). Screen readers hear "Buy now · $37.45 total" (and the setup-fee words while they apply).
 */
function BuyNowLabel({ priceCents, way, size }: { priceCents: number; way: NoDeliveryWay; size: DeliverySize }) {
  const { t } = useLanguage();
  // Owner pick 2 (11-08, one price story): the item's "$X incl. fee" right above is the price; the button says
  // "Buy now" and names no second figure. The one-time setup fee is its own line in the checkout summary
  // (DeclutterCheckoutSummary "One-time setup fee"), never folded into a button a first-time buyer compares to the card.
  // Audit BUY-3 stays: on an item the seller offers only delivered (way "none"), the pickup price is a figure nobody can
  // pay, so the label names the least it costs delivered (the least a Helpr delivery can cost, one road mile).
  if (way !== "none") return <span className="whitespace-nowrap font-semibold" data-buy-label="">{t("decl.buy.now")}</span>;
  return (
    <span className="whitespace-nowrap font-semibold" data-buy-label="">
      {/* Text nodes carry the spaces: a space at a span's edge is dropped from the accessible name. */}
      <span aria-hidden>{t("decl.buy.short")} ·</span><span className="sr-only">{t("decl.buy.now")} ·</span>{" "}
      {t("decl.buy.from")}{" "}
      <BuyerTotal
        priceCents={priceCents}
        addCents={deliveryPriceCents(1, [size])}
        suffix={<>{" "}<span className="sr-only">{t("decl.buy.delivered")}</span></>}
        pendingClassName="sr-only"
      />
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
  // F260q (owner 11-11): the buy bar's and notices' words from the dictionary (enDeclutter.ts / esDeclutter.ts).
  const { t } = useLanguage();
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
  // Q2564: whatever opens (the card step or the offer box) is brought into view, nearest edge, so it never sits
  // under the dock at 375.
  const stepArea = useRef<HTMLDivElement>(null);
  const stepOpen = open || !!needCard;
  useEffect(() => {
    if (stepOpen) stepArea.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
  }, [stepOpen, needCard]);
  useEffect(() => { if (resume) showPanel(); }, [resume]);
  useEffect(() => {
    // Owner 11-07: Buy now never asks for a card, so a "buy" brought back from an older card trip opens nothing.
    if (!cardCancelled || cardCancelled === "buy") return;
    setNeedCard(cardCancelled);
    showPanel();
  }, [cardCancelled]);
  /** The server refused an offer for want of a card: ask for one at the panel. True when it did. */
  const askCardIfRefused = (err: unknown) => {
    if (String((err as { message?: unknown } | null)?.message ?? "").trim() !== "card_required") return false;
    setServerNoCard(true);
    setNeedCard("offer");
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
    cents === null ? t("offer.enterAmount")
      : cents >= item.current_price_cents ? t("offer.lessThanPrice")
        : cents < minCents ? t("offer.atLeast", { min: formatPrice(minCents) })
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
    onError: (err) => { if (!askCardIfRefused(err)) toast.error(declutterErrorMessage(err)); },
  });
  // DB-5 (owner 2026-10-30): "Buy now goes straight to checkout, with no strike for backing out before paying." No
  // reserve sheet: the tap holds the item (the server's 48-hour line, needed for checkout) and opens this seller's
  // checkout in Buying, where Pay is its own press and nothing is charged before it. The button already shows the
  // pickup total; a buyer who backs out gets no strike (declutter_deadline_sweep, 20261030064929) and can Remove it.
  // Owner 11-07: no card is needed first (declutter_buy_now, 20261107174801); checkout's one pay page saves the card.
  const buy = useMutation({
    mutationFn: () => buyNow(item.id, item.current_price_cents),
    onSuccess: () => {
      invalidateTrades(qc);
      navigate(checkoutLinkFor(item.seller_id));
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
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
    setNeedCard(null);
    // DA-11: the amount comes first; the card is asked for at Send (sendOffer).
    if (action === "offer") {
      setOpen(true);
      return;
    }
    // Owner 11-07 (ONE Stripe page): Buy now holds the item and opens checkout with or without a saved card.
    run(action);
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
      // Owner 11-07: only an offer has a card step to open again.
      setNeedCard(resume === "offer" ? resume : null);
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
      note={cardCancelled === action ? t(CARD_NOT_SAVED) : undefined}
    />
  );

  // Until the cart read is in, say nothing yet: "Someone is buying" would flash before "Reserved for you".
  if (item.status === "reserved" && cart.isLoading) return <HoldChecking />;
  if (item.status === "reserved" && myHold) {
    return <ReservedForYou line={myHold} free={false} />;
  }
  if (item.status === "reserved") {
    return <DeclutterNotice title={t("decl.buy.someoneBuying")}>{t("decl.buy.someoneBuyingBody")}</DeclutterNotice>;
  }
  if (underAge) {
    return <DeclutterNotice tone="warn" title={t("decl.buy.underAge")} />;
  }
  return (
    // F119: lg:contents lifts the panel's children into the item column, so the pinned buy bar can stay in view the
    // whole length of the column (a sticky box never leaves its parent).
    <section ref={panel} tabIndex={-1} className="space-y-3 scroll-mt-4 focus:outline-none lg:contents" aria-label={t("decl.buy.bar")}>
      {/* Owner pick 1 (11-08, replacing 11-07's stacked buttons): ONE sticky bar with Make offer and Buy now, the one
          primary on the right. Fixed on the bottom edge of a phone (the dock yields), in the page on a wider screen.
          Message moved to the seller row (DeclutterItemView). Offers off: Buy now alone; an offer already sent: "Your
          offer" in Make offer's place. */}
      {/* F119 (UI audit 11-09): on a computer the pair stays pinned while the description and questions scroll. */}
      {/* Owner 11-14 (Depop/Vinted audit item 9): 44px buttons in the phone bar (max-sm:min-h-11), 56px wider. */}
      <StickyActionBar label={t("decl.buy.bar")} data-declutter-buybar="" spacer={false} pinWide>
        {myOffer ? (
          <Button type="button" variant="outline" size="wrap" className="whitespace-nowrap rounded-full px-3 font-semibold max-sm:min-h-11 max-sm:py-1"
            onClick={() => panel.current?.querySelector("[data-your-offer]")?.scrollIntoView({ behavior: "smooth", block: "center" })}>
            {t("decl.buy.yourOffer")}
          </Button>
        ) : offersOff ? null : (
          <Button
            type="button"
            variant="outline"
            size="wrap"
            className="whitespace-nowrap rounded-full px-3 font-semibold max-sm:min-h-11 max-sm:py-1"
            aria-expanded={open}
            disabled={offers.isLoading}
            onClick={() => (open ? setOpen(false) : tap("offer"))}
          >
            <span data-offer-label="">{t("decl.buy.makeOffer")}</span>
          </Button>
        )}
        {/* ONE primary at a time (audit #47): while the card step asks for a card, "Add a card" is the primary
            and Buy now steps back to an outline. */}
        <Button
          type="button"
          size="wrap"
          variant={showCardStep ? "outline" : undefined}
          className="rounded-full px-3 max-sm:min-h-11 max-sm:py-1"
          disabled={buy.isPending}
          onClick={() => tap("buy")}
        >
          <BuyNowLabel priceCents={item.current_price_cents} way={way} size={item.delivery_size} />
        </Button>
      </StickyActionBar>
      {/* Q2564 (Auditor 1, audit 1102a): the card step and the offer box open HERE, right under the buttons, and the
          panel's footer (the delivery line) right after them, as before; at 375 they used to open below that table, behind the
          dock, so a press on Buy or Offer showed nothing. A tap also brings the opened step into view. */}
      <div ref={stepArea} className="space-y-3 scroll-mb-28" data-offer-step-area="">
      {open && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            sendOffer();
          }}
        >
          {cardSaved && <p role="status" className="text-sm font-medium" data-card-saved="">{t("offer.cardSaved")}</p>}
          <label htmlFor="declutter-offer" className="text-sm font-medium">{t("decl.buy.yourOffer")}</label>
          {/* Owner 11-07 (Vinted review): quick chips, "10% off" and "20% off" the price (shown only where the server would
              take them: at least half the price, under the price), and Custom, the amount field below. */}
          <div role="radiogroup" aria-label={t("offer.quickAmounts")} className="grid grid-cols-3 gap-2" data-offer-chips="">
            {OFFER_CHIP_PERCENTS.map((pct) => {
              const chip = offerChipCents(item.current_price_cents, pct);
              if (chip === null) return null;
              return (
                // Owner 11-11 (F358, the 11-09 rule as on the item page): the offer itself is the big figure and what the
                // buyer would pay, "$X incl. fee", sits small under it. Display only: the offer sent is still `chip`.
                <ChoicePill key={pct} selected={cents === chip} data-offer-chip={pct} aria-label={t("offer.chipAria", { pct, total: inclFeeText(chip), amount: formatPrice(chip) })}
                  className="flex-col justify-center px-2 py-1 leading-tight" onClick={() => setAmount(centsToDollars(chip))}>
                  <span>{t("offer.pctOff", { pct })}</span>
                  <span className="block text-ds-13 font-bold tabular-nums" data-offer-chip-amount="">{formatPrice(chip)}</span>
                  <PriceInclFee priceCents={chip} className="block text-ds-11 font-normal tabular-nums text-muted-foreground" />
                </ChoicePill>
              );
            })}
            <ChoicePill selected={amount.trim() !== "" && !OFFER_CHIP_PERCENTS.some((p) => offerChipCents(item.current_price_cents, p) === cents)}
              data-offer-chip="custom" className="justify-center px-2" onClick={() => { setAmount(""); offerBox.current?.focus(); }}>
              {t("offer.custom")}
            </ChoicePill>
          </div>
          {/* Q2471 (2): Claude's suggested amount, one tap to fill the box. */}
          <OfferSuggestion itemId={item.id} priceCents={item.current_price_cents} onUse={setAmount} />
          <Input
            id="declutter-offer"
            ref={offerBox}
            inputMode="decimal"
            className="w-full min-w-0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={t("offer.customPlaceholder", { min: formatPrice(minCents) })}
            aria-describedby="declutter-offer-help"
          />
          {cents !== null && !offerProblem && (
            // Board 67: what the buyer would pay if the seller says yes, from the same fee rule as Buy now and
            // checkout (buyNowTotalCents = checkoutAmounts for one item, pickup). Delivery is added at checkout.
            <dl className="space-y-1 rounded-[20px] border border-border bg-background p-3 text-ds-14" data-offer-bill="">
              <div className="flex justify-between gap-3"><dt>{t("decl.buy.yourOffer")}</dt><dd className="font-semibold tabular-nums text-[hsl(var(--burnt-sienna))]">{formatPrice(cents)}</dd></div>
              <div className="flex items-baseline justify-between gap-3 border-t border-border pt-1.5">
                <dt className="font-bold text-foreground">{t("offer.youPayIfYes")}</dt>
                <dd className="text-right text-ds-18 font-bold tabular-nums text-[hsl(var(--burnt-sienna))]"><BuyerTotal priceCents={cents} /><span className="block whitespace-nowrap text-right text-ds-12 font-medium text-muted-foreground" data-offer-incl-fee="">{t("offer.inclFee")}</span></dd>
              </div>
              {/* lh-money-escrow re-review #2: a ceiling. Accepting charges the lower of the offer and the price now,
                  and more items from this seller share one 70¢. Delivery, if chosen, is added at checkout. */}
              <p className="text-ds-12 text-muted-foreground">{t("offer.atMost", { phrase: totalPhrase(way) })}</p>
            </dl>
          )}
          <p id="declutter-offer-help" className="text-xs text-muted-foreground">
            {amount.trim() && offerProblem
              ? offerProblem
              : t("offer.help")}
          </p>
          {/* Owner 11-07: ONE offer button, under the total. */}
          <Button
            type="submit"
            size="wrap"
            variant={needCard === "offer" ? "outline" : undefined}
            className="w-full rounded-full px-3"
            disabled={send.isPending || !!offerProblem || card.isLoading || checkingCard}
          >
            {t("offer.send")}
          </Button>
        </form>
      )}
      {showCardStep && needCard === "offer" && cardStep("offer")}
      </div>
      {footer}
      {myOffer && <div data-your-offer=""><YourOfferBox offer={myOffer} onChange={() => setOpen(true)} /></div>}
      {offersOff && !myOffer && <p className="text-xs text-muted-foreground" data-offers-off="">{t("decl.buy.offersOff")}</p>}
      {/* LEAD-ITEM-PAGE-LAYOUT (owner 2026-10-31): no reassurance lines under the buttons; the card step says when the card is charged. */}
      {card.isError && (
        <ErrorState variant="inline" title={t("offer.cardCheckFailed")} body={declutterErrorMessage(card.error)} onRetry={() => void card.refetch()} />
      )}
      {checkingCard && (
        <p role="status" className="text-sm text-muted-foreground">{t("offer.checkingCard")}</p>
      )}
      <OfferSentWhatNext way={way} cents={sentCents} returnFocusTo={panel} onClose={() => setSentCents(null)} onBrowse={() => { setSentCents(null); navigate("/declutter"); }} />
    </section>
  );
}
