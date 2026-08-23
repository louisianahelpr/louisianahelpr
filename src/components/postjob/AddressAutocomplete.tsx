// Apple MapKit JS address typeahead for the Post-a-Task street field.
//
// Built to slot into the existing Logistics section: when the user
// picks a suggestion we populate streetAddress + city + zipCode in one
// shot (state is locked to LA elsewhere). When MapKit isn't usable
// (missing token / load error / 'idle' boot state), this component
// renders nothing and the caller falls back to its plain inputs.
//
// Follows CityAutocomplete's conventions:
//   - plain Input + absolutely-positioned suggestion list
//   - role="combobox" + aria-controls for screen readers
//   - mousedown-preventDefault on options so the click registers
//     before the input blurs
//   - free-typed values are still accepted on blur

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useMapKitJs } from "@/hooks/useMapKitJs";

interface AddressAutocompleteProps {
  id?: string;
  /** Current street value — kept in sync with the parent. */
  value: string;
  /**
   * Fires on every keystroke so the parent stays controlled. We pass
   * just the street part; full structured picks go through `onPick`.
   */
  onChange: (street: string) => void;
  /**
   * Fires when the user selects a MapKit suggestion. Components above
   * use this to also populate city + zip in one shot. Any of the
   * fields may be empty when MapKit couldn't infer it from the
   * placemark — callers should treat them as best-effort.
   */
  onPick: (picked: { street: string; city: string; zipCode: string }) => void;
  className?: string;
}

/**
 * Minimal MapKit JS shapes for the autocomplete + search calls. The full
 * `@types/mapkit-js` package has historically drifted from Apple's runtime,
 * so we model only the fields this component reads.
 */
interface MapKitAutocompleteResult {
  displayLines?: string[];
}
interface MapKitPlace {
  subThoroughfare?: string;
  thoroughfare?: string;
  locality?: string;
  postCode?: string;
  postalCode?: string;
}
interface MapKitSearch {
  autocomplete: (
    query: string,
    callback: (
      err: Error | null,
      data: { results?: MapKitAutocompleteResult[] },
    ) => void,
  ) => void;
  search: (
    query: MapKitAutocompleteResult,
    callback: (err: Error | null, data: { places?: MapKitPlace[] }) => void,
  ) => void;
}

interface MapKitSuggestion {
  displayLines: string[];
  raw: MapKitAutocompleteResult;
}

// Louisiana's bounding box (rough): south~28.9, west~-94.1, north~33.1,
// east~-88.7. Setting a search region biases MapKit toward in-state
// results, which matches the rest of the app (LA-locked).
const LA_CENTER = { lat: 30.98, lng: -91.96 };
const LA_SPAN = { lat: 4.2, lng: 5.4 };

export function AddressAutocomplete({
  id,
  value,
  onChange,
  onPick,
  className,
}: AddressAutocompleteProps) {
  const mapKitStatus = useMapKitJs();
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<MapKitSuggestion[]>([]);
  const listboxId = useId();
  const searchRef = useRef<MapKitSearch | null>(null);

  // Sync local query when parent value changes (draft restore, etc.).
  useEffect(() => {
    setQuery(value);
  }, [value]);

  // Build a Search instance once MapKit is ready.
  useEffect(() => {
    if (mapKitStatus !== "ready" || !window.mapkit) return;
    try {
      const mk = window.mapkit;
      const region = new mk.CoordinateRegion(
        new mk.Coordinate(LA_CENTER.lat, LA_CENTER.lng),
        new mk.CoordinateSpan(LA_SPAN.lat, LA_SPAN.lng),
      );
      searchRef.current = new mk.Search({
        region,
        // Bias suggestions toward Louisiana. MapKit still returns
        // matches outside the region; the parish/state field is
        // locked to LA in the calling form, so a non-LA pick will
        // still get rejected at submit by validation downstream.
        getsUserLocation: false,
      });
    } catch {
      searchRef.current = null;
    }
  }, [mapKitStatus]);

  // Debounced autocomplete fetch.
  useEffect(() => {
    const trimmed = query.trim();
    const search = searchRef.current;
    if (!search || trimmed.length < 3) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      try {
        search.autocomplete(
          trimmed,
                  (err, data) => {
            if (cancelled || err || !data?.results) return;
                      const next: MapKitSuggestion[] = data.results.slice(0, 6).map((r) => ({
              displayLines: Array.isArray(r.displayLines) ? r.displayLines : [],
              raw: r,
            }));
            setSuggestions(next);
          },
        );
      } catch {
        setSuggestions([]);
      }
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  const showList = useMemo(
    () => open && suggestions.length > 0,
    [open, suggestions.length],
  );

  // Take a tapped suggestion → run search() to resolve the full
  // placemark (autocomplete gives display strings; search() gives
  // structured locality/postalCode), then propagate to the parent.
  const pick = (s: MapKitSuggestion) => {
    if (!searchRef.current) return;
    const fallbackStreet = s.displayLines[0] ?? query;
    setOpen(false);
    setQuery(fallbackStreet);
    onChange(fallbackStreet);

    try {
      searchRef.current.search(
        s.raw,
              (err, data) => {
          if (err || !data?.places?.length) {
            onPick({ street: fallbackStreet, city: "", zipCode: "" });
            return;
          }
                  const place = data.places[0];
          // MapKit fields are inconsistently shaped across versions —
          // we read them defensively. `subThoroughfare + thoroughfare`
          // is the canonical "123 Main St" decomposition; if missing
          // we fall back to the first display line.
          const sub = place.subThoroughfare ?? "";
          const thor = place.thoroughfare ?? "";
          const composedStreet = [sub, thor].filter(Boolean).join(" ").trim();
          const street = composedStreet || fallbackStreet;
          const city = place.locality ?? "";
          const zipCode = place.postCode ?? place.postalCode ?? "";
          setQuery(street);
          onChange(street);
          onPick({ street, city, zipCode });
        },
      );
    } catch {
      onPick({ street: fallbackStreet, city: "", zipCode: "" });
    }
  };

  // If MapKit can't be used, hide ourselves so the parent renders
  // its plain street input fallback. We only render when there's a
  // real chance of producing useful suggestions.
  if (mapKitStatus !== "ready") {
    return null;
  }

  return (
    <div className="relative">
      <Input
        id={id}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          if (suggestions.length > 0) setOpen(true);
        }}
        onBlur={() => {
          // Defer the close so a tap on a suggestion lands first.
          // The option's mousedown-preventDefault keeps the input
          // from blurring on touch, but pointer/keyboard paths still
          // hit this. 120ms matches CityAutocomplete-style timings.
          setTimeout(() => setOpen(false), 120);
        }}
        required
        maxLength={200}
        autoComplete="street-address"
        autoCapitalize="words"
        aria-label="Street address"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={listboxId}
        className={className}
      />
      {showList && (
        <ul
          id={listboxId}
          className="absolute z-30 left-0 right-0 mt-1 rounded-ds-md border border-border bg-card shadow-lg overflow-hidden"
          role="listbox"
        >
          {suggestions.map((s, i) => (
            <li key={`${s.displayLines.join("|")}-${i}`}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(s)}
                className="w-full text-left px-3 py-2.5 text-ds-13 flex items-start gap-2 hover:bg-secondary/70 active:bg-secondary transition-colors"
              >
                <MapPin className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium leading-tight truncate">
                    {s.displayLines[0] ?? ""}
                  </span>
                  {s.displayLines[1] && (
                    <span className="block text-ds-11 text-muted-foreground leading-tight truncate">
                      {s.displayLines[1]}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default AddressAutocomplete;
