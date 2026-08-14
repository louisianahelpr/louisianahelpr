import { useState } from "react";
import { Capacitor } from "@capacitor/core";
import { LocateFixed, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useMapKitJs } from "@/hooks/useMapKitJs";
import { usePermissionRationale } from "@/hooks/usePermissionRationale";
import { hapticLight } from "@/lib/haptics";

/** Reverse-geocode result: every field may be blank if undecodable. */
interface ResolvedAddress {
  street: string;
  city: string;
  state: string;
  zipCode: string;
}

interface CurrentLocationPillProps {
  /** Fires with whatever fields we could resolve. Any may be empty. */
  onResolved: (picked: ResolvedAddress) => void;
}

const isNativePlatform = Capacitor.isNativePlatform();

/**
 * Normalize a reverse-geocoder's state value (full name or abbreviation)
 * to a 2-letter code, then test whether it's Louisiana. Returns null when
 * the state can't be determined (so we don't wrongly block the user).
 */
function isLouisianaState(rawState: string | undefined | null): boolean | null {
  const s = (rawState ?? "").trim().toLowerCase();
  if (!s) return null;
  return s === "la" || s === "louisiana";
}

/**
 * "Use my current location" — single-tap helper for the address step of
 * Post-a-Task. Walks the same fallback chain we use elsewhere:
 *
 *  1. Read a lat/lng. On native (iOS/Android) this goes through the
 *     Capacitor Geolocation plugin (single OS-native prompt); on web it
 *     uses `navigator.geolocation.getCurrentPosition`. Using the browser
 *     API on native triggered a SECOND "localhost would like to use your
 *     location" WKWebView prompt on top of the Capacitor one.
 *  2. Apple MapKit JS reverse-geocode (`mapkit.Geocoder.reverseLookup`)
 *     when MapKit is configured — the result mirrors AddressAutocomplete's
 *     "place" structure so we can populate street + city + state + zip in
 *     one shot.
 *  3. If MapKit isn't initialized, fall back to a Nominatim reverse lookup
 *     so the pill still works on devices where MapKit can't load. Returns
 *     a coarse city + state + zip when full street isn't decodable.
 *
 * Helpr only operates in Louisiana, so a geocode that resolves OUTSIDE
 * Louisiana is rejected with a clear message rather than silently coerced
 * to "LA" (which produced the nonsensical "San Francisco, LA 94108").
 *
 * Hidden surfaces: if neither geolocation nor any geocoder is available
 * we still render the button — it just shows a friendly toast on tap.
 */
