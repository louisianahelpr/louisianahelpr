/**
 * The sell form's field groups, shared by the saved draft's step form (DeclutterSellView) and a new listing's one
 * screen (SellOneScreen, owner 2026-10-29: "ai should always be doing most of the work for declutter listing").
 * Presentational only: the state and server calls are useSellFlowState's.
 */
import type { ReactNode } from "react";
import { AddressNeedsExactSpot } from "./AddressNeedsExactSpot";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import type { SellerHandover } from "@/lib/declutter/api";
import { centsToDollars } from "@/lib/declutter/money";
import { OFFERS_TITLE, offersSettingLine } from "@/lib/declutter/offersOnPost";
import { DROP_PCT_CHOICES } from "@/lib/declutter/priceDrop";
import { ChipGroup, DropSchedule, StepperButton, dropRunTime } from "./DeclutterSellSteps";
import { PickupTimesEditor } from "./DeclutterPickupTimes";
import { SellHandoverChoices } from "./SellHandoverChoices";
import { SellerAddressField } from "./SellerAddressField";
import { SavedPlacesComeFirst, useHasPorchPlaces } from "./SellPorchPlaces";
import { TaxStatementsCheck } from "./declutterUi";
import { DROPS_SWITCH_LABEL, priceTooLowForDrops } from "./sellForm";
import type { SellFlow } from "./useSellFlowState";

export const SELL_INPUT =
  "w-full h-[52px] rounded-[14px] border border-border bg-card px-4 text-ds-15 text-foreground focus:border-primary focus:outline-none placeholder:text-muted-foreground";

export function FieldLabel({ htmlFor, text, extra }: { htmlFor: string; text: string; extra?: string }) {
  return (
    <label className="block text-ds-14 font-semibold text-foreground" htmlFor={htmlFor}>
      {text}
      {extra && <span className="font-normal text-muted-foreground"> {extra}</span>}
    </label>
  );
}

/** The big price box with its $1 steppers. */
export function SellPriceInput({ s }: { s: SellFlow }) {
  const { form, set, priceCents } = s;
  return (
    <div className="flex items-center justify-center gap-4">
      <StepperButton label="Lower the price by $1" disabled={!priceCents || priceCents <= 100} onClick={() => set("price", centsToDollars(Math.max(100, (priceCents ?? 100) - 100)))}>−</StepperButton>
      {/* text-ds-40 on the WRAPPER too (deep audit #43): on a phone index.css floors every input at
          max(16px, 1em), which beats the input's own text-ds-40, and 1em is this wrapper's size. Without it
          the digits drew at 16px beside a 40px "$". Guard: src/test/bigDigitInputsKeepTheirSize.test.ts. */}
      <div className="flex min-w-0 items-baseline justify-center text-ds-40 text-[hsl(var(--burnt-sienna))]">
        <span className="text-ds-40 font-bold" aria-hidden>$</span>
        <input
          id="sell-price"
          aria-label="Price"
          inputMode="decimal"
          value={form.price}
          onChange={(e) => set("price", e.target.value.replace(/[^0-9.]/g, ""))}
          placeholder="0"
          style={{ width: `${Math.max(1, form.price.length || 1) + 0.5}ch` }}
          className="max-w-[7ch] bg-transparent text-left text-ds-40 font-bold tabular-nums outline-none focus-visible:outline-none placeholder:text-muted-foreground"
        />
      </div>
      <StepperButton label="Raise the price by $1" disabled={(priceCents ?? 0) >= 100_000} onClick={() => set("price", centsToDollars(Math.min(100_000, (priceCents ?? 0) + 100)))}>+</StepperButton>
    </div>
  );
}

/** "Give it away free" and, when free, what that means. */
export function SellFreeToggle({ s }: { s: SellFlow }) {
  const { form, setForm } = s;
  return (<>
    <label className="flex min-h-11 items-center gap-3 rounded-[14px] border border-border bg-card px-4 text-ds-15 font-semibold text-foreground" data-sell-free="">
      <Checkbox checked={form.free} onCheckedChange={(v) => setForm((f) => ({ ...f, free: v === true }))} />
      Give it away free
    </label>
    {form.free && <SellFreeNote />}
  </>);
}

