/**
 * Declutter offers (split from DeclutterTradeViews.tsx, componentSizeRatchet, batch 1030e): "Offers on your items"
 * (side="seller", the Selling tab) and "Your offers" (side="buyer", the Buying tab), each offer a card with
 * accept / decline / counter. Every rule is enforced by the server (20261014210518); the app only explains it.
 */
import { NextStep } from "@/components/ui/NextStep";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ErrorState } from "@/components/ui/ErrorState";
import { noDeliveryWay, totalPhrase } from "@/lib/declutter/pickupWords";
import { fetchItemHandovers, fetchMyCart, fetchMyOffers, respondOffer, type MyOffer } from "@/lib/declutter/api";
import { offerBucket, underChip } from "@/lib/declutter/buyingBucket";
import type { OrderBucket } from "./OrderSteps";
import { closeWanted } from "@/lib/declutter/wanted";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { formatPrice } from "@/lib/declutter/distance";
import { dollarsInputToCents } from "@/lib/declutter/money";
import { BuyerTotal } from "./BuyerTotal";
import { NoSellerOffers, SectionHeading } from "./DeclutterTabParts";
import { GOOD_NEWS_NOTE } from "./goodNews";
import { orderWhen, timeLeft } from "@/lib/declutter/timeLeft";
import { ConfirmSheet } from "./DeclutterConfirmSheet";
import { invalidateTrades } from "./declutterLightActions";
import { useLinkedOffer, useScrollToLinkedOrder } from "./useLinkedOrder";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { InlineTextButton } from "@/components/ui/InlineTextButton";
import "@/lib/i18n/enDeclOffers";
import { t as tr, useLanguage } from "@/lib/i18n/language";
import type { MsgKey } from "@/lib/i18n/en";

/** Every Declutter read refetches after a trade (offers, cart, orders). */


/**
 * The counter box's example (audit 1030 DC-12: it was a hard-coded "30" on every offer, whatever the numbers). The
 * seller sees whole dollars halfway between the buyer's offer and the price now, the usual place to meet. The buyer
 * answering a counter sees none: the row doesn't carry their earlier offer, so any number would be made up.
 */
const counterExample = (o: MyOffer) =>
  o.my_side === "seller" ? String(Math.round((Math.min(o.amount_cents, o.current_price_cents) + o.current_price_cents) / 200)) : undefined;

/**
 * NIGHT-SELL-offers,sale-4: the counter box took any number ($1 and $99 on a $45 item) and said nothing. The range is
 * the server's (declutter_respond_offer, 20261029162620): at least $1 and at most the price now; a buyer's at least half
 * the price now; never the amount already on the table (that is Accept).
 */
function counterRange(o: Pick<MyOffer, "my_side" | "current_price_cents" | "amount_cents">): { min: number; max: number } {
  // Audit 11-10 F355: inside the server's range, a counter also has to MOVE the other way: the seller's above the
  // buyer's offer on the table, the buyer's below the seller's counter (a price equal to it is Accept, one past it is
  // nonsense: "$10" to someone who already offered $13.50).
  const serverMin = o.my_side === "buyer" ? Math.max(100, Math.ceil(o.current_price_cents / 2)) : 100;
  const serverMax = o.current_price_cents;
  const min = o.my_side === "seller" ? Math.min(serverMax, Math.max(serverMin, o.amount_cents + 1)) : serverMin;
  const max = o.my_side === "buyer" ? Math.max(min, Math.min(serverMax, o.amount_cents - 1)) : serverMax;
  return { min, max };
}

/** Why a typed counter can't be sent, in words; null when it can. */
function counterProblem(o: Pick<MyOffer, "my_side" | "current_price_cents" | "amount_cents">, cents: number | null): string | null {
  if (!cents) return null;
  const { min, max } = counterRange(o);
  if (o.my_side === "seller" && cents <= o.amount_cents && cents >= 100) return tr("dof.alreadyOffered", { amount: formatPrice(o.amount_cents) });
  if (o.my_side === "buyer" && cents >= o.amount_cents && cents <= o.current_price_cents) return tr("dof.askingLess", { amount: formatPrice(o.amount_cents) });
  if (cents < min || cents > max) return tr("dof.mustBeBetween", { min: formatPrice(min), max: formatPrice(max) });
  return null;
}

