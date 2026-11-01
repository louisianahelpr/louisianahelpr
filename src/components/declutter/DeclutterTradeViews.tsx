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
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import AppPage from "@/components/AppPage";
import { ErrorState } from "@/components/ui/ErrorState";
import { useFeature } from "@/hooks/useFeature";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { queryKeys } from "@/lib/queryKeys";
import { useFirstPayoutFeeCents, useFirstPayoutFeeKnown } from "@/hooks/useFirstPayoutFee";
import { fetchMyCart, fetchPhotos, photoPublicUrl, startCheckoutPayment, type CartLine, type Handover } from "@/lib/declutter/api";
import { wayAllowed, waysEveryLineAllows } from "@/lib/declutter/handovers";
import { NoWayWorks } from "./DeclutterHandoverTalk";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { formatPrice, itemPriceLabel } from "@/lib/declutter/distance";
import { fetchDeliveryQuote, type DeliveryQuote } from "@/lib/declutter/delivery";
import { fetchMyLastDropoff } from "@/lib/declutter/lastDropoff";
import { fetchSellerDeliveryOffer, sellerDeliveryAmounts, type DeliveryHandoff, type SellerDeliveryOffer } from "@/lib/declutter/sellerDelivery";
import { sellerDeliveryErrorMessage } from "@/lib/declutter/sellerDeliveryErrors";
import { SellerDeliveryPicker, sellerDeliveryPriceWords, sellerDeliveryState } from "./SellerDeliveryChoice";
import { openExternalUrl } from "@/lib/openExternalUrl";
import { DeclutterNotice } from "./declutterUi";
import { PaidOrders, SectionHeading } from "./DeclutterTabParts";
import { FreeCheckoutForSeller } from "./DeclutterFreeClaim";
import { MeetupSpotPicker } from "./DeclutterMeetup";
import { Button } from "@/components/ui/button";
import { DeliveryPriceList } from "./DeliveryPriceList";
import { DropoffAddressField } from "./DropoffAddressField";
import { PorchPlacePicker, useSellerPorchPlaces } from "./DeclutterPorchPlaces";
import { HANDOVER_TITLE, HANDOVER_WORDS } from "./handoverCopy";
import { fetchMeetupSpotsNear } from "@/lib/declutter/meetup";
import { meetupErrorMessage } from "@/lib/declutter/meetupErrors";
import { useBundleDiscount } from "./useBundleDiscount";
import { CartHold } from "./DeclutterReserveSheet";
import { timeLeft } from "@/lib/declutter/timeLeft";
import { PaySettlingNotice, rememberPaying, usePaySettling } from "./DeclutterPaySettling";
import { SalesWaiting } from "./DeclutterSalesWaiting";
import { RemoveFromCart } from "./DeclutterCartRemove";
import { invalidateTrades } from "./declutterLightActions";
import { cartSectionWords, CheckoutCardHead } from "./DeclutterCartWords";
import { firstPhotos } from "./DeclutterItemCard";
import { squarePhotoUrl, THUMB_PHOTO_PX } from "@/lib/declutter/photoSizes";
import { fetchItemPickupWindows } from "@/lib/declutter/handover";
import { pickupDays, porchWindowDays } from "@/lib/declutter/pickupSlots";
import { CheckoutPickupTime } from "./CheckoutPickupTime";

export { dollarsInputToCents } from "@/lib/declutter/money";
export { PaidOrders, SectionHeading, useDeclutterTodo } from "./DeclutterTabParts";
export { OffersSection } from "./DeclutterOffersSection";

// StrikeCount lives in the leaf DeclutterTabHeads (the /declutter first screen draws it without this module).
export { StrikeCount } from "./DeclutterTabHeads";

