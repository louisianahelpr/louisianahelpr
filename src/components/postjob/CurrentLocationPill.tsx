import { useState } from "react";
import { LocateFixed, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useMapKitJs } from "@/hooks/useMapKitJs";
import { hapticLight } from "@/lib/haptics";

interface CurrentLocationPillProps {
  /** Fires with whatever fields we could resolve. Any may be empty. */
  onResolved: (picked: { street: string; city: string; zipCode: string }) => void;
}

/**
 * "Use my current location" — single-tap helper for the address step of
 * Post-a-Task. Walks the same fallback chain we use elsewhere:
 *
 *  1. `navigator.geolocation.getCurrentPosition` to read a lat/lng.
 *  2. Apple MapKit JS reverse-geocode (`mapkit.Geocoder.reverseLookup`)
 *     when MapKit is configured — the result mirrors AddressAutocomplete's
 *     "place" structure so we can populate street + city + zip in one shot.
 *  3. If MapKit isn't initialized, fall back to a Nominatim reverse lookup
 *     so the pill still works on devices where MapKit can't load. Returns
 *     a coarse city + zip when full street isn't decodable.
 *
 * Hidden surfaces: if neither geolocation nor any geocoder is available
 * we still render the button — it just shows a friendly toast on tap.
 */
export function CurrentLocationPill({ onResolved }: CurrentLocationPillProps) {
  const mapKitStatus = useMapKitJs();
  const [loading, setLoading] = useState(false);

  const reverseViaMapKit = (
    lat: number,
    lng: number,
  ): Promise<{ street: string; city: string; zipCode: string } | null> => {
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
          const zipCode = place.postCode ?? place.postalCode ?? "";
          resolve({ street, city, zipCode });
        });
      } catch {
        resolve(null);
      }
    });
  };

  const reverseViaNominatim = async (
    lat: number,
    lng: number,
  ): Promise<{ street: string; city: string; zipCode: string } | null> => {
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
      const zipCode = a.postcode ?? "";
      if (!street && !city && !zipCode) return null;
      return { street, city, zipCode };
    } catch {
      return null;
    }
  };

  const handleTap = async () => {
    void hapticLight();
    if (loading) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      toast.error("Location isn't supported on this device.");
      return;
    }
    setLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        let picked: { street: string; city: string; zipCode: string } | null = null;
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
        onResolved(picked);
        toast.success("Address filled from your current location");
      },
      (err) => {
        setLoading(false);
        if (err.code === err.PERMISSION_DENIED) {
          toast.error("Location permission denied — type the address instead.");
        } else {
          toast.error("Couldn't get your location — try again or type it in.");
        }
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 5 * 60 * 1000 },
    );
  };

  return (
    <button
      type="button"
      onClick={handleTap}
      disabled={loading}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-ds-md font-sans font-semibold active:scale-95 transition-all"
      style={{
        fontSize: "0.75rem",
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
