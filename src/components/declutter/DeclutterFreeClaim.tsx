/**
 * The Free section (20261027170717, owner 2026-10-27 for the launch): on someone else's FREE item, one
 * button in place of Buy now / Make an offer. No card is asked and nothing is charged.
 * The Free change (Q2487, owner 2026-10-29): the button ASKS for the item; the item stays
 * up and the giver picks who gets it (FreeRequestsForGiver below). The picked person's asked time is booked at the
 * pick (20261101181129); an ask with no time (an older app build) still gets the 48 hours to choose in the cart. At most 3 at a time (asks
 * plus free items waiting); the server says so in plain words when a fourth is tried.
 * Owner 11-01 (Mockup 3): the button opens FreeAskSheet, where the asker picks the pickup time from the giver's
 * times (declutter_request_free_at); the giver's list shows each asker's time.
 */
import { NextStep } from "@/components/ui/NextStep";
import { PorchPlacePicker, useSellerPorchPlaces } from "./DeclutterPorchPlaces";
import { lazy, Suspense, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDockYield } from "@/components/mobileNav/useDockYield";
import { useOffScreen } from "./useOffScreen";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { InlineTextButton } from "@/components/ui/InlineTextButton";
import { useAgeGate } from "@/hooks/useAgeGate";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  checkoutFree, fetchFreeRequestsForItem, fetchSellerCard, fetchItemHandovers, fetchMyCart, fetchMyFreePause, fetchMyFreeRequests, pickFreeRequest,
  withdrawFreeRequest, type DeclutterItem, type Handover,
} from "@/lib/declutter/api";
import { ErrorState } from "@/components/ui/ErrorState";
import { wayAllowed } from "@/lib/declutter/handovers";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { freeClaimGateRefusal } from "@/lib/declutter/setupFee";
import { firstPickSteps } from "@/lib/declutter/freePickSteps";
import { useIdentityCheckOnStore } from "@/lib/identityCheckSwitch";
import { DeclutterNotice } from "./declutterUi";
import { ConfirmSheet } from "./DeclutterConfirmSheet";
import { HoldChecking, myHoldOn, ReservedForYou } from "./DeclutterYourOffer";
import { cn, formatName } from "@/lib/utils";
import { Sheet, SheetContent, SheetHero } from "@/components/ui/sheet";
import { NativeRadio } from "@/components/ui/NativeRadio";
import { getLang, t as tr, useLanguage } from "@/lib/i18n/language";
import type { MsgKey } from "@/lib/i18n/en";
import "@/lib/i18n/enFree";

// Owner 11-01 (Mockup 3): the "Ask for it" sheet loads when the button is pressed, never with the item page.
const FreeAskSheet = lazy(() => import("./FreeAskSheet"));
// "None of the ways works" shows only when the giver offers no way this item can use: its chat module (2.7 KB gz) loads
// then, not with every cold item page (critical-path budget, 11-11).
const NoWayWorks = lazy(() => import("./DeclutterHandoverTalk").then((m) => ({ default: m.NoWayWorks })));

