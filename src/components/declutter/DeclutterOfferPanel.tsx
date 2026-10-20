/**
 * The buy / offer panel on someone else's live Declutter item and its card
 * step (rows 36, 53, 56-59; owner 2026-10-19: Buy now and Make an offer always
 * show, and with no saved card either one asks for a card and comes back to
 * itself). Moved out of DeclutterTradeViews.tsx unchanged (component size limit).
 */
import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/ErrorState";
import { useAgeGate } from "@/hooks/useAgeGate";
import { useDockYield } from "@/components/mobileNav/useDockYield";
import { buyNow, fetchMyCard, makeOffer, startCardSave, type DeclutterItem } from "@/lib/declutter/api";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { formatPrice } from "@/lib/declutter/distance";
import { buyNowTotalCents, minOfferCents } from "@/lib/declutter/money";
import { openExternalUrl } from "@/lib/openExternalUrl";
import { afterCardFromState, rememberAfterCard, type AfterCardAction } from "@/lib/declutter/afterCard";
import { DeclutterNotice } from "./declutterUi";
import { dollarsInputToCents, invalidateTrades } from "./DeclutterTradeViews";

/**
 * Row 36, as the step INSIDE a buy or an offer (owner, 2026-10-19): a buyer
 * with no saved card still sees Buy now and Make an offer; tapping either asks
 * for a card here, then carries on with that same action (see afterCard.ts:
 * on the web via the return from Stripe's page, in the app on return from the
 * in-app browser). Nothing is charged by saving a card.
 */
