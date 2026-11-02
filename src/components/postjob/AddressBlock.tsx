import { useState } from "react";
import { MapPin, Shield } from "lucide-react";
import { CityAutocomplete } from "@/components/postjob/CityAutocomplete";
import { AddressAutocomplete } from "@/components/postjob/AddressAutocomplete";
import { AppleMapPreview } from "@/components/postjob/AppleMapPreview";
import { CurrentLocationPill } from "@/components/postjob/CurrentLocationPill";
import { useMapKitJs } from "@/hooks/useMapKitJs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError } from "@/components/ui/FieldError";

// Normalize a geocoder's state value (full name or abbreviation) to the canonical 2-letter code the
// form stores. "Louisiana" -> "LA"; any other 2-letter code is upper-cased and passed through; anything
// else is returned trimmed rather than coerced, so the field reflects what was geocoded.
function normalizeStateCode(rawState: string): string {
  const s = rawState.trim();
  if (/^louisiana$/i.test(s)) return "LA";
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  return s;
}

interface AddressBlockProps {
  streetAddress: string;
  setStreetAddress: (v: string) => void;
  city: string;
  setCity: (v: string) => void;
  addrState: string;
  setAddrState: (v: string) => void;
  zipCode: string;
  setZipCode: (v: string) => void;
  /** The "Only your city is shown" line. Off where the screen draws its own
   *  privacy note (Post a job's WHERE, board 45). */
  privacyLine?: boolean;
}

/**
 * Post a Job screen 4's address (friction 4, lead GO 2026-10-21): ONE search box. Type, pick a
 * suggestion, and street, city, state and ZIP are all filled (Apple MapKit, LA-biased). The picked
 * address then reads as one line with "Change". No data-model or geocoding change: the four fields
 * are stored as before, and backfill-job-geocode still works from the address text.
 *
 * "Enter it yourself" opens the four fields (the same fields as before, labelled street / city /
 * state / ZIP). They are also what shows when MapKit is not ready, and when a pick comes back
 * without a city or ZIP, so nothing is ever unreachable. The e2e journeys type ZIP 99999 through
 * that path on purpose (no parish, so no real Helpr is notified).
 */