/** What free means, under a free listing's price (LEAD-FREE-MOVE: free is chosen on the sell chooser's first screen). */
export function SellFreeNote() {
  return (
    <p className="text-ds-14 text-muted-foreground" data-sell-free-note="">
      Free items are claimed, not bought: no offers and no price drops. The person who claims it picks it up
      from your porch, and nothing is charged.
    </p>
  );
}

/**
 * LEAD-OFFERS-CHOICE part (2) (owner 2026-10-31): a new listing's "Accept offers", starting from the saved default
 * (Settings > Listing defaults) and saved with the item at Post. A free item is claimed, so it has no offers to take.
 */
export function SellOffersToggle({ s }: { s: SellFlow }) {
  const { form, offersWanted, setOffersWanted } = s;
  if (form.free) return null;
  return (
    <div className="flex min-h-11 items-center gap-3 rounded-[14px] border border-border bg-card px-4 py-3" data-sell-offers={offersWanted ? "on" : "off"}>
      <label htmlFor="sell-offers" className="min-w-0 flex-1">
        <span className="block text-ds-15 font-semibold text-foreground">{OFFERS_TITLE}</span>
        <span className="block text-ds-13 text-muted-foreground">{offersSettingLine(offersWanted)}</span>
      </label>
      <Switch id="sell-offers" checked={offersWanted} onCheckedChange={(v) => setOffersWanted(v === true)} />
    </div>
  );
}

/**
 * Owner 2026-10-28: the seller turns drops on and picks the step; a lowest price never turns them on.
 * `offerRules` takes the place of the "Lowest you'll take" box once builder 28's DeclutterOfferRules lands.
 */
export function SellDropsCard({ s, offerRules }: { s: SellFlow; offerRules?: ReactNode }) {
  const { form, setForm, set, priceCents, floorCents } = s;
  const tooLow = priceTooLowForDrops(form.price);
  const on = form.drops && !tooLow;
  return (
    <div className="space-y-4 rounded-[20px] border border-border bg-card p-4" data-sell-drops={on ? "on" : "off"}>
      <div className="flex items-start gap-3">
        <label htmlFor="sell-drops" className="min-w-0 flex-1">
          <span className="block text-ds-15 font-semibold text-foreground">{DROPS_SWITCH_LABEL}</span>
          <span className="block text-ds-13 text-muted-foreground">
            {tooLow ? "At this price there's nothing lower to drop to, so it stays at your price." : on ? `On. It drops ${form.dropPct}% each evening at ${dropRunTime()}, to a whole dollar, never below your lowest price. Turn this off if it should never drop.` : "Off. It stays at your price until you change it."}
          </span>
        </label>
        <Switch id="sell-drops" checked={on} disabled={tooLow} onCheckedChange={(v) => setForm((f) => ({ ...f, drops: v === true }))} />
      </div>
      {on && (<>
        <ChipGroup label="How much each evening" options={DROP_PCT_CHOICES.map((p) => ({ value: String(p), label: `${p}%` }))} value={String(form.dropPct)} onChange={(v) => set("dropPct", Number(v))} />
        {offerRules ?? (
          <div className="space-y-2">
            <FieldLabel htmlFor="sell-floor" text="Lowest you'll take" />
            <div className="flex h-[52px] items-center gap-1 rounded-[14px] border border-border bg-background px-4 focus-within:border-primary focus-within:ring-2 focus-within:ring-ring">
              <span className="text-ds-15 font-semibold text-[hsl(var(--burnt-sienna))]" aria-hidden>$</span>
              <input id="sell-floor" inputMode="decimal" value={form.floor} onChange={(e) => set("floor", e.target.value.replace(/[^0-9.]/g, ""))} placeholder="e.g. 30"
                className="w-full bg-transparent text-ds-15 font-semibold text-[hsl(var(--burnt-sienna))] outline-none focus-visible:outline-none focus-visible:ring-0 placeholder:font-normal placeholder:text-muted-foreground" />
            </div>
            <p className="text-ds-13 text-muted-foreground">Only you see this. The drops stop here.</p>
          </div>
        )}
        <DropSchedule priceCents={priceCents} floorCents={floorCents} pct={form.dropPct} />
      </>)}
    </div>
  );
}