/** An ended offer's chip: dof.st.<status> (Waiting, Accepted, Declined, Ran out of time, Taken back, went to someone else). */
const offerStatusWords = (status: MyOffer["status"]) => tr(`dof.st.${status}` as MsgKey);

const noop = () => {};

/**
 * Audit 11-10 F359: an accepted offer said only "Accepted" on both sides. Its line in the cart (the cart read and key
 * the item page uses) says what is next: the buyer checks out by the line's deadline, the seller waits on the payment.
 * Nothing while the cart read is out or the line has moved on (paid: the order card says the rest).
 */
function AcceptedOfferNext({ o }: { o: MyOffer }) {
  const { t } = useLanguage();
  const cart = useQuery({ queryKey: ["declutter", "my-cart"], queryFn: fetchMyCart });
  const line = (cart.data ?? []).find((l) => l.item_id === o.item_id && l.my_side === o.my_side && l.status === "in_cart") ?? null;
  if (!line) return null;
  if (o.my_side === "buyer") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2" data-accepted-next="buyer">
        <p className="text-ds-13 text-foreground">{t("dof.inCart", { when: orderWhen(line.checkout_by) })}</p>
        <Button asChild size="sm"><Link to={`/declutter?tab=buying&checkout=${line.seller_id ?? ""}`}>{t("dof.checkOut")}</Link></Button>
      </div>
    );
  }
  return <p className="text-ds-13 text-foreground" data-accepted-next="seller">{t("dof.waitPay", { when: orderWhen(line.checkout_by) })}</p>;
}

