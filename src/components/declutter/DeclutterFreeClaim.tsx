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
import { lazy, Suspense, useState } from "react";
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
import { NoWayWorks } from "./DeclutterHandoverTalk";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { freeClaimGateRefusal } from "@/lib/declutter/setupFee";
import { useIdentityCheckOnStore } from "@/lib/identityCheckSwitch";
import { DeclutterNotice } from "./declutterUi";
import { HoldChecking, myHoldOn, ReservedForYou } from "./DeclutterYourOffer";
import { formatName } from "@/lib/utils";
import { Sheet, SheetContent, SheetHero } from "@/components/ui/sheet";

// Owner 11-01 (Mockup 3): the "Ask for it" sheet loads when the button is pressed, never with the item page.
const FreeAskSheet = lazy(() => import("./FreeAskSheet"));

/** "Today 3 PM" for a time the asker picked (the sheet's own words), without loading the sheet. */
function pickedTimeLabel(iso: string): string {
  const zone = "America/Chicago";
  const d = new Date(iso);
  const day = (x: Date) => new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "numeric", day: "numeric" }).format(x);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(d).replace(":00", "");
  if (day(d) === day(new Date())) return `Today ${time}`;
  return `${new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short", month: "numeric", day: "numeric" }).format(d)}, ${time}`;
}

/** Is this listing free? (price and current price are both 0, a CHECK keeps them together). */
export function isFreeItem(item: Pick<DeclutterItem, "current_price_cents">): boolean {
  return item.current_price_cents === 0;
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
    : offered.length === 2 ? " to pick it up at their home or from their porch"
    : offered[0] === "porch" ? " to collect it from their porch"
    : offered[0] === "pickup_home" ? " to pick it up at their home"
    : "; agree with them how you'll get it";
  // Asking is free (owner 2026-10-30). "Nothing is charged" would overpromise to a member whose first pick carries the one-time ID check.
  // Owner 11-01 (Mockup 3): the asker picks the pickup time when they ask, and the giver's pick books it
  // (declutter_pick_free_request, 20261101181129).
  return `${oneTimeCheckAhead ? "Asking is free." : "Free, nothing is charged."} When you ask, you pick a pickup time from the giver's times. The giver picks who gets it; if it's you, that time is already set and you'll get the address${how}. You can ask for up to 3 free items at a time.`;
}