/** "Today 3 PM" for a time the asker picked (the sheet's own words), without loading the sheet. */
function pickedTimeLabel(iso: string): string {
  const zone = "America/Chicago";
  // F260q: day and clock words in the viewer's language.
  const locale = getLang() === "es" ? "es-US" : "en-US";
  const d = new Date(iso);
  const day = (x: Date) => new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "numeric", day: "numeric" }).format(x);
  const time = new Intl.DateTimeFormat(locale, { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(d).replace(":00", "");
  if (day(d) === day(new Date())) return tr("free.today", { time });
  return `${new Intl.DateTimeFormat(locale, { timeZone: zone, weekday: "short", month: "numeric", day: "numeric" }).format(d)}, ${time}`;
}


/**
 * The ways a free item can be collected (porch pickup, or at the giver's home): porch only when porch is on, and of
 * those only what the giver ticked (null = an older item with no ticks: both, as before). One rule for the ask line
 * on the item page and for the free checkout, so the page never promises a way that checkout then leaves out.
 */
function freeWaysOffered(porchOk: boolean, ways: Handover[] | null): FreeHandover[] {
  return (porchOk ? (["porch", "pickup_home"] as FreeHandover[]) : (["pickup_home"] as FreeHandover[])).filter((h) => wayAllowed(ways, h));
}

/**
 * DA-5 (Declutter audit 2026-10-30): the ask line named "their home or from their porch" whatever the giver ticked.
 * It now names only the ways this item offers (undefined = still loading: no way named yet).
 */
function freeAskLine(offered: FreeHandover[] | undefined, oneTimeCheckAhead = false): string {
  const how = offered === undefined ? ""
    : offered.length === 2 ? tr("free.howBoth")
    : offered[0] === "porch" ? tr("free.howPorch")
    : offered[0] === "pickup_home" ? tr("free.howHome")
    : tr("free.howAgree");
  // Asking is free (owner 2026-10-30). "Nothing is charged" would overpromise to a member whose first pick carries the one-time ID check.
  // Owner 11-01 (Mockup 3): the asker picks the pickup time when they ask, and the giver's pick books it
  // (declutter_pick_free_request, 20261101181129). That booking happens only for a member already verified: a
  // first-timer the giver picks gets the item held instead, does the one-time ID check, then chooses the time, so
  // "that time is already set" was false for them (11-07 free-claim trace).
  const ifYou = oneTimeCheckAhead ? `${firstPickSteps()}${how}` : tr("free.ifSet", { how });
  return tr("free.rulesLine", { lead: oneTimeCheckAhead ? tr("free.askingFree") : tr("free.freeNothing"), ifYou });
}

export function FreeClaimPanel({ item }: { item: DeclutterItem }) {
  const qc = useQueryClient();
  const { t } = useLanguage();
  // Same query (and cache) as the item page's "You can get it by" lines (ItemPickupWays). A failed read keeps the
  // older behaviour (null: every free way), as there.
  const ticks = useQuery({ queryKey: ["declutter", "item-handovers", item.id], queryFn: () => fetchItemHandovers(item.id) });
  const offered = ticks.isLoading ? undefined : freeWaysOffered(item.porch_ok !== false, Array.isArray(ticks.data) ? (ticks.data as Handover[]) : null);
  const { user, profile } = useCurrentUser();
  const { underAge } = useAgeGate();
  const idCheckOn = useIdentityCheckOnStore();
  const oneTimeCheckAhead = idCheckOn && profile?.onboarding_fee_paid === false;
  // Deep audit #3: a free item the member was picked for says so, with the way to choose a pickup.
  const cart = useQuery({ queryKey: ["declutter", "my-cart"], queryFn: fetchMyCart, enabled: item.status === "reserved" });
  const myHold = myHoldOn(cart.data, item.id);
  // The Free change (Q2487): the member's own open ask on this item, if any.
  const asks = useQuery({
    queryKey: ["declutter", "my-free-requests", user?.id ?? null],
    queryFn: () => fetchMyFreeRequests(user!.id),
    enabled: !!user && item.status === "live",
  });
  const myAsk = (asks.data ?? []).find((r) => r.item_id === item.id) ?? null;
  const [asking, setAsking] = useState(false);
  // Audit 1110 F359c: "Change time" on the asker's own open ask (the same sheet; the server moves its pickup_at).
  const [changing, setChanging] = useState(false);
  const [rules, setRules] = useState(false);
  // Audit 1110 F359c: Take back my ask asks first, as Take back my offer does (DeclutterOffersSection).
  const [takingBack, setTakingBack] = useState(false);
  // Q2560 (Auditor 1, audit 1102a): a paid item keeps Offer / Buy in a bar pinned to the bottom once its buttons
  // scroll away; a free item had nothing, so after reading the description, pickup and questions there was no way to
  // ask without scrolling back. The same trigger (useOffScreen) and dock hand-off (useDockYield) as OfferPanel.
  const askButton = useRef<HTMLDivElement>(null);
  const askBarShown = useOffScreen(askButton) && item.status === "live" && !underAge && !myAsk;
  useDockYield(askBarShown);
  const giver = useQuery({ queryKey: ["declutter", "seller-card", item.seller_id], queryFn: () => fetchSellerCard(item.seller_id) });
  const giverFirstName = giver.data?.name?.trim() ? formatName(giver.data.name).split(" ")[0] : null;
  const takeBack = useMutation({
    mutationFn: (id: string) => withdrawFreeRequest(id),
    onSuccess: () => {
      toast(t("free.taken"));
      void qc.invalidateQueries({ queryKey: ["declutter"] });
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
    onSettled: () => setTakingBack(false),
  });

  // Until the cart read is in, say nothing yet: "Someone is buying" would flash before "Reserved for you".
  if (item.status === "reserved" && cart.isLoading) return <HoldChecking />;
  if (item.status === "reserved" && myHold) {
    return <ReservedForYou line={myHold} free />;
  }
  if (item.status === "reserved") {
    return <DeclutterNotice title={t("free.pickedSomeone")}>{t("free.pickedSomeoneBody")}</DeclutterNotice>;
  }
  if (underAge) {
    return <DeclutterNotice tone="warn" title={t("free.underAge")} />;
  }
  if (myAsk) {
    return (
      <section className="rounded-2xl border border-border bg-card p-4 space-y-3" aria-label={t("free.youAskedAria")} data-free-claim="">
        <p className="text-ds-15 font-semibold text-foreground">{t("free.youAsked")}</p>
        {/* Audit 1110 F359c: the pickup time the asker chose, the one the giver sees beside their name. */}
        {myAsk.pickup_at && (
          <p className="flex flex-wrap items-center justify-between gap-x-3 text-ds-14 text-foreground">
            <span data-my-ask-time="">{t("free.pickup", { time: pickedTimeLabel(myAsk.pickup_at) })}</span>
            <InlineTextButton className="text-ds-14 font-semibold underline underline-offset-2" onClick={() => setChanging(true)} data-my-ask-change="">
              {t("free.changeTime")}
            </InlineTextButton>
          </p>
        )}
        {changing && (
          <Suspense fallback={null}>
            <FreeAskSheet item={item} giverFirstName={giverFirstName ?? t("free.theGiver")} open={changing} onClose={() => setChanging(false)} oneTimeCheckAhead={oneTimeCheckAhead} change />
          </Suspense>
        )}
        {/* The shared next-step line (owner 11-01 12:02 PM): nothing is the asker's to do; it waits on the giver. */}
        <NextStep className="!text-sm" value={{ who: "them", text: giverFirstName ? t("free.waitingOn", { name: giverFirstName }) : t("free.waitingOnGiver") }} />
        <Button type="button" variant="outline" size="wrap" className="w-full rounded-full" disabled={takeBack.isPending}
          onClick={() => setTakingBack(true)}>
          {t("free.takeBack")}
        </Button>
        <ConfirmSheet open={takingBack} pending={takeBack.isPending} onConfirm={() => takeBack.mutate(myAsk.id)} onClose={() => setTakingBack(false)}
          title={t("free.takeBackTitle")} confirmLabel={t("free.takeItBack")} cancelLabel={t("free.keepAsk")} testId="withdraw-ask">
          {t("free.takeBackBody", { title: item.title })}
        </ConfirmSheet>
      </section>
    );
  }
  return (
    <section className="rounded-2xl border border-border bg-card p-4 space-y-2" aria-label={t("free.askAria")} data-free-claim="">
      {/* Owner mockup 11-01: ONE button; the asker picks the pickup time in the sheet it opens (Mockup 3). */}
      <div ref={askButton}>
        <Button type="button" size="wrap" className="w-full rounded-full" disabled={asks.isLoading} onClick={() => setAsking(true)}>
          {t("free.askForIt")}
        </Button>
      </div>
      {askBarShown && typeof document !== "undefined" &&
        createPortal(
          // Portaled to <body> (a fixed bar inside the page would be placed by its transformed ancestor), flush on the
          // bottom edge while the dock yields: the paid item's bar (data-declutter-buybar) with one button.
          <div data-declutter-askbar="" data-rail-inset="" className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card px-4 pt-2 pb-[calc(var(--safe-area-bottom,0px)+0.5rem)] shadow-[0_-4px_16px_rgb(0_0_0/0.06)] sm:hidden">
            <div role="group" aria-label={t("free.askAria")} className="mx-auto flex max-w-xl">
              <Button type="button" size="wrap" className="flex-1 min-w-0 rounded-full px-3 font-semibold" disabled={asks.isLoading} onClick={() => setAsking(true)}>
                {t("free.askForIt")}
              </Button>
            </div>
          </div>,
          document.body,
        )}
      <p className="text-xs text-muted-foreground" data-free-ask-note="">
        {oneTimeCheckAhead ? t("free.askingFree") : t("free.freeNothing")} {t("free.pickWhenAsk")}{" "}
        {/* A text link inside the sentence (B106: as a <Button> it kept the global 44px button box, so the note's two
            lines sat 30px apart). InlineTextButton (the shared text link) gives it the 44px tap area as an overlay on a touch screen instead. */}
        <InlineTextButton className="text-xs font-semibold text-foreground underline underline-offset-2" onClick={() => setRules(true)} data-free-how="">
          {t("free.howItWorks")}
        </InlineTextButton>
      </p>
      {asking && (
        <Suspense fallback={null}>
          <FreeAskSheet item={item} giverFirstName={giverFirstName ?? t("free.theGiver")} open={asking} onClose={() => setAsking(false)} oneTimeCheckAhead={oneTimeCheckAhead} />
        </Suspense>
      )}
      {/* The long rules sit behind the link (owner mockup 11-01). */}
      <Sheet open={rules} onOpenChange={setRules}>
        <SheetContent side="bottom" className="bg-premium-page max-h-[90dvh] overflow-y-auto" data-free-rules="">
          <SheetHero title={t("free.howTitle")} />
          <p className="mt-2 text-ds-14 text-foreground">{freeAskLine(offered, oneTimeCheckAhead)}</p>
        </SheetContent>
      </Sheet>
    </section>
  );
}

/**
 * The giver's side of the Free change (Q2487): who asked for this free item, oldest first, each with their name and
 * rating, the pickup time they picked, and one Pick button each. Picking gives that person the item and books their
 * time (20261101181129; an ask with no time still gives them 48 hours to choose); everyone else is told it went to
 * someone else.
 */
export function FreeRequestsForGiver({ item }: { item: DeclutterItem }) {
  const qc = useQueryClient();
  const { t } = useLanguage();
  const asks = useQuery({ queryKey: ["declutter", "free-requests", item.id], queryFn: () => fetchFreeRequestsForItem(item.id) });
  const pick = useMutation({
    mutationFn: (requestId: string) => pickFreeRequest(requestId),
    onSuccess: () => {
      // The server books their asked time when it can, else gives them 48 hours (20261101181129): say only what is sure.
      toast(t("free.picked"));
      void qc.invalidateQueries({ queryKey: ["declutter"] });
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  if (asks.isError) {
    return <ErrorState variant="inline" title={t("free.whoAskedFailed")} body={declutterErrorMessage(asks.error)} onRetry={() => void asks.refetch()} />;
  }
  if (asks.isLoading) return null;
  const rows = asks.data ?? [];
  return (
    <section className="rounded-2xl border border-border bg-card p-4 space-y-3" aria-label={t("free.whoAskedAria")} data-free-requests="">
      <h2 className="text-base font-semibold">{t("free.requests", { n: rows.length })}</h2>
      {/* The shared next-step line (owner 11-01 12:02 PM): with asks in, picking one is the giver's move. */}
      {rows.length === 0 ? (
        <NextStep className="!text-sm" value={{ who: "info", text: t("free.nobodyYet") }} />
      ) : (
        // A3-25 (audit 11-01): with how many asked. The server sets the giver no deadline, so no "by".
        <NextStep className="!text-sm" value={{ who: "you", text: t("free.pickWho"), by: t("free.nAsked", { n: rows.length }) }} />
      )}
      {rows.length === 0 ? null : (
        <ul className="space-y-2">
          {rows.map((r) => {
            // A3-57: an ask whose time has passed can't be picked (the server refuses it, request_time_passed) and
            // closes at the next sweep with a notice to the asker; until then it says so instead of offering Pick.
            const passed = !!r.pickup_at && new Date(r.pickup_at).getTime() <= Date.now();
            return (
            <li key={r.request_id} className="flex items-center justify-between gap-3 rounded-xl border border-border p-3" data-free-ask-passed={passed ? "" : undefined}>
              <span className="min-w-0">
                <span className="block font-semibold truncate">{r.display_name}</span>
                {/* Owner 11-01: each asker's chosen pickup time (null for an ask made before times were asked). */}
                {r.pickup_at && (
                  <span className={cn("block text-ds-13 font-semibold", passed ? "text-muted-foreground" : "text-foreground")} data-free-ask-time="">
                    {t("free.pickup", { time: pickedTimeLabel(r.pickup_at) })}{passed ? t("free.timePassed") : ""}
                  </span>
                )}
                <span className="block text-xs text-muted-foreground">
                  {r.review_count ? t(r.review_count === 1 ? "free.starsOne" : "free.stars", { rating: Number(r.avg_rating ?? 0).toFixed(1), n: r.review_count }) : t("free.noReviews")}
                </span>
              </span>
              {passed ? null : (
                <Button type="button" size="sm" className="shrink-0 rounded-full" disabled={pick.isPending} onClick={() => pick.mutate(r.request_id)}>
                  {t("free.pick")}
                </Button>
              )}
            </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** The member's open asks for free items (Q2487): one read for the list below and Buying's empty notice. */
export function useMyFreeAsks() {
  const { user } = useCurrentUser();
  return useQuery({
    queryKey: ["declutter", "my-free-requests", user?.id ?? null],
    queryFn: () => fetchMyFreeRequests(user!.id),
    enabled: !!user,
  });
}

/** Buying: the member's open asks for free items (Q2487), "You asked for <item>", each opening its item page. */
export function MyFreeAsks() {
  const asks = useMyFreeAsks();
  const { t } = useLanguage();
  if (asks.isError) {
    return <ErrorState variant="inline" title={t("free.myAsksFailed")} body={declutterErrorMessage(asks.error)} onRetry={() => void asks.refetch()} />;
  }
  const rows = asks.data ?? [];
  if (rows.length === 0) return null;
  return (
    <section className="space-y-2" aria-label={t("free.myAsksTitle")} data-my-free-asks="">
      <h2 className="text-base font-semibold">{t("free.myAsksTitle")}</h2>
      <ul className="divide-y divide-border overflow-hidden rounded-[20px] border border-border bg-card">
        {rows.map((r) => (
          <li key={r.id}>
            <Link to={`/declutter/item/${r.item_id}`} className="block px-4 py-3 min-h-11">
              <span className="block truncate text-ds-15 font-semibold" title={t("free.youAskedFor", { title: r.declutter_items?.title ?? t("free.aFreeItem") })}>{t("free.youAskedFor", { title: r.declutter_items?.title ?? t("free.aFreeItem") })}</span>
              <span className="block text-ds-13 text-muted-foreground">{t("free.giverPicks")}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The Buying line while a missed free pickup pauses free asks (Q2487): "You can ask for free items again on <date>." */
export function FreePauseLine() {
  const pause = useQuery({ queryKey: ["declutter", "my-free-pause"], queryFn: fetchMyFreePause });
  const { lang, t } = useLanguage();
  if (!pause.data) return null;
  const on = new Date(pause.data).toLocaleDateString(lang === "es" ? "es-US" : "en-US", { month: "long", day: "numeric", timeZone: "America/Chicago" });
  return (
    <DeclutterNotice tone="warn" title={t("free.pausedUntil", { date: on })}>
      {t("free.pausedBody")}
    </DeclutterNotice>
  );
}

type FreeHandover = "porch" | "pickup_home";
// F260q: dictionary keys (enFree.ts), read with t() where drawn.
const FREE_HANDOVER: Record<FreeHandover, { title: MsgKey; words: MsgKey }> = {
  porch: { title: "free.porchTitle", words: "free.porchWords" },
  pickup_home: { title: "free.homeTitle", words: "free.homeWords" },
};
/** Audit 11-10 F362: an accepted trade in the cart is worded as a trade, never as a free item from a "giver". */
const TRADE_HANDOVER: Record<FreeHandover, { title: MsgKey; words: MsgKey }> = {
  porch: { title: "free.porchTitle", words: "free.tradePorchWords" },
  pickup_home: { title: "free.tradeHomeTitle", words: "free.homeWords" },
};
const TRADE_CHECKOUT_LINE: MsgKey = "free.tradeLine";

const FREE_CHECKOUT_LINE: MsgKey = "free.checkoutLine";
const FREE_CHECKOUT_FIRST_LINE: MsgKey = "free.checkoutFirstLine";

/**
 * The cart for a seller whose waiting items are ALL free: no payment page and no fee. The buyer picks
 * porch pickup (only when every item allows it) or pickup at the giver's home; Helpr and seller delivery
 * are not offered for a free order. declutter_checkout_free sets the order at once, and the pickup time is
 * then booked like any paid pickup.
 */
export function FreeCheckoutForSeller({ sellerId, porchOk, ways = null, onDone, trade = false }: {
  sellerId: string; porchOk: boolean; onDone: () => void;
  /** F362: every line here is one side of an accepted trade (cart line source "swap"). */
  trade?: boolean;
  /** Owner 2026-10-28: the ways the giver ticked for every item here (null = older items: as before). */
  ways?: Handover[] | null;
}) {
  const qc = useQueryClient();
  const { t } = useLanguage();
  // Same reading as the ask line: a first-timer's Confirm is one tap from the one-time fee, so "nothing is charged" would be false.
  const { profile } = useCurrentUser();
  const idCheckOn = useIdentityCheckOnStore();
  const oneTimeCheckAhead = idCheckOn && profile?.onboarding_fee_paid === false;
  // An item made free on day 12 whose giver ticked only other ways offers nothing here: no fallback to the giver's
  // door (Q2462); NoWayWorks below opens the chat with them.
  const offered = freeWaysOffered(porchOk, ways);
  const [handover, setHandover] = useState<FreeHandover>(offered[0]);
  const chosen = offered.includes(handover) ? handover : offered[0];
  // D-NEW14: a giver with saved pickup places: the taker picks one for a porch pickup (porch_place_needed otherwise).
  // LEAD-PLACE-TIMES (20261031164337): a door pickup is at the chosen place too.
  const atPlace = chosen === "porch" || chosen === "pickup_home";
  const porchPlaces = useSellerPorchPlaces(sellerId, 0, atPlace);
  const placeReady = !atPlace || porchPlaces.ready;
  const confirm = useMutation({
    mutationFn: async () => {
      await porchPlaces.whenPicked();
      return checkoutFree(sellerId, chosen);
    },
    onSuccess: () => {
      toast(t("free.setNext"));
      void qc.invalidateQueries({ queryKey: ["declutter"] });
      onDone();
    },
    onError: (err) => {
      // A first-timer the giver picked: its own screen answers (FreeClaimFirstTime, the ID sheet), so no message as well.
      if (!freeClaimGateRefusal(err)) toast.error(declutterErrorMessage(err));
      // porch_place_needed after a read that stalled, or a place saved since: show the picker it asks for.
      if (atPlace) void porchPlaces.reread(err);
    },
  });
  return (
    <div className="space-y-3" data-free-checkout="">
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">{t("free.howGet")}</legend>
        {offered.map((h) => (
          <label key={h} className="flex items-start gap-3 rounded-xl border border-border p-3 text-sm">
            <NativeRadio className="mt-1" name={`free-handover-${sellerId}`} value={h}
              checked={chosen === h} onChange={() => setHandover(h)} />
            <span className="min-w-0">
              <span className="block font-semibold">{t((trade ? TRADE_HANDOVER : FREE_HANDOVER)[h].title)}</span>
              <span className="block text-muted-foreground">{t((trade ? TRADE_HANDOVER : FREE_HANDOVER)[h].words)}</span>
            </span>
          </label>
        ))}
        {!porchOk && ways === null && <p className="text-xs text-muted-foreground">{t("free.homeOnly")}</p>}
        {offered.length === 0 && <Suspense fallback={null}><NoWayWorks sellerId={sellerId} who="giver" /></Suspense>}
      </fieldset>
      {atPlace && <PorchPlacePicker sellerId={sellerId} cartKey={0} places={porchPlaces.places} free refused={porchPlaces.refused} loadError={porchPlaces.query.error}
        onRetry={() => void porchPlaces.reread()} />}
      <Button type="button" size="wrap" className="w-full rounded-full" disabled={confirm.isPending || offered.length === 0 || !placeReady} onClick={() => confirm.mutate()}>
        {confirm.isPending ? t("free.confirming") : t("free.confirmPick")}
      </Button>
      <p className="text-xs text-muted-foreground">{t(trade ? TRADE_CHECKOUT_LINE : oneTimeCheckAhead ? FREE_CHECKOUT_FIRST_LINE : FREE_CHECKOUT_LINE)}</p>
    </div>
  );
}