function OfferRow({ o, linked = false, closed = false }: { o: MyOffer; linked?: boolean; closed?: boolean }) {
  const qc = useQueryClient();
  const { t } = useLanguage();
  // Q2660: the offer a notice opened scrolls into view and takes focus, once.
  const rowRef = useRef<HTMLLIElement>(null);
  useScrollToLinkedOrder(rowRef, linked, noop);
  const [counter, setCounter] = useState("");
  const [countering, setCountering] = useState(false);
  // NIGHT-SELL-offers,sale-4: opening the box puts the cursor in it (no second tap for the keyboard).
  const counterBox = useRef<HTMLInputElement>(null);
  useEffect(() => { if (countering) counterBox.current?.focus(); }, [countering]);
  const counterCents = dollarsInputToCents(counter);
  const counterBad = counterProblem(o, counterCents);
  // Accept asks in the app, never window.confirm (lead 2026-10-28, DeclutterConfirmSheet).
  const [accepting, setAccepting] = useState(false);
  // Audit 1d D4-9: "Say no" asks first too; it ends the offer for good.
  const [declining, setDeclining] = useState(false);
  // BUY-10 (buying audit 10-30 #10): "Take back my offer" ended it in one tap; it asks first, like Say no.
  const [withdrawing, setWithdrawing] = useState(false);
  // BUY-29 (lead decision 10-31): after accepting a reply to their Wanted post, the buyer is asked whether to close it
  // (the owner prefers asking over a silent change). Only the poster's own row carries the open post's id (20261031095146).
  const [askClose, setAskClose] = useState(false);
  const wantedId = o.my_side === "buyer" ? o.open_wanted_id ?? null : null;
  const close = useMutation({
    mutationFn: (id: string) => closeWanted(id),
    onSettled: () => setAskClose(false),
    onSuccess: () => { toast(t("dof.wantedClosed")); invalidateTrades(qc); },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const act = useMutation({
    mutationFn: (v: { action: "accept" | "decline" | "counter" | "withdraw"; cents?: number }) => respondOffer(o.offer_id, v.action, v.cents ?? null),
    onSettled: () => { setAccepting(false); setDeclining(false); setWithdrawing(false); },
    onSuccess: (res) => {
      setCountering(false);
      setCounter("");
      toast(
        res === "accepted" ? (o.my_side === "buyer" ? t("dof.acceptedBuyer") : t("dof.acceptedSeller"))
          : res === "countered" ? t("dof.countered")
            : res === "withdrawn" ? t("dof.withdrawn")
              : t("dof.declined"),
      );
      invalidateTrades(qc);
      if (res === "accepted" && wantedId) setAskClose(true);
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
    // the asking price, whose turn it is, and what the answer means in money, from the real rules. Audit 11-10 F359a: a
    // closed offer (in the fold) sits on the muted card ground, so it reads as finished next to the live ones.
    <li ref={rowRef} tabIndex={linked ? -1 : undefined} className={`scroll-mt-3 rounded-[20px] border border-border p-4 space-y-2.5 ${closed ? "bg-muted/50" : "bg-card"}`} data-offer-row="" data-closed-offer={closed ? "" : undefined} data-linked-offer={linked ? "" : undefined}>
      <div className="flex items-start justify-between gap-3 min-w-0">
        <div className="min-w-0">
          {wantedReply && <p className="text-ds-12 font-semibold text-[hsl(var(--sage-ink))]" data-wanted-reply="">{t("dof.wantedReply")}</p>}
          {/* Audit 1110 F408: an offer title wraps to two lines instead of an ellipsis at 375 / Bigger text. */}
          <Link to={`/declutter/item/${o.item_id}`} className="line-clamp-2 break-words block text-ds-15 font-semibold leading-snug" title={o.item_title}>{o.item_title}</Link>
          {/* Audit 1110 F356 (owner 11-11): the seller sees who made the offer, first name + last initial only. */}
          {o.my_side === "seller" && o.buyer_display && <p className="text-ds-13 text-foreground" data-offer-buyer="">{t("dof.from", { name: o.buyer_display })}</p>}
          <p className="text-ds-13 text-muted-foreground">{t("dof.priceNow", { price: formatPrice(o.current_price_cents) })}</p>
        </div>
        <div className="shrink-0 text-right">
          {/* Spec v2 §1.1: amounts wear the money ink. */}
          <p className="text-ds-20 font-bold leading-tight tabular-nums text-[hsl(var(--burnt-sienna))]">{formatPrice(o.amount_cents)}</p>
          <p className="text-ds-12 text-muted-foreground">
            {o.awaiting === o.my_side ? (o.my_side === "seller" ? t("dof.theirOffer") : wantedReply ? t("dof.theirPrice") : t("dof.theirCounter")) : o.my_side === "buyer" ? t("dof.yourOffer") : t("dof.yourPrice")}
          </p>
        </div>
      </div>
      {o.status !== "open" && (
        <span className="inline-flex rounded-full bg-muted px-2.5 py-1 text-xs font-medium">{offerStatusWords(o.status)}</span>
      )}
      {o.status === "accepted" && <AcceptedOfferNext o={o} />}
      {/* Board 160: an offer that ended unpaid never charged anything (offers charge only at checkout). The item page says
          whether it can still be bought; this card does not know, so it never promises "Offer again". */}
      {o.my_side === "buyer" && (o.status === "declined" || o.status === "expired") && (
        <p className="text-ds-13 text-muted-foreground" data-offer-ended="">
          {t("dof.nothingCharged")}{" "}
          <Link to={`/declutter/item/${o.item_id}`} className="font-semibold text-foreground underline underline-offset-2">{t("dof.seeItem")}</Link>
        </p>
      )}
      {underFloor && <p className="text-xs text-amber-700 dark:text-amber-300">{t("dof.underFloor", { price: formatPrice(o.floor_price_cents as number) })}</p>}
      {o.status === "open" && (
        // The shared next-step line (owner 11-01 12:02 PM, "Next: <what> · <deadline>"; replaces lead 10-28's "Your turn to
        // answer. 3 hours left."): the viewer's move, or who it waits on, with the time left.
        <NextStep
          className="!text-ds-13"
          value={myTurn
            ? { who: "you", text: t("dof.answerOffer"), by: timeLeft(o.respond_by) }
            : { who: "them", text: o.my_side === "buyer" ? t("dof.waitSeller") : t("dof.waitBuyer"), by: timeLeft(o.respond_by) }}
        />
      )}
      {myTurn && o.my_side === "seller" && (
        // Sellers keep the whole price (spec v2 §9.11). Members never see a fee name or number (owner 2026-10-25).
        // Good news, so the sage tint, not the rust one problems use (audit 1030 DC-13).
        <p className={GOOD_NEWS_NOTE} data-offer-note="" data-tone="good">
          {t("dof.keepA")}<strong className="tabular-nums">{formatPrice(takeCents)}</strong>{t("dof.keepB")}
        </p>
      )}
      {myTurn && o.my_side === "buyer" && (
        // Board 70: what accepting the counter costs at checkout (pickup), from the same rule as Buy now.
        <dl className="space-y-1 rounded-xl border border-border p-3 text-ds-13" data-offer-bill="">
          <div className="flex justify-between gap-3"><dt>{t("dof.billPrice")}</dt><dd className="font-semibold tabular-nums text-[hsl(var(--burnt-sienna))]">{formatPrice(takeCents)}</dd></div>
          <div className="flex items-baseline justify-between gap-3 border-t border-border pt-1"><dt className="font-bold">{t("dof.youPay", { phrase: totalPhrase(noDeliveryWay(ways.data)) })}</dt><dd className="text-ds-16 font-bold tabular-nums text-[hsl(var(--burnt-sienna))]"><BuyerTotal priceCents={takeCents} /></dd></div>
          <p className="text-ds-12 text-muted-foreground">{t("dof.atMost")}</p>
        </dl>
      )}
      {myTurn && (
        // Q2709: the shared Button (44px tap floor); the green primary on the RIGHT (owner 11-01), the row
        // right-aligned so a wrap keeps Accept at the bottom right.
        // Audit 11-10 F373: three outlined buttons competed and pushed Accept onto its own line at 375; the two
        // other answers are text links (still the shared Button, 44px), so Accept is the one button in the row.
        <div className="flex flex-wrap items-center justify-end gap-2" data-offer-actions="">
          <Button type="button" variant="link" size="sm" disabled={act.isPending} onClick={() => setDeclining(true)}>
            {t("dof.sayNo")}
          </Button>
          <Button type="button" variant="link" size="sm" disabled={act.isPending} onClick={() => setCountering((v) => !v)} aria-expanded={countering}>
            {t("dof.answerPrice")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={act.isPending}
            onClick={() => setAccepting(true)}
          >
            {t("dof.accept")}
          </Button>
        </div>
      )}
      {myTurn && countering && (
        <form
          className="space-y-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (counterCents && !counterBad) act.mutate({ action: "counter", cents: counterCents });
          }}
        >
          {/* A shown label and a "$" in the field (deep audit #47: no "$" and no label). */}
          <label className="block text-sm font-semibold" htmlFor={`counter-${o.offer_id}`}>{t("dof.yourPriceLabel")}</label>
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1" data-counter-field="">
              <span aria-hidden className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm font-semibold text-muted-foreground">$</span>
              <Input
                id={`counter-${o.offer_id}`}
                inputMode="decimal"
                className="w-full min-w-0 pl-6"
                value={counter}
                onChange={(e) => setCounter(e.target.value)}
                placeholder={counterExample(o)}
                aria-describedby={`counter-range-${o.offer_id}`}
                aria-invalid={counterBad ? true : undefined}
                ref={counterBox}
              />
            </div>
            <Button type="submit" size="sm" disabled={act.isPending || !counterCents || !!counterBad}>
              {t("dof.send")}
            </Button>
          </div>
          <p id={`counter-range-${o.offer_id}`} className={`text-ds-13 ${counterBad ? "text-[hsl(var(--destructive-ink))]" : "text-muted-foreground"}`}>
            {counterBad ?? t("dof.between", { min: formatPrice(counterRange(o).min), max: formatPrice(counterRange(o).max) })}
          </p>
        </form>
      )}
      {/* Audit 1110 F357: while a counter waits on the buyer, Say no already ends the offer, so Take back shows only
          while the seller has the turn (which also keeps it off a Wanted reply, D4-3). */}
      {o.status === "open" && o.my_side === "buyer" && o.awaiting === "seller" && (
        <InlineTextButton className="text-sm underline underline-offset-2" disabled={act.isPending} onClick={() => setWithdrawing(true)}>
          {t("dof.takeBack")}
        </InlineTextButton>
      )}
      <ConfirmSheet open={accepting} pending={act.isPending} onConfirm={() => act.mutate({ action: "accept" })} onClose={() => setAccepting(false)}
        // NIGHT-SELL-offers,sale-1: accepting sells at the lower of the offer and today's price (declutter_respond_offer,
        // B28: least(amount, current_price)), so the title names that figure, never an offer above a dropped price.
        title={o.my_side === "seller" ? t("dof.sellFor", { price: formatPrice(takeCents) }) : t("dof.buyFor", { price: formatPrice(takeCents) })}
        confirmLabel={t("dof.accept")} cancelLabel={t("dof.notNow")} testId="accept-offer">
        {o.my_side === "seller"
          ? `${takeCents < o.amount_cents ? t("dof.aboveNow", { offer: formatPrice(o.amount_cents), price: formatPrice(takeCents) }) : ""}${t("dof.sellBody", { title: o.item_title })}`
          : <>{t("dof.buyA", { title: o.item_title })}<BuyerTotal priceCents={takeCents} />{t("dof.buyB", { phrase: totalPhrase(noDeliveryWay(ways.data)) })}</>}
      </ConfirmSheet>
      <ConfirmSheet open={withdrawing} pending={act.isPending} onConfirm={() => act.mutate({ action: "withdraw" })} onClose={() => setWithdrawing(false)}
        title={t("dof.wdTitle")} confirmLabel={t("dof.wdConfirm")} cancelLabel={t("dof.wdKeep")} testId="withdraw-offer">
        {t("dof.wdBody", { title: o.item_title, amount: formatPrice(o.amount_cents) })}
      </ConfirmSheet>
      {wantedId && (
        <ConfirmSheet open={askClose} pending={close.isPending} onConfirm={() => close.mutate(wantedId)} onClose={() => setAskClose(false)}
          title={t("dof.cwTitle")} confirmLabel={t("dof.cwConfirm")} cancelLabel={t("dof.cwKeep")} testId="close-wanted-after-accept">
          {t("dof.cwBody", { title: o.item_title })}
        </ConfirmSheet>
      )}
      <ConfirmSheet open={declining} pending={act.isPending} onConfirm={() => act.mutate({ action: "decline" })} onClose={() => setDeclining(false)}
        title={t("dof.noTitle", { amount: formatPrice(o.amount_cents) })} confirmLabel={t("dof.sayNo")} cancelLabel={t("dof.notNow")} testId="decline-offer">
        {o.my_side === "seller"
          ? t("dof.noSeller", { title: o.item_title })
          : wantedReply
            ? t("dof.noReply", { title: o.item_title })
            : t("dof.noCounter", { title: o.item_title })}
      </ConfirmSheet>
    </li>
  );
}

/**
 * Offers on your items (side="seller", the Selling tab) or the offers you sent
 * (side="buyer", the Buying tab): rows 57-58.
 */
/** onlyMyTurn (audit DC-9, Selling's "To answer"): only the open offers waiting for this member, nothing else. */
/** only (audit 11-10 F374, Buying's chips): just the offers that chip files (offerBucket); nothing at all when none. */
export function OffersSection({ side, onlyMyTurn = false, only = null }: { side: "buyer" | "seller"; onlyMyTurn?: boolean; only?: OrderBucket | null }) {
  const { t } = useLanguage();
  const offers = useQuery({ queryKey: ["declutter", "my-offers"], queryFn: fetchMyOffers });
  const seller = side === "seller";
  const title = seller ? t("dof.onYourItems") : t("dof.yourOffers");
  const linkedOffer = useLinkedOffer();
  // null until the member taps the fold: then their choice wins over the notice's offer (Q2660).
  const [showClosed, setShowClosed] = useState<boolean | null>(null);
  if (offers.isError) {
    return <ErrorState variant="inline" title={t("dof.loadError")} body={declutterErrorMessage(offers.error)} onRetry={() => void offers.refetch()} />;
  }
  if (offers.isLoading) return <p className="text-sm text-muted-foreground" role="status">{t("dof.loading")}</p>;
  const mine = underChip((offers.data ?? []).filter((o) => o.my_side === side), only, (o) => offerBucket(o, side));
  if (only && mine.length === 0) return null;
  const myTurn = (o: MyOffer) => o.status === "open" && o.awaiting === side;
  const toAnswer = mine.filter(myTurn).length;
  if (onlyMyTurn) {
    const waiting = mine.filter((o) => o.status === "open" && o.awaiting === side);
    if (waiting.length === 0) return null;
    return (
      <section className="space-y-2" aria-label={title} data-offers-my-turn="">
        <SectionHeading title={title} todo={toAnswer} todoWords={t("dof.toAnswer")} />
        <ul className="space-y-3">{waiting.map((o) => <OfferRow key={o.offer_id} o={o} linked={o.offer_id === linkedOffer} />)}</ul>
      </section>
    );
  }
  // Deep audit #30: closed offers (said no, taken back, ran out, sold) piled up above the seller's live ones. The
  // seller sees the open ones; the closed ones fold under one button. declutter_my_offers keeps a closed offer 30 days.
  // Audit 11-10 F360d: Buying folds its finished offers the same way (said no, taken back, ran out, sold). An accepted
  // offer stays out: it is in the buyer's cart with a check-out-by time. A chosen chip already picked its rows, so
  // nothing folds under one, and an offer waiting on this member's answer comes first.
  const folds = (o: MyOffer) => (seller ? o.status !== "open" : only === null && o.status !== "open" && o.status !== "accepted");
  const shown = mine.filter((o) => !folds(o)).sort((a, b) => Number(myTurn(b)) - Number(myTurn(a)));
  const closed = mine.filter(folds);
  // Q2660: a notice's offer that has since closed opens the fold, so the card it names is on screen.
  const closedOpen = showClosed ?? (linkedOffer !== null && closed.some((o) => o.offer_id === linkedOffer));
  return (
    <section className="space-y-2" aria-label={title}>
      <SectionHeading title={title} todo={toAnswer} todoWords={t("dof.toAnswer")} />
      {mine.length === 0 ? (
        seller ? <NoSellerOffers /> : <p className="text-sm text-muted-foreground">{t("dof.noneMade")}</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("dof.noneOpen")}</p>
      ) : (
        <ul className="space-y-3">{shown.map((o) => <OfferRow key={o.offer_id} o={o} linked={o.offer_id === linkedOffer} />)}</ul>
      )}
      {closed.length > 0 && (
        <>
          <InlineTextButton className="text-sm font-medium" aria-expanded={closedOpen}
            onClick={() => setShowClosed(!closedOpen)} data-closed-offers-toggle="">
            {closedOpen ? t("dof.hideClosed") : closed.length === 1 ? t("dof.showClosed1", { n: 1 }) : t("dof.showClosedN", { n: closed.length })}
          </InlineTextButton>
          {closedOpen && <ul className="space-y-3" data-closed-offers="">{closed.map((o) => <OfferRow key={o.offer_id} o={o} linked={o.offer_id === linkedOffer} closed />)}</ul>}
        </>
      )}
    </section>
  );
}