/** How buyers get it: the ways, the area, the private pickup address and the seller's pickup times. */
/** With saved places these times no longer set porch days (declutter_order_is_porch_day); these ways still read them. */
const PICKUP_TIMES_WITH_PLACES = "Safe meeting spots and Helpr delivery pickups use these times. They apply to all your listings.";
const PICKUP_TIMES_FREE_WITH_PLACES = "A free item is picked up on the place's days, so these times are for your other listings.";

export function SellWaysFields({ s }: { s: SellFlow }) {
  const { form, set, ways, setWays, sellerDeliveryOpen, windows, setWindows, place } = s;
  const hasPlaces = useHasPorchPlaces();
  return (<>
    <SellHandoverChoices ways={ways} setWays={(w: SellerHandover[]) => setWays(w)} free={form.free} sellerDeliveryOpen={sellerDeliveryOpen} pickupDays={windows.map((w) => w.weekday)} />
    {hasPlaces && <SavedPlacesComeFirst free={form.free} />}
    {/* Owner 10-30: no box for the area. Buyers see the city from this address (SellerAddressField). */}
    <div className="space-y-2">
      <FieldLabel htmlFor="sell-address" text="Pickup address" />
      <SellerAddressField id="sell-address" ariaLabel="Pickup address" className={SELL_INPUT} value={form.pickupAddress} place={place}
        onChange={(address, city) => { set("pickupAddress", address); set("areaLabel", city); }} />
      {/* DA-5: nobody pays for a free item; the address shows to the person it goes to once their pickup is set. */}
      <p className="text-ds-13 text-muted-foreground" data-sell-address-note="">
        {hasPlaces
          ? (form.free ? "Private. Only used if you remove your saved places." : "Private. Only used when a buyer gets it another way, or if you remove your saved places.")
          : (form.free ? "Private. Only the person who gets it sees it." : "Private. Only the buyer who pays sees it.")}
      </p>
      <AddressNeedsExactSpot typedAddress={form.pickupAddress} inexact={place.inexact} locating={place.locating} shareMyLocation={place.shareMyLocation} />
    </div>
    <div className="space-y-2" aria-labelledby="sell-pickup">
      <h3 id="sell-pickup" className="text-ds-14 font-semibold text-foreground">Your usual pickup times</h3>
      <p className="text-ds-13 text-muted-foreground">{hasPlaces ? (form.free ? PICKUP_TIMES_FREE_WITH_PLACES : PICKUP_TIMES_WITH_PLACES) : "Buyers pick one of these times. They apply to all your listings."}</p>
      <PickupTimesEditor windows={windows} setWindows={setWindows} />
    </div>
  </>);
}

/** The four statements above ONE checkbox (row 54; owner 2026-10-28 and 2026-10-30; attestItem records all four). */
export function SellTaxBox({ s }: { s: SellFlow }) {
  const { attested, setAttested, form } = s;
  return (
    <div className="space-y-3 rounded-[20px] border border-border bg-card p-4" aria-labelledby="sell-tax-head" data-sell-tax="">
      <h3 id="sell-tax-head" className="text-ds-15 font-semibold text-foreground">Confirm about this item</h3>
      {!form.free && <p className="text-ds-13 text-muted-foreground">Louisiana doesn't charge sales tax on occasional sales of your own things.</p>}
      <TaxStatementsCheck id="sell-tax" checked={attested} onChange={setAttested} free={form.free} />
    </div>
  );
}
