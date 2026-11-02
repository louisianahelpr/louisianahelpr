/**
 * Shipping S2/S3 buyer picker ("Ship it to me" in How you'll get it; docs/specs/shipping-draft.md section 4; Q2259).
 * The buyer types a Louisiana address, gets up to 3 postage options from ship-rates (cheapest first and pre-picked),
 * and picks one. Checkout sends only the picked quote's id; the server reads its price and address again
 * (declutter_start_checkout p_quote_id). Shown only while declutter_shipping is on for this account (testers).
 * Kept out of DeclutterTradeViews (the component-size ratchet).
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fetchShipRates, type ShipQuote } from "@/lib/declutter/api";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { formatPrice } from "@/lib/declutter/distance";
import { isLouisianaZip } from "@/lib/shipping/policy";

export const SHIP_SERVICE_NAME: Record<ShipQuote["service"], string> = {
  usps_ground_advantage: "USPS Ground Advantage",
  usps_priority: "USPS Priority Mail",
  ups_ground: "UPS Ground",
};

/** ship-rates' own refusals, in the buyer's words (its 5xx answers are already a sentence). */
const SHIP_RATES_COPY: Record<string, string> = {
  address_incomplete: "Fill in the street, city and ZIP.",
  louisiana_only: "Shipping is for Louisiana addresses only.",
  not_shippable: "One of these items can't be shipped. Pick another way to get it.",
  parcel_too_big: "These items are too big to ship together. Pick another way to get it.",
  seller_zip_missing: "The seller hasn't set where it ships from yet. Pick another way to get it.",
  no_rates: "No shipping options for this address. Check it, or pick another way to get it.",
  nothing_to_ship: "Nothing from this seller is waiting for checkout.",
};

export function shipRatesMessage(err: unknown): string {
  const m = err instanceof Error ? err.message : "";
  if (Object.prototype.hasOwnProperty.call(SHIP_RATES_COPY, m)) return SHIP_RATES_COPY[m];
  if (/\s/.test(m) && m.endsWith(".")) return m;
  return declutterErrorMessage(err);
}

export function daysWords(d: number | null): string | null {
  if (d === null || d <= 0) return null;
  return d === 1 ? "about 1 day" : `about ${d} days`;
}

export function ShipToMe({ sellerId, picked, onPick }: {
  sellerId: string;
  picked: ShipQuote | null;
  onPick: (q: ShipQuote | null) => void;
}) {
  const [street1, setStreet1] = useState("");
  const [city, setCity] = useState("");
  const [zip, setZip] = useState("");
  const [quotes, setQuotes] = useState<ShipQuote[]>([]);
  const [error, setError] = useState<string | null>(null);
  const zipOk = isLouisianaZip(zip.trim());
  const ready = street1.trim().length >= 3 && city.trim().length >= 2 && zipOk;
  const getRates = useMutation({
    mutationFn: () => fetchShipRates(sellerId, { street1: street1.trim(), city: city.trim(), state: "LA", zip: zip.trim() }),
    onSuccess: (q) => {
      setError(null);
      setQuotes(q);
      onPick(q.find((x) => x.preselected) ?? q[0] ?? null);
    },
    onError: (err) => { setQuotes([]); onPick(null); setError(shipRatesMessage(err)); },
  });
  // A changed address is a new price: the old options go.
  const typed = (set: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    set(e.target.value);
    if (quotes.length > 0 || picked) { setQuotes([]); onPick(null); }
  };
  const id = `ship-${sellerId}`;
  return (
    <div className="space-y-2 rounded-xl border border-border p-3" data-ship-to-me="">
      <label className="block text-ds-13 font-semibold text-foreground" htmlFor={`${id}-street`}>Street address</label>
      <Input id={`${id}-street`} autoComplete="address-line1" value={street1} onChange={typed(setStreet1)} />
      <div className="grid grid-cols-[minmax(0,1fr)_6.5rem] gap-2">
        <div className="min-w-0">
          <label className="block text-ds-13 font-semibold text-foreground" htmlFor={`${id}-city`}>City</label>
          <Input id={`${id}-city`} autoComplete="address-level2" value={city} onChange={typed(setCity)} />
        </div>
        <div>
          <label className="block text-ds-13 font-semibold text-foreground" htmlFor={`${id}-zip`}>ZIP</label>
          <Input id={`${id}-zip`} inputMode="numeric" autoComplete="postal-code" maxLength={10} value={zip} onChange={typed(setZip)} />
        </div>
      </div>
      {zip.trim().length >= 5 && !zipOk && <p className="text-ds-12 text-destructive">Shipping is for Louisiana addresses only.</p>}
      <Button type="button" variant="outline" size="sm" className="rounded-full" disabled={!ready || getRates.isPending}
        onClick={() => getRates.mutate()}>
        {getRates.isPending ? "Getting prices…" : "Get prices"}
      </Button>
      {error && <p role="alert" className="text-ds-13 text-destructive">{error}</p>}
      {quotes.length > 0 && (
        <fieldset className="space-y-2" data-ship-quotes="">
          <legend className="text-ds-12 font-semibold text-muted-foreground">Shipping</legend>
          {quotes.map((q) => (
            <label key={q.quote_id} className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 ${picked?.quote_id === q.quote_id ? "border-2 border-primary" : "border-border"}`}>
              <input type="radio" className="h-4 w-4 min-h-0 min-w-0 shrink-0" name={`${id}-quote`} checked={picked?.quote_id === q.quote_id}
                onChange={() => onPick(q)} style={{ accentColor: "hsl(var(--primary))" }} />
              <span className="min-w-0 flex-1">
                <span className="block text-ds-14 font-semibold text-foreground">{SHIP_SERVICE_NAME[q.service]}</span>
                {daysWords(q.delivery_days) && <span className="block text-ds-12 text-muted-foreground">{daysWords(q.delivery_days)}</span>}
              </span>
              <span className="shrink-0 text-ds-14 font-bold tabular-nums text-[hsl(var(--accent-ink))]">{formatPrice(q.rate_cents)}</span>
            </label>
          ))}
          <p className="text-ds-12 text-muted-foreground">Prices hold for 30 minutes.</p>
        </fieldset>
      )}
    </div>
  );
}