export function FreeClaimPanel({ item }: { item: DeclutterItem }) {
  const qc = useQueryClient();
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
  const [rules, setRules] = useState(false);
  const giver = useQuery({ queryKey: ["declutter", "seller-card", item.seller_id], queryFn: () => fetchSellerCard(item.seller_id) });
  const giverFirstName = giver.data?.name?.trim() ? formatName(giver.data.name).split(" ")[0] : "The giver";
  const takeBack = useMutation({
    mutationFn: (id: string) => withdrawFreeRequest(id),
    onSuccess: () => {
      toast("Your ask is taken back.");
      void qc.invalidateQueries({ queryKey: ["declutter"] });
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });

  // Until the cart read is in, say nothing yet: "Someone is buying" would flash before "Reserved for you".
  if (item.status === "reserved" && cart.isLoading) return <HoldChecking />;
  if (item.status === "reserved" && myHold) {
    return <ReservedForYou line={myHold} free />;
  }
  if (item.status === "reserved") {
    return <DeclutterNotice title="The giver picked someone for this item.">If they don't choose a pickup in time, it's free again.</DeclutterNotice>;
  }
  if (underAge) {
    return <DeclutterNotice tone="warn" title="You must be 18 or older to use Declutter." />;
  }
  if (myAsk) {
    return (
      <section className="rounded-2xl border border-border bg-card p-4 space-y-3" aria-label="You asked for this item" data-free-claim="">
        <p className="text-ds-15 font-semibold text-foreground">You asked for this.</p>
        {/* The shared next-step line (owner 11-01 12:02 PM): nothing is the asker's to do; it waits on the giver. */}
        <NextStep className="!text-sm" value={{ who: "them", text: `Waiting on ${giverFirstName === "The giver" ? "the giver" : giverFirstName} to pick who gets it. We'll tell you either way.` }} />
        <Button type="button" variant="outline" size="wrap" className="w-full rounded-full" disabled={takeBack.isPending}
          onClick={() => takeBack.mutate(myAsk.id)}>
          Take back my ask
        </Button>
      </section>
    );
  }
  return (
    <section className="rounded-2xl border border-border bg-card p-4 space-y-2" aria-label="Ask for this item" data-free-claim="">
      {/* Owner mockup 11-01: ONE button; the asker picks the pickup time in the sheet it opens (Mockup 3). */}
      <Button type="button" size="wrap" className="w-full rounded-full" disabled={asks.isLoading} onClick={() => setAsking(true)}>
        Ask for it
      </Button>
      <p className="text-xs text-muted-foreground" data-free-ask-note="">
        {oneTimeCheckAhead ? "Asking is free." : "Free, nothing is charged."} You pick a pickup time when you ask.{" "}
        {/* A text link inside the sentence (B106: as a <Button> it kept the global 44px button box, so the note's two
            lines sat 30px apart). InlineTextButton (the shared text link) gives it the 44px tap area as an overlay on a touch screen instead. */}
        <InlineTextButton className="text-xs font-semibold text-foreground underline underline-offset-2" onClick={() => setRules(true)} data-free-how="">
          How it works
        </InlineTextButton>
      </p>
      {asking && (
        <Suspense fallback={null}>
          <FreeAskSheet item={item} giverFirstName={giverFirstName} open={asking} onClose={() => setAsking(false)} />
        </Suspense>
      )}
      {/* The long rules sit behind the link (owner mockup 11-01). */}
      <Sheet open={rules} onOpenChange={setRules}>
        <SheetContent side="bottom" className="bg-premium-page max-h-[90dvh] overflow-y-auto" data-free-rules="">
          <SheetHero title="How free items work" />
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
  const asks = useQuery({ queryKey: ["declutter", "free-requests", item.id], queryFn: () => fetchFreeRequestsForItem(item.id) });
  const pick = useMutation({
    mutationFn: (requestId: string) => pickFreeRequest(requestId),
    onSuccess: () => {
      // The server books their asked time when it can, else gives them 48 hours (20261101181129): say only what is sure.
      toast("Picked. We've told them.");
      void qc.invalidateQueries({ queryKey: ["declutter"] });
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  if (asks.isError) {
    return <ErrorState variant="inline" title="We couldn't load who asked." body={declutterErrorMessage(asks.error)} onRetry={() => void asks.refetch()} />;
  }
  if (asks.isLoading) return null;
  const rows = asks.data ?? [];
  return (
    <section className="rounded-2xl border border-border bg-card p-4 space-y-3" aria-label="Who asked for this item" data-free-requests="">
      <h2 className="text-base font-semibold">Requests ({rows.length})</h2>
      {/* The shared next-step line (owner 11-01 12:02 PM): with asks in, picking one is the giver's move. */}
      {rows.length === 0 ? (
        <NextStep className="!text-sm" value={{ who: "info", text: "Nobody has asked yet. It stays up until you pick someone." }} />
      ) : (
        <NextStep className="!text-sm" value={{ who: "you", text: "Pick who gets it" }} />
      )}
      {rows.length === 0 ? null : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.request_id} className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
              <span className="min-w-0">
                <span className="block font-semibold truncate">{r.display_name}</span>
                {/* Owner 11-01: each asker's chosen pickup time (null for an ask made before times were asked). */}
                {r.pickup_at && <span className="block text-ds-13 font-semibold text-foreground" data-free-ask-time="">Pickup {pickedTimeLabel(r.pickup_at)}</span>}
                <span className="block text-xs text-muted-foreground">
                  {r.review_count ? `${Number(r.avg_rating ?? 0).toFixed(1)} stars, ${r.review_count} ${r.review_count === 1 ? "review" : "reviews"}` : "No reviews yet"}
                </span>
              </span>
              <Button type="button" size="sm" className="shrink-0 rounded-full" disabled={pick.isPending} onClick={() => pick.mutate(r.request_id)}>
                Pick
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Buying: the member's open asks for free items (Q2487), "You asked for <item>", each opening its item page. */
export function MyFreeAsks() {
  const { user } = useCurrentUser();
  const asks = useQuery({
    queryKey: ["declutter", "my-free-requests", user?.id ?? null],
    queryFn: () => fetchMyFreeRequests(user!.id),
    enabled: !!user,
  });
  if (asks.isError) {
    return <ErrorState variant="inline" title="We couldn't load your asks for free items." body={declutterErrorMessage(asks.error)} onRetry={() => void asks.refetch()} />;
  }
  const rows = asks.data ?? [];
  if (rows.length === 0) return null;
  return (
    <section className="space-y-2" aria-label="Free items you asked for" data-my-free-asks="">
      <h2 className="text-base font-semibold">Free items you asked for</h2>
      <ul className="divide-y divide-border overflow-hidden rounded-[20px] border border-border bg-card">
        {rows.map((r) => (
          <li key={r.id}>
            <Link to={`/declutter/item/${r.item_id}`} className="block px-4 py-3 min-h-11">
              <span className="block truncate text-ds-15 font-semibold" title={`You asked for ${r.declutter_items?.title ?? "a free item"}`}>You asked for {r.declutter_items?.title ?? "a free item"}</span>
              <span className="block text-ds-13 text-muted-foreground">The giver picks who gets it. We'll tell you either way.</span>
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
  if (!pause.data) return null;
  const on = new Date(pause.data).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "America/Chicago" });
  return (
    <DeclutterNotice tone="warn" title={`You can ask for free items again on ${on}.`}>
      You missed a free pickup, so free items are paused for 30 days.
    </DeclutterNotice>
  );
}

type FreeHandover = "porch" | "pickup_home";
const FREE_HANDOVER: Record<FreeHandover, { title: string; words: string }> = {
  porch: { title: "Porch pickup", words: "The giver leaves it out for you, no need to meet. Address once you confirm." },
  pickup_home: { title: "Meet at the giver's home", words: "Pick it up at their door. Address once you confirm." },
};

const FREE_CHECKOUT_LINE = "Free items are picked up only. Nothing is charged.";
const FREE_CHECKOUT_FIRST_LINE = "Free items are picked up only. The item stays free. Your first claim has a one-time ID check next, and we'll show you the cost first.";

/**
 * The cart for a seller whose waiting items are ALL free: no payment page and no fee. The buyer picks
 * porch pickup (only when every item allows it) or pickup at the giver's home; Helpr and seller delivery
 * are not offered for a free order. declutter_checkout_free sets the order at once, and the pickup time is
 * then booked like any paid pickup.
 */
export function FreeCheckoutForSeller({ sellerId, porchOk, ways = null, onDone }: {
  sellerId: string; porchOk: boolean; onDone: () => void;
  /** Owner 2026-10-28: the ways the giver ticked for every item here (null = older items: as before). */
  ways?: Handover[] | null;
}) {
  const qc = useQueryClient();
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
      toast("It's set. Next: choose your pickup time.");
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
        <legend className="text-sm font-medium">How you'll get it</legend>
        {offered.map((h) => (
          <label key={h} className="flex items-start gap-3 rounded-xl border border-border p-3 text-sm">
            <input type="radio" className="mt-1 h-4 w-4 min-h-0 min-w-0 shrink-0" name={`free-handover-${sellerId}`} value={h}
              checked={chosen === h} onChange={() => setHandover(h)} style={{ accentColor: "hsl(var(--primary))" }} />
            <span className="min-w-0">
              <span className="block font-semibold">{FREE_HANDOVER[h].title}</span>
              <span className="block text-muted-foreground">{FREE_HANDOVER[h].words}</span>
            </span>
          </label>
        ))}
        {!porchOk && ways === null && <p className="text-xs text-muted-foreground">The giver asked to meet at their home for this item, so porch pickup isn't available.</p>}
        {offered.length === 0 && <NoWayWorks sellerId={sellerId} who="giver" />}
      </fieldset>
      {atPlace && <PorchPlacePicker sellerId={sellerId} cartKey={0} places={porchPlaces.places} free refused={porchPlaces.refused} loadError={porchPlaces.query.error}
        onRetry={() => void porchPlaces.reread()} />}
      <Button type="button" size="wrap" className="w-full rounded-full" disabled={confirm.isPending || offered.length === 0 || !placeReady} onClick={() => confirm.mutate()}>
        {confirm.isPending ? "Confirming…" : "Confirm and pick a time"}
      </Button>
      <p className="text-xs text-muted-foreground">{oneTimeCheckAhead ? FREE_CHECKOUT_FIRST_LINE : FREE_CHECKOUT_LINE}</p>
    </div>
  );
}