export function CurrentLocationPill({ onResolved }: CurrentLocationPillProps) {
  const mapKitStatus = useMapKitJs();
  const { request: requestPermission } = usePermissionRationale();
  const [loading, setLoading] = useState(false);

  const reverseViaMapKit = (
    lat: number,
    lng: number,
  ): Promise<ResolvedAddress | null> => {
    return new Promise((resolve) => {
      const mk = window.mapkit;
      if (!mk) return resolve(null);
      try {
        // mapkit.Geocoder isn't in our minimal type — call defensively.
        const GeocoderCtor = (mk as unknown as { Geocoder?: new () => any }).Geocoder;
        if (!GeocoderCtor) return resolve(null);
        const geocoder = new GeocoderCtor();
        const coord = new mk.Coordinate(lat, lng);
        geocoder.reverseLookup(coord, (err: any, data: any) => {
          if (err || !data?.results?.length) return resolve(null);
          const place: any = data.results[0];
          const sub = place.subThoroughfare ?? "";
          const thor = place.thoroughfare ?? "";
          const street = [sub, thor].filter(Boolean).join(" ").trim();
          const city = place.locality ?? "";
          // administrativeArea is the state (e.g. "LA" / "Louisiana").
          const state = place.administrativeArea ?? place.administrativeAreaCode ?? "";
          const zipCode = place.postCode ?? place.postalCode ?? "";
          resolve({ street, city, state, zipCode });
        });
      } catch {
        resolve(null);
      }
    });
  };

  const reverseViaNominatim = async (
    lat: number,
    lng: number,
  ): Promise<ResolvedAddress | null> => {
    try {
      const url = new URL("https://nominatim.openstreetmap.org/reverse");
      url.searchParams.set("lat", String(lat));
      url.searchParams.set("lon", String(lng));
      url.searchParams.set("format", "json");
      const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
      if (!res.ok) return null;
      const body: any = await res.json();
      const a = body?.address ?? {};
      const houseNumber = a.house_number ?? "";
      const road = a.road ?? a.pedestrian ?? "";
      const street = [houseNumber, road].filter(Boolean).join(" ").trim();
      const city = a.city ?? a.town ?? a.village ?? "";
      // Nominatim returns the full state name in `state` (e.g. "Louisiana").
      const state = a.state ?? a["ISO3166-2-lvl4"]?.replace(/^US-/, "") ?? "";
      const zipCode = a.postcode ?? "";
      if (!street && !city && !zipCode) return null;
      return { street, city, state, zipCode };
    } catch {
      return null;
    }
  };

  // Read the current position. On native, route through the Capacitor
  // Geolocation plugin so iOS/Android show a single OS-native prompt — the
  // WKWebView navigator.geolocation shim fires a second "localhost would
  // like to use your location" prompt on top of the Capacitor one.
  const getPosition = async (): Promise<{ latitude: number; longitude: number }> => {
    if (isNativePlatform) {
      const { Geolocation } = await import("@capacitor/geolocation");
      const pos = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 12_000,
        maximumAge: 5 * 60 * 1000,
      });
      return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
    }
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
        reject,
        { enableHighAccuracy: true, timeout: 12_000, maximumAge: 5 * 60 * 1000 },
      );
    });
  };

  const handleTap = async () => {
    void hapticLight();
    if (loading) return;
    if (!isNativePlatform && (typeof navigator === "undefined" || !navigator.geolocation)) {
      toast.error("Location isn't supported on this device.");
      return;
    }

    // Pre-prompt with the friendly "why we want location" rationale before
    // the OS dialog fires. iOS only shows its system alert ONCE per install,
    // so a cold prompt here burns the single shot with no context. The hook
    // session-gates itself, so a returning user skips straight to the fetch.
    let coords: { latitude: number; longitude: number } | null = null;
    let posError: unknown = null;
    await requestPermission("location", async () => {
      setLoading(true);
      try {
        coords = await getPosition();
      } catch (err) {
        posError = err;
      }
    });

    // The user declined the rationale ("Not now") — the native call never
    // ran. Stay silent rather than nagging with an error toast.
    if (!coords && !posError) {
      setLoading(false);
      return;
    }

    if (posError) {
      setLoading(false);
      const code = (posError as { code?: number })?.code;
      const msg = String((posError as { message?: string })?.message ?? "");
      const denied =
        code === 1 /* PERMISSION_DENIED */ || /denied|permission/i.test(msg);
      toast.error(
        denied
          ? "Location permission denied — type the address instead."
          : "Couldn't get your location — try again or type it in.",
      );
      return;
    }

    const { latitude, longitude } = coords!;
    let picked: ResolvedAddress | null = null;
    if (mapKitStatus === "ready") {
      picked = await reverseViaMapKit(latitude, longitude);
    }
    if (!picked) {
      picked = await reverseViaNominatim(latitude, longitude);
    }
    setLoading(false);
    if (!picked) {
      toast.error("Couldn't resolve your address. Try typing it instead.");
      return;
    }
    // Louisiana-only: reject a geocode that clearly resolved out of state
    // instead of silently filling State="LA" on a non-LA city/zip. When
    // the state is undeterminable (null) we let it through — the form's
    // own validation still gates submission.
    if (isLouisianaState(picked.state) === false) {
      toast.error("Louisiana Helpr is available in Louisiana only.");
      return;
    }
    onResolved(picked);
    toast.success("Address filled from your current location");
  };

  return (
    <button
      type="button"
      onClick={handleTap}
      disabled={loading}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-ds-md font-sans font-semibold active:scale-95 transition-all text-ds-12"
      style={{
        color: "hsl(var(--bark))",
        background: "hsl(var(--parchment) / 0.7)",
        border: "0.5px solid hsl(var(--olivewood) / 0.22)",
        boxShadow:
          "inset 0 1px 1px 0 rgba(255, 255, 255, 0.55), " +
          "0 1px 2px hsl(var(--olivewood) / 0.06)",
      }}
      aria-label="Use my current location"
    >
      {loading ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
      ) : (
        <LocateFixed className="w-3.5 h-3.5" aria-hidden />
      )}
      {loading ? "Locating…" : "Use my location"}
    </button>
  );
}

export default CurrentLocationPill;
