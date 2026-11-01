/**
 * "Deliver to" for Helpr delivery and seller delivery at checkout (owner 2026-11-01, screenshot: typing "314 Lynn
 * Street" and Get price said "We couldn't find that address"). The app's shared address search
 * (postjob/AddressAutocomplete, as SellerAddressField and Post a Job's AddressBlock use it) with "Use my current
 * location", so the buyer picks a whole address ("314 Lynn St, New Iberia, LA 70560") instead of free text. A pick
 * hands that whole address on at once (`onPicked`), so the caller prices it without another tap. The server still
 * geocodes the address itself (declutter-checkout delivery_quote): a buyer never sends the point the price is
 * measured from. While Apple's search can't be used, the same box takes a typed address, as before.
 */
import { AddressAutocomplete } from "@/components/postjob/AddressAutocomplete";
import { CurrentLocationPill } from "@/components/postjob/CurrentLocationPill";

/** "314 Lynn St, New Iberia, LA 70560": a pick's parts as one line, a town never said twice. */
export function dropoffLine(street: string, city: string, state: string, zip: string): string {
  const st = /^louisiana$/i.test(state.trim()) ? "LA" : state.trim();
  const stateZip = [st, zip.trim()].filter(Boolean).join(" ");
  const sameAsCity = street.trim().toLowerCase() === city.trim().toLowerCase();
  return [sameAsCity ? "" : street, city, stateZip].map((s) => s.trim()).filter(Boolean).join(", ");
}

export function DropoffAddressField({ id, value, onTyped, onPicked, invalid, describedBy }: {
  id: string;
  value: string;
  /** Every keystroke (the parent keeps the box controlled). */
  onTyped: (typed: string) => void;
  /** A whole address picked from the list or from the current location: price it now. */
  onPicked: (address: string) => void;
  invalid?: boolean;
  describedBy?: string;
}) {
  const take = (p: { street: string; city: string; state: string; zipCode: string }) => {
    const line = dropoffLine(p.street, p.city, p.state, p.zipCode);
    if (line.length >= 5) onPicked(line);
  };
  return (
    <div className="space-y-2" data-dropoff-address="" aria-invalid={invalid ? true : undefined} aria-describedby={describedBy}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={id} className="block text-xs font-medium">Deliver to</label>
        <CurrentLocationPill onResolved={take} />
      </div>
      <AddressAutocomplete
        id={id}
        value={value}
        ariaLabel="Deliver to"
        placeholder="Start typing, then pick the address"
        className="w-full min-w-0 rounded-lg border border-input bg-background px-3 py-2 text-sm"
        plainWithoutMapKit
        keepListInView
        onChange={onTyped}
        onPick={take}
      />
    </div>
  );
}