/** Q2427: the seller's bundle discount on these lines (useBundleDiscount), then the ordinary checkout panel. */
function PayWithBundle({ sellerId, lines, porchOk, onBack, held }: { sellerId: string; lines: CartLine[]; porchOk: boolean; onBack: () => void; held: boolean }) {
  const b = useBundleDiscount(sellerId, lines);
  return <PayForSeller sellerId={sellerId} itemsTotalCents={b.itemsCents} discountCents={b.discountCents} totalCents={b.totalCents} porchOk={porchOk} onBack={onBack} itemCount={lines.length} held={held}
    ways={waysEveryLineAllows(lines)} itemId={lines.find((l) => l.item_id)?.item_id ?? null} />;
}

/**
 * Row 24 + B30 + row 101 + slice 5: choose how you get it, then pay on Stripe's
 * page. Porch is first and chosen when every item allows it; when any item's
 * seller turned porch off, only pickup at the seller's home is offered (the server
 * refuses porch for such an order anyway, porch_unavailable). Helpr delivery
 * (rows 29-30) is offered while Declutter is open for the member: the buyer types
 * the drop-off address, the SERVER geocodes it and prices the trip ($6 + $1.50 per
 * road mile + size), and the Pay button carries that price.
 */
function PayForSeller({ sellerId, itemsTotalCents, discountCents = 0, totalCents, porchOk, onBack, itemCount = 1, held = false, ways = null, itemId = null }: {
  sellerId: string; itemsTotalCents: number; totalCents: number; porchOk: boolean; onBack: () => void;
  /** B-1: this checkout was just paid and the cart has not caught up: Pay stays off. */
  held?: boolean;
  /** Owner 2026-10-28: the ways every item in this checkout allows (null = older items: every way). */
  ways?: Handover[] | null;
  /** Q2427: the bundle discount on the paid items (0 when none); totalCents is already after it. */
  discountCents?: number;
  /** B110: an item of this checkout, to read the seller's pickup times (declutter_item_pickup_windows). */
  itemId?: string | null;
  /** Board 161: how many items this one checkout covers. The bill shows the items and what the buyer pays, never a fee line (owner 2026-10-25, issue #3672). */
  itemCount?: number;
}) {
  const qc = useQueryClient();
  const deliveryOpen = useFeature("declutter");
  // Seller delivery (20261027153244): asked of the server only while the switch is on for this member.
  const sellerDeliveryOn = useFeature("declutter_seller_delivery");
  const sdKey = ["declutter", "seller-delivery-offer", sellerId, itemsTotalCents] as const;
  const sdOffer = useQuery({ queryKey: sdKey, queryFn: () => fetchSellerDeliveryOffer(sellerId), enabled: sellerDeliveryOn });
  const [sdTyped, setSdTyped] = useState(false);
  const [sdChecked, setSdChecked] = useState<string | null>(null); // DB-9: the address checked in THIS checkout, shown in full
  const [slot, setSlot] = useState<string | null>(null);
  const [handoff, setHandoff] = useState<DeliveryHandoff | null>(null);
  const sdState = sellerDeliveryOn && !sdOffer.isError ? sellerDeliveryState(sdOffer.data, sdTyped) : "hidden";
  // Q2425: safe meetup spots near this seller's items (admin-curated); offered only when there is one.
  const meetupSpots = useQuery({
    queryKey: ["declutter", "meetup-spots", sellerId, itemsTotalCents],
    queryFn: () => fetchMeetupSpotsNear(sellerId),
    enabled: deliveryOpen,
  });
  const spotsNear = meetupSpots.data ?? [];
  // The spec's order: porch / safe place, pickup at the home, the seller delivers, Helpr delivery.
  // Owner 2026-10-28: only the ways the seller ticked for every item here (the server refuses the rest).
  const order: Handover[] = ([...(porchOk ? ["porch" as const] : []), "pickup_home", ...(spotsNear.length > 0 ? ["meetup" as const] : []),
    ...(sdState !== "hidden" ? ["seller_delivery" as const] : [])] as Handover[]).filter((h) => wayAllowed(ways, h));
  // Owner 2026-10-29 (DC-4): Helpr delivery is always a choice for what the buyer pays for, whatever was ticked.
  const ticked: Handover[] = deliveryOpen && wayAllowed(ways, "delivery", true) ? [...order, "delivery"] : order;
  const offered = ticked; // None open to this buyer: no fallback to the seller's door (Q2462); NoWayWorks opens the chat.
  // DB-15: the buyer's tap, never useState(offered[0]) (it froze Helpr delivery before spots loaded); else the first way now.
  const [picked, setPicked] = useState<Handover | null>(null);
  const chosen = picked && offered.includes(picked) ? picked : offered[0];
  const [opening, setOpening] = useState(false);
  const [address, setAddress] = useState("");
  const [quote, setQuote] = useState<DeliveryQuote | null>(null);
  // The quote is for the cart as it was priced: a changed cart total asks again.
  const [quotedFor, setQuotedFor] = useState<number | null>(null);
  const priceIt = useMutation({
    // `picked`: a whole address just picked from the list (owner 2026-11-01), priced at once.
    mutationFn: async (picked?: string) => {
      await porchPlaces.whenPicked();
      return fetchDeliveryQuote(sellerId, (picked ?? address).trim());
    },
    onSuccess: (q) => { setQuote(q); setQuotedFor(itemsTotalCents); setSdChecked(null); }, // DB-9: it stored a new drop-off: seller delivery checks again
    onError: (err) => { setQuote(null); toast.error(declutterErrorMessage(err)); void porchPlaces.reread(err); },
  });
  const liveQuote = quote && quotedFor === itemsTotalCents ? quote : null;
  const delivering = chosen === "delivery";
  // D-NEW14: a seller with saved pickup places: the buyer picks one for porch pickup and Helpr delivery (the server
  // refuses checkout and a delivery price without it, porch_place_needed). LEAD-PLACE-TIMES (20261031164337): a door
  // pickup is at the chosen place too.
  const needsPlace = chosen === "porch" || chosen === "pickup_home" || delivering;
  const porchPlaces = useSellerPorchPlaces(sellerId, itemsTotalCents, needsPlace);
  const placeReady = !needsPlace || porchPlaces.ready;
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
  // BUY-9: the last drop-off this buyer sent (theirs only) fills "Deliver to" once, while the box is still empty and
  // untouched; asked only when a way that delivers is chosen.
  const lastDropoff = useQuery({ queryKey: ["declutter", "last-dropoff", me?.id], queryFn: () => fetchMyLastDropoff(me!.id),
    enabled: !!me?.id && (delivering || sellerDelivering), staleTime: 5 * 60_000 });
  const [addressTouched, setAddressTouched] = useState(false);
  useEffect(() => {
    if (!addressTouched && lastDropoff.data && address === "") setAddress(lastDropoff.data);
  }, [addressTouched, lastDropoff.data, address]);
  const meetingUp = chosen === "meetup";
  const meetupReady = !meetingUp || spotsNear.some((s) => s.chosen);
  // B110 (owner 11-01): a porch, door or meetup pickup picks its day and time HERE, before paying, from the chosen
  // place's own hours, else the seller's usual times. Porch: a 2-hour window; door and meetup: a 30-minute time.
  // declutter_start_checkout checks it again and freezes it on the order; payment books it and tells the seller.
  const timedPickup = chosen === "porch" || chosen === "pickup_home" || meetingUp;
  const sellerTimes = useQuery({ queryKey: ["declutter", "item-pickup-windows", itemId], queryFn: () => fetchItemPickupWindows(itemId ?? ""),
    enabled: !!itemId && timedPickup, staleTime: 60_000 });
  const placeHours = chosen !== "meetup" ? porchPlaces.places.find((p) => p.chosen)?.windows : null;
  const hours = useMemo(() => (placeHours && placeHours.length > 0 ? placeHours : (sellerTimes.data ?? [])), [placeHours, sellerTimes.data]);
  const pickupChoices = useMemo(
    () => (!timedPickup ? [] : chosen === "porch" ? porchWindowDays(hours, Date.now(), null) : pickupDays(hours, Date.now(), null)),
    [timedPickup, chosen, hours],
  );
  const [pickupPick, setPickupPick] = useState<{ way: Handover; iso: string } | null>(null);
  const pickupStart = pickupPick && pickupPick.way === chosen
    && pickupChoices.some((d) => d.slots.some((x) => x.iso === pickupPick.iso)) ? pickupPick.iso : null;
  // A time is asked for whenever the seller has one open; a seller with none: the buyer books after paying, as before.
  const pickupTimeReady = !timedPickup || pickupChoices.length === 0 || pickupStart !== null;
  const sdRate = sellerDelivering && sdOffer.data?.available ? sdOffer.data.rate_cents : null;
  // The seller's rate counts in the buyer's premium (the server's rule), folded into "You pay" before checkout; a free
  // seller delivery (rate 0, or the order is over the seller's free-delivery amount) adds nothing. The bill never
  // shows the premium on its own line (owner 2026-10-25, issue #3672).
  // Q2427: every amount after the items line is on the discounted items (what checkout freezes).
  const netItemsCents = itemsTotalCents - discountCents;
  const sdAmounts = sdRate !== null ? sellerDeliveryAmounts(netItemsCents, sdRate) : null;
  const payCents = (delivering && liveQuote ? totalCents + liveQuote.delivery_cents : sdAmounts ? sdAmounts.totalCents : totalCents) + setupFeeCents;
  // #20 (owner 2026-10-28, "Words only"): when the total holds more than the lines above it (the buyer's service fee),
  // one quiet line says so, with no number. A free claim never reaches this sheet with a fee.
  const listedCents = netItemsCents + (delivering && liveQuote ? liveQuote.delivery_cents : 0) + (sdRate ?? 0) + setupFeeCents;
  const includesServiceFee = payCents > listedCents;
  const sdReady = sellerDelivering && sdState === "pick" && !!slot && !!handoff && sdChecked !== null;
  // BUY-8 (audit 10-30): Pay was grey with nothing saying why, and at 375 the choice it waited on was far above it,
  // past the bill. The first thing it waits on, in the buyer's words, right above it.
  const payWaitsOn =
    needsPlace && !placeReady && porchPlaces.places.length > 0 ? "Choose a pickup place above to pay."
      : delivering && !liveQuote ? "Get the delivery price above to pay."
        : sellerDelivering && sdState === "pick" && !sdReady ? "Finish the delivery choices above to pay."
          : !meetupReady ? "Choose a meeting spot above to pay."
            : !pickupTimeReady ? (chosen === "porch" ? "Choose a pickup day and time above to pay." : meetingUp ? "Choose when you'll meet above to pay." : "Choose a pickup day and time above to pay.")
              : null;
  const addressId = `dcl-dropoff-${sellerId}`;
  return (
    // BUY-15 (audit 10-30): at 1440 this was one stretched column (Pay 1110 px wide, far down the page). From lg the
    // choices sit on the left and the bill with Pay beside them; a phone keeps the one column in the same order.
    <div className="space-y-3 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:items-start lg:gap-6 lg:space-y-0" data-checkout-columns="">
    <div className="min-w-0 space-y-3" data-checkout-choices="">
      {/* Board 30: "How you'll get it" as radio cards; each price from the real rule (pickups are free; delivery is
          the server's quote, or "Get a price" until there is one). */}
      <fieldset className="space-y-2">
        <legend className="mb-2 text-ds-12 font-semibold uppercase tracking-[0.08em] text-muted-foreground">How you'll get it</legend>
        {offered.map((h) => (
          <div key={h} className="space-y-2" data-handover-option={h}>
          <label
            className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-[20px] border bg-card px-4 py-3.5 ${chosen === h ? "border-2 border-primary" : "border-border"}`}
          >
            <input type="radio" className="mt-1 h-4 w-4 min-h-0 min-w-0 shrink-0" name={`handover-${sellerId}`} value={h} checked={chosen === h} onChange={() => setPicked(h)} style={{ accentColor: "hsl(var(--primary))" }} />
            <span className="min-w-0 flex-1">
              <span className="block text-ds-15 font-semibold text-foreground">{HANDOVER_TITLE[h]}</span>
              <span className="block text-ds-13 text-muted-foreground">{HANDOVER_WORDS[h]}</span>
            </span>
            <span className="shrink-0 text-ds-15 font-bold text-[hsl(var(--accent-ink))]">
              {h === "delivery" ? (liveQuote ? formatPrice(liveQuote.delivery_cents) : <span className="font-semibold text-muted-foreground">Get a price</span>)
                : h === "seller_delivery" ? (sdState === "no_times"
                  ? <span className="font-semibold text-muted-foreground">{sellerDeliveryPriceWords(sdOffer.data, sdState)}</span>
                  : sellerDeliveryPriceWords(sdOffer.data, sdState))
                : "Free"}
            </span>
          </label>
          {/* Owner 2026-11-01: the seller's pickup places sit UNDER the way that uses them (porch pickup, the default,
              or a door pickup or Helpr delivery from that place), shown while it is the one chosen. */}
          {/* Owner 2026-11-01 (1:02 PM): each way's details sit INSIDE it, shown while it is the one chosen: the seller's
              pickup places, the meeting spot, the day and time, the delivery address and price. */}
          {chosen === h && (needsPlace || meetingUp || timedPickup || h === "seller_delivery" || h === "delivery") && (
            <div className="space-y-3 pl-4" data-places-under={needsPlace ? h : undefined} data-details-under={h}>
              {needsPlace && (
                <PorchPlacePicker sellerId={sellerId} cartKey={itemsTotalCents} places={porchPlaces.places} refused={porchPlaces.refused} loadError={porchPlaces.query.error}
                  onRetry={() => void porchPlaces.reread()} onChosen={() => { setQuote(null); setPickupPick(null); }} />
              )}
              {h === "meetup" && <MeetupSpotPicker sellerId={sellerId} spots={spotsNear} onChosen={() => void meetupSpots.refetch()} />}
              {timedPickup && placeReady && (
                <CheckoutPickupTime days={pickupChoices} porch={h === "porch"} meetup={h === "meetup"} value={pickupStart}
                  loading={sellerTimes.isLoading && !(placeHours && placeHours.length > 0)}
                  onPick={(iso) => setPickupPick(iso ? { way: h, iso } : null)} />
              )}
              {h === "seller_delivery" && (
                <SellerDeliveryPicker sellerId={sellerId} offer={sdOffer.data} state={sdState} slot={slot} onSlot={setSlot}
                  handoff={handoff} onHandoff={setHandoff} checked={sdChecked} onChecked={setSdChecked}
                  typed={address} onTyped={(a) => { setAddressTouched(true); setAddress(a); setQuote(null); }}
                  onOffer={(o: SellerDeliveryOffer) => { setSdTyped(true); setQuote(null); qc.setQueryData(sdKey, o); }} />
              )}
              {h === "delivery" && (
                <div className="space-y-2 rounded-xl border border-border p-3">
                  <DropoffAddressField id={addressId} value={address}
                    onTyped={(a) => { setAddressTouched(true); setAddress(a); setQuote(null); }}
                    onPicked={(a) => { setAddressTouched(true); setAddress(a); setQuote(null); if (placeReady) priceIt.mutate(a); }} />
                  <Button type="button" variant="outline" size="sm" className="rounded-full"
                    disabled={priceIt.isPending || address.trim().length < 5 || !placeReady} onClick={() => priceIt.mutate(undefined)}>
                    {priceIt.isPending ? "Pricing…" : "Get price"}
                  </Button>
                  {/* Owner 2026-11-01: the price by size up front, this checkout's size marked, then the total once priced. */}
                  <DeliveryPriceList quote={liveQuote} />
                  <p className="text-xs text-muted-foreground">If no Helpr takes it within 48 hours, what you paid for delivery comes back. Then you pick it up instead, or cancel for a refund.</p>
                </div>
              )}
            </div>
          )}
          </div>
        ))}
        {!porchOk && ways === null && (
          <p className="text-xs text-muted-foreground">The seller asked buyers to meet at their home for this order, so porch pickup isn't available.</p>
        )}
        {offered.length === 0 && <NoWayWorks sellerId={sellerId} />}
      </fieldset>
    </div>
    <div className="min-w-0 space-y-3 lg:sticky lg:top-4" data-checkout-summary="">
      {/* BUY-34: the notes sit beside the <dl>; a <p> inside one fails axe's definition-list rule. */}
      <div className="space-y-1.5 rounded-[20px] border border-border bg-card p-4 text-ds-14" data-checkout-breakdown="">
      <dl className="space-y-1.5">
        <div className="flex justify-between gap-3"><dt>{itemCount > 1 ? `${itemCount} items` : "Item"}</dt><dd className="font-semibold tabular-nums text-[hsl(var(--accent-ink))]">{formatPrice(itemsTotalCents)}</dd></div>
        {discountCents > 0 && (
          <div className="flex justify-between gap-3" data-bundle-discount=""><dt>Bundle discount</dt><dd className="font-semibold tabular-nums text-[hsl(var(--accent-ink))]">−{formatPrice(discountCents)}</dd></div>
        )}
        {delivering && liveQuote && (
          <div className="flex justify-between gap-3"><dt>Helpr delivery</dt><dd className="font-semibold tabular-nums text-[hsl(var(--accent-ink))]">{formatPrice(liveQuote.delivery_cents)}</dd></div>
        )}
        {sdRate !== null && (
          <div className="flex justify-between gap-3"><dt>Seller delivery</dt><dd className="font-semibold tabular-nums text-[hsl(var(--accent-ink))]">{sdRate === 0 ? "Free" : formatPrice(sdRate)}</dd></div>
        )}
        <div className="flex items-baseline justify-between gap-3 border-t border-border pt-2">
          <dt className="text-ds-16 font-bold text-foreground">You pay</dt>
          <dd className="text-ds-24 font-bold tabular-nums text-[hsl(var(--accent-ink))]">
            {formatPrice(payCents)}
            {/* Delivery chosen but not priced yet: the total is not complete, so say so (money review #4). */}
            {delivering && !liveQuote && <span className="ml-1 text-ds-14 font-semibold text-muted-foreground">+ delivery</span>}
            {!setupFeeKnown && <span className="ml-1 text-ds-14 font-semibold text-muted-foreground" data-setup-fee-pending="">+ any setup fee</span>}
          </dd>
        </div>
      </dl>
        {setupFeeCents > 0 && (
          <p className="text-ds-12 text-muted-foreground" data-checkout-setup-fee="">Includes the one-time {formatPrice(setupFeeCents)} account setup fee.</p>
        )}
        {includesServiceFee && (
          <p className="text-ds-12 text-muted-foreground" data-service-fee-words="">Includes a small Louisiana Helpr service fee.</p>
        )}
        {/* Spec v2 §9.11: Declutter buyer screens may say what the seller keeps; sellers keep the whole price. */}
      </div>
      {/* lh-money-escrow review (2026-10-20): the seller can be paid without a buyer step (home pickup marked by the
          seller; declutter_handover_sweep pays 24 h after the slot unless a problem is open, porch also needs the
          set-out photo: measured live with pg_get_functiondef), so never "held until you have your items". */}
      <p className="rounded-xl bg-[hsl(var(--burnt-sienna)/0.10)] px-3 py-2 text-ds-13 text-[hsl(var(--sienna-ink))]" data-checkout-note="">
        The seller keeps the whole {formatPrice(netItemsCents)}{sdRate ? ` and the ${formatPrice(sdRate)} delivery` : ""}.{" "}
        {delivering
          ? "It's paid to the seller once the delivery is done."
          : sellerDelivering
            ? "It's paid to the seller when you have your items, or about 48 hours after they mark it delivered unless you report a problem."
            : "It's paid to the seller when you say you have it, or about 48 hours after the seller says you do, unless you report a problem."}
      </p>
      {!held && !opening && payWaitsOn && (
        <p id={`${addressId}-pay-waits`} className="text-ds-14 font-semibold text-foreground" data-pay-waits-on="">{payWaitsOn}</p>
      )}
      <button
        type="button"
        aria-describedby={!held && !opening && payWaitsOn ? `${addressId}-pay-waits` : undefined}
        className="btn-grad-primary !text-[hsl(var(--parchment))] h-14 w-full rounded-full px-5 text-ds-16 font-semibold"
        disabled={held || opening || offered.length === 0 || (delivering && !liveQuote) || (sellerDelivering && !sdReady) || !meetupReady || !placeReady || !pickupTimeReady}
        onClick={async () => {
          setOpening(true);
          rememberPaying(sellerId);
          try {
            await porchPlaces.whenPicked();
            const res = await startCheckoutPayment(sellerId, chosen, sellerDelivering ? slot : timedPickup ? pickupStart : null, sellerDelivering ? handoff : null,
              sellerDelivering ? sdRate : null);
            if (res.paid || !res.url) {
              toast("This order is already paid.");
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
              toast.error(meetingUp ? meetupErrorMessage(err) : declutterErrorMessage(err));
              // B110: a pickup time no longer open (or outside the hours): show the times again, ask for a new pick.
              if ((err as { message?: string } | null)?.message === "invalid_slot") setPickupPick(null);
            }
            // porch_place_needed after a read that stalled, or a place saved since: show the picker it asks for.
            if (needsPlace) void porchPlaces.reread(err);
            setOpening(false);
          }
        }}
      >
        {held ? "Confirming your payment…" : opening ? "Opening…" : `Pay ${formatPrice(payCents)}`}
      </button>
      <p className="text-xs text-muted-foreground">You pay on a secure payment page.</p>
      <AddHelprNote />
    </div>
    </div>
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

/** BUY-15: a cart line's small photo; a grey square while it loads, when the item has none, or when it fails. */
function CartThumb({ path }: { path?: string }) {
  // B77: the 160 px square first (the original was 356-560 KB for a 48 px box), the original if that fails, then grey.
  const [stage, setStage] = useState<"thumb" | "full" | "failed">("thumb");
  return (
    <span className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-muted" data-cart-thumb="" aria-hidden="true">
      {path && stage !== "failed" && <img src={stage === "thumb" ? squarePhotoUrl(photoPublicUrl(path), THUMB_PHOTO_PX) ?? photoPublicUrl(path) : photoPublicUrl(path)} width={THUMB_PHOTO_PX} height={THUMB_PHOTO_PX} alt="" loading="lazy" decoding="async" onError={() => setStage((s) => (s === "thumb" ? "full" : "failed"))} className="h-full w-full object-cover" />}
    </span>
  );
}

/** The buyer's cart (rows 13, 20-22, 24, 38, 59): one checkout per seller. */
export function CartView() {
  const cart = useQuery({ queryKey: ["declutter", "my-cart"], queryFn: fetchMyCart });
  // B-1: back from the payment page, the cart is read again until the paid checkout leaves it; its Pay is off meanwhile.
  const settling = usePaySettling();
  // BUY-15: each cart line shows its item's first photo (none at either width before).
  const lineItemIds = useMemo(() => [...new Set((cart.data ?? []).filter((l) => l.my_side === "buyer" && l.status === "in_cart" && l.item_id)
    .map((l) => l.item_id as string))].sort(), [cart.data]);
  const photos = useQuery({ queryKey: ["declutter", "photos", lineItemIds.join(",")], queryFn: () => fetchPhotos(lineItemIds), enabled: lineItemIds.length > 0 });
  const cover = useMemo(() => firstPhotos(photos.data ?? []), [photos.data]);
  if (cart.isError) {
    return <ErrorState variant="inline" title="We couldn't load your cart." body={declutterErrorMessage(cart.error)} onRetry={() => void cart.refetch()} />;
  }
  if (cart.isLoading) return <p className="text-sm text-muted-foreground" role="status">Loading your cart…</p>;
  const mine = (cart.data ?? []).filter((l) => l.my_side === "buyer");
  // Only lines still inside their hold: checkout drops expired ones (money review #10).
  const now = Date.now();
  const waiting = mine.filter((l) => l.status === "in_cart" && new Date(l.checkout_by).getTime() > now);
  const bySeller = new Map<string, CartLine[]>();
  // A line still waiting for checkout always has its seller (an account with a line in flight cannot be deleted).
  for (const l of waiting) if (l.seller_id) bySeller.set(l.seller_id, [...(bySeller.get(l.seller_id) ?? []), l]);
  return (
    <section className="space-y-3" aria-label={cartSectionWords(waiting).title /* DA-4: "Claimed" when all free */}>
      <SectionHeading title={cartSectionWords(waiting).title} todo={waiting.length} todoWords={cartSectionWords(waiting).todoWords} />
      <PaySettlingNotice s={settling} />
      {waiting.length === 0 ? (
        <DeclutterNotice title="Your cart is empty.">When a seller accepts your offer, or you tap Buy, the item comes here. Buy now holds it 30 minutes; an accepted offer gives you 24 hours to check out.</DeclutterNotice>
      ) : (
        [...bySeller.entries()].map(([sellerId, lines], i) => {
          const soonest = lines.map((l) => l.checkout_by).sort()[0];
          // The Free section (20261027170717): an all-free group never reaches a payment page.
          const allFree = lines.every((l) => l.price_cents === 0);
          return (
            <section key={sellerId} className="rounded-2xl border border-border bg-card p-4 space-y-3 scroll-mt-4" aria-label={`Checkout ${i + 1}`} data-checkout-seller={sellerId}>
              {/* Board 161: several items from one seller are one checkout, one pickup and ONE buyer fee on the total. */}
              {/* Said once (lead 2026-10-28: the card read "From one seller · one checkout" then "One checkout, one pickup,
                  one payment."): the heading names the checkout, the line under it (2+ items) what they share. */}
              <CheckoutCardHead allFree={allFree} count={lines.length} />
              <ul className="space-y-2">
                {lines.map((l) => (
                  <li key={l.line_id} className="flex items-center justify-between gap-3 text-sm min-w-0" data-cart-line="">
                    <CartThumb path={l.item_id ? cover.get(l.item_id) : undefined} />
                    {l.item_id ? (
                      // NIGHT-BUYINGpresse-3: the title link was 20 px tall on a phone; it is now a 44 px tap.
                      <Link to={`/declutter/item/${l.item_id}`} className="flex min-h-11 min-w-0 items-center truncate" title={l.item_title}><span className="truncate">{l.item_title}</span></Link>
                    ) : (
                      <span className="truncate" title={l.item_title}>{l.item_title}</span>
                    )}
                    <span className="ml-auto shrink-0 font-semibold tabular-nums text-[hsl(var(--accent-ink))]">{itemPriceLabel(l.price_cents)}</span>
                    <RemoveFromCart line={l} />
                  </li>
                ))}
              </ul>
              <CartHold sellerId={sellerId} checkoutBy={soonest} allFree={allFree} lines={lines} timeLeft={timeLeft(soonest)} />
              {allFree ? (
                <FreeCheckoutForSeller sellerId={sellerId} porchOk={lines.every((l) => l.porch_ok !== false)} ways={waysEveryLineAllows(lines)} onDone={() => void cart.refetch()} />
              ) : (
                <PayWithBundle sellerId={sellerId} lines={lines} porchOk={lines.every((l) => l.porch_ok !== false)} onBack={() => void cart.refetch()}
                  held={settling.settling && (settling.sellerId === null || settling.sellerId === sellerId)} />
              )}
            </section>
          );
        })
      )}
    </section>
  );
}