function AddCardStep({ action, itemId, onReturned, onCancel }: {
  action: AfterCardAction;
  itemId: string;
  onReturned: () => void;
  onCancel: () => void;
}) {
  const [opening, setOpening] = useState(false);
  return (
    <div className="rounded-2xl border border-border bg-muted/40 p-4 space-y-2" role="group" aria-label="Add a card">
      <p className="text-sm font-semibold">Add a card to finish.</p>
      <p className="text-xs text-muted-foreground">
        You're only charged when you buy. {action === "buy" ? "Then you confirm the buy." : "Then you enter your offer."}
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
              rememberAfterCard(itemId, action);
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
 * True while `el` is off screen (IntersectionObserver). False where the
 * observer does not exist, so the in-page buttons are then the only ones.
 */
function useOffScreen(el: RefObject<HTMLElement>): boolean {
  const [off, setOff] = useState(false);
  useEffect(() => {
    const node = el.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setOff(!entry.isIntersecting));
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
 * amount entry. The age, reserved and own-item gates stay as they were, and
 * the server checks every buy and offer (strikes, card, sold) on its own.
 */
/**
 * Board 4: "Buy now" over "$40.60 total with fee". The total is the checkout
 * total (buyNowTotalCents = checkoutAmounts, the rule declutter_start_checkout
 * freezes), never the bare price (D6). Screen readers hear one line.
 */
function BuyNowLabel({ priceCents }: { priceCents: number }) {
  return (
    <span className="flex flex-col items-center leading-tight">
      <span className="font-semibold">Buy now</span>{" "}
      <span className="sr-only">·</span>{" "}
      <span data-buy-total="" className="text-xs font-medium">{formatPrice(buyNowTotalCents(priceCents))} total with fee</span>
    </span>
  );
}

export function OfferPanel({ item, userId }: { item: DeclutterItem; userId: string }) {
  const qc = useQueryClient();
  const { underAge } = useAgeGate();
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const buttons = useRef<HTMLDivElement>(null);
  // Phone (owner, 2026-10-19): while the in-page buttons are scrolled out of
  // view, the same two actions ride in a bar above the bottom dock.
  const barShown = useOffScreen(buttons);
  // The bar owns the bottom strip while it shows; the dock steps aside (Q1646).
  useDockYield(barShown && !underAge && item.status === "live");
  const [amount, setAmount] = useState("");
  /** The action waiting for a card: shown as AddCardStep, then resumed once a card is on file. */
  const [needCard, setNeedCard] = useState<AfterCardAction | null>(null);
  /**
   * An action to carry on with once the card read shows a saved card: back
   * from Stripe's page on the web (router state set by DeclutterPage, never the
   * address) or from the in-app browser in the app.
   */
  const [resume, setResume] = useState<AfterCardAction | null>(() => afterCardFromState(location.state));
  // The saved card is written by Stripe's webhook, which can land a moment
  // after the member is back: while resuming, read again every CARD_POLL_MS.
  const card = useQuery({
    queryKey: ["declutter", "card", userId],
    queryFn: () => fetchMyCard(userId),
    refetchInterval: resume ? CARD_POLL_MS : false,
  });
  const minCents = minOfferCents(item.current_price_cents);
  const cents = dollarsInputToCents(amount);
  const offerProblem =
    cents === null ? "Enter an amount, like 25 or 25.50."
      : cents >= item.current_price_cents ? "Offer less than the price. To pay the price, tap Buy now."
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

  const confirmBuy = () => {
    const total = buyNowTotalCents(item.current_price_cents);
    // The single-item pickup total (lh-money-escrow review notes: Helpr delivery
    // is added at checkout, and more from the same seller shares one 70c).
    if (window.confirm(`Buy "${item.title}" for ${formatPrice(total)} (${formatPrice(item.current_price_cents)} + ${formatPrice(total - item.current_price_cents)} buyer's fee)? Delivery, if you choose it, is added at checkout. You'll have 48 hours to check out and pay. Your card isn't charged now.`)) {
      buy.mutate();
    }
  };
  const run = (action: AfterCardAction) => {
    if (action === "buy") confirmBuy();
    else setOpen(true);
  };
  const tap = (action: AfterCardAction) => {
    setResume(null);
    if (card.data) {
      setNeedCard(null);
      run(action);
    } else {
      setOpen(false);
      setNeedCard(action);
    }
  };

  // The action came back in the router state: drop it from history so a
  // reload or Back never replays it.
  useEffect(() => {
    if (afterCardFromState(location.state)) {
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
    if (item.status === "live" && !underAge) run(resume);
  }, [resume, hasCard]);
  // No card after CARD_WAIT_MS (they closed Stripe's page, or it failed):
  // stop waiting and show the card step again for the same action.
  useEffect(() => {
    if (!resume) return;
    const t = window.setTimeout(() => {
      setResume(null);
      setNeedCard(resume);
    }, CARD_WAIT_MS);
    return () => window.clearTimeout(t);
  }, [resume]);

  const showCardStep = !!needCard && !resume && !card.isError;

  if (item.status === "reserved") {
    return <DeclutterNotice title="Someone is buying this item.">If they don't check out in time, it goes back up for sale.</DeclutterNotice>;
  }
  if (underAge) {
    return <DeclutterNotice tone="warn" title="You must be 18 or older to buy on Declutter." />;
  }
  return (
    <section ref={panel} className="rounded-2xl border border-border bg-card p-4 space-y-3 scroll-mt-4" aria-label="Buy or make an offer">
      {/* Full width and stacked on a phone (a long price never squeezes them); side by side from sm. */}
      <div ref={buttons} className="grid gap-2 sm:grid-cols-2">
        <Button
          type="button"
          size="wrap"
          className="w-full rounded-full"
          disabled={buy.isPending || card.isLoading}
          aria-busy={card.isLoading || undefined}
          onClick={() => tap("buy")}
        >
          <BuyNowLabel priceCents={item.current_price_cents} />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="wrap"
          className="w-full rounded-full"
          aria-expanded={open}
          disabled={card.isLoading}
          onClick={() => (open ? setOpen(false) : tap("offer"))}
        >
          Make an offer
        </Button>
      </div>
      {/* The card step says it itself; once is enough. */}
      {!showCardStep && <p className="text-xs text-muted-foreground">You're only charged when you buy.</p>}
      {card.isError && (
        <ErrorState variant="inline" title="We couldn't check your saved card." body={declutterErrorMessage(card.error)} onRetry={() => void card.refetch()} />
      )}
      {resume && !hasCard && !card.isError && (
        <p role="status" className="text-sm text-muted-foreground">Checking for your card…</p>
      )}
      {showCardStep && needCard && (
        <AddCardStep
          action={needCard}
          itemId={item.id}
          onReturned={() => {
            setResume(needCard);
            setNeedCard(null);
            void card.refetch();
          }}
          onCancel={() => setNeedCard(null)}
        />
      )}
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
            <Button type="submit" size="sm" className="rounded-full" disabled={send.isPending || !!offerProblem}>
              Send offer
            </Button>
          </div>
          <p id="declutter-offer-help" className="text-xs text-muted-foreground">
            {amount.trim() && offerProblem
              ? offerProblem
              : `The seller has 48 hours to accept, say no or answer with another price. If they accept, you have 48 hours to check out. Nothing is charged until you pay.`}
          </p>
        </form>
      )}
      <p className="text-xs text-muted-foreground">
        At checkout you pay the price plus a buyer's fee of 5% + 70¢ (once per seller). The seller keeps the whole price.
      </p>
      {barShown && typeof document !== "undefined" &&
        createPortal(
          // Portaled to <body>: a fixed bar inside the page would be placed by its transformed ancestor, not the screen.
          // Flush on the bottom edge while the dock yields (useDockYield), as on Marketplace's item page.
          <div data-declutter-buybar="" data-rail-inset="" className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card px-4 pt-2 pb-[calc(var(--safe-area-bottom,0px)+0.5rem)] shadow-[0_-4px_16px_rgb(0_0_0/0.06)] sm:hidden">
            <div role="group" aria-label="Buy or make an offer" className="mx-auto flex max-w-xl gap-2">
              <Button
                type="button"
                variant="outline"
                size="wrap"
                className="h-14 flex-1 min-w-0 rounded-full px-3 font-semibold"
                disabled={card.isLoading}
                onClick={() => {
                  tap("offer");
                  panel.current?.scrollIntoView({ behavior: "smooth", block: "center" });
                }}
              >
                Make an offer
              </Button>
              <Button
                type="button"
                size="wrap"
                className="h-14 flex-[1.5] min-w-0 rounded-full px-3"
                disabled={buy.isPending || card.isLoading}
                onClick={() => {
                  tap("buy");
                  if (!card.data) panel.current?.scrollIntoView({ behavior: "smooth", block: "center" });
                }}
              >
                <BuyNowLabel priceCents={item.current_price_cents} />
              </Button>
            </div>
          </div>,
          document.body,
        )}
    </section>
  );
}