export function AddressBlock({ streetAddress, setStreetAddress, city, setCity, addrState, setAddrState, zipCode, setZipCode, privacyLine = true }: AddressBlockProps) {
  const mapKitReady = useMapKitJs() === "ready";
  const [manual, setManual] = useState(false);
  const [changing, setChanging] = useState(false);
  // A pick outside Louisiana is refused here rather than stored: Helpr works in Louisiana only.
  const [outOfState, setOutOfState] = useState(false);
  const complete = !!(streetAddress.trim() && city.trim() && zipCode.trim());
  const oneBox = mapKitReady && !manual;
  const link = "inline-flex min-h-[44px] items-center font-sans text-ds-13 font-semibold text-[hsl(var(--bark))]";

  return (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <Label id="location-label">Location <span className="text-[hsl(var(--destructive-ink))]">*</span></Label>
          {/* "Use my current location" — Capacitor/web Geolocation +
              MapKit reverse-geocode in one tap. Falls back to a tasteful
              error toast if location is denied or no street can be
              resolved. */}
          <CurrentLocationPill
            onResolved={({ street, city: pickedCity, state: pickedState, zipCode: pickedZip }) => {
              if (street) setStreetAddress(street);
              if (pickedCity) setCity(pickedCity);
              // Store the state the geocoder actually resolved — never a
              // hard-coded "LA", which produced "San Francisco, LA 94108".
              // The pill already rejects clearly out-of-state geocodes, so
              // this only normalizes the LA name/code to the canonical
              // 2-letter "LA" we store (a coarse/blank geocode passes
              // through untouched for the form's own validation to gate).
              if (pickedState) setAddrState(normalizeStateCode(pickedState));
              if (pickedZip) setZipCode(pickedZip);
            }}
          />
        </div>
        {oneBox && complete && !changing ? (
          <div className="flex items-center gap-3 rounded-ds-md border border-border bg-card px-3 py-2.5" data-testid="address-summary">
            <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <p className="min-w-0 flex-1 font-sans text-ds-14 text-foreground">
              {streetAddress.trim()}, {city.trim()}, {addrState || "LA"} {zipCode.trim()}
            </p>
            <button type="button" className={link} onClick={() => setChanging(true)}>Change</button>
          </div>
        ) : oneBox ? (
          <>
            <Label htmlFor="streetAddress" className="text-ds-11 text-muted-foreground">Address</Label>
            <AddressAutocomplete
              id="streetAddress"
              value={streetAddress}
              onChange={setStreetAddress}
              ariaLabel="Address"
              placeholder="Start typing, then pick your address"
              onPick={({ street, city: pickedCity, state: pickedState, zipCode: pickedZip }) => {
                const st = pickedState ? normalizeStateCode(pickedState) : "";
                setOutOfState(!!st && st !== "LA");
                if (st && st !== "LA") return;
                setStreetAddress(street);
                if (pickedCity) setCity(pickedCity);
                if (pickedState) setAddrState(normalizeStateCode(pickedState));
                if (pickedZip) setZipCode(pickedZip);
                // A pick without a city or ZIP opens the fields so the poster can finish it.
                if (!pickedCity || !pickedZip) setManual(true);
                setChanging(false);
              }}
            />
            {outOfState && <FieldError>Helpr works in Louisiana only. Pick a Louisiana address.</FieldError>}
            {!outOfState && streetAddress.trim().length > 0 && !complete && (
              <FieldError>Pick your address from the list, or enter it yourself.</FieldError>
            )}
          </>
        ) : null}
        {oneBox ? (
          <button type="button" className={link} onClick={() => setManual(true)}>Enter it yourself</button>
        ) : (
          <>
          {mapKitReady && (
            <button type="button" className={link} onClick={() => { setManual(false); setChanging(true); }}>Search for it instead</button>
          )}
          <Label htmlFor="streetAddress" className="text-ds-11 text-muted-foreground">Street address</Label>
          {mapKitReady ? (
            <AddressAutocomplete
              id="streetAddress"
              value={streetAddress}
              onChange={setStreetAddress}
              onPick={({ street, city: pickedCity, state: pickedState, zipCode: pickedZip }) => {
                setStreetAddress(street);
                // Only overwrite the city/zip when MapKit actually gave
                // us a value — otherwise we'd blank a user-typed field.
                if (pickedCity) setCity(pickedCity);
                if (pickedState) setAddrState(normalizeStateCode(pickedState));
                if (pickedZip) setZipCode(pickedZip);
              }}
            />
          ) : (
            <Input id="streetAddress" value={streetAddress} onChange={(e) => setStreetAddress(e.target.value)} required maxLength={200} autoComplete="street-address" autoCapitalize="words" aria-label="Street address" />
          )}
          {/* Weighted, not thirds. Three equal columns gave City the same 81px
              the two-letter State got, and "Baton Rouge" — the city most posts
              are in — rendered as "Baton R" at 375 (measured 2026-09-07). City
              takes the room; State is a fixed two letters (3rem); ZIP is five digits
              (4.5rem). Measured after the first cut: 3.5/5.25rem still left City
              at 109px against 117px of text. */}
          <div className="grid grid-cols-[minmax(0,1fr)_3rem_4.5rem] gap-2.5">
            {/* City is the only address part shown publicly on job cards.
                CityAutocomplete suggests canonical Louisiana city names so
                card display + filtering stay consistent; free-typed
                values are still accepted and title-cased. */}
            <div className="space-y-1.5 min-w-0">
              <Label htmlFor="city" className="text-ds-11 text-muted-foreground">City</Label>
              <CityAutocomplete
                id="city"
                value={city}
                onChange={setCity}
                required
                className="px-3 text-ds-14"
              />
            </div>
            {/* State is locked to LA — Helpr only operates in Louisiana,
                so this is a fixed field rather than a free input. */}
            <div className="space-y-1.5 min-w-0">
              <Label htmlFor="state" className="text-ds-11 text-muted-foreground">State</Label>
              <Input
                id="state"
                value={addrState || "LA"}
                readOnly
                tabIndex={-1}
                aria-label="State (Louisiana)"
                className="px-3 text-ds-14 bg-muted/50 text-muted-foreground cursor-default"
              />
            </div>
            <div className="space-y-1.5 min-w-0">
              <Label htmlFor="zipCode" className="text-ds-11 text-muted-foreground">ZIP</Label>
              <Input id="zipCode" value={zipCode} onChange={(e) => setZipCode(e.target.value)} required maxLength={10} inputMode="numeric" autoComplete="postal-code" aria-label="ZIP code" aria-invalid={streetAddress.trim().length > 0 && !zipCode.trim()} className="px-3 text-ds-14" />
            </div>
          </div>
          {/* Address-gate hint — the submit button stays disabled until Zip is
              filled, but the Zip sits to the side of the read-only State field,
              so a poster who typed a street address could be silently blocked
              with no idea why (LH-53). State is locked to LA, so Zip is the only
              field a poster can still be missing here; name it inline using the
              same error treatment as the description placeholder guard (LH-23). */}
          {streetAddress.trim().length > 0 && !zipCode.trim() && (
            <FieldError>
              Add the zip code to continue.
            </FieldError>
          )}
          </>
        )}
        {/* Parish is silently looked up from zip for Louisiana sales tax (admin-only). */}
        {privacyLine && (
          <p className="text-ds-11 text-muted-foreground flex items-center gap-1.5">
            <Shield className="w-3 h-3 shrink-0" />
            Only your city is shown until you pick a Helpr.
          </p>
        )}
        {/* Apple MapKit JS embedded preview — confirms visually that the
            typed address resolved to the right spot. Hides itself when
            MapKit isn't configured. */}
        <AppleMapPreview
          street={streetAddress}
          city={city}
          state={addrState || "LA"}
          zipCode={zipCode}
        />
      </div>
  );
}
